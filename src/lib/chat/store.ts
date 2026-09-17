import { abortable } from '@/lib/async';
import { isAttachmentDownloadRequest } from '@/lib/onnara/attachments';
import { downloadDocumentAttachments, formatAttachmentReport, releaseWorkTab } from '@/lib/onnara/download';
/**
 * 채팅 상태. 계획서 §5 Phase 2–3
 *
 * Zustand를 쓰는 이유: 21 tok/s로 토큰이 들어올 때마다 상태가 갱신되는데,
 * Context는 구독자 전체를 리렌더시킨다. 셀렉터로 구독 범위를 좁힐 수 있어야 한다.
 *
 * ★ 이 스토어는 Side Panel 문서에서만 산다. Service Worker가 아니다.
 *   (MV3 워커는 30초 유휴에 죽으므로 장시간 스트리밍을 맡길 수 없다.)
 */

import { createStore } from 'zustand/vanilla';
import { createChatSessions } from './sessions';
import type { ChatMessage, PerfSample } from '@/types/ollama';
import { streamChat } from '@/lib/ollama/stream';
import { requireCapabilities } from '@/lib/ollama/client';
import { OllamaError } from '@/lib/ollama/errors';
import {
  addMessage,
  createConversation,
  db,
  deleteMessagesFrom,
  deleteMessage,
  deleteConversation,
  findForTab,
  listMessages,
  titleFrom,
  type Conversation,
  type StoredMessage,
} from '@/lib/storage/db';
import {
  buildContext,
  uncachedPrefillSeconds,
  type AttachedPage,
  type Attachment,
} from '@/lib/chat/context';
import { isRestrictedUrl, sameDocument, sendToSW } from '@/lib/messaging/protocol';
import type { ApprovalRequest, AppError, ExtractedPage } from '@/lib/messaging/protocol';
import type { Settings } from '@/lib/storage/settings';
import { AGENT_TOOLS } from '@/lib/agent/tools';
import { createBrowserTools } from '@/lib/agent/executor';
import { runAgentLoop, type AgentStep, type TurnResult } from '@/lib/agent/loop';
import { buildAgentSystem } from '@/lib/prompts/agent';
import {
  buildDocumentTitleTable,
  isDocumentListTableRequest,
  isDocumentSummaryRequest,
  matchDocumentTitle,
  requestedDocumentTitles,
} from '@/lib/onnara/document-list';

/** 에이전트가 조작할 탭. 제목까지 필요하다 — 승인 카드와 모델 안내에 쓴다. */
export interface AgentTab {
  tabId: number;
  url: string;
  title: string;
}

/** 화면에 그리는 메시지. 저장 레코드에 스트리밍 중 상태가 얹힌다. */
export interface UiMessage extends Omit<StoredMessage, 'id'> {
  id: number | string;
  streaming?: boolean;
}

export interface ChatState {
  conversation: Conversation | null;
  loading: boolean;
  /**
   * 아직 저장되지 않은 대화의 소속 정보.
   * 사이드패널은 탭마다 열리므로, 실제로 말이 오가기 전에는 레코드를 만들지
   * 않는다. 첫 메시지를 보낼 때 이 정보로 대화를 생성한다.
   */
  pending: { tabId: number; url: string } | null;
  messages: UiMessage[];

  /** 이 대화에 붙어 있는 페이지. 대화 내내 동일하게 유지된다(KV 캐시). */
  page: ExtractedPage | null;
  /**
   * 붙어 있는 화면 캡처(base64 PNG).
   * 실측상 약 262토큰 — 페이지 본문(2,000토큰)보다 8배 싸다.
   */
  screenshot: string | null;
  /** 페이지 추출 또는 화면 캡처 진행 중 */
  extracting: boolean;
  documentProgress?: string | null;
  /**
   * 패널이 알고 있는 현재 탭의 URL.
   * 붙어 있는 첨부물이 아직 이 페이지의 것인지 대조하는 데 쓴다.
   */
  currentUrl: string;

  streaming: boolean;
  startedAt: number | null;
  /** 이번 요청에서 실제로 프리필해야 할 예상 초 — 캐시 적중분은 뺀 값 */
  expectedPrefillSec: number;

  /**
   * 화면에 띄울 오류. ★ 문자열이 아니라 코드가 붙은 AppError다.
   * 코드가 있어야 UI가 해결 방법(명령·권한 요청 버튼)을 붙일 수 있다 —
   * 계획서 Phase 7-2. 문구는 lib/errors/describe.ts 한곳에서 만든다.
   */
  error: AppError | null;
  abort: AbortController | null;
  /** 직전 요청의 컨텍스트. 접두사 캐시 적중분을 계산하는 데 쓴다. */
  lastContext: ChatMessage[] | null;

  /* ── 에이전트 (Phase 5) ── */

  /** 진행 중인 루프의 단계 기록. 완료 시 메시지에 실려 저장된다. */
  agentSteps: AgentStep[];
  /** 지금 몇 번째 턴인가. 0이면 에이전트가 돌고 있지 않다. */
  agentTurn: number;
  /**
   * 승인 대기 중인 요청.
   *
   * ★ resolve를 부르기 전까지 루프는 여기서 멈춰 있다. 이 상태를 우회하는
   *   경로(자동 승인·기억하기)는 만들지 않는다 — 계획서 §7의 실질 방어선이다.
   */
  pendingApproval: { request: ApprovalRequest; resolve: (ok: boolean) => void } | null;

