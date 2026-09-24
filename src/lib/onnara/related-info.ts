/**
 * 온나라 기안기 화면의 '관련정보' 문서 추출 및 AI 프롬프트 연동 모듈.
 *
 * 공문 작성 시 사용자가 '관련정보'로 등록해 둔 문서(상급기관 지침, 전년도 계획, 관련 공문 등)를
 * DOM에서 자동 탐지하고, 원문 본문을 회수하여 AI 초안 작성 시 정확한 참고 컨텍스트로 제공한다.
 */

import type { DraftTemplate } from './draft-templates';

export interface RelatedDocInfo {
  id?: string;
  docNumber?: string;
  title: string;
  type?: string; // '문서' | '보고문서' | '메모보고' | '직접입력' | '정책점검' 등
  rawText: string;
  content?: string; // 추출된 본문 텍스트
  summary?: string; // 본문 핵심 요약
  source?: 'dom' | 'background' | 'manual';
  status?: 'idle' | 'loading' | 'loaded' | 'error';
  errorMessage?: string;
}

/** 텍스트에서 불필요한 공백 및 버튼 문구(삭제, 검색, 닫기 등) 제거 */
function cleanRawText(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s*(삭제|추가|검색|닫기|조회|미리보기|다운로드|열기)\s*$/gi, '')
    .trim();
}

