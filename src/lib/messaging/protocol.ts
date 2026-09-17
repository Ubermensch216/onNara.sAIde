import { abortable, deadlineSignal } from '@/lib/async';

/**
 * 계약 ② — Side Panel ↔ Service Worker ↔ Content Script 3자 통신 규약.
 * 계획서 §4.2
 *
 * 이 파일이 없으면 Phase 3·5에서 반드시 꼬인다. 코드보다 먼저 고정한다.
 *
 * 방향 규칙:
 *   Panel  → SW      : PanelToSW  (sendMessage, 응답을 await)
 *   SW     → Panel   : SWToPanel  (요청의 반환값 또는 push)
 *   SW     → Content : SWToContent (tabs.sendMessage)
 */

/* ── 오류 분류 ─────────────────────────────────────────── */

export type ErrorCode =
  /** Ollama 프로세스가 없음. fetch가 TypeError로 즉시 실패. */
  | 'OLLAMA_DOWN'
  /** 서버는 살아 있으나 요청한 모델이 /api/tags에 없음. */
  | 'MODEL_MISSING'
  /** ★ 서버는 응답하나 chrome-extension:// origin이 거부됨. OLLAMA_ORIGINS 미설정. */
  | 'CORS_BLOCKED'
  /** 메모리 부족. 16GB에 6.9GB 상주 + 임베딩 1.2GB 동시 로드 시 발생 가능. */
  | 'OOM'
  | 'TIMEOUT'
  /** 사용자가 중단(AbortController). 오류가 아니라 정상 흐름. */
  | 'ABORTED'
  /** chrome://, 웹스토어 등 content script 주입이 금지된 페이지. */
  | 'TAB_RESTRICTED'
  /**
   * 해당 사이트의 호스트 권한이 아직 없음.
   * activeTab은 사이드패널 사용 패턴에서 신뢰할 수 없어 optional_host_permissions로
   * 그때그때 요청한다. src/lib/permissions.ts 참조.
   */
  | 'HOST_PERMISSION_REQUIRED'
  /** 승인 카드에서 사용자가 거부. */
  | 'ACTION_DENIED'
  | 'UNKNOWN';

export interface AppError {
  code: ErrorCode;
  message: string;
  /** 사용자에게 보여줄 해결 방법. 없으면 UI가 기본 문구를 쓴다. */
  hint?: string;
}

/* ── 페이지 추출 결과 ──────────────────────────────────── */

export type ExtractMethod = 'readability' | 'innerText' | 'youtube-caption';

export interface ExtractedPage {
  url: string;
  title: string;
  /** ★ 이미 토큰 예산 내로 절단된 상태로 전달된다. 수신 측에서 다시 자르지 않는다. */
  text: string;
  /** 절단 전 원본 길이 (자) */
  charCount: number;
  /** true면 UI가 절단 고지 칩을 반드시 표시한다. 계획서 §6 완료 기준. */
  truncated: boolean;
  /** 0~1. 원본 대비 실제로 모델에 넣은 비율. */
  keptRatio: number;
  /** 추정 토큰 수 — 대기시간 예측에 쓴다. */
  estimatedTokens: number;
  method: ExtractMethod;
  extractedAt: number;
}

/* ── 페이지 액션 (Phase 5 에이전트) ─────────────────────── */

export type PageAction =
  | { kind: 'read_page' }
  | { kind: 'find_element'; query: string }
  /**
   * 승인 카드에 보여줄 대상 요소를 미리 확인한다. 부작용 없음.
   * click / type_text를 승인받기 **전에** 무엇을 건드리는지 알아야 하기 때문에 있다.
   * 계획서 §7 — 승인 카드는 대상 요소의 텍스트/aria-label을 표시해야 한다.
   */
  | { kind: 'describe_target'; selector: string }
  | { kind: 'scroll'; direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number }
  | { kind: 'click'; selector: string }
  | { kind: 'type_text'; selector: string; text: string }
  | { kind: 'navigate'; url: string };

/** 부작용이 있어 사용자 승인이 반드시 필요한 액션. 예외를 만들지 않는다. */
export const SIDE_EFFECT_ACTIONS = ['click', 'type_text', 'navigate'] as const;

export function requiresApproval(action: PageAction): boolean {
  return (SIDE_EFFECT_ACTIONS as readonly string[]).includes(action.kind);
}

/** 승인 카드가 사용자에게 보여줄 내용. 모델이 아니라 우리가 만든다. */
export interface ApprovalRequest {
  action: PageAction;
  /** 사람이 읽는 설명. 예: "'제출' 버튼을 클릭합니다" */
  humanDescription: string;
  /** 대상 요소의 표시 텍스트 또는 aria-label */
  targetLabel?: string;
  pageUrl: string;
  pageTitle: string;
}