  openForTab: (tabId: number, url: string) => Promise<void>;
  openConversation: (conversation: Conversation) => Promise<void>;
  attachPage: (tabId: number, settings: Settings, force?: boolean) => Promise<ExtractedPage | null>;
  attachScreenshot: (tabId: number) => Promise<string | null>;
  detachPage: () => void;
  detachScreenshot: () => void;
  send: (text: string, settings: Settings) => Promise<void>;
  /** 에이전트 모드 전송 (Phase 5). 툴을 붙여 최대 8턴까지 돈다. */
  sendAgent: (text: string, settings: Settings, tab: AgentTab) => Promise<void>;
  /** 승인 카드의 응답. false면 실행하지 않는다. */
  resolveApproval: (approved: boolean) => void;
  regenerate: (settings: Settings) => Promise<void>;
  removeMessage: (id: UiMessage['id']) => Promise<void>;
  resetConversation: () => Promise<void>;
  stop: () => void;
  setError: (e: AppError | string | null) => void;
  clearError: () => void;
}

interface SessionEpochs { view: number; operation: number; attachment: number }

/** Each document owns its state and cancellation counters, even while hidden. */
export function createChatSession() {
  const epochs: SessionEpochs = { view: 0, operation: 0, attachment: 0 };
  const tasks = new Set<Promise<void>>();
  async function track(task: Promise<void>) {
    tasks.add(task);
    try { await task; } finally { tasks.delete(task); }
  }
  return createStore<ChatState>((set, get) => ({
    conversation: null,
    loading: false,
    pending: null,
    messages: [],
    page: null,
    screenshot: null,
    extracting: false,
    currentUrl: '',
    streaming: false,
    startedAt: null,
    expectedPrefillSec: 0,
    error: null,
    abort: null,
    lastContext: null,
    agentSteps: [],
    agentTurn: 0,
    pendingApproval: null,

    /** 탭별 세션 분리 (Phase 2-5). 탭이 바뀌면 그 탭의 대화로 갈아끼운다. */
    async openForTab(tabId, url) {
      get().stop();
      const epoch = ++epochs.view;
      ++epochs.attachment;
      set({ loading: true, extracting: false, conversation: null, pending: null, messages: [], page: null, screenshot: null, currentUrl: url, error: null, lastContext: null, agentSteps: [] });
      try {
        const conversation = await findForTab(tabId, url);
        const messages = conversation ? await listMessages(conversation.id) : [];
        if (epoch === epochs.view) set({ conversation, pending: conversation ? null : { tabId, url }, messages, loading: false });
      } catch (error) { if (epoch === epochs.view) set({ loading: false, error: toAppError(null, error) }); }
    },
    async openConversation(conversation) {
      get().stop();
      const epoch = ++epochs.view;
      ++epochs.attachment;
      set({ loading: true, extracting: false, page: null, screenshot: null, messages: [], pending: null, conversation: null, agentSteps: [], lastContext: null, error: null });
      try {
        const messages = await listMessages(conversation.id);
        if (epoch === epochs.view) set({ conversation, messages, loading: false });
      } catch (error) { if (epoch === epochs.view) set({ loading: false, error: toAppError(null, error) }); }
    },

    /**
     * 현재 탭 본문을 추출해 대화에 붙인다.
     *
     * ★ 이미 같은 URL이 붙어 있으면 재추출하지 않는다(계획서 Phase 3-5).
     *   재추출은 낭비일 뿐 아니라, 본문이 1바이트라도 달라지면 접두사가 바뀌어
     *   KV 캐시가 통째로 무효화된다(프리필 183ms → 7,684ms).
     */
    async attachPage(tabId, settings, force = false) {
      const current = get().page;
      if (get().extracting || get().loading) return current;
      const epoch = ++epochs.attachment;
      const expectedUrl = get().currentUrl;

      set({ extracting: true, error: null });
      try {
        const res = await sendToSW({
          type: 'EXTRACT_PAGE',
          tabId,
          budgetTokens: settings.pageTokenBudget,
          control: { id: '', deadline: 0, expectedUrl: expectedUrl || undefined },
        });
        if (epoch !== epochs.attachment) return null;

        if (res.type === 'ERROR') {
          set({ error: res.error });
          return null;
        }
        if (res.type !== 'PAGE_EXTRACTED') return null;

        const page = res.payload;
        // 같은 URL이면 기존 것을 유지해 접두사를 보존한다.
        if (!force && current && current.url === page.url) return current;

        set({ page, currentUrl: page.url, lastContext: null });
        return page;
      } catch (error) {
        if (epoch === epochs.attachment) set({ error: toAppError(null, error) });
        return null;
      } finally {
        if (epoch === epochs.attachment) set({ extracting: false });
      }
    },

    /**
     * 현재 탭 화면을 캡처해 붙인다.
     *
     * 본문 추출이 실패하는 페이지(캔버스 앱, 대시보드, 차트)에서 특히 유용하다 —
     * 실측 262토큰 / 프리필 4.5초로, 본문을 넣는 것보다 오히려 싸고 빠르다.
     */
    async attachScreenshot(tabId) {
      if (get().extracting || get().loading) return get().screenshot;
      const epoch = ++epochs.attachment;
      const expectedUrl = get().currentUrl;

      set({ extracting: true, error: null });
      try {
        const res = await sendToSW({ type: 'CAPTURE_SCREENSHOT', tabId, control: { id: '', deadline: 0, expectedUrl: expectedUrl || undefined } });
        if (epoch !== epochs.attachment) return null;
        if (res.type === 'ERROR') {
          set({ error: res.error });
          return null;
        }
        if (res.type !== 'SCREENSHOT') return null;

        // Ollama의 images 필드는 순수 base64를 받는다. data: 프리픽스를 떼어낸다.
        const base64 = res.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        set({ screenshot: base64, lastContext: null });
        return base64;
      } catch (error) {
        if (epoch === epochs.attachment) set({ error: toAppError(null, error) });
        return null;
      } finally {
        if (epoch === epochs.attachment) set({ extracting: false });
      }
    },

    detachPage: () => { ++epochs.attachment; set({ page: null, lastContext: null, extracting: false }); },
    detachScreenshot: () => { ++epochs.attachment; set({ screenshot: null, lastContext: null, extracting: false }); },

    async send(text, settings) {
      await track(submit(set, get, text, settings, epochs));
    },
    async sendAgent(text, settings, tab) {
      await track(submit(set, get, text, settings, epochs, tab));
    },

    resolveApproval(approved) {
      const pending = get().pendingApproval;
      if (!pending) return;
      set({ pendingApproval: null });
      pending.resolve(approved);
    },

    async removeMessage(id) {
      const { conversation, streaming, loading } = get();
      if (!conversation || streaming || loading) return;
      if (!get().messages.some(message => message.id === id)) return;
      set({ loading: true, error: null });
      try {
        // A stopped response can still be committing its partial answer.
        await Promise.allSettled([...tasks]);
        await deleteMessage(conversation.id, id);
        set(state => ({ messages: state.messages.filter(message => message.id !== id), lastContext: null }));
      } catch (error) { set({ error: toAppError(null, error) }); }
      finally { set({ loading: false }); }
    },

    async resetConversation() {
      if (get().loading) return;
      const { conversation, pending } = get();
      get().stop();
      ++epochs.attachment;
      set({ loading: true, extracting: false, documentProgress: null, error: null });
      try {
        // Removing the record also rejects late writes from the cancelled request.
        if (conversation) await deleteConversation(conversation.id);
        set({ conversation: null,
          pending: conversation ? { tabId: conversation.tabId, url: conversation.originUrl } : pending,
          messages: [], page: null, screenshot: null, lastContext: null,
          agentSteps: [], agentTurn: 0, expectedPrefillSec: 0,
        });
      } catch (error) { set({ error: toAppError(null, error) }); }
      finally { set({ loading: false }); }
    },

    /** 재생성: 마지막 assistant 응답을 걷어내고 같은 입력으로 다시 돌린다. */
    async regenerate(settings) {
      await track((async () => {
        if (get().streaming || get().loading) return;
        const conv = get().conversation;
        const msgs = get().messages;
        const index = findLastIndex(msgs, m => m.role === 'assistant');
        if (!conv || index < 0) return;
        const epoch = ++epochs.operation;
        set({ streaming: true, abort: new AbortController() });
        const ownSet = guardedSet(set, () => epoch === epochs.operation);
        try {
          await requireCapabilities(settings.endpoint, settings.model, get().screenshot ? ['vision'] : [], get().abort?.signal);
          if (epoch !== epochs.operation) return;
          await deleteMessagesFrom(conv.id, msgs[index]!.createdAt);
          if (epoch !== epochs.operation) return;
          ownSet({ messages: msgs.slice(0, index) });
          await runGeneration(ownSet, get, settings);
        } catch (error) { ownSet({ error: toAppError(null, error) }); }
        finally { ownSet({ streaming: false, abort: null }); }
      })());
    },

    stop() {
      ++epochs.operation;
      // 승인 대기 중에 중단을 누르면 그 동작은 거부로 처리한다.
      // 대기 중인 Promise를 남겨 두면 루프가 영원히 멈춰 있게 된다.
      const pending = get().pendingApproval;
      if (pending) {
        set({ pendingApproval: null });
        pending.resolve(false);
      }

      const { abort } = get();
      abort?.abort();
      set(s => ({ abort: null, streaming: false, startedAt: null, agentTurn: 0,
        messages: s.messages.filter(m => !m.streaming || m.content || m.thinking).map(m => m.streaming ? { ...m, streaming: false, aborted: true } : m),
      }));
    },

    // 문자열로 넘어온 것은 분류되지 않은 오류다. 코드만 씌워 형태를 맞춘다.
    setError: (e) =>
      set({ error: typeof e === 'string' ? { code: 'UNKNOWN', message: e } : e }),
    clearError: () => set({ error: null }),
  }));
}

