import { abortable } from '@/lib/async';
import { downloadDocumentAttachments, formatAttachmentReport, releaseWorkTab } from '@/lib/onnara/download';
import { cancelAutomation, enqueueAutomation, recordAutomation, workTabLock } from '@/lib/automation/jobs';
import { notifyJobFinished } from '@/lib/automation/notify';
import { t } from '@/lib/i18n';
import { ACTION_CARD_SCHEMA, actionCardInstruction, parseActionCard, renderActionCard } from '@/lib/ai/action-card';
import { buildTaskCandidates, type TaskCandidate } from '@/lib/schedule/candidates';
import {
  bodyRevision,
  documentIdentity,
  readDocResult,
  saveDocResult,
  type DocResult,
  type DocResultLookup,
} from '@/lib/cache/doc-results';
import { classifyScheduleIntent } from '@/lib/schedule/classify';
import { patchFor, planFor, type SchedulePlan } from '@/lib/schedule/resolve';
import { renderCancelled, renderList, renderOutcome, renderProblem } from '@/lib/schedule/report';
import { addTask, deleteTask, listTasks, setTaskDone, updateTask } from '@/lib/schedule/store';
import type { StructuredDocumentList } from '@/lib/onnara/document-list';
import { parseReferenceDate } from '@/lib/schedule/due-date';
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
import { fitToBudget } from '@/lib/extract/budget';
import type { ApprovalRequest, AppError, ExtractedPage } from '@/lib/messaging/protocol';
import type { Settings } from '@/lib/storage/settings';
import { AGENT_TOOLS } from '@/lib/agent/tools';
import { createBrowserTools } from '@/lib/agent/executor';
import { runAgentLoop, type AgentStep, type TurnResult } from '@/lib/agent/loop';
import { buildAgentSystem } from '@/lib/prompts/agent';
import {
  commandTargets,
  defaultInstruction,
  findDocumentCommand,
  type DocumentCommandId,
} from '@/lib/onnara/commands';

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
  /**
   * 같은 탭 안에서 화면이 바뀐 시각(ms).
   *
   * ★ 주소 비교만으로는 온나라의 문서 전환을 알 수 없다. 목록에서 다른 문서를 열어도
   *   탭 주소가 그대로이기 때문이다. 프레임 이동 시각을 붙어 있는 본문의 추출 시각과
   *   견줘, 지난 화면의 본문으로 답이 만들어지는 것을 막는다.
   */
  screenChangedAt: number;
  /** 붙어 있는 화면 캡처를 찍은 시각(ms). 화면이 바뀌면 캡처도 함께 떼어내기 위한 기준이다. */
  screenshotAt: number;

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
  /**
   * 모델에 넣을 대화의 시작 시점(ms). 그 앞의 메시지는 화면에만 남는다.
   * 문서를 새로 읽을 때마다 여기로 경계를 옮겨, 앞 문서 이야기가 새 문서 답변에 섞이지 않게 한다.
   */
  contextFrom: number;

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

  /* ── @일정 (S07 자연어 일정 관리) ── */

  /**
   * 확인 카드에 걸려 있는 일정 변경 계획.
   *
   * ★ 대화 기록에 저장하지 않는다. 저장하면 패널을 닫았다 열었을 때 며칠 지난 삭제 카드가
   *   그대로 되살아나 누를 수 있게 된다 — 그 사이에 목록은 이미 달라져 있다.
   *   승인 카드(pendingApproval)와 같은 자리, 같은 수명이다.
   */
  pendingSchedule: { plan: SchedulePlan; typed: string } | null;

  /* ── 분석 결과 캐시 (B1) ── */

  /**
   * 마지막으로 실행한 목록 명령. `다시 분석`이 같은 지시를 캐시 없이 되풀이하는 데 쓴다.
   *
   * ★ 메시지마다 "다시 분석" 버튼을 달지 않는다. 문서 한 건만 다시 돌리려면 그 문서만
   *   체크된 상태를 되살려야 하는데, 그 사이 목록은 이미 달라져 있을 수 있다.
   *   명령 전체를 다시 돌리는 편이 정직하다.
   */
  lastCommand: { text: string; command: DocumentCommandId; args: string } | null;
  /** 직전 명령에서 모델을 부르지 않고 재사용한 문서 수. 0이면 안내를 보이지 않는다. */
  cacheReused: number;

  openForTab: (tabId: number, url: string) => Promise<void>;
  /** 같은 작업의 다른 탭(문서 팝업)으로 대상만 옮긴다. 대화와 메시지는 그대로 둔다. */
  followTab: (tabId: number, url: string) => Promise<void>;
  /** 탭 안에서 화면이 바뀌었음을 기록한다. 붙어 있는 본문이 그 화면의 것이면 떼어낸다. */
  noteScreenChange: (frameId: number) => void;
  openConversation: (conversation: Conversation) => Promise<void>;
  attachPage: (tabId: number, settings: Settings, force?: boolean) => Promise<ExtractedPage | null>;
  attachScreenshot: (tabId: number) => Promise<string | null>;
  detachPage: () => void;
  detachScreenshot: () => void;
  send: (text: string, settings: Settings) => Promise<void>;
  /** 문서등록대장 목록 명령 실행. 무엇을 할지는 문장이 아니라 명령 id가 정한다. */
  runCommand: (text: string, command: DocumentCommandId, args: string, settings: Settings, options?: { bypassCache?: boolean }) => Promise<void>;
  /** 직전 목록 명령을 캐시 없이 다시 실행한다(B1의 `다시 분석`). */
  rerunLastCommand: (settings: Settings) => Promise<void>;
  /** `@일정` 자연어 명령. 조회는 바로 답하고, 쓰기는 확인 카드를 띄운다. */
  runSchedule: (text: string, settings: Settings) => Promise<void>;
  /** 확인 카드의 응답. `null`이면 취소, 배열이면 그 항목만 실행한다. */
  commitSchedule: (ids: number[] | null) => Promise<void>;
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

  /**
   * 대화를 갈아끼우는 중(loading)인지 알려 주는 약속.
   *
   * ★ 패널은 탭이 바뀌면 openForTab을 기다리지 않고 호출한다(App.tsx).
   *   그 사이에 사용자가 보낸 요청을 그냥 버리면, 화면에서는 "지시를 무시했다"로 보이고
   *   한 번 더 보내야 동작한다. 버리지 말고 복원이 끝나기를 기다린다.
   */
  let restoring: Promise<void> = Promise.resolve();
  function during<T>(work: Promise<T>): Promise<T> {
    restoring = work.then(() => undefined, () => undefined);
    return work;
  }
  /** 화면 상태가 안정될 때까지 기다린다. 기다리는 동안 또 갈아끼우면 그것도 기다린다. */
  async function settled(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = restoring;
      await current;
      if (restoring === current) return;
    }
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
    screenChangedAt: 0,
    screenshotAt: 0,
    streaming: false,
    startedAt: null,
    expectedPrefillSec: 0,
    error: null,
    abort: null,
    lastContext: null,
    contextFrom: 0,
    agentSteps: [],
    agentTurn: 0,
    pendingApproval: null,
    pendingSchedule: null,
    lastCommand: null,
    cacheReused: 0,

    /** 탭별 세션 분리 (Phase 2-5). 탭이 바뀌면 그 탭의 대화로 갈아끼운다. */
    async openForTab(tabId, url) {
      get().stop();
      const epoch = ++epochs.view;
      ++epochs.attachment;
      set({ loading: true, extracting: false, conversation: null, pending: null, messages: [], page: null, screenshot: null, currentUrl: url, screenChangedAt: 0, error: null, lastContext: null, agentSteps: [] });
      await during((async () => {
        try {
          const conversation = await findForTab(tabId, url);
          const messages = conversation ? await listMessages(conversation.id) : [];
          if (epoch === epochs.view) set({ conversation, pending: conversation ? null : { tabId, url }, messages, loading: false,
            contextFrom: conversation?.contextFrom ?? 0 });
        } catch (error) { if (epoch === epochs.view) set({ loading: false, error: toAppError(null, error) }); }
      })());
    },
    async openConversation(conversation) {
      get().stop();
      const epoch = ++epochs.view;
      ++epochs.attachment;
      set({ loading: true, extracting: false, page: null, screenshot: null, messages: [], pending: null, conversation: null, agentSteps: [], lastContext: null, screenChangedAt: 0, error: null });
      await during((async () => {
        try {
          const messages = await listMessages(conversation.id);
          if (epoch === epochs.view) set({ conversation, messages, loading: false, contextFrom: conversation.contextFrom ?? 0 });
        } catch (error) { if (epoch === epochs.view) set({ loading: false, error: toAppError(null, error) }); }
      })());
    },

    /**
     * 문서 팝업처럼 같은 작업이 다른 탭으로 이어질 때 대상만 옮긴다.
     *
     * ★ 대화를 갈아끼우지 않는다. 목록에서 문서를 하나 열었을 뿐인데 화면이 빈 대화로
     *   바뀌면, 사용자는 방금까지의 문답과 붙여 둔 본문을 잃는다.
     *   대신 읽고 쓸 대상 탭을 옮기고, 화면이 달라졌으므로 지난 본문은 떼어낸다.
     */
    async followTab(tabId, url) {
      const state = get();
      if (state.currentUrl === url && state.conversation?.tabId === tabId) return;
      const moved = Boolean(state.currentUrl) && !sameDocument(state.currentUrl, url);
      set({
        currentUrl: url,
        ...(moved ? { screenChangedAt: Date.now() } : {}),
        ...(state.pending ? { pending: { ...state.pending, tabId } } : {}),
      });
      const conversation = state.conversation;
      if (!conversation || conversation.tabId === tabId) return;
      set({ conversation: { ...conversation, tabId } });
      await db.conversations.update(conversation.id, { tabId }).catch(() => undefined);
    },

    /**
     * 탭 주소는 그대로인데 화면만 바뀌는 경우(온나라 목록 → 문서)를 잡는다.
     *
     * ★ 관계없는 프레임(알림 폴링 등)까지 받아 본문을 떼면 사용자는 붙여 둔 문서를
     *   자꾸 잃는다. 붙어 있는 본문을 뽑은 프레임과 최상위 프레임의 이동만 센다.
     */
    noteScreenChange(frameId) {
      const page = get().page;
      if (!page && !get().screenshot) return;
      const attachedFrame = page?.sourceFrameId ?? 0;
      if (frameId !== 0 && page && frameId !== attachedFrame) return;
      set({ screenChangedAt: Date.now() });
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
        /**
         * 같은 URL이면 기존 것을 유지해 접두사를 보존한다.
         *
         * ★ 단, 본문까지 같을 때만이다. 온나라는 같은 주소에서 문서를 갈아끼우므로,
         *   주소만 보고 재사용하면 앞 문서 본문이 그대로 남는다.
         */
        if (!force && current && current.url === page.url && current.text === page.text) {
          // 내용이 같으니 접두사는 그대로 두고, 이 화면을 방금 확인했다는 사실만 갱신한다.
          const confirmed = { ...current, extractedAt: page.extractedAt };
          set({ page: confirmed, currentUrl: page.url });
          return confirmed;
        }

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
        set({ screenshot: base64, screenshotAt: Date.now(), lastContext: null });
        return base64;
      } catch (error) {
        if (epoch === epochs.attachment) set({ error: toAppError(null, error) });
        return null;
      } finally {
        if (epoch === epochs.attachment) set({ extracting: false });
      }
    },

    // 본문을 떼는 것은 "이 문서 이야기는 그만"이라는 뜻이다. 그 문서에 대한 문답도 문맥에서 뺀다.
    detachPage: () => { ++epochs.attachment; set({ page: null, lastContext: null, extracting: false }); void moveContextBoundary(set, get, nextStamp(get())); },
    detachScreenshot: () => { ++epochs.attachment; set({ screenshot: null, lastContext: null, extracting: false }); },

    async send(text, settings) {
      // 대화를 갈아끼우는 중이면 그 복원이 끝난 뒤에 보낸다(요청을 조용히 버리지 않는다).
      await settled();
      await track(submit(set, get, text, settings, epochs));
    },
    async runCommand(text, command, args, settings, options) {
      await settled();
      await track(runDocumentCommand(set, get, text, command, args, settings, epochs, options?.bypassCache ?? false));
    },
    async rerunLastCommand(settings) {
      const last = get().lastCommand;
      if (!last) return;
      await settled();
      await track(runDocumentCommand(set, get, last.text, last.command, last.args, settings, epochs, true));
    },
    async sendAgent(text, settings, tab) {
      await settled();
      await track(submit(set, get, text, settings, epochs, tab));
    },
    async runSchedule(text, settings) {
      await settled();
      await track(runScheduleIntent(set, get, text, settings, epochs));
    },
    async commitSchedule(ids) {
      await track(commitSchedulePlan(set, get, ids));
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
        set({ conversation: null, pendingSchedule: null,
          pending: conversation ? { tabId: conversation.tabId, url: conversation.originUrl } : pending,
          messages: [], page: null, screenshot: null, lastContext: null, contextFrom: 0,
          agentSteps: [], agentTurn: 0, expectedPrefillSec: 0,
          lastCommand: null, cacheReused: 0,
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

/**
 * 문맥 경계를 지금으로 옮긴다. 이 시점보다 앞선 문답은 화면에만 남고 모델에는 가지 않는다.
 *
 * ★ 문서를 새로 읽을 때마다 부른다. 앞 문서 요약이 다음 문서 답변에 섞이면 사용자는
 *   무엇을 근거로 한 답인지 알 수 없고, 좁은 문맥(num_ctx 4096)도 그만큼 잡아먹는다.
 */
/**
 * 대화 안에서 다음에 쓸 시각. 새 메시지의 `createdAt`과 문맥 경계를 모두 이 값으로 잡는다.
 *
 * ★ 밀리초는 생각보다 넉넉하지 않다. 답변이 캐시로 즉시 끝나면 질문·답변·다음 동작이 같은
 *   밀리초에 들어오고, 그러면 `createdAt`만으로는 무엇이 먼저인지 알 수 없다.
 *
 * ★ 문맥 경계는 같은 시각의 메시지를 **포함**한다(contextMessages). 그래서 경계와 메시지 시각이
 *   겹치면 두 가지가 동시에 깨진다 — 본문을 떼었는데 그 문서 문답이 문맥에 남거나(경계가 앞 메시지와 같을 때),
 *   방금 보낸 질문이 문맥에서 빠지거나(경계가 새 메시지보다 뒤일 때).
 *
 * 시각이 절대 뒤로 가지 않게 하면 둘 다 사라진다. 경계 = 다음 시각, 새 메시지 = 그 시각이므로
 * 앞의 것은 모두 경계보다 앞서고, 새 메시지는 경계에 걸쳐 문맥에 들어간다.
 * 사람이 조작하는 실제 상황에서는 이미 시계가 충분히 흘러 Date.now()와 같은 값이다.
 */
function nextStamp(state: ChatState): number {
  return Math.max(Date.now(), (state.messages.at(-1)?.createdAt ?? 0) + 1);
}

async function moveContextBoundary(set: Set, get: Get, at = Date.now()): Promise<void> {
  set({ contextFrom: at, lastContext: null });
  const conversation = get().conversation;
  if (!conversation) return;
  set({ conversation: { ...conversation, contextFrom: at } });
  await db.conversations.update(conversation.id, { contextFrom: at }).catch(() => undefined);
}

/** 모델에 넣을 대화. 경계 이전 메시지는 뺀다. */
function contextMessages(state: ChatState): UiMessage[] {
  return state.contextFrom ? state.messages.filter(message => message.createdAt >= state.contextFrom) : state.messages;
}

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
    const userMsg = { conversationId: conv.id, role: 'user' as const, content: trimmed, createdAt: nextStamp(get()) };
    const id = await addMessage(userMsg);
    if (!owns()) return;
    ownSet(s => ({ messages: [...s.messages, { ...userMsg, id }] }));

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

/**
 * 문서등록대장 목록 명령 실행. lib/onnara/commands.ts의 정의를 실제 동작으로 옮긴다.
 *
 * ★ 무엇을 할지는 명령 id가 정한다. 문장에서 의도를 짐작하지 않는다.
 *   슬래시 없는 문장은 submit()으로 가서 대화 문맥만으로 답한다.
 *
 * ★ 실행 직전에 화면을 다시 읽는다. 목록의 체크 상태는 패널 밖에서 바뀐다.
 */
async function runDocumentCommand(
  set: Set,
  get: Get,
  text: string,
  command: DocumentCommandId,
  args: string,
  settings: Settings,
  epochs: SessionEpochs,
  bypassCache = false,
) {
  const trimmed = text.trim();
  if (!trimmed || get().streaming || get().loading) return;
  const epoch = ++epochs.operation;
  const owns = () => epoch === epochs.operation;
  const ownSet = guardedSet(set, owns);
  // 이번 실행에서 다시 센다. 앞 실행의 "재사용 n건" 안내가 남아 있으면 안 된다.
  ownSet({ streaming: true, startedAt: Date.now(), abort: new AbortController(), error: null,
    lastCommand: { text: trimmed, command, args }, cacheReused: 0 });
  try {
    const conv = await ensureConversation(ownSet, get, trimmed, owns);
    if (!conv || !owns()) return;
    // 문서를 새로 다루는 명령이다. 여기서부터가 새 문맥이다 — 앞 문서 문답은 모델에 보내지 않는다.
    // ★ 경계와 이 명령의 사용자 메시지는 같은 시각이어야 한다(경계는 같은 시각을 포함한다).
    //   앞 메시지와 겹치지 않도록 nextStamp로 잡는다 — Date.now()면 답변이 즉시 끝났을 때
    //   직전 문답과 시각이 같아져 앞 문서 이야기가 새 문맥에 딸려 들어온다.
    const startedAt = nextStamp(get());
    await moveContextBoundary(ownSet, get, startedAt);
    if (!owns()) return;
    const userMsg = { conversationId: conv.id, role: 'user' as const, content: trimmed, createdAt: startedAt };
    const id = await addMessage(userMsg);
    if (!owns()) return;
    ownSet(s => ({ messages: [...s.messages, { ...userMsg, id }] }));

    const tabId = await resolvePageTab(ownSet, get);
    if (!owns()) return;
    if (tabId === null) { ownSet({ error: TAB_MISSING_ERROR }); return; }
    const signal = get().abort!.signal;

    /** 모델이 만들지 않은 실행 결과. 답변과 구분해 표시한다. */
    const report = async (content: string) => {
      if (!owns() || signal.aborted) return;
      const message = { conversationId: conv.id, role: 'assistant' as const, content, origin: 'automation' as const, createdAt: nextStamp(get()) };
      const reportId = await addMessage(message);
      ownSet(s => ({ messages: [...s.messages, { ...message, id: reportId }] }));
    };

    const page = await get().attachPage(tabId, settings, true);
    if (!page || !owns() || signal.aborted) return;
    const list = page.structuredData;

    if (command === 'refresh') {
      await report(describeCurrentScreen(page));
      return;
    }

    // 목록 화면이면 체크한 문서가 대상이고, 상세 화면이면 지금 열려 있는 문서 한 건이다.
    const titles = list ? commandTargets(list, args) : [];
    if (list && !titles.length) {
      ownSet({ error: { code: 'UNKNOWN', message: '대상 문서가 없습니다. 온나라 목록에서 문서를 체크한 뒤 다시 실행하세요.',
        hint: `현재 목록에 ${list.rows.length}건이 있습니다. 모두 처리하려면 "${slashOf(command)} 전체"로 실행하세요.` } });
      return;
    }

    if (command === 'attachments') {
      await downloadDocumentAttachments({ tabId, page, titles: list ? titles : [undefined], signal,
        progress: documentProgress => ownSet({ documentProgress }), report });
      return;
    }

    if (command === 'read' || command === 'compare') {
      // 상세 화면은 이미 붙인 본문을 그대로 쓴다.
      if (list && !await readDocumentsTogether(ownSet, get, titles, settings, epochs, tabId, signal)) return;
      if (!owns() || signal.aborted) return;
      if (command === 'read') {
        await report(describeAttachedDocuments(get().page, titles));
        return;
      }
      const instruction = args.trim() || defaultInstruction('compare');
      await requireCapabilities(settings.endpoint, settings.model, [], signal);
      if (!owns()) return;
      ownSet({ documentProgress: 'AI가 문서들을 함께 읽고 답하는 중입니다. CPU에서는 수 분 걸릴 수 있습니다.' });
      await runGeneration(ownSet, instructionOnly(get, instruction), { ...settings, thinkMode: 'off' });
      return;
    }

    // 문서별 처리(요약·조치사항)는 한 건씩 읽고 한 건씩 생성한다.
    await requireCapabilities(settings.endpoint, settings.model, [], signal);
    if (!owns()) return;

    const targets = list ? titles : [page.title];
    /**
     * ★ 작업 큐를 거친다(B2). 첨부 다운로드와 같은 줄에 서므로 온나라 작업 탭을 두 작업이
     *   동시에 만지지 않고, 도구 탭에서 진행·취소가 보이며, 무엇을 언제 분석했는지가 남는다.
     * ★ `lock: false`인 이유는 jobs.ts의 주석에 있다 — 본문 읽기가 안쪽에서 이미 잠근다.
     */
    ownSet({ documentProgress: t('auto.queuedWait') });
    const startedRun = Date.now();
    const { id: jobId, finished } = enqueueAutomation({
      // 명령 id와 작업 종류는 이름이 다르다. `summary`는 명령, `summarize`는 작업이다.
      kind: command === 'actions' ? 'actions' : 'summarize', origin: 'chat', lock: false,
      label: targets.length === 1 ? targets[0]! : t('auto.docCount', { n: targets.length }),
      run: async jobSignal => {
        // 도구 탭에서 취소를 누르면 여기서 진행 중인 생성도 멈춰야 한다.
        const stopChat = () => get().abort?.abort();
        jobSignal.addEventListener('abort', stopChat, { once: true });
        try {
          await runDocumentBatch(ownSet, get, {
            command, settings, epochs, tabId,
            titles: targets,
            instruction: args.trim() || defaultInstruction(command),
            detailPage: list ? null : page,
            list: list ?? null,
            signal,
            bypassCache,
          });
          // 중단은 실패가 아니라 취소다. "분석 완료"로 기록하면 하지 않은 일이 기록에 남는다.
          if (signal?.aborted || jobSignal.aborted) return { error: { code: 'ABORTED', message: '작업을 취소했습니다.' } };
          const failure = get().error;
          if (failure) return { error: failure };
          const reused = get().cacheReused;
          return { summary: reused
            ? t('auto.docsAnalyzedCached', { n: targets.length, cached: reused })
            : t('auto.docsAnalyzed', { n: targets.length }) };
        } finally { jobSignal.removeEventListener('abort', stopChat); }
      },
    });
    // 입력창의 중지 버튼을 눌렀을 때 작업도 함께 취소된 것으로 기록되어야 한다.
    signal?.addEventListener('abort', () => cancelAutomation(jobId), { once: true });
    const job = await finished;
    if (owns()) void notifyJobFinished(job, Date.now() - startedRun);
  } catch (error) { ownSet({ error: toAppError(error instanceof OllamaError ? error : null, error) }); }
  finally { ownSet({ streaming: false, abort: null, startedAt: null, documentProgress: null }); }
}

function slashOf(command: DocumentCommandId): string {
  return findDocumentCommand(command)?.slash ?? '/요약';
}

/**
 * 캐시에서 꺼낸 분석 결과를 대화에 붙인다 (B1).
 *
 * ★ `cached`에 **처음 분석한 시각**을 남긴다. 사용자는 "방금 읽고 답한 것"과 "전에 분석해 둔 것을
 *   다시 보여 주는 것"을 구분할 수 있어야 한다. 구분이 없으면 캐시는 조용한 거짓말이 된다.
 * ★ 일정 후보와 출처 공문도 함께 복원한다. 그래야 `일정으로 등록` 카드가 그대로 살아난다.
 */
async function appendCachedResult(set: Set, get: Get, hit: DocResult): Promise<void> {
  const conv = get().conversation;
  if (!conv) return;
  const message = {
    conversationId: conv.id,
    role: 'assistant' as const,
    content: hit.content,
    cached: hit.createdAt,
    ...(hit.taskCandidates?.length ? { taskCandidates: hit.taskCandidates } : {}),
    ...(hit.sourceDoc ? { sourceDoc: hit.sourceDoc } : {}),
    createdAt: nextStamp(get()),
  };
  const id = await addMessage(message);
  set(s => ({ messages: [...s.messages, { ...message, id }] }));
}

/* ── @일정 (S07 자연어 일정 관리) ─────────────────────── */

/** 코드가 만든 기록. 모델 답변과 구분해 표시된다(origin: 'automation'). */
async function reportInto(
  set: Set,
  get: Get,
  content: string,
  owns: () => boolean = () => true,
): Promise<void> {
  const conv = get().conversation;
  if (!conv || !owns()) return;
  const message = { conversationId: conv.id, role: 'assistant' as const, content, origin: 'automation' as const, createdAt: nextStamp(get()) };
  const id = await addMessage(message);
  if (!owns()) return;
  set(s => ({ messages: [...s.messages, { ...message, id }] }));
}

/**
 * `@일정` 한 문장을 실행한다.
 *
 * ★ 모델은 분류만 한다. 목록도 결과 문장도 코드가 저장소를 읽어 만든다(report.ts).
 * ★ 쓰기는 여기서 일어나지 않는다. 계획을 카드에 걸어 두고 끝낸다 — 실제 저장은
 *   사용자가 누른 뒤 commitSchedulePlan에서만 일어난다.
 */
async function runScheduleIntent(
  set: Set,
  get: Get,
  text: string,
  settings: Settings,
  epochs: SessionEpochs,
) {
  const trimmed = text.trim();
  if (!trimmed || get().streaming || get().loading) return;
  const epoch = ++epochs.operation;
  const owns = () => epoch === epochs.operation;
  const ownSet = guardedSet(set, owns);
  // 앞서 걸어 둔 계획은 여기서 버린다. 새 지시가 앞 지시를 대신한다.
  ownSet({ streaming: true, startedAt: Date.now(), abort: new AbortController(), error: null, pendingSchedule: null });
  try {
    const conv = await ensureConversation(ownSet, get, trimmed, owns);
    if (!conv || !owns()) return;

    const userMsg = { conversationId: conv.id, role: 'user' as const, content: trimmed, createdAt: nextStamp(get()) };
    const userId = await addMessage(userMsg);
    if (!owns()) return;
    ownSet(s => ({ messages: [...s.messages, { ...userMsg, id: userId }] }));

    ownSet({ documentProgress: '무엇을 할지 읽는 중입니다…' });
    const intent = await classifyScheduleIntent(settings, trimmed, get().abort?.signal);
    if (!owns()) return;

    const plan = planFor(intent, await listTasks(), trimmed);
    if (!owns()) return;

    // 조회와 안내는 확인받을 것이 없다. 바로 답한다.
    // ★ 화면을 옮기지 않는다. 결과는 여기 남고, 일정 탭으로 가는 길은 답변 안의 링크다
    //   (report.ts). 지시한 자리에서 읽고 다음 지시를 잇는 사람을 붙잡아 두지 않는다.
    if (plan.kind === 'list') { await reportInto(ownSet, get, renderList(plan), owns); return; }
    if (plan.kind === 'none') { await reportInto(ownSet, get, renderProblem(plan.problem), owns); return; }

    ownSet({ pendingSchedule: { plan, typed: trimmed } });
  } catch (error) {
    const err = error instanceof OllamaError ? error : null;
    const aborted = err?.code === 'ABORTED' || get().abort?.signal.aborted;
    ownSet({ error: aborted ? null : toAppError(err, error) });
  } finally {
    ownSet({ streaming: false, abort: null, startedAt: null, documentProgress: null });
  }
}

/**
 * 확인 카드의 응답을 실행한다.
 *
 * @param ids `null`이면 취소. 등록은 배열이 비어 있지 않기만 하면 되고,
 *            수정·삭제는 이 배열에 든 항목만 건드린다.
 */
async function commitSchedulePlan(set: Set, get: Get, ids: number[] | null) {
  const pending = get().pendingSchedule;
  if (!pending) return;
  const { plan } = pending;
  if (plan.kind === 'list' || plan.kind === 'none') { set({ pendingSchedule: null }); return; }

  // 카드를 먼저 내린다. 저장이 도는 동안 한 번 더 눌러 두 번 실행되는 일을 막는다.
  set({ pendingSchedule: null });
  const owns = () => true;

  try {
    if (ids === null || !ids.length) {
      await reportInto(set, get, renderCancelled(plan.kind), owns);
      return;
    }

    if (plan.kind === 'create') {
      const id = await addTask(plan.task);
      const saved = (await listTasks()).filter(task => task.id === id);
      await reportInto(set, get, renderOutcome('create', saved), owns);
      return;
    }

    const chosen = plan.targets.filter(task => ids.includes(task.id));
    if (!chosen.length) { await reportInto(set, get, renderCancelled(plan.kind), owns); return; }

    if (plan.kind === 'update') {
      for (const task of chosen) {
        const { status, ...rest } = patchFor(task, plan.changes);
        if (Object.keys(rest).length) await updateTask(task.id, rest);
        // ★ 완료 여부는 setTaskDone을 거친다. 직접 쓰면 완료 시각이 비어 목록 정렬이 흔들린다.
        if (status) await setTaskDone(task.id, status === 'done');
      }
      const after = (await listTasks()).filter(task => chosen.some(item => item.id === task.id));
      await reportInto(set, get, renderOutcome('update', after), owns);
      return;
    }

    for (const task of chosen) await deleteTask(task.id);
    // ★ 지운 항목은 제목만 남긴다. 기한과 D-day를 되살려 적으면 아직 있는 것처럼 읽힌다.
    await reportInto(set, get, renderOutcome('delete', chosen.map(task => ({ title: task.title }))), owns);
  } catch (error) {
    set({ error: toAppError(null, error) });
  }
}

/** 생성에 쓸 문맥을 지금 지시 한 줄로 좁힌다. 작은 모델에 여러 문서와 긴 대화를 함께 넣지 않는다. */
function instructionOnly(get: Get, instruction: string): Get {
  return () => ({
    ...get(),
    messages: get().messages.filter(message => message.role === 'user').slice(-1)
      .map(message => ({ ...message, content: instruction })),
  });
}

function describeCurrentScreen(page: ExtractedPage): string {
  const list = page.structuredData;
  if (!list) return `현재 화면: ${page.title}\n문서 목록 화면이 아니어서 지금 열려 있는 문서 한 건을 대상으로 합니다.`;
  const selected = list.selectedTitles ?? [];
  const lines = [`목록을 다시 읽었습니다 · ${list.listName}`, `현재 화면 ${list.rows.length}건 / 체크 ${selected.length}건`];
  if (selected.length) lines.push(...selected.map((title, index) => `${index + 1}. ${title}`));
  else lines.push('체크한 문서가 없습니다. 목록에서 문서를 체크한 뒤 명령을 실행하세요.');
  return lines.join('\n');
}

function describeAttachedDocuments(page: ExtractedPage | null, titles: string[]): string {
  const names = titles.length ? titles.map((title, index) => `${index + 1}. ${title}`).join('\n') : page?.title ?? '';
  return [`문서 ${titles.length || 1}건의 본문을 읽어 대화에 붙였습니다.`, names,
    '이제 슬래시 없이 그냥 물어보세요. 예: "기한이 빠른 순서로 정리해줘"',
    '앞서 다룬 문서에 대한 대화는 더 이상 참고하지 않습니다. 본문을 떼려면 본문 칩의 ×를 누르세요.'].filter(Boolean).join('\n');
}

/**
 * 문서별 처리(/요약, /조치): 한 건 읽고 한 건 생성하기를 반복한다.
 *
 * ★ 여러 본문을 한꺼번에 CPU 모델에 넣지 않는다. 문서마다 문맥을 비우고 그 문서만 넣는다.
 * ★ 여러 문서는 복제한 목록 탭 하나를 끝까지 재사용한다(문서마다 목록 복원을 반복하지 않는다).
 */
async function runDocumentBatch(set: Set, get: Get, options: {
  command: 'summary' | 'actions';
  settings: Settings;
  epochs: SessionEpochs;
  tabId: number;
  titles: string[];
  instruction: string;
  /** 목록이 아니라 이미 열린 상세 화면이면 그 본문 */
  detailPage: ExtractedPage | null;
  /**
   * 목록 화면이면 그 목록. 기한의 연도를 해석할 기준일(보고일자)을 여기서 찾는다.
   *
   * ★ 공문은 "9. 30.까지"처럼 연도를 자주 생략한다. 오늘을 기준으로 삼으면 지난달에 받은
   *   공문의 기한이 한 해 뒤로 밀린다. 그 문서의 보고일자가 기준이어야 한다.
   */
  list: StructuredDocumentList | null;
  signal: AbortSignal | undefined;
  /** true면 캐시를 읽지 않고 반드시 모델을 부른다(`다시 분석`). 결과는 그대로 새로 저장한다. */
  bypassCache?: boolean;
}): Promise<void> {
  const { command, settings, epochs, tabId, titles, instruction, detailPage, list, signal, bypassCache = false } = options;
  const rowOf = (title: string) => list?.rows.find(row => row.title === title);
  const referenceOf = (title: string): Date | null => parseReferenceDate(rowOf(title)?.reportDate);
  /** 이 문서·이 명령·이 지시·이 모델의 결과가 저장되는 자리(B1). */
  const lookupFor = (title: string): DocResultLookup => ({
    identity: documentIdentity({ listName: list?.listName, title, reportDate: rowOf(title)?.reportDate }),
    command,
    instruction,
    model: settings.model,
  });
  const controller = get().abort;
  const epoch = ++epochs.attachment;
  const keepWorkTab = titles.length > 1;
  const failures: string[] = [];
  // 배치가 끝난 뒤 도착하는 늦은 갱신까지 붙잡으면 패널이 영원히 "읽는 중"으로 남는다.
  let batching = true;
  const generating = (index: number, title: string) => `${index + 1}/${titles.length}번째 문서 · ${title} · AI가 분석하는 중입니다. CPU에서는 수 분 걸릴 수 있습니다.`;
  /**
   * 한 건을 분석한다. 본문 판본이 같은 결과가 이미 있으면 모델을 부르지 않는다(B1).
   *
   * ★ 본문은 캐시가 있어도 **언제나 읽고 온 뒤**다. 제목만 같고 내용이 바뀐 공문(정정·재통보)에
   *   지난 요약을 보여 주지 않기 위해서다. 아끼는 것은 비싼 쪽(모델)이다.
   */
  const generate = async (title: string, page: ExtractedPage) => {
    const batchSet: Set = patch => set(current => ({
      ...(typeof patch === 'function' ? patch(current) : patch),
      ...(batching ? { streaming: true, abort: controller } : {}),
    }));
    const lookup = lookupFor(title);
    const revision = bodyRevision(page.text);

    if (!bypassCache) {
      const hit = await readDocResult(lookup, revision);
      if (hit) {
        await appendCachedResult(batchSet, get, hit);
        set(state => ({ cacheReused: state.cacheReused + 1 }));
        return;
      }
    }

    const outcome = command === 'actions'
      ? await runActionCard(batchSet, get, settings, title, page, referenceOf(title))
      : await runGeneration(batchSet, instructionOnly(get, documentBatchInstruction(title, instruction)), { ...settings, thinkMode: 'off' });
    if (!outcome) return;
    await saveDocResult(lookup, {
      bodyRevision: revision,
      content: outcome.content,
      ...(outcome.taskCandidates ? { taskCandidates: outcome.taskCandidates } : {}),
      ...(outcome.sourceDoc ? { sourceDoc: outcome.sourceDoc } : {}),
    });
  };

  set({ extracting: true, error: null });
  try {
    // 이미 열려 있는 상세 화면은 다시 열지 않고 그 본문으로 처리한다.
    if (detailPage) {
      set({ extracting: false, documentProgress: generating(0, detailPage.title) });
      await generate(detailPage.title, detailPage);
      return;
    }
    for (const [index, title] of titles.entries()) {
      if (signal?.aborted || epoch !== epochs.attachment) return;
      set({ extracting: true, streaming: true, startedAt: Date.now(), expectedPrefillSec: 0, abort: controller,
        documentProgress: `${index + 1}/${titles.length}번째 문서 본문을 읽는 중 · ${title}` });
      // 자동화 탭 작업과 같은 온나라 작업 탭을 쓰므로 잠금을 거친다. AI 생성은 잠금 밖에서 한다.
      const response = await workTabLock(() => sendToSW({
        type: 'READ_DOCUMENT', tabId, title, budgetTokens: settings.pageTokenBudget,
        ...(keepWorkTab ? { keepWorkTab } : {}),
        control: { id: '', deadline: 0, expectedUrl: get().currentUrl || undefined },
      }, signal, 120_000));
      if (epoch !== epochs.attachment || signal?.aborted) return;
      if (response.type === 'ERROR') {
        // 권한 문제는 나머지 문서도 똑같이 실패한다. 계속 돌리지 않고 바로 멈춰 권한 허용 버튼을 보여 준다.
        if (titles.length === 1 || response.error.code === 'HOST_PERMISSION_REQUIRED') {
          set({ error: failures.length ? { ...response.error, hint: `${response.error.hint ?? ''} 앞서 실패한 문서: ${failures.join(' / ')}`.trim() } : response.error });
          return;
        }
        failures.push(`${title}: ${response.error.message}`);
        continue;
      }
      if (response.type !== 'DOCUMENT_READ') {
        set({ error: { code: 'UNKNOWN', message: '문서 본문 읽기 결과를 받지 못했습니다.' } });
        return;
      }
      set({ page: { ...response.payload, title }, screenshot: null, lastContext: null,
        extracting: false, documentProgress: generating(index, title) });
      await generate(title, response.payload);
      if (signal?.aborted) return;
      if (get().error) failures.push(`${title}: ${get().error!.message}`);
    }
    if (failures.length) set({ error: { code: 'UNKNOWN', message: `일부 문서를 처리하지 못했습니다.\n${failures.join('\n')}` } });
  } catch (error) {
    if (epoch === epochs.attachment && !signal?.aborted) set({ error: error instanceof Error && error.name === 'TimeoutError'
      ? { code: 'UNKNOWN', message: '문서 화면 읽기가 120초 안에 완료되지 않았습니다. AI 생성 전 단계의 시간 초과입니다.', hint: '복제 탭에서 원래 문서 목록이 복원되는지, 상세 본문이 표시되는지 확인이 필요합니다.' }
      : toAppError(null, error) });
  } finally {
    batching = false;
    if (keepWorkTab) void workTabLock(() => releaseWorkTab(tabId));
    if (epoch === epochs.attachment) set({ extracting: false });
  }
}

/**
 * 여러 문서를 견주어 보는 요청: 문서 본문을 모두 읽어 한 문맥에 붙인다.
 *
 * ★ 문서마다 따로 생성하면 "공통점을 찾아줘" 같은 요청이 문서별 요약으로 바뀐다.
 *   대신 본문을 함께 붙여 두고, 사용자의 원래 문장 그대로 한 번만 답하게 한다.
 * ★ 작은 모델의 문맥은 좁다. 문서 수만큼 본문 예산을 나눠 담는다.
 */
async function readDocumentsTogether(
  set: Set,
  get: Get,
  titles: string[],
  settings: Settings,
  epochs: SessionEpochs,
  tabId: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const epoch = ++epochs.attachment;
  const share = Math.max(400, Math.floor(settings.pageTokenBudget / titles.length));
  const keepWorkTab = titles.length > 1;
  const bodies: string[] = [];
  const failures: string[] = [];
  set({ extracting: true, error: null });
  try {
    for (const [index, title] of titles.entries()) {
      if (signal?.aborted || epoch !== epochs.attachment) return false;
      set({ documentProgress: `${index + 1}/${titles.length}번째 문서 본문을 읽는 중 · ${title}` });
      const response = await workTabLock(() => sendToSW({
        type: 'READ_DOCUMENT', tabId, title, budgetTokens: share,
        ...(keepWorkTab ? { keepWorkTab } : {}),
        control: { id: '', deadline: 0, expectedUrl: get().currentUrl || undefined },
      }, signal, 120_000));
      if (signal?.aborted || epoch !== epochs.attachment) return false;
      if (response.type === 'ERROR') {
        // 권한 문제는 나머지 문서도 똑같이 실패한다. 바로 멈춰 권한 허용 버튼을 보여 준다.
        if (response.error.code === 'HOST_PERMISSION_REQUIRED') { set({ error: response.error }); return false; }
        failures.push(`${title}: ${response.error.message}`);
        continue;
      }
      if (response.type !== 'DOCUMENT_READ') { failures.push(`${title}: 문서 본문 읽기 결과를 받지 못했습니다.`); continue; }
      bodies.push(`<document title="${title}">\n${response.payload.text}\n</document>`);
    }
    if (!bodies.length) {
      set({ error: { code: 'UNKNOWN', message: `문서 본문을 읽지 못했습니다.\n${failures.join('\n')}` } });
      return false;
    }
    const combined = bodies.join('\n\n');
    const fitted = fitToBudget(combined, settings.pageTokenBudget);
    set({
      page: {
        url: get().currentUrl, title: `문서 ${bodies.length}건`, text: fitted.text, charCount: combined.length,
        truncated: fitted.truncated, keptRatio: fitted.keptRatio, estimatedTokens: fitted.estimatedTokens,
        method: 'innerText', extractedAt: Date.now(),
      },
      screenshot: null, lastContext: null,
      documentProgress: `문서 ${bodies.length}건을 함께 두고 AI가 답하는 중입니다. CPU에서는 수 분 걸릴 수 있습니다.`,
      ...(failures.length ? { error: { code: 'UNKNOWN' as const, message: `일부 문서를 읽지 못했습니다.\n${failures.join('\n')}` } } : {}),
    });
    return true;
  } finally {
    if (keepWorkTab) void workTabLock(() => releaseWorkTab(tabId));
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
  const movedAway = Boolean(rawPage && currentUrl && !sameDocument(rawPage.url, currentUrl));
  // 주소가 같아도 화면이 바뀌었으면 지난 본문이다(온나라 목록 → 문서).
  const changedAt = get().screenChangedAt;
  const screenChanged = Boolean(rawPage && changedAt > rawPage.extractedAt) ||
    Boolean(get().screenshot && changedAt > get().screenshotAt);
  const stale = movedAway || screenChanged;

  if (stale) set({ page: null, screenshot: null, lastContext: null });

  return {
    page: stale ? null : rawPage,
    screenshot: stale ? null : get().screenshot,
    stale,
  };
}

const STALE_NOTICE =
  '페이지가 바뀌어 이전 본문을 떼어냈습니다. 현재 페이지 내용은 참조하지 않았습니다.';

/** 문서 한 건을 처리해 얻은 결과. 캐시(B1)에 그대로 저장된다. */
interface DocumentOutcome {
  content: string;
  taskCandidates?: TaskCandidate[];
  sourceDoc?: { title: string; url?: string };
}

/**
 * 핵심·조치사항 카드(S01). JSON 스키마로만 답하게 하고, 원문 대조 결과를 붙여 보여 준다.
 * 토큰 스트림은 JSON이라 화면에 흘리지 않고 진행 표시만 한다.
 */
async function runActionCard(set: Set, get: Get, settings: Settings, title: string, page: ExtractedPage, reference: Date | null): Promise<DocumentOutcome | null> {
  const conv = get().conversation;
  if (!conv) return null;
  const abort = get().abort ?? new AbortController();
  const startedAt = nextStamp(get());
  const context = buildContext([{ role: 'user', content: actionCardInstruction(title) }], settings.numCtx, toAttachment(page, null));
  const placeholder: UiMessage = { id: `streaming-${crypto.randomUUID()}`, conversationId: conv.id, role: 'assistant', content: '', createdAt: startedAt, streaming: true };
  set(s => ({ messages: [...s.messages, placeholder], streaming: true, startedAt, expectedPrefillSec: uncachedPrefillSeconds(null, context), abort, error: null }));
  let raw = '';
  try {
    const perf = await abortable(streamChat(settings.endpoint, {
      model: settings.model, messages: context, stream: true, think: false, keep_alive: settings.keepAlive,
      format: ACTION_CARD_SCHEMA as unknown as Record<string, unknown>,
      // 사실 추출이므로 표현의 다양성이 필요 없다.
      options: { temperature: 0, num_ctx: settings.numCtx },
    }, { onToken: token => { raw += token; } }, abort.signal), abort.signal);
    abort.signal.throwIfAborted();
    const card = parseActionCard(raw);
    if (!card) throw new Error('AI 응답을 핵심·조치사항 형식으로 읽지 못했습니다. 다시 요청해 보세요.');
    const content = renderActionCard(title, card, page.text);
    // 일정 후보(S07). 등록은 사용자가 확인 카드에서 체크한 것만 — 여기서 저장되는 것은 후보일 뿐이다.
    const candidates = buildTaskCandidates(card, page.text, reference ?? new Date());
    const extra = candidates.length
      ? { taskCandidates: candidates, sourceDoc: { title, ...(page.url ? { url: page.url } : {}) } }
      : {};
    const id = await addMessage({ conversationId: conv.id, clientId: String(placeholder.id), role: 'assistant', content, perf: perf ?? undefined, ...extra, createdAt: startedAt });
    set(s => ({
      messages: s.messages.map(m => m.id === placeholder.id ? { ...m, id, content, perf: perf ?? undefined, ...extra, streaming: false } : m),
      streaming: false, startedAt: null, abort: null, lastContext: null,
    }));
    return { content, ...extra };
  } catch (e) {
    const err = e instanceof OllamaError ? e : null;
    const aborted = err?.code === 'ABORTED' || abort.signal.aborted;
    set(s => ({ messages: s.messages.filter(m => m.id !== placeholder.id), streaming: false, startedAt: null, abort: null, error: aborted ? null : toAppError(err, e) }));
    return null;
  }
}

async function runGeneration(set: Set, get: Get, settings: Settings): Promise<DocumentOutcome | null> {
  const conv = get().conversation;
  if (!conv) return null;

  const abort = get().abort ?? new AbortController();
  const startedAt = nextStamp(get());

  const { page, screenshot, stale } = freshAttachment(set, get);

  const context = buildContext(
    contextMessages(get()),
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
    return { content };
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
      // ★ 중단된 답변은 캐시에 넣지 않는다. 반쪽 요약이 다음번에 "완성된 결과"로 나오면 안 된다.
      return null;
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
    return null;
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
  const startedAt = nextStamp(get());
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