/** '[문서] 제목' 형태의 문자열에서 구분(type), 제목(title), 문서번호(docNumber) 추출 */
export function parseRelatedDocText(raw: string): { type: string; title: string; docNumber?: string } | null {
  const cleaned = cleanRawText(raw);
  if (!cleaned) return null;

  // 1. [구분] 제목 패턴 탐색 (예: [문서] 공유재산관리계획 수립...)
  const bracketMatch = cleaned.match(/^\[([^\]]+)\]\s*(.+)$/);
  let type = '문서';
  let title = cleaned;

  if (bracketMatch && bracketMatch[1] && bracketMatch[2]) {
    type = bracketMatch[1].trim();
    title = bracketMatch[2].trim();
  } else {
    // 괄호가 없지만 '문서: ...' 등의 형태일 경우
    const colonMatch = cleaned.match(/^(보고문서|메모보고|직접입력|정책점검|문서)\s*[:]\s*(.+)$/);
    if (colonMatch && colonMatch[1] && colonMatch[2]) {
      type = colonMatch[1].trim();
      title = colonMatch[2].trim();
    }
  }

  // 2. 제목 내부에서 문서번호가 괄호로 포함된 경우 추출 (예: 제목 (11099))
  let docNumber: string | undefined;
  const numMatch = title.match(/[\(#](\d{4,8})[\)]?$/);
  if (numMatch && numMatch[1]) {
    docNumber = numMatch[1];
    title = title.replace(/[\(#](\d{4,8})[\)]?$/, '').trim();
  }

  // 버튼 문구 등이 잔존할 경우 2차 정제
  title = title.replace(/\s*(삭제|선택|보기)\s*$/g, '').trim();

  if (!title || title.length < 2) return null;

  return { type, title, docNumber };
}

/** 요소 또는 상위 속성에서 문서 식별자(ID) 탐색 */
function findDocIdFromElement(el: HTMLElement): { id?: string; docNumber?: string } {
  // data 속성 확인
  const dataId = el.getAttribute('data-id') || el.getAttribute('data-docid') || el.getAttribute('data-report-id') || el.getAttribute('data-doc-id');
  if (dataId) return { id: dataId, docNumber: dataId };

  // onclick 속성 확인 (예: fn_viewDoc('11099'), fn_openReport('11099'))
  const onclick = el.getAttribute('onclick') || '';
  const clickMatch = onclick.match(/(?:fn_view|fn_open|openDoc|viewReport|openReport)[a-zA-Z0-9_]*\s*\(\s*['"]?([^'",\)\s]+)/i);
  if (clickMatch && clickMatch[1]) {
    return { id: clickMatch[1], docNumber: /^\d+$/.test(clickMatch[1]) ? clickMatch[1] : undefined };
  }

  // 인접 또는 자식 hidden input 확인
  const hiddenInp = el.querySelector<HTMLInputElement>('input[type="hidden"]') || el.parentElement?.querySelector<HTMLInputElement>('input[type="hidden"]');
  if (hiddenInp && hiddenInp.value && /^\d+$/.test(hiddenInp.value.trim())) {
    return { id: hiddenInp.value.trim(), docNumber: hiddenInp.value.trim() };
  }

  return {};
}

/** 모든 프레임을 순회하며 Document 배열 반환 */
function getAllFrameDocuments(rootDoc: Document): Document[] {
  const docs: Document[] = [rootDoc];
  const iframes = Array.from(rootDoc.querySelectorAll('iframe'));
  for (const ifr of iframes) {
    try {
      if (ifr.contentDocument) {
        docs.push(...getAllFrameDocuments(ifr.contentDocument));
      }
    } catch {
      // cross-origin 무시
    }
  }
  return docs;
}

/**
 * 기안기 DOM에서 '관련정보'로 등록된 모든 참고 문서를 추출한다.
 */
export function extractRelatedDocuments(rootDoc: Document = document): RelatedDocInfo[] {
  const results: RelatedDocInfo[] = [];
  const seenTitles = new Set<string>();

  const docs = getAllFrameDocuments(rootDoc);

  for (const doc of docs) {
    // ── 전략 1: '관련정보' 레이블(th, td, label 등) 기반 탐색 ──
    const labelCandidates = Array.from(
      doc.querySelectorAll<HTMLElement>('th, td, label, dt, span, div.title, .form-title')
    );

    for (const labelEl of labelCandidates) {
      const text = (labelEl.textContent || '').trim();
      if (!/관련\s*정보/i.test(text)) continue;

      // 레이블에 해당하는 값 컨테이너 탐색
      let valueContainer: HTMLElement | null = null;

      // A. table 구조: th의 형제 td 또는 같은 tr 내의 td
      if (labelEl.tagName === 'TH' || labelEl.tagName === 'TD') {
        const tr = labelEl.closest('tr');
        if (tr) {
          const tds = Array.from(tr.querySelectorAll('td'));
          valueContainer = tds.find(td => td !== labelEl) || null;
        }
      }

      // B. label 구조: for 속성 또는 다음 형제 요소
      if (!valueContainer && labelEl.tagName === 'LABEL') {
        const forId = labelEl.getAttribute('for');
        if (forId) valueContainer = doc.getElementById(forId);
        if (!valueContainer) valueContainer = labelEl.nextElementSibling as HTMLElement | null;
      }

      // C. 일반 div/dt 구조: 다음 형제 요소
      if (!valueContainer) {
        valueContainer = (labelEl.nextElementSibling as HTMLElement | null) || (labelEl.parentElement?.querySelector('dd, .form-value') as HTMLElement | null);
      }

      if (valueContainer) {
        // 컨테이너 내부의 개별 항목(span, a, li, div) 탐색
        const itemEls = Array.from(valueContainer.querySelectorAll<HTMLElement>('a, span, li, p, div'));
        const targetedEls = itemEls.length > 0 ? itemEls : [valueContainer];

        for (const el of targetedEls) {
          // 버튼이나 아이콘 자체는 건너뜀
          if (el.tagName === 'BUTTON' || el.classList.contains('btn') || el.classList.contains('ico')) continue;

          const raw = (el.textContent || '').trim();
          const parsed = parseRelatedDocText(raw);
          if (parsed && !seenTitles.has(parsed.title)) {
            seenTitles.add(parsed.title);
            const idInfo = findDocIdFromElement(el);
            results.push({
              title: parsed.title,
              type: parsed.type,
              docNumber: parsed.docNumber || idInfo.docNumber,
              id: idInfo.id,
              rawText: raw,
              source: 'dom',
              status: 'idle',
            });
          }
        }
      }
    }

    // ── 전략 2: addinfo/reldoc 관련 식별자(ID, class, name) 탐색 ──
    const idContainers = Array.from(
      doc.querySelectorAll<HTMLElement>(
        '#divAddInfo, #addInfoList, #tbAddInfo, #tblAddInfo, #relDocList, [id*="addInfo"], [id*="relDoc"], [class*="add_info"]'
      )
    );

    for (const c of idContainers) {
      const items = Array.from(c.querySelectorAll<HTMLElement>('a, span, li, tr'));
      const targets = items.length > 0 ? items : [c];

      for (const el of targets) {
        if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') continue;
        const raw = (el.textContent || '').trim();
        const parsed = parseRelatedDocText(raw);
        if (parsed && !seenTitles.has(parsed.title)) {
          seenTitles.add(parsed.title);
          const idInfo = findDocIdFromElement(el);
          results.push({
            title: parsed.title,
            type: parsed.type,
            docNumber: parsed.docNumber || idInfo.docNumber,
            id: idInfo.id,
            rawText: raw,
            source: 'dom',
            status: 'idle',
          });
        }
      }
    }

    // ── 전략 3: 폼 내 hidden input 탐색 (addInfoDocId, relDocTitle 등) ──
    const hiddenTitleInputs = Array.from(
      doc.querySelectorAll<HTMLInputElement>(
        'input[type="hidden"][name*="addInfo"], input[type="hidden"][name*="relDoc"], input[type="hidden"][name*="relReport"]'
      )
    );

    for (const inp of hiddenTitleInputs) {
      const val = inp.value?.trim();
      if (!val || val.length < 2 || /^\d+$/.test(val)) continue; // 순수 숫자는 ID이므로 제외
      const parsed = parseRelatedDocText(val);
      const title = parsed ? parsed.title : val;
      if (!seenTitles.has(title)) {
        seenTitles.add(title);
        results.push({
          title,
          type: parsed ? parsed.type : '문서',
          docNumber: parsed?.docNumber,
          rawText: val,
          source: 'dom',
          status: 'idle',
        });
      }
    }
  }

  return results;
}

/** 참고 문서 본문 텍스트를 적정 토큰 예산(기본 약 3,000자)으로 정돈 */
export function fitReferenceText(content: string, maxChars = 3200): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;

  // 앞부분(배경/목적/개요: 약 70%) + 뒷부분(조치/기한/서식: 약 30%) 보존
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars - 50;

  const head = clean.substring(0, headChars);
  const tail = clean.substring(clean.length - tailChars);

  return `${head}\n\n[... 중략 ...]\n\n${tail}`;
}

/**
 * '관련정보' 참고 문서 및 지정 서식(템플릿) 컨텍스트를 주입한 AI 프롬프트 생성
 */
export function buildReferencePrompt(options: {
  userPrompt: string;
  docTitle?: string;
  referenceDoc?: RelatedDocInfo | null;
  template?: DraftTemplate | null;
}): string {
  const { userPrompt, docTitle, referenceDoc, template } = options;
  const targetTitle = docTitle && docTitle.trim() ? docTitle.trim() : '기안문';

  const parts: string[] = [
    `[기안할 공문 정보]`,
    `- 공문 제목: ${targetTitle}`,
  ];

  if (template) {
    parts.push(
      ``,
      `[지정된 공문서 서식 및 구성 항목]`,
      `- 적용 서식명: ${template.title}`,
      `- 문서 유형: ${template.documentType}`,
    );
    if (template.description) {
      parts.push(`- 서식 설명: ${template.description}`);
    }
    if (template.guidance) {
      parts.push(`- 서식 작성 지침: ${template.guidance}`);
    }
    parts.push(`- 필수 주요 항목 구성 (반드시 아래 순서대로 각 대항목(1., 2., 3. ...)을 빠짐없이 배치하고 각 항목에 맞는 내용을 작성하십시오):`);
    for (const sec of template.sections) {
      parts.push(`  * ${sec}`);
    }
  }

  if (referenceDoc) {
    const docType = referenceDoc.type || '참고 공문';
    const hasContent = Boolean(referenceDoc.content && referenceDoc.content.trim());
    const refBody = hasContent
      ? fitReferenceText(referenceDoc.content!)
      : '(원문 본문 텍스트가 전달되지 않았습니다. 문서 제목 및 업무 취지를 바탕으로 초안을 구성하십시오.)';

    parts.push(
      ``,
      `[참고 문서 (관련정보)]`,
      `- 문서 구분: [${docType}]`,
      `- 문서 제목: ${referenceDoc.title}${referenceDoc.docNumber ? ` (문서번호: ${referenceDoc.docNumber})` : ''}`,
      `- 참고 문서 내용:`,
      refBody,
    );
  }

  parts.push(
    ``,
    `[작성자 요구 사항 및 개요 메모]`,
    `- 요청 사항: ${userPrompt}`,
    ``,
    `[필수 작성 지침]`,
    `1. 대한민국 행정업무운영편람의 표준 서식(1. -> 가. -> (1) -> 1) -> 가) -> (가))과 개조식 기호(-, ·)만을 사용하여 정형화된 공문서 어투(~코자 함, ~바람)로 명확하고 간결하게 작성하십시오.`,
  );

  if (template) {
    parts.push(
      `2. 위 [지정된 공문서 서식 및 구성 항목]에 명시된 주요 항목(${template.sections.map(s => s.replace(/^\d+\.\s*/, '')).join(' -> ')})을 대항목으로 삼아 각 항목별 핵심 내용을 누락 없이 충실하게 작성하십시오.`,
      `3. 지정된 서식 항목 이외의 불필요한 인사말, 사족, 마크다운 기호(##, **, *)는 절대 출력하지 마십시오.`,
    );
  }

  if (referenceDoc) {
    parts.push(
      `${template ? '4' : '2'}. 위 [참고 문서 (관련정보)]에 명시된 추진 배경, 근거 법령/지침, 제출 기한, 서식 요구사항을 사실에 입각하여 정확히 인용하십시오.`,
      `${template ? '5' : '3'}. 문서 내에 특정 일자나 수치가 불확실할 경우 임의로 지어내지 말고 [확인 필요: 내용]으로 표시하십시오.`,
    );
  } else if (!template) {
    parts.push(
      `2. 문서 내에 특정 일자나 수치가 불확실할 경우 임의로 지어내지 말고 [확인 필요: 내용]으로 표시하십시오.`,
    );
  }

  return parts.join('\n');
}

/**
 * 공문서 원문에서 행정 핵심 요점(추진목적, 주요내용, 기한/일정, 제출서식 등)을 추출하는 규칙 기반 요약기
 */
export function generateRuleBasedSummary(content: string, title?: string): string {
  if (!content || !content.trim()) {
    return '(본문 내용이 없습니다.)';
  }

  const clean = content.replace(/\r\n/g, '\n').trim();
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

  const keyPoints: string[] = [];

  const backgroundLines: string[] = [];
  const mainPlanLines: string[] = [];
  const scheduleDeadlineLines: string[] = [];
  const formatActionLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const l = line.toLowerCase();
    if (line.startsWith('```') || line.startsWith('http') || line.length < 3) continue;

    // 만약 현재 줄이 "1. 추진 배경 및 목적"처럼 짧은 목차 헤더라면 바로 다음 행의 구체적 내용을 결합
    const isHeadingOnly = /^\d+[\.\)]\s*[^:\n]{2,20}$/.test(line.trim());
    const nextLine = (i + 1 < lines.length) ? lines[i + 1]!.trim() : '';
    const contentToUse = (isHeadingOnly && nextLine.length >= 5) ? nextLine : line;

    // 1. 추진배경/목적/근거 관련
    if (/배경|목적|근거|취지|추진\s*이유/.test(l) && !backgroundLines.length) {
      backgroundLines.push(contentToUse);
      continue;
    }
    // 2. 주요내용/방침/계획 관련
    if (/(주요|핵심|세부|사업|추진).*(내용|방침|계획|개요|골자|사항)|방침|사업개요/.test(l) && !mainPlanLines.length) {
      if (i === 0 && lines.length > 3) continue; // 첫 줄의 문서 제목과 겹치면 제외
      mainPlanLines.push(contentToUse);
      continue;
    }
    // 3. 기한/일정/일시 관련
    if (/기한|마감|일시|일정|제출일|까지/.test(l) && !scheduleDeadlineLines.length) {
      scheduleDeadlineLines.push(contentToUse);
      continue;
    }
    // 4. 서식/제출/첨부 관련
    if (/서식|양식|제출처|붙임|별첨|증빙/.test(l) && !formatActionLines.length) {
      formatActionLines.push(contentToUse);
      continue;
    }
  }

  const bg0 = backgroundLines[0];
  if (bg0) {
    keyPoints.push(`- 추진배경/목적: ${bg0.replace(/^[\d\.\-\·\*\s]+/, '')}`);
  }
  const plan0 = mainPlanLines[0];
  if (plan0) {
    keyPoints.push(`- 주요내용/방침: ${plan0.replace(/^[\d\.\-\·\*\s]+/, '')}`);
  }
  const sched0 = scheduleDeadlineLines[0];
  if (sched0) {
    keyPoints.push(`- 제출기한/일정: ${sched0.replace(/^[\d\.\-\·\*\s]+/, '')}`);
  }
  const fmt0 = formatActionLines[0];
  if (fmt0) {
    keyPoints.push(`- 서식/행정사항: ${fmt0.replace(/^[\d\.\-\·\*\s]+/, '')}`);
  }

  // 매칭된 핵심 항목이 2개 미만일 경우, 본문 상위의 핵심 문장 3~4개를 개조식으로 구성
  if (keyPoints.length < 2) {
    keyPoints.length = 0;
    const meaningfulLines = lines.filter(l => l.length >= 8 && !/^(메뉴|온나라|결재|수신자|발신자)/.test(l));
    const topLines = meaningfulLines.slice(0, 4);
    for (const tl of topLines) {
      keyPoints.push(`- ${tl.replace(/^[\d\.\-\·\*\s]+/, '')}`);
    }
  }

  if (title && keyPoints.length === 0) {
    return `- [${title}] 관련 공문 지침에 따라 공문 작성 필요`;
  }

  return keyPoints.join('\n');
}

/**
 * 로컬 Ollama 또는 규칙 기반 엔진을 통해 참고 문서의 핵심 요약 생성
 */
export async function generateDocSummary(
  content: string,
  title: string,
  settings?: { ollamaUrl?: string; model?: string }
): Promise<string> {
  const ollamaUrl = settings?.ollamaUrl || 'http://localhost:11434';
  const model = settings?.model || 'llama3';

  if (!content || !content.trim()) {
    return '(본문 내용이 없습니다.)';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const prompt = `다음 대한민국 공문서 원문을 읽고, 기안자가 새 공문 작성 시 반드시 참고해야 할 핵심 내용(추진배경 및 목적, 주요 방침/지침, 제출기한/일정, 필수 서식 등)을 3~4줄의 개조식(- )으로 명확히 요약해 주십시오. 사족이나 인사말은 일절 없이 요약된 개조식 항목만 출력하십시오.\n\n[문서 제목]: ${title}\n[문서 본문]:\n${fitReferenceText(content, 2000)}`;

    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        system: '당신은 대한민국 행정 공문서 핵심 요약 전문가입니다. 공문서의 핵심 행정사항(추진배경, 지침, 기한, 서식)을 3~4개 개조식(- ) 항목으로 간결하게 정리합니다.',
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data.response && typeof data.response === 'string') {
        const cleaned = data.response.trim();
        if (cleaned.length >= 15) return cleaned;
      }
    }
  } catch {
    // 타임아웃 또는 Ollama 미응답 시 규칙 기반 요약 반환
  } finally {
    clearTimeout(timeoutId);
  }

  return generateRuleBasedSummary(content, title);
}