export const useChat = createChatSessions(createChatSession);

/* ── 생성 루프 ─────────────────────────────────────────── */

type Set = (
  partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
) => void;
type Get = () => ChatState;

function guardedSet(set: Set, owns: () => boolean): Set {
  return patch => { if (owns()) set(patch); };
}

async function submit(set: Set, get: Get, text: string, settings: Settings, epochs: SessionEpochs, tab?: AgentTab) {
  const trimmed = text.trim();
  if (!trimmed || get().streaming || get().loading) return;
  const epoch = ++epochs.operation;
  const owns = () => epoch === epochs.operation;
  const ownSet = guardedSet(set, owns);
  ownSet({ streaming: true, startedAt: Date.now(), abort: new AbortController(), error: null });
  try {
    const conv = await ensureConversation(ownSet, get, trimmed, owns);
    if (!conv || !owns()) return;
    const userMsg = { conversationId: conv.id, role: 'user' as const, content: trimmed, createdAt: Date.now() };
    const id = await addMessage(userMsg);
    if (!owns()) return;
    ownSet(s => ({ messages: [...s.messages, { ...userMsg, id }] }));

    const pageTabId = await resolvePageTab(ownSet, get);
    if (!owns()) return;

    const report = async (content: string) => {
      if (!owns() || get().abort?.signal.aborted) return;
      const message = { conversationId: conv.id, role: 'assistant' as const, content, createdAt: Date.now() };
      const reportId = await addMessage(message);
      ownSet(s => ({ messages: [...s.messages, { ...message, id: reportId }] }));
    };
    // "요약하고 첨부도 받아줘"처럼 둘 다 요청하면 다운로드만 하고 끝내지 않는다. 요약 경로에서 문서마다 함께 처리한다.
    const wantsDownload = isAttachmentDownloadRequest(trimmed);
    const withAttachments = wantsDownload && isDocumentSummaryRequest(trimmed);
    if (wantsDownload && !withAttachments) {
      const signal = get().abort!.signal;
      if (pageTabId === null) { ownSet({ error: TAB_MISSING_ERROR }); return; }
      const page = await get().attachPage(pageTabId, settings, true);
      if (!page || !owns() || signal.aborted) return;
      await downloadDocumentAttachments({ tabId: pageTabId, page, prompt: trimmed, signal,
        progress: documentProgress => ownSet({ documentProgress }), report });
      return;
    }

    await refreshDocumentListIfRequested(get, text, settings, pageTabId);
    if (!owns()) return;
    if (!await prepareDocumentSummary(ownSet, get, text, settings, epochs, pageTabId, withAttachments ? report : undefined) || !owns()) return;

    const localAnswer = buildDocumentTitleTable(trimmed, get().page?.structuredData);
    if (localAnswer) {
      const assistantMsg = {
        conversationId: conv.id,
        role: 'assistant' as const,
        content: localAnswer,
        notice: '온나라 문서 목록을 화면의 표 구조에서 읽어 작성했습니다.',
        createdAt: Date.now() + 1,
      };
      const assistantId = await addMessage(assistantMsg);
      if (owns()) ownSet(s => ({ messages: [...s.messages, { ...assistantMsg, id: assistantId }] }));
      return;
    }

    await requireCapabilities(settings.endpoint, settings.model, [...(tab ? ['tools'] : []), ...(get().screenshot ? ['vision'] : [])], get().abort?.signal);
    if (!owns()) return;
    if (tab) await runAgent(ownSet, get, settings, tab);
    else await runGeneration(ownSet, get, settings);
  } catch (error) { ownSet({ error: toAppError(error instanceof OllamaError ? error : null, error) }); }
  finally { ownSet({ streaming: false, abort: null, startedAt: null, documentProgress: null }); }
}

