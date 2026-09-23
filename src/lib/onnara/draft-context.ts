/**
 * 기안문 맥락 스냅샷 및 식별자 모델.
 *
 * 기안기 화면의 현재 문서 키, 제목, 원문 해시, 편집기 revision을 캡처하여
 * 문서 전환이나 비정상 상태에서의 오삽입을 방지한다.
 */

export type DraftCoverage = 'full' | 'partial' | 'none';

export interface DraftTitleInfo {
  value: string | null;
  source: 'dom' | 'user' | 'unknown';
}

export interface DraftBodyInfo {
  text: string | null;
  coverage: DraftCoverage;
  source: string;
}

export interface DraftContext {
  tabId: number;
  frameId: number;
  documentId?: string;
  origin: string;
  route: 'draft-editor';
  documentKey: string | null;
  documentRevision: string;
  editorRevision: string;
  title: DraftTitleInfo;
  body: DraftBodyInfo;
  capturedAt: number;
}

/** 빠른 deterministic 해시 생성 (revision 계산용) */
export function computeRevisionHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return `rev_${(hash >>> 0).toString(16)}`;
}

/** 기안기 DOM에서 DraftContext 스냅샷 생성 */
export function captureDraftContext(
  doc: Document,
  tabInfo: { tabId: number; frameId: number; documentId?: string; origin: string }
): DraftContext {
  // 1. 제목 추출
  const titleInput = doc.querySelector<HTMLInputElement>(
    'input[name="docTitle"], #docTitle, input[name="title"], input[name="reportTitle"]'
  );
  const titleVal = titleInput?.value?.trim() || null;
  const title: DraftTitleInfo = {
    value: titleVal,
    source: titleVal ? 'dom' : 'unknown',
  };

  // 2. 문서 업무 키 탐색 (hidden input 또는 파라미터)
  const keyInput = doc.querySelector<HTMLInputElement>(
    'input[name="docId"], input[name="reportId"], input[name="docKey"], #docId'
  );
  let docKey: string | null = keyInput?.value?.trim() || null;

  if (!docKey) {
    try {
      const url = new URL(doc.location?.href || '');
      docKey = url.searchParams.get('docId') || url.searchParams.get('reportId') || null;
    } catch {
      // ignore
    }
  }

  // 3. 본문 텍스트 및 revision 추출
  let bodyText: string | null = null;
  let coverage: DraftCoverage = 'none';

  const ta = doc.querySelector<HTMLTextAreaElement>('textarea[name*="body"], textarea#body, textarea');
  if (ta && ta.value) {
    bodyText = ta.value;
    coverage = 'full';
  } else {
    const ce = doc.querySelector<HTMLElement>('[contenteditable="true"]');
    if (ce && ce.textContent) {
      bodyText = ce.textContent;
      coverage = 'full';
    }
  }

  const rawBody = bodyText || '';
  const bodyRev = computeRevisionHash(rawBody);

  return {
    tabId: tabInfo.tabId,
    frameId: tabInfo.frameId,
    documentId: tabInfo.documentId,
    origin: tabInfo.origin,
    route: 'draft-editor',
    documentKey: docKey,
    documentRevision: bodyRev,
    editorRevision: bodyRev,
    title,
    body: {
      text: bodyText,
      coverage,
      source: ta ? 'textarea' : bodyText ? 'contenteditable' : 'none',
    },
    capturedAt: Date.now(),
  };
}

/** 두 맥락이 동일한 문서 상태인지 검사 */
export function isSameDraftContext(expected: DraftContext, current: DraftContext): boolean {
  if (expected.tabId !== current.tabId) return false;
  if (expected.frameId !== current.frameId) return false;
  if (expected.origin !== current.origin) return false;

  // documentKey가 둘 다 있는 경우 일치해야 함
  if (expected.documentKey && current.documentKey && expected.documentKey !== current.documentKey) {
    return false;
  }

  // editor revision이 다르면 사용자가 에디터를 수정했음을 의미
  if (expected.editorRevision !== current.editorRevision) {
    return false;
  }

  return true;
}
