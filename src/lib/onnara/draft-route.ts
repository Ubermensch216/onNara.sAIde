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
  const elements = Array.from(doc.querySelectorAll<HTMLElement>('button, a, input[type="button"], input[type="image"], .btn'));
  for (const el of elements) {
    const text = (el.textContent || (el as HTMLInputElement).value || el.title || el.getAttribute('aria-label') || '').trim();
    const onclick = el.getAttribute('onclick') || '';
    if (
      text.includes('본문작성') ||
      text.includes('본문 작성') ||
      text.includes('본문편집') ||
      text.includes('본문 편집') ||
      text.includes('기안문작성') ||
      text.includes('기안문 작성') ||
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