const TAB_MISSING_ERROR: AppError = {
  code: 'UNKNOWN',
  message: '이 대화가 연결된 탭을 찾을 수 없습니다.',
  hint: '온나라 문서 목록이나 문서 화면을 연 탭에서 사이드패널을 열고 다시 요청하세요.',
};

/**
 * 페이지를 읽을 실제 탭을 정한다.
 *
 * ★ 대화에 저장된 tabId는 영구적이지 않다. 브라우저를 다시 켜거나 탭을 닫은 뒤
 *   대화 기록에서 대화를 다시 열면 그 id의 탭은 더 이상 없다. 그 id로 요청하면
 *   서비스 워커가 탭을 찾지 못해 읽기에 실패한다. 저장된 탭이 사라졌으면 지금
 *   사용자가 보고 있는 탭으로 대화를 다시 연결한다.
 */
export async function resolvePageTab(set: Set, get: Get): Promise<number | null> {
  const state = get();
  const stored = state.conversation?.tabId ?? state.pending?.tabId;
  const valid = typeof stored === 'number' && stored >= 0;
  // 탭 API가 없는 환경(테스트 등)에서는 저장된 값을 그대로 쓴다.
  if (typeof chrome === 'undefined' || !chrome.tabs?.get || !chrome.tabs?.query) return valid ? stored : null;
  if (valid && await chrome.tabs.get(stored).then(tab => !!tab, () => false)) return stored;

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [] as chrome.tabs.Tab[]);
  if (typeof active?.id !== 'number' || active.id < 0 || isRestrictedUrl(active.url)) return null;
  const tabId = active.id;
  const url = active.url ?? '';
  const conversation = get().conversation;
  if (conversation) {
    await db.conversations.update(conversation.id, { tabId });
    set({ conversation: { ...conversation, tabId }, currentUrl: url });
  } else if (state.pending) {
    set({ pending: { ...state.pending, tabId }, currentUrl: url });
  }
  return tabId;
}

async function refreshDocumentListIfRequested(get: Get, text: string, settings: Settings, tabId: number | null): Promise<void> {
  if (!isDocumentListTableRequest(text)) return;
  if (tabId !== null) await get().attachPage(tabId, settings, true);
}

