/**
 * 온나라 기안기 화면 3중 판별기.
 *
 * 1. origin: 기관 설정 또는 허용된 온나라 origin
 * 2. path: /bms/dct/addoreportbodyview.do 및 본문작성(addhwpbody.do 등) 공식 경로
 * 3. DOM signals: 문서카드 폼, 제목 입력 필드, 본문작성 버튼 등 실제 기안기 신호
 */

export interface DraftRouteDecision {
  status: 'confirmed' | 'pending' | 'rejected';
  reason?: string;
}

const EXACT_DRAFT_PATHS = [
  '/bms/dct/addoreportbodyview.do',
  '/bms/dct/addoreportbody.do',
  '/bms/dct/modifyoreportbodyview.do',
  '/bms/dct/modifyoreportbody.do',
  '/bms/dct/insertoreportbodyview.do',
  '/bms/dct/insertoreportbody.do',
  '/bms/dct/vieworeportbodyview.do',
  '/bms/dct/addreportbodyview.do',
  '/bms/dct/addreportbody.do',
  '/bms/dct/modifyreportbodyview.do',
  '/bms/dct/modifyreportbody.do',
  '/bms/dct/insertreportbodyview.do',
  '/bms/dct/insertreportbody.do',
  '/bms/dct/viewreportbodyview.do',
  '/bms/dct/addhwpbody.do',
  '/bms/dct/modifyhwpbody.do',
  '/bms/dct/addhwpbodyview.do',
  '/bms/dct/hwpctrl.do',
  '/bms/dct/webhwp.do',
  '/bms/dct/viewbody.do',
  '/bms/dct/adddraftbody.do',
  '/bms/dct/modifydraftbody.do',
  '/bms/com/addreportbodyview.do',
  '/bms/com/addoreportbodyview.do',
  '/bms/sanctn/addreportbodyview.do',
  '/bms/sanctn/addoreportbodyview.do',
];

/** URL의 origin이 허용된 온나라 origin 목록에 포함되는지 검사 */
export function isAllowedOrigin(url: string, allowedOrigins?: string[]): boolean {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    // allowedOrigins가 명시되지 않은 경우, http/https 프로토콜의 유효한 URL이면 통과 (런타임 권한 검사에 위임)
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  try {
    const origin = new URL(url).origin.toLowerCase();
    return allowedOrigins.some(allowed => {
      try {
        return new URL(allowed).origin.toLowerCase() === origin;
      } catch {
        return allowed.toLowerCase() === origin;
      }
    });
  } catch {
    return false;
  }
}

/** URL 경로가 공식 온나라 기안기 또는 본문작성 경로인지 검사 */
export function isExactDraftPath(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, 'http://localhost');
    const path = parsed.pathname.toLowerCase();
    if (!path.endsWith('.do')) {
      return false;
    }
    if (EXACT_DRAFT_PATHS.some(exact => path === exact || path.endsWith(exact))) {
      return true;
    }
    // 추가 일반 패턴: /bms/ 또는 /dct/ 또는 /sanctn/ 하위에서 기안문/보고서 본문 작성 경로 (.do 확장자 완결)
    if (
      (path.includes('/bms/') || path.includes('/dct/') || path.includes('/sanctn/')) &&
      /(?:reportbody|oreportbody|hwpbody|viewbody|draftbody)(?:view)?\.do$/i.test(path)
    ) {
      return true;
    }
    return false;
  } catch {
    const lower = String(url).toLowerCase();
    return lower.includes('addoreportbodyview.do') || lower.includes('addreportbodyview.do');
  }
}

/** 요소가 실제로 화면에 렌더링되어 눈에 보이는 상태인지 검사 */
export function isElementVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  try {
    if (el.hidden) return false;
    let curr: HTMLElement | null = el;
    while (curr && curr !== curr.ownerDocument?.documentElement) {
      if (curr.hidden) return false;
      const inlineStyle = curr.style;
      if (inlineStyle && (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden' || inlineStyle.opacity === '0')) {
        return false;
      }
      const win = curr.ownerDocument?.defaultView;
      if (win && typeof win.getComputedStyle === 'function') {
        try {
          const computed = win.getComputedStyle(curr);
          if (computed.display === 'none' || computed.visibility === 'hidden' || computed.opacity === '0') {
            return false;
          }
        } catch {}
      }
      curr = curr.parentElement;
    }
    return true;
  } catch {
    return true;
  }
}

