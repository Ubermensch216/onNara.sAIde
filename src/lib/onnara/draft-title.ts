/**
 * 공문서 추천 제목 생성, 정제 및 본 화면(웹한글기안기/DOM) 반영 모듈.
 *
 * 1. LLM 출력에서 [추천 제목] 및 [공문서 초안]을 안전하게 분리·정제
 * 2. LLM이 제목 형식을 누락한 경우 사용자 프롬프트 기반 적합한 행정 제목 생성
 * 3. 온나라 공문 본 화면(웹한글기안기 HwpCtrl 누름틀 또는 HTML DOM 필드)에 제목 직접 반영
 */

import { cleanAdminDraft } from './draft-cleaner';

export interface ExtractedDraftResult {
  title: string;
  draft: string;
}

/**
 * LLM 시스템 프롬프트에 추천 제목 생성 지침을 추가한다.
 */
export function buildDraftTitleSystemPrompt(baseSystemPrompt: string): string {
  return `${baseSystemPrompt}

[반드시 준수할 출력 서식]
답변 첫머리에 작성할 공문의 핵심 내용을 한눈에 나타내는 표준 공문 제목을 아래 형식으로 정확히 1개 출력하십시오:
[추천 제목] (행정 공문서 표준에 적합한 명확하고 간결한 제목, 예: 2026년 공공 AI 업무혁신 추진계획(안))

이어서 한 줄을 띄우고 다음 형식으로 본문 초안을 작성하십시오:
[공문서 초안]
(행정 공문서 표준 서식의 본문 내용)`;
}

/**
 * 사용자의 프롬프트에서 불필요한 요청어구를 제거하고 공문서형 추천 제목을 생성한다.
 */