async function prepareDocumentSummary(
  set: Set,
  get: Get,
  text: string,
  settings: Settings,
  epochs: SessionEpochs,
  tabId: number | null,
  /** 있으면 요약과 함께 첨부도 받고 그 결과를 이 함수로 답변에 남긴다. */
  reportAttachments?: (content: string) => Promise<void>,
): Promise<boolean> {
  if (!isDocumentSummaryRequest(text)) return true;
  if (tabId === null) { set({ error: TAB_MISSING_ERROR }); return false; }
  const state = get();
  const signal = state.abort?.signal;
  const view = epochs.view;

  const listPage = await state.attachPage(tabId, settings, true);
  if (signal?.aborted || view !== epochs.view) return false;
  if (!listPage) return false;
  const list = listPage?.structuredData;
  // 일반 웹 문서(또는 이미 연 상세 화면)의 요약 요청은 기존 페이지 요약 경로에 맡긴다. 첨부는 지금 화면에서 먼저 받는다.
  if (!list) {
    if (reportAttachments && signal) {
      await downloadDocumentAttachments({ tabId, page: listPage, prompt: text, signal,
        progress: documentProgress => set({ documentProgress }), report: reportAttachments });
      if (signal.aborted || view !== epochs.view) return false;
    }
    return true;
  }

  const match = matchDocumentTitle(text, list);
  const titles = requestedDocumentTitles(text, list);
  if (!titles.length) {
    const candidates = ('candidates' in match ? match.candidates : []).slice(0, 5).join(', ');
    set({
      error: {
        code: 'UNKNOWN',
        message: match.status === 'ambiguous'
          ? '요청한 제목과 일치하는 문서가 여러 개입니다.'
          : '요약할 문서를 찾지 못했습니다. 문서를 체크하거나 제목 또는 전체 문서를 지정하세요.',
        hint: candidates ? `문서 제목을 더 정확히 입력하세요. 현재 후보: ${candidates}` : undefined,
      },
    });
    return false;
  }

  const epoch = ++epochs.attachment;
  set({ extracting: true, error: null });
  const controller = state.abort;
  const failures: string[] = [];
  // 문서 사이에도 중단 버튼과 진행 표시를 유지하려고 생성 중 상태를 붙잡아 둔다.
  // 배치가 끝난 뒤 도착하는 늦은 갱신(표시 지연 타이머 등)까지 붙잡으면 패널이 영원히 "읽는 중"으로 남는다.
  let batching = true;
  const withAttachments = Boolean(reportAttachments);
  // 첨부를 함께 받으면 한 건이어도 문서별 보고가 필요하므로 배치 경로로 처리한다.
  const batch = titles.length > 1 || withAttachments;
  // 여러 문서는 복제한 목록 탭 하나를 끝까지 재사용한다(문서마다 목록 복원을 반복하지 않는다).
  const keepWorkTab = titles.length > 1;
  try {
    for (const [index, title] of titles.entries()) {
    if (signal?.aborted || epoch !== epochs.attachment) return false;
    set({ extracting: true, streaming: true, startedAt: Date.now(), expectedPrefillSec: 0, abort: controller, documentProgress: `${index + 1}/${titles.length}번째 문서 본문을 읽는 중 · ${title}` });
    const response = await sendToSW({
      type: 'READ_DOCUMENT',
      tabId,
      title,
      budgetTokens: settings.pageTokenBudget,
      ...(withAttachments ? { withAttachments } : {}),
      ...(keepWorkTab ? { keepWorkTab } : {}),
      control: { id: '', deadline: 0, expectedUrl: state.currentUrl || undefined },
    }, signal, withAttachments ? 170_000 : 120_000);
    if (epoch !== epochs.attachment || signal?.aborted) return false;
    if (response.type === 'ERROR') {
      // 권한 문제는 나머지 문서도 똑같이 실패한다. 계속 돌리지 않고 바로 멈춰 권한 허용 버튼을 보여 준다.
      if (titles.length === 1 || response.error.code === 'HOST_PERMISSION_REQUIRED') {
        set({ error: failures.length ? { ...response.error, hint: `${response.error.hint ?? ''} 앞서 실패한 문서: ${failures.join(' / ')}`.trim() } : response.error });
        return false;
      }
      failures.push(`${title}: ${response.error.message}`);
      continue;
    }
    if (response.type !== 'DOCUMENT_READ') {
      set({ error: { code: 'UNKNOWN', message: '문서 본문 읽기 결과를 받지 못했습니다.' } });
      return false;
    }
    set({ page: { ...response.payload, title }, screenshot: null, lastContext: null });
    if (batch) {
      set({ extracting: false, documentProgress: `${index + 1}/${titles.length}번째 문서 · AI가 읽은 내용을 분석하고 요약하는 중입니다. CPU에서는 수 분 걸릴 수 있습니다.` });
      const batchGet: Get = () => ({ ...get(), messages: get().messages.filter(message => message.role === 'user').slice(-1).map(message => ({ ...message, content: documentBatchInstruction(title, text, withAttachments) })) });
      // 한 문서씩 생성해 여러 본문을 CPU 모델에 한꺼번에 넣지 않는다.
      const batchSet: Set = patch => set(current => ({
        ...(typeof patch === 'function' ? patch(current) : patch),
        ...(batching ? { streaming: true, abort: controller } : {}),
      }));
      await runGeneration(batchSet, batchGet, { ...settings, thinkMode: 'off' });
      if (signal?.aborted) return false;
      if (get().error) failures.push(`${title}: ${get().error!.message}`);
      // 요약 바로 아래에 같은 문서의 첨부 다운로드 결과를 남긴다.
      if (reportAttachments) await reportAttachments(formatAttachmentReport(title, { results: response.attachments, error: response.attachmentError }));
    }
    }
    if (failures.length) set({ error: { code: 'UNKNOWN', message: `일부 문서를 처리하지 못했습니다.\n${failures.join('\n')}` } });
    if (batch) return false;
    set({ documentProgress: '1/1번째 문서 · AI가 읽은 내용을 분석하고 요약하는 중입니다. CPU에서는 수 분 걸릴 수 있습니다.' });
    return true;
  } catch (error) {
    if (epoch === epochs.attachment && !signal?.aborted) set({ error: error instanceof Error && error.name === 'TimeoutError'
      ? { code: 'UNKNOWN', message: '문서 화면 읽기가 120초 안에 완료되지 않았습니다. AI 생성 전 단계의 시간 초과입니다.', hint: '복제 탭에서 원래 문서 목록이 복원되는지, 상세 본문이 표시되는지 확인이 필요합니다.' }
      : toAppError(null, error) });
    return false;
  } finally {
    batching = false;
    if (keepWorkTab) void releaseWorkTab(tabId);
    if (epoch === epochs.attachment) set({ extracting: false });
  }
}

