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
      text.includes('본문작성') ||
      text.includes('기안문작성') ||
      /addHwp|openHwp|openBody|goBody|fn_addHwp/i.test(onclick)
    ) {
      return el;
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
  // 메타데이터 입력란은 반드시 input, textarea, select 중 하나여야 함.
  // 본문 텍스트가 위치하는 div, p, td, span, table 등은 절대 메타데이터 필드가 아님.
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
    return false;
  }

  const name = (el.getAttribute('name') || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
  const placeholder = ((el as HTMLInputElement).placeholder || '').toLowerCase();

  // 본문/에디터 관련 입력 요소인 경우 절대 메타데이터가 아님
  if (
    name.includes('content') || id.includes('content') ||
    name.includes('body') || id.includes('body') ||
    cls.includes('editor') || id.includes('editor')
  ) {
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

  // 2. 문서카드 전용 폼/컨테이너 내부의 입력 필드인지 검사
  const cardContainer = el.closest(
    '#reportForm, #docCard, #divDocCard, .docCard, #formDocCard, form[name="reportForm"], table.tbl_doc_card, .tb_docinfo, #div_doccard, #cardForm, #docInfoArea'
  );
  if (cardContainer) {
    return true;
  }

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

  if (topDoc) {
    try {
      if (isDraftCardScreenInternal(topDoc)) return true;
    } catch {}
  }

  return isDraftCardScreenInternal(doc);
}

function isDraftCardScreenInternal(doc: Document): boolean {
  // 1. [본문작성] 버튼이 존재하면 확실한 문서카드 화면이다.
  if (findWriteBodyButton(doc)) {
    return true;
  }

  // 2. 문서관리카드 전용 헤딩/영역 신호
  // "문서관리카드", "과제카드명", "보고경로", "문서정보" 등이 존재하고 본문저장 버튼이 없는 경우
  const docText = doc.body?.textContent || '';
  const isCardTitlePresent =
    docText.includes('문서관리카드') ||
    docText.includes('과제카드명') ||
    (docText.includes('문서정보') && docText.includes('보고경로'));

  // 본문작성 전용 버튼들: [본문저장], [본문(검정변환)], [표준기안문], [서식참조]
  const allButtons = Array.from(doc.querySelectorAll<HTMLElement>('button, a, input[type="button"], .btn, span'));
  const hasSaveBodyBtn = allButtons.some(b => {
    const t = (b.textContent || (b as HTMLInputElement).value || '').replace(/\s+/g, '');
    return t === '본문저장' || t === '본문(검정변환)' || t === '표준기안문' || t === '서식참조' ||
      t.includes('본문저장') || t.includes('본문(검정변환)');
  });

  if (isCardTitlePresent && !hasSaveBodyBtn) {
    return true;
  }

  // 3. 문서카드 메타데이터 전용 테이블/필드들
  const hasCardFields = Boolean(
    doc.querySelector(
      'input[name="docTitle"], #docTitle, input[name="keyword"], #keyword, textarea[name="summary"], #summary, table.tbl_doc_card, .tb_docinfo, #divDocCard, #div_doccard, #docInfoArea'
    )
  );
  if (hasCardFields && !hasSaveBodyBtn) {
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
  // 1. 본문작성 전용 상단 액션 버튼들
  // [본문저장], [본문(검정변환)], [표준기안문], [서식참조], [미리보기]
  const allButtons = Array.from(doc.querySelectorAll<HTMLElement>('button, a, input[type="button"], .btn, span'));
  const bodyActionKeywords = ['본문저장', '본문(검정변환)', '표준기안문', '서식참조'];
  const hasBodyActionButtons = allButtons.some(b => {
    const text = (b.textContent || (b as HTMLInputElement).value || '').replace(/\s+/g, '');
    return bodyActionKeywords.some(kw => text.includes(kw));
  });
  if (hasBodyActionButtons) {
    return true;
  }

  // 2. 한글 기안기(WebHWP, HwpCtrl) 컨트롤 및 에디터 요소
  const hasHwp = Boolean(
    doc.querySelector(
      '#hwpCtrl, #HwpCtrl, #tbContentElement, object[type*="hwp"], embed[type*="hwp"], canvas.webhwp_canvas, .webhwp-container, .hwp-menubar, .hwp_toolbar, iframe[name*="body"], iframe[id*="body"], iframe[src*="body"], iframe[src*="hwp"]'
    )
  );
  if (hasHwp) {
    return true;
  }

  // 3. 에디터 툴바 메뉴 텍스트 (보기, 입력, 서식, 쪽, 표)
  const hasHwpToolbarMenu = allButtons.some(b => {
    const text = (b.textContent || '').trim();
    return text === '보기' || text === '입력' || text === '서식' || text === '쪽' || text === '표';
  });
  if (hasHwpToolbarMenu) {
    return true;
  }

  // 4. 프레임 URL이 본문작성 전용 .do 경로인 경우
  const path = (doc.location?.pathname || '').toLowerCase();
  const isBodyUrl = /(?:addhwpbody|modifyhwpbody|hwpctrl|webhwp|viewbody|draftbody)/i.test(path);
  if (isBodyUrl) {
    return true;
  }

  // 5. 하위 프레임인 경우
  if (doc.defaultView && doc.defaultView !== doc.defaultView.top) {
    const bodyContent = doc.querySelector('table, p, div, #hwpCtrl, .webhwp-container');
    if (bodyContent) return true;
  }

  // 6. 공식 본문 문서 구조 (수신, (경유), 제목, 본문 표/문단, contenteditable, 에디터 textarea)
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
