export type OnnaraPageKind =
  | 'inbox'
  | 'document-view'
  | 'distribution'
  | 'draft-editor'
  | 'search-results'
  | 'unknown';

export interface OnnaraPageSignals {
  inboxGrid?: boolean;
  documentView?: boolean;
  distributionForm?: boolean;
  draftEditor?: boolean;
  searchResults?: boolean;
  sourceDocumentId?: string;
  managementNumber?: string;
  createdDate?: string;
}

export interface OnnaraSnapshot {
  tabId: number;
  frameId: number;
  url: string;
  title: string;
  capturedAt: number;
  signals: OnnaraPageSignals;
}

export interface DocumentKey {
  system: 'onnara';
  value: string;
  basis: 'source-document-id' | 'management-number-and-date';
}

export interface RunContext {
  tabId: number;
  frameId: number;
  url: string;
  origin: string;
  pageKind: OnnaraPageKind;
  documentKey: DocumentKey | null;
  capturedAt: number;
}

export type ContextMatch =
  | { ok: true }
  | { ok: false; reason: 'tab-changed' | 'frame-changed' | 'page-changed' | 'document-changed' };

function normalizedOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

function cleanIdentifier(value: string | undefined): string | undefined {
  const clean = value?.trim();
  return clean && /^[\p{L}\p{N}._/-]{1,160}$/u.test(clean) ? clean : undefined;
}

export function configuredOnnaraOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map(item => normalizedOrigin(item.trim())).filter((item): item is string => Boolean(item)))];
}

export function isConfiguredOnnaraUrl(url: string, allowedOrigins: string[]): boolean {
  const origin = normalizedOrigin(url);
  return origin !== null && allowedOrigins.map(item => normalizedOrigin(item)).includes(origin);
}

/** 화면 종류는 DOM 수집기가 확인한 명시적 신호만 사용한다. URL 문자열은 분류 근거로 쓰지 않는다. */
export function classifyOnnaraPage(signals: OnnaraPageSignals): OnnaraPageKind {
  if (signals.distributionForm) return 'distribution';
  if (signals.draftEditor) return 'draft-editor';
  if (signals.documentView) return 'document-view';
  if (signals.inboxGrid) return 'inbox';
  if (signals.searchResults) return 'search-results';
  return 'unknown';
}

/** URL이 바뀌지 않는 SPA에서도 문서를 구분할 수 있도록 업무 식별자를 우선한다. */
export function createDocumentKey(signals: OnnaraPageSignals): DocumentKey | null {
  const sourceDocumentId = cleanIdentifier(signals.sourceDocumentId);
  if (sourceDocumentId) return { system: 'onnara', value: sourceDocumentId, basis: 'source-document-id' };

  const managementNumber = cleanIdentifier(signals.managementNumber);
  const createdDate = signals.createdDate?.trim();
  if (managementNumber && createdDate && /^\d{4}-\d{2}-\d{2}$/.test(createdDate)) {
    return {
      system: 'onnara',
      value: `${managementNumber}@${createdDate}`,
      basis: 'management-number-and-date',
    };
  }
  return null;
}

export function createRunContext(snapshot: OnnaraSnapshot, allowedOrigins: string[]): RunContext | null {
  if (!isConfiguredOnnaraUrl(snapshot.url, allowedOrigins)) return null;
  const origin = normalizedOrigin(snapshot.url);
  if (!origin) return null;
  return {
    tabId: snapshot.tabId,
    frameId: snapshot.frameId,
    url: snapshot.url,
    origin,
    pageKind: classifyOnnaraPage(snapshot.signals),
    documentKey: createDocumentKey(snapshot.signals),
    capturedAt: snapshot.capturedAt,
  };
}

/** 추천·초안을 실제 화면에 적용하기 직전에 대상이 그대로인지 확인한다. */
export function compareRunContext(expected: RunContext, current: RunContext): ContextMatch {
  if (expected.tabId !== current.tabId) return { ok: false, reason: 'tab-changed' };
  if (expected.frameId !== current.frameId) return { ok: false, reason: 'frame-changed' };
  if (expected.url !== current.url) return { ok: false, reason: 'page-changed' };
  if (expected.documentKey?.value !== current.documentKey?.value) return { ok: false, reason: 'document-changed' };
  return { ok: true };
}