/**
 * 여러 문서를 한 건씩 요약할 때 모델에 보내는 요청.
 *
 * ★ 항목(핵심 내용·요청 사항·기한 등)을 미리 정해 두지 않는다. 틀을 주면 작은
 *   모델은 본문을 읽기보다 칸을 채우려 하고, 알림·보고·회의록처럼 틀에 맞지 않는
 *   문서마다 "명시되어 있지 않습니다"만 늘어놓는다. 형식은 사용자 요청과 문서
 *   자체의 구성을 따르게 한다.
 */
export function documentBatchInstruction(title: string, request: string, attachmentsHandled = false): string {
  return [
    `첨부된 페이지 내용은 문서 '${title}'의 상세 화면이다. 이 문서 한 건의 본문을 직접 읽고 사용자 요청에 답하라.`,
    '첫 줄에 문서 제목을 쓰고, 이어서 본문에 실제로 적힌 내용을 문서의 구성에 맞게 정리하라.',
    '정해진 항목을 채우려 하지 말고, 본문에 없는 항목은 언급하지 마라.',
    '화면에 메뉴·버튼·첨부 목록만 있고 본문을 찾을 수 없으면 그렇게 밝혀라.',
    // 다운로드 요청까지 모델에 그대로 넘기면 "다운로드 기능이 없다"고 답한다. 실제 다운로드는 앱이 따로 하고 결과를 아래에 붙인다.
    ...(attachmentsHandled ? ['첨부 파일 다운로드는 앱이 이미 처리해 결과를 따로 보여 준다. 다운로드에 대해서는 아무것도 쓰지 말고 문서 내용 요약만 하라.'] : []),
    `사용자 요청: ${request}`,
  ].join('\n');
}

/**
 * 대화 레코드를 확보한다. 아직 없으면 지금 만든다.
 *
 * ★ 대화가 DB에 생기는 지점은 여기 한 곳뿐이다.
 *   패널이 열릴 때가 아니라 **첫 메시지를 보낼 때** 만들어야 빈 대화방이
 *   쌓이지 않는다. 제목도 이때 함께 정해 별도 갱신 쿼리를 아낀다.
 */
async function ensureConversation(
  set: Set,
  get: Get,
  firstMessage: string,
  owns: () => boolean,
): Promise<Conversation | null> {
  const existing = get().conversation;
  if (existing) return existing;

  const p = get().pending;
  if (!p) return null;

  const id = await createConversation(p.tabId, p.url, titleFrom(firstMessage));
  const conv = await db.conversations.get(id);
  if (!conv) return null;
  if (!owns()) { await deleteConversation(id); return null; }

  set({ conversation: conv, pending: null });
  return conv;
}

function toAttachment(page: ExtractedPage | null, screenshot: string | null): Attachment {
  const p: AttachedPage | null = page
    ? {
        url: page.url,
        title: page.title,
        text: page.text,
        truncated: page.truncated,
        keptRatio: page.keptRatio,
      }
    : null;
  return { page: p, screenshot };
}

/**
 * ★ 최종 안전망 — 첨부물이 아직 현재 페이지의 것인지 대조한다.
 *
 *   탭 변경 감지(background의 onUpdated)와 대화 이어가기 규칙(findForTab)이
 *   이미 막고 있지만, 둘 다 브라우저 이벤트에 의존한다. iframe 이동이나
 *   이벤트 유실 같은 경우에 낡은 본문이 남을 수 있다.
 *
 *   그 상태로 생성하면 모델이 **다른 글을 근거로 그럴듯하게** 답한다.
 *   사용자가 알아채기 가장 어려운 종류의 오답이므로, 여기서 한 번 더 막고
 *   왜 페이지가 빠졌는지 알린다.
 */
function freshAttachment(
  set: Set,
  get: Get,
): { page: ExtractedPage | null; screenshot: string | null; stale: boolean } {
  const currentUrl = get().currentUrl;
  const rawPage = get().page;
  const stale = Boolean(rawPage && currentUrl && !sameDocument(rawPage.url, currentUrl));

  if (stale) set({ page: null, screenshot: null, lastContext: null });

  return {
    page: stale ? null : rawPage,
    screenshot: stale ? null : get().screenshot,
    stale,
  };
}

const STALE_NOTICE =
  '페이지가 바뀌어 이전 본문을 떼어냈습니다. 현재 페이지 내용은 참조하지 않았습니다.';