/**
 * 액션 결과. **문구가 아니라 코드다.**
 *
 * ★ 주입 스크립트는 페이지 컨텍스트에서 돌아 설정 저장소에 닿지 않는다.
 *   거기서 한국어 문장을 만들면 영어 사용자에게 한국어가 그대로 남는다.
 *   로케일을 페이지로 내려보내는 방법도 있지만, 그러면 카탈로그 전체가
 *   모든 페이지 주입에 실린다. 그래서 반대로 한다 — 주입 스크립트는 무슨
 *   일이 있었는지만 알리고, i18n이 있는 패널이 문구를 만든다.
 *
 * ★ 이 결과는 화면(실행 단계 목록)과 모델(툴 결과) 양쪽으로 간다.
 *   둘 다 사용자의 로케일을 따라야 하므로 번역 지점은 패널 하나면 된다.
 */
export type ActionResultCode =
  | 'read'
  | 'found'
  | 'described'
  | 'scrolled'
  | 'clicked'
  | 'typed'
  | 'navigated'
  | 'notFound'
  | 'noElement'
  | 'notTextInput'
  | 'wrongRoute';

export interface ActionResult {
  ok: boolean;
  code: ActionResultCode;
  /** 문구에 끼워 넣을 값(요소 설명·선택자·방향 등). 페이지에서 온 텍스트다. */
  vars?: Record<string, string>;
  /** read_page 본문. 이것만은 문구가 아니라 데이터라 그대로 싣는다. */
  text?: string;
}

/* ── Panel → Service Worker ────────────────────────────── */

export interface RequestControl {
  id: string;
  deadline: number;
  expectedUrl?: string;
  approvalToken?: string;
}

export type PanelToSW = (
  | { type: 'EXTRACT_PAGE'; tabId: number; budgetTokens: number }
  | { type: 'CAPTURE_SCREENSHOT'; tabId: number }
  | { type: 'EXEC_ACTION'; tabId: number; action: PageAction }
  | { type: 'LIST_TABS' }
  | { type: 'GET_ACTIVE_TAB' }
  | { type: 'PREPARE_ACTION'; tabId: number; action: PageAction }
  | { type: 'CANCEL_REQUEST'; requestId: string }
) & { control?: RequestControl };

/* ── Service Worker → Panel ────────────────────────────── */

export interface TabSummary {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
}

export type SWToPanel =
  | { type: 'ACTION_PREPARED'; token: string; label?: string }
  | { type: 'PAGE_EXTRACTED'; payload: ExtractedPage }
  | { type: 'SCREENSHOT'; dataUrl: string }
  | { type: 'ACTION_RESULT'; result: ActionResult }
  | { type: 'TABS'; tabs: TabSummary[] }
  | { type: 'ACTIVE_TAB'; tab: TabSummary | null }
  | { type: 'TAB_CHANGED'; tab: TabSummary }
  | { type: 'CONTEXT_MENU'; preset: string; selectionText: string; tab: TabSummary }
  | { type: 'ERROR'; error: AppError };

/* ── Service Worker → Content Script ───────────────────── */

export type SWToContent = (
  | { type: 'CANCEL' }
  | { type: 'EXTRACT'; budgetTokens: number }
  | { type: 'ACT'; action: PageAction }
  | { type: 'PREPARE'; action: PageAction }
) & { control: RequestControl };

export type ContentToSW =
  | { type: 'PREPARED'; token: string; label?: string }
  | { type: 'EXTRACTED'; payload: ExtractedPage }
  | { type: 'ACTED'; result: ActionResult }
  | { type: 'FAILED'; error: AppError };

/* ── 타입 안전한 sendMessage 헬퍼 ──────────────────────── */

export async function sendToSW(msg: PanelToSW, signal?: AbortSignal, timeoutMs = 15_000): Promise<SWToPanel> {
  signal?.throwIfAborted();
  const guard = deadlineSignal(timeoutMs, signal);
  const control: RequestControl = {
    ...msg.control,
    id: crypto.randomUUID(),
    deadline: Date.now() + timeoutMs,
  };
  const cancel = () => {
    void chrome.runtime.sendMessage({ type: 'CANCEL_REQUEST', requestId: control.id }).catch(() => undefined);
  };
  guard.signal.addEventListener('abort', cancel, { once: true });
  try {
    return await abortable(chrome.runtime.sendMessage({ ...msg, control }), guard.signal) as SWToPanel;
  } finally {
    guard.signal.removeEventListener('abort', cancel);
    guard.dispose();
  }
}

export async function sendToContent(
  tabId: number,
  msg: SWToContent,
): Promise<ContentToSW> {
  return chrome.tabs.sendMessage(tabId, msg) as Promise<ContentToSW>;
}

/* ── URL 비교 ──────────────────────────────────────────── */

/**
 * 같은 문서인지 판정할 때 쓰는 정규화 형태.
 *
 * 해시(#)만 다른 것은 같은 문서로 본다 — 문서 내 이동일 뿐 내용이 바뀌지 않는다.
 * 반면 경로나 쿼리가 다르면 다른 글이다. 뉴스 사이트에서 기사 A와 B는
 * 호스트가 같아도 완전히 다른 내용이므로 반드시 구분해야 한다.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

/** 두 URL이 같은 문서를 가리키는가. */
export function sameDocument(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}

/** content script를 주입할 수 없는 URL인지 판정. 시도 전에 거른다. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('view-source:') ||
    url.startsWith('https://chromewebstore.google.com') ||
    url.startsWith('https://chrome.google.com/webstore')
  );
}