/** 기안기 문서카드 화면에서 '본문작성' 버튼 탐색 */
export function findWriteBodyButton(doc: Document = document): HTMLElement | null {
  const elements = Array.from(
    doc.querySelectorAll<HTMLElement>(
      'button, a, input[type="button"], input[type="image"], .btn, span, img, div'
    )
  );
  for (const el of elements) {
    if (el.children.length > 3) continue;

    const text = (
      el.textContent ||
      (el as HTMLInputElement).value ||
      (el as HTMLImageElement).alt ||
      el.title ||
      el.getAttribute('aria-label') ||
      ''
    ).replace(/\s+/g, '');

    const onclick = el.getAttribute('onclick') || '';
    if (
      text === '본문작성' ||
      text === '본문편집' ||
      text === '기안문작성' ||
      text === '본문입력' ||
      text.includes('본문작성') ||
      text.includes('기안문작성') ||
      /addHwp|openHwp|openBody|goBody|fn_addHwp/i.test(onclick)
    ) {
      if (isElementVisible(el)) {
        return el;
      }
    }
  }
  return null;
}

/** 기안기 DOM 신호 검사 (문서카드 제목 필드, 본문작성 버튼, 결재/보고서 폼 등) */
export function hasDraftEditorSignals(doc: Document): boolean {
  // 1. 문서 제목 입력 필드 확인
  const titleField = doc.querySelector<HTMLInputElement>(
    'input[name="docTitle"], #docTitle, input[name="title"], input[name="reportTitle"], input[name="subject"]'
  );
  if (titleField) return true;

  // 2. '본문작성' 버튼 확인
  if (findWriteBodyButton(doc)) return true;

  // 3. 문서카드 본문 폼 또는 iframe 에디터 확인
  const editorSignals = doc.querySelector(
    '#hwpCtrl, #HwpCtrl, iframe[name*="body"], iframe[id*="body"], iframe[src*="body"], #reportForm, form[name="reportForm"]'
  );
  if (editorSignals) return true;

  // 4. 온나라 기안기 특정 버튼/요소 확인
  const actionButtons = doc.querySelector(
    'button[onclick*="save"], button[onclick*="report"], a[onclick*="saveReport"], .btn_report, #btn_save'
  );
  if (actionButtons) return true;

  return false;
}

/** 기안기 3중 종합 판정 */
export function classifyDraftRoute(
  url: string,
  doc?: Document,
  allowedOrigins?: string[]
): DraftRouteDecision {
  if (!isAllowedOrigin(url, allowedOrigins)) {
    return { status: 'rejected', reason: '허용되지 않은 사이트(Origin)입니다.' };
  }

  if (!isExactDraftPath(url)) {
    return { status: 'rejected', reason: '기안기 공식 경로가 아닙니다.' };
  }

  if (doc) {
    if (hasDraftEditorSignals(doc)) {
      return { status: 'confirmed' };
    }
    // DOM 로딩 중일 가능성이 있으므로 pending 반환
    return { status: 'pending', reason: '기안기 DOM 요소를 아직 찾지 못했습니다.' };
  }

  return { status: 'pending', reason: 'DOM 신호 검증 대기 중' };
}

/**
 * 주어진 요소가 온나라 기안기 '문서카드'의 메타데이터 필드(단위관리, 제목, 키워드, 요약 등)인지 판별.
 * 블럭 메뉴(Bubble Menu)는 본문작성 영역에만 적용되어야 하므로, 메타데이터 필드 선택 시에는 절대 노출되지 않아야 한다.
 */