async function runGeneration(set: Set, get: Get, settings: Settings) {
  const conv = get().conversation;
  if (!conv) return;

  const abort = get().abort ?? new AbortController();
  const startedAt = Date.now();

  const { page, screenshot, stale } = freshAttachment(set, get);

  const context = buildContext(
    get().messages,
    settings.numCtx,
    toAttachment(page, screenshot),
  );
  // 캐시 적중분을 뺀 예상 대기시간. 페이지를 붙인 후속 질문은 이 값이 거의 0이다.
  const expectedPrefillSec = uncachedPrefillSeconds(get().lastContext, context);

  // 스트리밍 중 자리표시자. 실제 저장은 완료 후 한 번만 한다 —
  // 토큰마다 IndexedDB에 쓰면 21 tok/s에서도 부하가 크다.
  const placeholder: UiMessage = {
    id: `streaming-${crypto.randomUUID()}`,
    conversationId: conv.id,
    role: 'assistant',
    content: '',
    thinking: '',
    createdAt: startedAt,
    streaming: true,
  };

  set((s) => ({
    messages: [...s.messages, placeholder],
    streaming: true,
    startedAt,
    expectedPrefillSec,
    abort,
    error: null,
  }));

  let content = '';
  let thinking = '';
  let perf: PerfSample | null = null;

  const flush = () =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === placeholder.id ? { ...m, content, thinking } : m,
      ),
    }));

  // 토큰마다 React를 돌리면 프레임을 놓친다. 60ms 단위로 묶는다.
  let pending: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = undefined;
      flush();
    }, 60);
  };
  // 응답이 끝난 뒤 남은 지연 갱신이 완료 상태를 덮어쓰지 않게 한다.
  const cancelScheduled = () => { clearTimeout(pending); pending = undefined; };

  // 페이지를 처음 붙인 턴에만 절단 고지를 메시지에 남긴다.
  // 조용히 넘어가지 않는다 — 페이지 없이 답한 사실을 반드시 알린다.
  const staleNotice = stale ? STALE_NOTICE : undefined;

  const truncNotice =
    page?.truncated && !get().lastContext
      ? `본문이 길어 앞부분 ${Math.round(page.keptRatio * 100)}%만 참조했습니다.`
      : undefined;

  const notice = staleNotice ?? truncNotice;

  try {
    perf = await abortable(streamChat(
      settings.endpoint,
      {
        model: settings.model,
        messages: context,
        stream: true,
        // 일반 대화에서는 thinking을 끈다. 실측상 총 지연이 6.4배 차이난다.
        think: settings.thinkMode === 'always',
        keep_alive: settings.keepAlive,
        options: { temperature: settings.temperature, num_ctx: settings.numCtx },
      },
      {
        onToken: (t) => {
          content += t;
          schedule();
        },
        onThinking: (t) => {
          thinking += t;
          schedule();
        },
      },
      abort.signal,
    ), abort.signal);
    abort.signal.throwIfAborted();

    cancelScheduled();
    flush();

    const id = await addMessage({
      conversationId: conv.id,
      clientId: String(placeholder.id),
      role: 'assistant',
      content,
      thinking: thinking || undefined,
      notice,
      perf: perf ?? undefined,
      createdAt: startedAt,
    });

    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === placeholder.id
          ? {
              ...m,
              id,
              content,
              thinking: thinking || undefined,
              notice,
              perf: perf ?? undefined,
              streaming: false,
            }
          : m,
      ),
      streaming: false,
      startedAt: null,
      abort: null,
      // 다음 턴의 캐시 적중분 계산 기준. 이번 응답까지 포함해야 정확하다.
      lastContext: [...context, { role: 'assistant', content }],
    }));
  } catch (e) {
    const err = e instanceof OllamaError ? e : null;
    const aborted = err?.code === 'ABORTED' || abort.signal.aborted;
    cancelScheduled();

    // 중단은 오류가 아니다. 여기까지 받은 내용은 살려서 저장한다.
    if (aborted && content) {
      const id = await addMessage({
        conversationId: conv.id,
        clientId: String(placeholder.id),
        role: 'assistant',
        content,
        thinking: thinking || undefined,
        notice,
        aborted: true,
        createdAt: startedAt,
      });
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === placeholder.id
            ? { ...m, id, content, notice, aborted: true, streaming: false }
            : m,
        ),
        streaming: false,
        startedAt: null,
        abort: null,
        lastContext: null, // 중단된 응답은 캐시 기준으로 삼지 않는다
      }));
      return;
    }

    // 실패한 자리표시자는 남기지 않는다. 오류는 배너로 보여준다.
    set((s) => ({
      messages: s.messages.filter((m) => m.id !== placeholder.id),
      streaming: false,
      startedAt: null,
      abort: null,
      lastContext: null,
      error: aborted ? null : toAppError(err, e),
    }));
  }
}

/* ── 에이전트 루프 (Phase 5) ───────────────────────────── */

/**
 * 툴을 붙여 최대 8턴을 돈다. 계획서 §5 Phase 5-2
 *
 * ★ 일반 생성과 나눠 둔 이유는 비용이다. 툴 스키마 8종은 매 턴 프리필에
 *   들어가므로, 툴이 필요 없는 대화에까지 붙이면 모든 질문이 느려진다.
 *   그래서 에이전트는 사용자가 명시적으로 켰을 때만 이 경로로 온다.
 */