export function generateFallbackTitle(userPrompt?: string, existingDocTitle?: string): string {
  if (existingDocTitle && existingDocTitle.trim() && existingDocTitle !== '기안문') {
    return existingDocTitle.trim();
  }

  if (!userPrompt || !userPrompt.trim()) {
    return '공문서 기안(안)';
  }

  let text = userPrompt.trim();

  // 1. 첫 줄 또는 첫 마침표/쉼표 앞부분 우선 추출
  const firstLine = text.split(/\r?\n/)[0] || '';
  text = firstLine.split(/[.。!?]/)[0] || firstLine;

  // 2. 요청형/지시형 어구 제거
  text = text.replace(
    /(?:작성해줘|작성바람|작성해주세요|써줘|초안\s*작성|작성\s*부탁|공문\s*작성|기안\s*작성|부탁해|해줘|바람|요청드림|해\s*주시기\s*바랍니다).*/gi,
    ''
  );
  text = text.replace(/^(?:예|예시|참고)\s*[:：]?\s*/gi, '');
  text = text.replace(/^(?:지침에\s*따라|내용에\s*따라|관련하여)\s*/gi, '');

  text = text.trim();

  // 특수문자 및 불필요한 따옴표 정제
  text = text.replace(/^["'\[\(]|["'\]\)]$/g, '').trim();

  if (!text) {
    return '공문서 기안(안)';
  }

  // 3. 행정 문서형 종결 어미 보정
  if (/(계획|방안|조례|규정)안$/i.test(text)) {
    text = text.replace(/(계획|방안|조례|규정)안$/i, '$1(안)');
  } else if (text.endsWith('계획') && !text.endsWith('(안)')) {
    text = `${text}(안)`;
  } else if (
    !text.endsWith('(안)') &&
    !text.endsWith('안') &&
    !text.endsWith('건') &&
    !text.endsWith('계획') &&
    !text.endsWith('보고') &&
    !text.endsWith('알림') &&
    !text.endsWith('요청') &&
    !text.endsWith('통보') &&
    !text.endsWith('안내') &&
    !text.endsWith('결과')
  ) {
    text = `${text} 추진계획(안)`;
  }

  return text;
}

/**
 * LLM의 원문 응답에서 [추천 제목]과 [공문서 초안]을 파싱하여 정제된 형태로 반환한다.
 */
export function extractRecommendedTitleAndDraft(
  rawText: string,
  userPrompt?: string,
  existingDocTitle?: string
): ExtractedDraftResult {
  if (!rawText || !rawText.trim()) {
    return {
      title: generateFallbackTitle(userPrompt, existingDocTitle),
      draft: '',
    };
  }

  let title = '';
  let draftBody = rawText;

  // 1. [추천 제목] 태그 매칭 시도 (마크다운 볼드, 백틱, 인용 등 유연 대응)
  // 예: "[추천 제목] 2026년 공공 AI 업무혁신 추진계획(안)"
  // 예: "**[추천 제목]** \"부산광역시 발전계획(안)\""
  // 예: "추천 제목: 2026년 ..."
  const titleTagMatch = rawText.match(
    /(?:^|\n)\s*[*_#`\s>]*(?:\[추천\s*제목\]|추천\s*제목\s*[:：]?|\[제목\]|^제목\s*[:：])[*_#`\s>]*\s*([^\r\n]+)/i
  );

  if (titleTagMatch && titleTagMatch[1]) {
    title = titleTagMatch[1].trim();

    // 원문에서 추천 제목 라인 제거
    draftBody = draftBody.replace(titleTagMatch[0], '');
  }

  // 2. [공문서 초안] 또는 [초안 본문] 마커 제거
  draftBody = draftBody.replace(
    /(?:^|\n)\s*[*_#`\s>]*\[(?:공문서\s*초안|초안\s*본문|초안|본문)\][*_#`\s>]*(?:\r?\n)?/gi,
    '\n'
  );

  // 3. 만약 태그를 찾지 못한 경우, 첫 줄이 '제목: ' 형태인지 검사
  if (!title) {
    const firstLineMatch = rawText.match(/^\s*(?:[#*`\-_>\s]*)(?:제목|공문\s*제목)\s*[:：]\s*([^\r\n]+)/im);
    if (firstLineMatch && firstLineMatch[1]) {
      title = firstLineMatch[1].trim();
      draftBody = draftBody.replace(firstLineMatch[0], '');
    }
  }

  // 4. 제목 텍스트 마크다운 및 따옴표 정제
  if (title) {
    title = title
      .replace(/[*_#`]/g, '')
      .replace(/^["'「『]|["'」』]$/g, '')
      .trim();
  }

  // 5. 제목이 여전히 없으면 사용자 프롬프트 기반으로 스마트 추출
  if (!title) {
    title = generateFallbackTitle(userPrompt, existingDocTitle);
  }

  // 6. 본문 정제 (공문서 표준 행정편람 서식 적용)
  const cleanedDraft = cleanAdminDraft(draftBody);

  return {
    title,
    draft: cleanedDraft,
  };
}

/**
 * 한컴 웹기안기(HwpCtrl) 객체에 제목을 입력한다.
 */
export function applyTitleToHwpCtrl(
  hwp: any,
  title: string
): { success: boolean; method?: string; fieldName?: string; error?: string } {
  if (!hwp) return { success: false, error: 'NO_HWP' };

  const titleFields = [
    '제목',
    'title',
    'TITLE',
    '기안제목',
    'docTitle',
    '기안문_제목',
    '기안문제목',
    '문서제목',
    'SUBJECT',
    'subject',
    'titleText',
  ];

  // 1. PutFieldText (한컴 웹기안기 누름틀 표준 입력)
  if (typeof hwp.PutFieldText === 'function') {
    for (const fn of titleFields) {
      try {
        const exist = typeof hwp.FieldExist === 'function' ? Boolean(hwp.FieldExist(fn)) : true;
        if (exist) {
          hwp.PutFieldText(fn, title);
          return { success: true, method: 'PutFieldText', fieldName: fn };
        }
      } catch {}
    }
  }

  // 2. SetFieldText (온나라 커스텀 래퍼 지원)
  if (typeof hwp.SetFieldText === 'function') {
    for (const fn of titleFields) {
      try {
        const exist = typeof hwp.FieldExist === 'function' ? Boolean(hwp.FieldExist(fn)) : true;
        if (exist) {
          hwp.SetFieldText(fn, title);
          return { success: true, method: 'SetFieldText', fieldName: fn };
        }
      } catch {}
    }
  }

  // 3. MoveToField + InsertText (누름틀 전체 선택 후 덮어쓰기)
  if (typeof hwp.MoveToField === 'function') {
    for (const fn of titleFields) {
      try {
        const exist = typeof hwp.FieldExist === 'function' ? Boolean(hwp.FieldExist(fn)) : true;
        if (exist) {
          hwp.MoveToField(fn, true, true, true);
          if (typeof hwp.InsertText === 'function') {
            hwp.InsertText(title);
            return { success: true, method: 'MoveToField+InsertText', fieldName: fn };
          }
          if (typeof hwp.Run === 'function') {
            hwp.Run('Paste');
            return { success: true, method: 'MoveToField+RunPaste', fieldName: fn };
          }
        }
      } catch {}
    }
  }

  return { success: false, error: 'NO_MATCHING_TITLE_FIELD' };
}

/**
 * DOM 상에서 공문 본 화면의 제목 입력 엘리먼트를 탐색한다.
 */
export function findTitleInputElement(
  root: Document | Element
): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  const doc = root.ownerDocument || (root as Document);

  // 1. 온나라 표준 Selector 기반 탐색
  const selectors = [
    'input[name="docTitle"]',
    'input#docTitle',
    'input[name="title"]',
    'input#title',
    'input[name="reportTitle"]',
    'input#reportTitle',
    'input[name="subject"]',
    'input#subject',
    'input[name="txtTitle"]',
    'input#txtTitle',
    'input[name="txtDocTitle"]',
    'input#txtDocTitle',
    'input[name="doc_title"]',
    'input#doc_title',
    'input[name="bmsTitle"]',
    'input#bmsTitle',
    'input[title="제목"]',
    'input[placeholder*="제목"]',
    'input[aria-label*="제목"]',
    'textarea[name="docTitle"]',
    'textarea#docTitle',
    'textarea[name="title"]',
    'textarea#title',
  ];

  for (const sel of selectors) {
    try {
      const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel);
      if (el && el.type !== 'hidden' && !el.disabled && !el.readOnly) {
        return el;
      }
    } catch {}
  }

  // 2. 대소문자 무관 속성 매칭 (title, subject)
  try {
    const allInputs = root.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type]), textarea');
    for (const inp of Array.from(allInputs)) {
      if (inp.disabled || inp.readOnly || inp.type === 'hidden') continue;
      const name = (inp.name || '').toLowerCase();
      const id = (inp.id || '').toLowerCase();
      if (name.includes('title') || id.includes('title') || name.includes('subject') || id.includes('subject')) {
        return inp;
      }
    }
  } catch {}

  // 3. 표(Table) 또는 레이블(Label) 구조 탐색: '제목' 텍스트 인접 입력칸
  try {
    const candidates = root.querySelectorAll<HTMLElement>('th, td, label, span, div, dt, p');
    for (const el of Array.from(candidates)) {
      const text = (el.textContent || '').trim().replace(/\s+/g, '');
      if (text === '제목' || text === '제목:' || text === '[제목]' || text === '제 목') {
        // (1) label[for]
        if (el instanceof HTMLLabelElement && el.htmlFor) {
          const target = doc.getElementById(el.htmlFor);
          if (
            (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
            !target.disabled &&
            !target.readOnly
          ) {
            return target;
          }
        }

        // (2) 같은 행(tr) 내의 input/textarea
        const tr = el.closest('tr');
        if (tr) {
          const rowInp = tr.querySelector<HTMLInputElement | HTMLTextAreaElement>(
            'input[type="text"], input:not([type]), textarea'
          );
          if (rowInp && !rowInp.disabled && !rowInp.readOnly && rowInp.type !== 'hidden') {
            return rowInp;
          }
        }

        // (3) 다음 형제 요소(nextElementSibling)
        const next = el.nextElementSibling;
        if (next) {
          if (
            (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) &&
            !next.disabled &&
            !next.readOnly &&
            next.type !== 'hidden'
          ) {
            return next;
          }
          const nested = next.querySelector<HTMLInputElement | HTMLTextAreaElement>(
            'input[type="text"], input:not([type]), textarea'
          );
          if (nested && !nested.disabled && !nested.readOnly && nested.type !== 'hidden') {
            return nested;
          }
        }

        // (4) 부모 요소의 자식 input
        const parent = el.parentElement;
        if (parent) {
          const pInp = parent.querySelector<HTMLInputElement | HTMLTextAreaElement>(
            'input[type="text"], input:not([type]), textarea'
          );
          if (pInp && !pInp.disabled && !pInp.readOnly && pInp.type !== 'hidden') {
            return pInp;
          }
        }
      }
    }
  } catch {}

  // 4. 자식 iframe 재귀 탐색
  try {
    const iframes = root.querySelectorAll<HTMLIFrameElement>('iframe, frame');
    for (const ifr of Array.from(iframes)) {
      try {
        const innerDoc = ifr.contentDocument || ifr.contentWindow?.document;
        if (innerDoc) {
          const found = findTitleInputElement(innerDoc);
          if (found) return found;
        }
      } catch {}
    }
  } catch {}

  return null;
}

/**
 * DOM의 제목 입력 필드에 추천 제목을 입력하고 이벤트를 발생시킨다.
 */
export function applyDraftTitleToDom(
  doc: Document,
  title: string
): { success: boolean; method?: string; element?: HTMLElement; error?: string } {
  const inputEl = findTitleInputElement(doc);
  if (!inputEl) {
    return { success: false, error: 'TITLE_INPUT_NOT_FOUND' };
  }

  if (
    inputEl instanceof HTMLInputElement ||
    inputEl.tagName === 'INPUT' ||
    inputEl instanceof HTMLTextAreaElement ||
    inputEl.tagName === 'TEXTAREA'
  ) {
    const inp = inputEl as HTMLInputElement | HTMLTextAreaElement;
    inp.focus();
    inp.value = title;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, method: 'DOM_INPUT', element: inp };
  }

  if (inputEl.isContentEditable) {
    inputEl.focus();
    inputEl.textContent = title;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    return { success: true, method: 'DOM_CONTENTEDITABLE', element: inputEl };
  }

  return { success: false, error: 'UNSUPPORTED_ELEMENT' };
}
