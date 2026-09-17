import { abortable } from '@/lib/async';
/**
 * 채팅 상태. 계획서 §5 Phase 2–3
 *
 * Zustand를 쓰는 이유: 21 tok/s로 토큰이 들어올 때마다 상태가 갱신되는데,
 * Context는 구독자 전체를 리렌더시킨다. 셀렉터로 구독 범위를 좁힐 수 있어야 한다.
 *
 * ★ 이 스토어는 Side Panel 문서에서만 산다. Service Worker가 아니다.
 *   (MV3 워커는 30초 유휴에 죽으므로 장시간 스트리밍을 맡길 수 없다.)
 */

import { create } from 'zustand';
import type { ChatMessage, PerfSample } from '@/types/ollama';
import { streamChat } from '@/lib/ollama/stream';
import { requireCapabilities } from '@/lib/ollama/client';
import { OllamaError } from '@/lib/ollama/errors';
import {
  addMessage,
  createConversation,
  db,
  deleteMessagesFrom,
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
import { sameDocument, sendToSW } from '@/lib/messaging/protocol';
import type { ApprovalRequest, AppError, ExtractedPage } from '@/lib/messaging/protocol';
import type { Settings } from '@/lib/storage/settings';
import { AGENT_TOOLS } from '@/lib/agent/tools';
import { createBrowserTools } from '@/lib/agent/executor';
import { runAgentLoop, type AgentStep, type TurnResult } from '@/lib/agent/loop';
import { buildAgentSystem } from '@/lib/prompts/agent';

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

interface ChatState {
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
  attachPage: (tabId: number, settings: Settings) => Promise<ExtractedPage | null>;
  attachScreenshot: (tabId: number) => Promise<string | null>;
  detachPage: () => void;
  detachScreenshot: () => void;
  send: (text: string, settings: Settings) => Promise<void>;
  /** 에이전트 모드 전송 (Phase 5). 툴을 붙여 최대 8턴까지 돈다. */
  sendAgent: (text: string, settings: Settings, tab: AgentTab) => Promise<void>;
  /** 승인 카드의 응답. false면 실행하지 않는다. */
  resolveApproval: (approved: boolean) => void;
  regenerate: (settings: Settings) => Promise<void>;
  stop: () => void;
  setError: (e: AppError | string | null) => void;
  clearError: () => void;
}

let viewEpoch = 0;
let operationEpoch = 0;
let attachmentEpoch = 0;

export const useChat = create<ChatState>((set, get) => ({
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
    const epoch = ++viewEpoch;
    ++attachmentEpoch;
    set({ loading: true, extracting: false, conversation: null, pending: null, messages: [], page: null, screenshot: null, currentUrl: url, error: null, lastContext: null, agentSteps: [] });
    try {
      const conversation = await findForTab(tabId, url);
      const messages = conversation ? await listMessages(conversation.id) : [];
      if (epoch === viewEpoch) set({ conversation, pending: conversation ? null : { tabId, url }, messages, loading: false });
    } catch (error) { if (epoch === viewEpoch) set({ loading: false, error: toAppError(null, error) }); }
  },
  async openConversation(conversation) {
    get().stop();
    const epoch = ++viewEpoch;
    ++attachmentEpoch;
    set({ loading: true, extracting: false, page: null, screenshot: null, messages: [], pending: null, conversation: null, agentSteps: [], lastContext: null, error: null });
    try {
      const messages = await listMessages(conversation.id);
      if (epoch === viewEpoch) set({ conversation, messages, loading: false });
    } catch (error) { if (epoch === viewEpoch) set({ loading: false, error: toAppError(null, error) }); }
  },

  /**
   * 현재 탭 본문을 추출해 대화에 붙인다.
   *
   * ★ 이미 같은 URL이 붙어 있으면 재추출하지 않는다(계획서 Phase 3-5).
   *   재추출은 낭비일 뿐 아니라, 본문이 1바이트라도 달라지면 접두사가 바뀌어
   *   KV 캐시가 통째로 무효화된다(프리필 183ms → 7,684ms).
   */
  async attachPage(tabId, settings) {
    const current = get().page;
    if (get().extracting || get().loading) return current;
    const epoch = ++attachmentEpoch;
    const expectedUrl = get().currentUrl;

    set({ extracting: true, error: null });
    try {
      const res = await sendToSW({
        type: 'EXTRACT_PAGE',
        tabId,
        budgetTokens: settings.pageTokenBudget,
        control: { id: '', deadline: 0, expectedUrl: expectedUrl || undefined },
      });
      if (epoch !== attachmentEpoch) return null;

      if (res.type === 'ERROR') {
        set({ error: res.error });
        return null;
      }
      if (res.type !== 'PAGE_EXTRACTED') return null;

      const page = res.payload;
      // 같은 URL이면 기존 것을 유지해 접두사를 보존한다.
      if (current && current.url === page.url) return current;

      set({ page, currentUrl: page.url, lastContext: null });
      return page;
    } catch (error) {
      if (epoch === attachmentEpoch) set({ error: toAppError(null, error) });
      return null;
    } finally {
      if (epoch === attachmentEpoch) set({ extracting: false });
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
    const epoch = ++attachmentEpoch;
    const expectedUrl = get().currentUrl;

    set({ extracting: true, error: null });
    try {
      const res = await sendToSW({ type: 'CAPTURE_SCREENSHOT', tabId, control: { id: '', deadline: 0, expectedUrl: expectedUrl || undefined } });
      if (epoch !== attachmentEpoch) return null;
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
      if (epoch === attachmentEpoch) set({ error: toAppError(null, error) });
      return null;
    } finally {
      if (epoch === attachmentEpoch) set({ extracting: false });
    }
  },

  detachPage: () => { ++attachmentEpoch; set({ page: null, lastContext: null, extracting: false }); },
  detachScreenshot: () => { ++attachmentEpoch; set({ screenshot: null, lastContext: null, extracting: false }); },

  async send(text, settings) { await submit(set, get, text, settings); },
  async sendAgent(text, settings, tab) { await submit(set, get, text, settings, tab); },

  resolveApproval(approved) {
    const pending = get().pendingApproval;
    if (!pending) return;
    set({ pendingApproval: null });
    pending.resolve(approved);
  },

  /** 재생성: 마지막 assistant 응답을 걷어내고 같은 입력으로 다시 돌린다. */
  async regenerate(settings) {
    if (get().streaming || get().loading) return;
    const conv = get().conversation;
    const msgs = get().messages;
    const index = findLastIndex(msgs, m => m.role === 'assistant');
    if (!conv || index < 0) return;
    const epoch = ++operationEpoch;
    set({ streaming: true, abort: new AbortController() });
    const ownSet = guardedSet(set, () => epoch === operationEpoch);
    try {
      await requireCapabilities(settings.endpoint, settings.model, get().screenshot ? ['vision'] : [], get().abort?.signal);
      if (epoch !== operationEpoch) return;
      await deleteMessagesFrom(conv.id, msgs[index]!.createdAt);
      if (epoch !== operationEpoch) return;
      ownSet({ messages: msgs.slice(0, index) });
      await runGeneration(ownSet, get, settings);
    } catch (error) { ownSet({ error: toAppError(null, error) }); }
    finally { ownSet({ streaming: false, abort: null }); }
  },

  stop() {
    ++operationEpoch;
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

/* ── 생성 루프 ─────────────────────────────────────────── */

type Set = (
  partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>),
) => void;
type Get = () => ChatState;

function guardedSet(set: Set, owns: () => boolean): Set {
  return patch => { if (owns()) set(patch); };
}

async function submit(set: Set, get: Get, text: string, settings: Settings, tab?: AgentTab) {
  const trimmed = text.trim();
  if (!trimmed || get().streaming || get().loading) return;
  const epoch = ++operationEpoch;
  const owns = () => epoch === operationEpoch;
  const ownSet = guardedSet(set, owns);
  ownSet({ streaming: true, abort: new AbortController(), error: null });
  try {
    await requireCapabilities(settings.endpoint, settings.model, [...(tab ? ['tools'] : []), ...(get().screenshot ? ['vision'] : [])], get().abort?.signal);
    if (!owns()) return;
    const conv = await ensureConversation(ownSet, get, trimmed, owns);
    if (!conv || !owns()) return;
    const userMsg = { conversationId: conv.id, role: 'user' as const, content: trimmed, createdAt: Date.now() };
    const id = await addMessage(userMsg);
    if (!owns()) return;
    ownSet(s => ({ messages: [...s.messages, { ...userMsg, id }] }));
    if (tab) await runAgent(ownSet, get, settings, tab);
    else await runGeneration(ownSet, get, settings);
  } catch (error) { ownSet({ error: toAppError(error instanceof OllamaError ? error : null, error) }); }
  finally { ownSet({ streaming: false, abort: null, startedAt: null }); }
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
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      flush();
    }, 60);
  };

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

    flush();

    const id = await addMessage({
      conversationId: conv.id,
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

    // 중단은 오류가 아니다. 여기까지 받은 내용은 살려서 저장한다.
    if (aborted && content) {
      const id = await addMessage({
        conversationId: conv.id,
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
        idleTimeoutMs: settings.agentIdleTimeoutMs,
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