async function runAgent(set: Set, get: Get, settings: Settings, tab: AgentTab) {
  const conv = get().conversation;
  if (!conv) return;

  const abort = get().abort ?? new AbortController();
  const startedAt = Date.now();
  const { page, screenshot, stale } = freshAttachment(set, get);

  // ★ 시스템 프롬프트 · 에이전트 지침 · 현재 탭 안내를 **하나로 합쳐** 넣는다.
  //   나눠 넣으면 도구 호출이 깨지고, 탭을 알려주지 않으면 "어떤 페이지요?"라고
  //   되묻고 끝난다. 둘 다 실측 근거는 prompts/agent.ts 머리말.
  const context = buildContext(
    get().messages,
    settings.numCtx,
    toAttachment(page, screenshot),
    buildAgentSystem(tab),
  );

  const placeholder: UiMessage = {
    id: `streaming-${crypto.randomUUID()}`,
    conversationId: conv.id,
    role: 'assistant',
    content: '',
    thinking: '',
    steps: [],
    createdAt: startedAt,
    streaming: true,
  };

  set((s) => ({
    messages: [...s.messages, placeholder],
    streaming: true,
    startedAt,
    expectedPrefillSec: uncachedPrefillSeconds(get().lastContext, context),
    abort,
    error: null,
    agentSteps: [],
    agentTurn: 0,
  }));

  let content = '';
  let thinking = '';

  // 토큰마다 리렌더하면 프레임을 놓친다. 60ms로 묶는 것은 일반 생성과 같다.
  let pending = false;
  const flush = () =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === placeholder.id ? { ...m, content, thinking, steps: s.agentSteps } : m,
      ),
    }));
  const schedule = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      flush();
    }, 60);
  };

  const { execute, describeTarget } = createBrowserTools(() => tab.tabId, () => tab.url);
  let visionChecked = Boolean(screenshot);

  try {
    const outcome = await runAgentLoop(
      context,
      {
        chat: async (messages, handlers, signal): Promise<TurnResult> => {
          if (!visionChecked && messages.some(message => message.images?.length)) {
            await requireCapabilities(settings.endpoint, settings.model, ['vision'], signal);
            visionChecked = true;
          }
          let turnContent = '';
          let turnThinking = '';
          const toolCalls: TurnResult['toolCalls'] = [];

          const perf = await streamChat(
            settings.endpoint,
            {
              model: settings.model,
              messages,
              stream: true,
              // ★ 여기서만 thinking을 켠다(계획서 Phase 5). 계획 단계의 정확도가
              //   6.4배의 지연보다 중요한 유일한 지점이다. 'off'면 사용자 뜻대로 끈다.
              think: settings.thinkMode !== 'off',
              keep_alive: settings.keepAlive,
              tools: AGENT_TOOLS,
              options: { temperature: settings.temperature, num_ctx: settings.numCtx },
            },
            {
              onToken: (t) => {
                turnContent += t;
                content = turnContent;
                handlers.onToken?.(t);
                if (!abort.signal.aborted) schedule();
              },
              onThinking: (t) => {
                turnThinking += t;
                thinking += t;
                handlers.onThinking?.(t);
                if (!abort.signal.aborted) schedule();
              },
              onToolCall: (c) => toolCalls.push(c),
            },
            signal,
          );

          return { content: turnContent, thinking: turnThinking, toolCalls, perf };
        },

        execute,
        describeTarget,

        // 승인 카드가 뜨고, 사용자가 누를 때까지 루프가 여기서 멈춘다.
        approve: (request) =>
          new Promise<boolean>((resolve) => { if (abort.signal.aborted) resolve(false); else set({ pendingApproval: { request, resolve } }); }),

        currentPage: () => ({ url: tab.url, title: tab.title }),

        onEvent: (e) => {
          if (e.type === 'turn-start') set({ agentTurn: e.turn });
          else if (e.type === 'step') {
            set((s) => ({ agentSteps: [...s.agentSteps, e.step] }));
            flush();
          }
        },
      },
      {
        maxTurns: settings.agentMaxTurns,
        signal: abort.signal,
      },
    );

    content = outcome.content;
    thinking = outcome.thinking;
    const steps = outcome.steps;

    const notice = stale ? STALE_NOTICE : outcome.notice;
    const aborted = outcome.stopReason === 'aborted';

    const id = await addMessage({
      conversationId: conv.id,
      clientId: String(placeholder.id),
      role: 'assistant',
      content,
      thinking: thinking || undefined,
      notice,
      steps: steps.length > 0 ? steps : undefined,
      perf: outcome.perf ?? undefined,
      aborted: aborted || undefined,
      createdAt: startedAt,
    });

    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === placeholder.id
          ? {
              ...m,
              id,
              content,
              thinking: thinking || undefined,
              notice,
              steps: steps.length > 0 ? steps : undefined,
              perf: outcome.perf ?? undefined,
              aborted: aborted || undefined,
              streaming: false,
            }
          : m,
      ),
      streaming: false,
      startedAt: null,
      abort: null,
      agentTurn: 0,
      pendingApproval: null,
      // ★ 에이전트 턴은 캐시 기준으로 삼지 않는다. 툴 결과가 중간에 끼어
      //   다음 일반 대화와 접두사가 어차피 어긋난다.
      lastContext: null,
    }));
  } catch (e) {
    const err = e instanceof OllamaError ? e : null;
    const aborted = err?.code === 'ABORTED' || abort.signal.aborted;

    set((s) => ({
      messages: s.messages.filter((m) => m.id !== placeholder.id),
      streaming: false,
      startedAt: null,
      abort: null,
      agentTurn: 0,
      pendingApproval: null,
      lastContext: null,
      error: aborted ? null : toAppError(err, e),
    }));
  }
}

/** 예외를 AppError로 정규화한다. OllamaError면 분류된 코드를 살린다. */
function toAppError(err: OllamaError | null, raw: unknown): AppError {
  if (err) return err.toAppError();
  return { code: 'UNKNOWN', message: String(raw) };
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
  return -1;
}