export function isMetadataField(el: HTMLElement | null): boolean {
  if (!el || typeof (el as any).closest !== 'function' || !el.tagName) return false;

  const tag = el.tagName.toLowerCase();
  const name = (el.getAttribute('name') || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
  const placeholder = ((el as HTMLInputElement).placeholder || '').toLowerCase();

  // 본문/에디터 관련 요소인 경우 절대 메타데이터가 아님
  if (
    tag === 'canvas' ||
    name.includes('content') || id.includes('content') ||
    name.includes('body') || id.includes('body') ||
    cls.includes('editor') || id.includes('editor') ||
    cls.includes('webhwp') || id.includes('hwp')
  ) {
    return false;
  }

  // 본문 구조(report_body, doc_body 등) 내부의 텍스트 요소(p, div, td, span 등)는 절대 메타데이터가 아님
  const isInsideBodyDoc = el.closest(
    'table.report_body, table.doc_body, .reportBody, #div_report_body, #divBodyContent, textarea.editor, [contenteditable="true"], #hwpCtrl, #HwpCtrl, #tbContentElement, .webhwp-container'
  );
  if (isInsideBodyDoc) {
    return false;
  }

  // 1. 온나라 문서카드 주요 필드명 및 ID 패턴
  const metadataPatterns = [
    'title', 'doctitle', 'reporttitle', 'subject',
    'keyword', 'searchkeyword',
    'summary', 'docsummary', 'txtsummary',
    'unittask', 'taskname', 'taskid',
    'deptname', 'userdept', 'drafter', 'author',
    'publicyn', 'openlevel', 'urgency', 'seclevel',
    'docnum', 'sender', 'receiver'
  ];

  if (metadataPatterns.some(pat => name.includes(pat) || id.includes(pat))) {
    return true;
  }

  // placeholder 검사
  if (placeholder.includes('제목') || placeholder.includes('키워드') || placeholder.includes('요약') || placeholder.includes('단위관리')) {
    return true;
  }

  // 2. 문서카드 전용 폼/컨테이너 내부의 모든 요소 (테이블 셀, 텍스트, 보고경로 등 포함)
  // 주의: #reportForm은 온나라 기안기 전체 폼일 수 있으므로, 구체적 카드 영역은 전체를 메타데이터로 보고,
  // reportForm 직속 입력 필드(input, select, textarea)는 메타데이터 필드로 판별한다.
  const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';
  const cardContainer = el.closest(
    '#docCard, #divDocCard, .docCard, #formDocCard, table.tbl_doc_card, .tb_docinfo, #div_doccard, #cardForm, #docInfoArea'
  );
  if (cardContainer) {
    return true;
  }

  if (isInput && el.closest('#reportForm, form[name="reportForm"]')) {
    return true;
  }

  // 3. 보고경로 테이블이나 문서정보 테이블 내부 텍스트 선택인지 검사 (기안 주무관 김명진 등)
  const tr = el.closest('tr');
  if (tr) {
    const tableText = (tr.closest('table')?.textContent || '').replace(/\s+/g, '');
    if (
      tableText.includes('보고경로') ||
      (tableText.includes('구분') && tableText.includes('직위') && tableText.includes('성명')) ||
      (tableText.includes('기안') && tableText.includes('주무관')) ||
      tableText.includes('과제카드명') ||
      tableText.includes('문서요지')
    ) {
      return true;
    }
  }

  return false;
}

/** 본문작성 화면임을 확정짓는 신호 (본문저장 버튼, WebHWP 캔버스 등) */
export function hasBodyEditorSignals(doc: Document): boolean {
  const allButtons = Array.from(doc.querySelectorAll<HTMLElement>('button, a, input[type="button"], .btn, span'));
  const hasSaveBodyBtn = allButtons.some(b => {
    if (!isElementVisible(b)) return false;
    const t = (b.textContent || (b as HTMLInputElement).value || '').replace(/\s+/g, '');
    return t === '본문저장' || t === '본문(검정변환)' || t === '표준기안문' || t === '서식참조' ||
      t.includes('본문저장') || t.includes('본문(검정변환)');
  });
  if (hasSaveBodyBtn) return true;

  const hwpEl = doc.querySelector<HTMLElement>(
    'canvas.webhwp_canvas, canvas, #hwpCtrl, #HwpCtrl, #tbContentElement, object[type*="hwp"], embed[type*="hwp"], .webhwp-container'
  );
  if (hwpEl && isElementVisible(hwpEl)) return true;

  const hasHwpToolbar = allButtons.some(b => {
    if (!isElementVisible(b)) return false;
    const t = (b.textContent || '').trim();
    return t === '보기' || t === '입력' || t === '서식' || t === '쪽' || t === '표';
  });
  if (hasHwpToolbar) return true;

  return false;
}

/**
 * 현재 기안기 화면이 '문서카드' (문서관리카드 / 문서정보 / 메타데이터 입력) 화면인지 판별.
 * 블럭 메뉴(Bubble Menu)는 문서카드 화면에서는 100% 노출 금지되어야 한다.
 */
export function isDraftCardScreen(doc: Document = document): boolean {
  const topDoc = (doc.defaultView?.top && doc.defaultView.top !== doc.defaultView)
    ? (doc.defaultView.top.document as Document | null)
    : null;

  // top이 본문 화면(본문저장 버튼 등)이면 전체 창이 본문작성 모드이므로 문서카드 아님
  if (topDoc) {
    try {
      if (hasBodyEditorSignals(topDoc)) return false;
    } catch {}
  }
  if (hasBodyEditorSignals(doc)) return false;

  if (topDoc) {
    try {
      if (isDraftCardScreenInternal(topDoc)) return true;
    } catch {}
  }

  return isDraftCardScreenInternal(doc);
}

function isDraftCardScreenInternal(doc: Document): boolean {
  // 0. 본문작성 신호가 있으면 절대 문서카드 아님
  if (hasBodyEditorSignals(doc)) {
    return false;
  }

  // 1. [본문작성] 버튼이 실제로 보이면 확실한 문서카드 화면이다.
  if (findWriteBodyButton(doc)) {
    return true;
  }

  // 2. 문서관리카드 전용 헤딩/영역 신호
  const docText = doc.body?.textContent || '';
  const isCardTitlePresent =
    docText.includes('문서관리카드') ||
    docText.includes('과제카드명') ||
    (docText.includes('문서정보') && docText.includes('보고경로'));

  if (isCardTitlePresent) {
    return true;
  }

  // 3. 문서카드 메타데이터 전용 테이블/필드들
  const hasCardFields = Boolean(
    doc.querySelector(
      'input[name="docTitle"], #docTitle, input[name="keyword"], #keyword, textarea[name="summary"], #summary, table.tbl_doc_card, .tb_docinfo, #divDocCard, #div_doccard, #docInfoArea'
    )
  );
  if (hasCardFields) {
    return true;
  }

  return false;
}

/**
 * 현재 기안기 화면이 '본문작성' 화면인지 판별.
 * 블럭 메뉴는 오직 이 '본문작성' 화면에서만 호출된다.
 */
export function isBodyWritingScreen(doc: Document = document): boolean {
  // 1. 문서카드 화면이면 절대 본문작성 화면이 아님
  if (isDraftCardScreen(doc)) {
    return false;
  }

  const topDoc = (doc.defaultView?.top && doc.defaultView.top !== doc.defaultView)
    ? (doc.defaultView.top.document as Document | null)
    : null;

  return isBodyWritingScreenInternal(doc) || (topDoc ? isBodyWritingScreenInternal(topDoc) : false);
}

function isBodyWritingScreenInternal(doc: Document): boolean {
  // 1. 본문작성 전용 신호가 있으면 본문작성 화면이다.
  if (hasBodyEditorSignals(doc)) {
    return true;
  }

  // 2. 프레임 URL이 본문작성 전용 .do 경로인 경우
  const path = (doc.location?.pathname || '').toLowerCase();
  const isBodyUrl = /(?:addhwpbody|modifyhwpbody|hwpctrl|webhwp|viewbody|draftbody)/i.test(path);
  if (isBodyUrl) {
    return true;
  }

  // 3. 공식 본문 문서 구조 (수신, (경유), 제목, 본문 표/문단, contenteditable, 에디터 textarea)
  const hasDocBodyStructure = Boolean(
    doc.querySelector(
      'table.report_body, table.doc_body, .reportBody, #div_report_body, #divBodyContent, textarea.editor, textarea[name*="content"], textarea[name*="body"], [contenteditable="true"]'
    )
  );
  if (hasDocBodyStructure) {
    return true;
  }

  return false;
}
