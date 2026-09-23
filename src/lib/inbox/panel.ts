/**
 * 공유/공람 탭의 상태(N1).
 *
 * ★ 화면이 보여 주는 것은 "이번에 새로 들어온 것"이 아니라 **아직 처리하지 않은 것**이다.
 *   새 문서만 보이면, 아침에 패널을 닫아 두었다가 오후에 열었을 때 화면이 비어 있다.
 *   브리핑은 유입을 만드는 장치이고, 화면은 남아 있는 일을 보여 주는 자리다.
 *
 * ★ 판단은 [briefing.ts]에 있다. 여기서는 부르고 담아 둘 뿐이다.
 */

import { create } from 'zustand';
import { t } from '@/lib/i18n';
import { isRestrictedUrl, sendToSW, type AppError, type SWToPanel, type TabSummary } from '@/lib/messaging/protocol';
import { addTask } from '@/lib/schedule/store';
import type { Settings } from '@/lib/storage/settings';
import { briefingCount, type Briefing, type BriefingGroup } from './briefing';
import { classifyWithModel } from './classify';
import { loadInboxLocation, type InboxLocation } from './location';
import { recordSkippedRun, runBriefing } from './run';
import { lastInboxRun, listInboxDocs, patchInboxDoc, saveInboxDocs } from './store';
import { draftFromDoc, draftTasksFromBody, toNewTask, type TaskDraft } from './task-draft';
import type { InboxCategory, InboxDoc, InboxRun, InboxTrigger } from './types';
import { INBOX_CATEGORIES } from './types';

/**
 * `@브리핑` — 공유/공람을 수시로 확인하는 명령.
 *
 * ★ 주화면이 공유/공람 탭이므로 `@` 무리다(commands.ts의 접두 문자 규칙). 온나라 목록 화면을
 *   보고 있지 않아도 동작한다 — 지정해 둔 브리핑 대상 위치를 쓰기 때문이다.
 */
export const BRIEFING_PRESET_ID = 'inbox-briefing';
export const BRIEFING_SLASH = '@브리핑';
export const BRIEFING_ALIASES = ['@brief', '@inbox', '@공람'];

export interface InboxFocus {
  key: string;
  /** 같은 문서를 두 번 눌러도 화면이 반응하게 하는 일련번호. */
  at: number;
}

/**
 * "일정 등록"을 누른 뒤의 한 문서. 확인 → 본문 읽기 → 폼 확인의 세 걸음이다.
 *
 * ★ 화면(컴포넌트)이 아니라 여기에 둔다. 탭을 옮겼다 돌아와도 읽던 본문과 고치던
 *   초안이 살아 있어야 한다 — 본문 읽기와 AI 분석은 CPU에서 수 분이 걸리고, 그동안
 *   사용자는 다른 탭을 본다. 화면 상태로 두면 그 시간과 열람 기록이 함께 사라진다.
 */
export interface TaskDraftSession {
  /** 어느 문서인가. */
  key: string;
  /** 같은 문서를 다시 시작했을 때 지난 실행의 결과가 끼어들지 않게 하는 일련번호. */
  id: number;
  stage: 'confirm' | 'working' | 'ready' | 'failed';
  /** 지금 하는 일. 본문을 여는 시간과 AI가 읽는 시간은 성격이 다르다. */
  step: 'read' | 'analyze' | null;
  /**
   * 읽기 시작한 시각.
   *
   * ★ 화면이 흘러간 초를 센다. CPU 추론에서는 수 분이 걸리고, 그동안 아무것도 움직이지
   *   않으면 사용자는 고장으로 본다(계획서 §6 — 5초 넘는 일은 진행 상태를 보인다).
   *   세션에 두는 이유는 탭을 옮겼다 돌아와도 경과 시간이 이어져야 하기 때문이다.
   */
  startedAt: number | null;
  drafts: TaskDraft[];
  /** 폼에 올라와 있는 초안. */
  chosen: number;
  summary: string;
  /**
   * 본문을 열어 열람 처리된 시각.
   *
   * ★ 화면은 이 값이 있을 때 "이 문서는 이제 열람 상태입니다"를 사실로 말한다.
   *   되돌릴 수 없는 일이므로 짐작이 아니라 실제로 연 뒤에만 채운다.
   */
  readAt: number | null;
  /** 모델이 본문에서 일정을 뽑지 못해 목록 값으로 채웠는가. */
  fallback: boolean;
  /** 그 이유(모델을 부르지 못한 까닭). 화면에 그대로 적는다. */
  fallbackReason: string;
  error: AppError | null;
  abort: AbortController | null;
}

interface InboxState {
  docs: InboxDoc[];
  /** 마지막 브리핑 결과. 머리말의 수치와 열람 상태 문구가 여기서 나온다. */
  briefing: Briefing | null;
  lastRun: InboxRun | null;
  location: InboxLocation | null;
  loaded: boolean;
  running: boolean;
  error: AppError | null;
  focus: InboxFocus | null;
  /** 지금 일정으로 옮기는 중인 문서. 한 번에 하나다. */
  draft: TaskDraftSession | null;
  /** 넘기면서 열람 처리하는 중인 문서. 작업 탭을 쓰므로 한 번에 하나다. */
  dismissing: string | null;
}

export const useInbox = create<InboxState>(() => ({
  docs: [], briefing: null, lastRun: null, location: null, loaded: false, running: false, error: null, focus: null,
  draft: null, dismissing: null,
}));

/** 아직 손대지 않은 문서. 탭 배지의 숫자이자 화면의 본문이다. */
export function pendingDocs(docs: InboxDoc[]): InboxDoc[] {
  const order: Record<InboxCategory, number> = { deadline: 0, mine: 1, notice: 2, filtered: 3 };
  return docs
    .filter(doc => doc.category !== 'filtered' && !doc.dismissedAt && !doc.openedAt)
    .sort((left, right) =>
      order[left.category] - order[right.category] ||
      (left.dueDate || '9999').localeCompare(right.dueDate || '9999') ||
      right.reportDate.localeCompare(left.reportDate));
}

export function groupDocs(docs: InboxDoc[]): Array<{ category: InboxCategory; docs: InboxDoc[] }> {
  return (['deadline', 'mine', 'notice'] as const)
    .map(category => ({ category, docs: docs.filter(doc => doc.category === category) }))
    .filter(group => group.docs.length > 0);
}

export async function loadInbox(): Promise<void> {
  const [docs, lastRun, location] = await Promise.all([listInboxDocs(), lastInboxRun(), loadInboxLocation()]);
  useInbox.setState({ docs, lastRun: lastRun ?? null, location, loaded: true });
}

/** 공유/공람 탭에서 이 문서를 짚어 달라고 남긴다. 탭 전환 자체는 화면(App)이 한다. */
export function focusInboxDoc(key: string): void {
  useInbox.setState({ focus: { key, at: Date.now() } });
}

export function clearInboxFocus(): void {
  if (useInbox.getState().focus) useInbox.setState({ focus: null });
}

export function clearInboxError(): void {
  if (useInbox.getState().error) useInbox.setState({ error: null });
}

/** 지금 보고 있는 화면을 브리핑 대상으로 지정한다. */
export async function designateInbox(tab: TabSummary): Promise<boolean> {
  useInbox.setState({ running: true, error: null });
  try {
    const reply = await sendToSW({ type: 'CAPTURE_INBOX_LOCATION', tabId: tab.tabId });
    if (reply.type === 'ERROR') {
      useInbox.setState({ error: reply.error });
      return false;
    }
    useInbox.setState({ location: await loadInboxLocation() });
    return true;
  } finally {
    useInbox.setState({ running: false });
  }
}

/**
 * 공유/공람 목록을 읽어 브리핑한다.
 *
 * ★ 실패도 기록에 남긴다. 읽지 못한 날 화면이 그냥 비어 있으면, 사용자는
 *   "오늘은 받은 문서가 없구나"로 오해한다.
 */
export async function collectAndBrief(
  tab: TabSummary | null,
  settings: Settings,
  trigger: InboxTrigger = 'manual',
): Promise<Briefing | null> {
  if (useInbox.getState().running) return null;
  useInbox.setState({ running: true, error: null });
  try {
    const reply = await sendToSW({
      type: 'COLLECT_INBOX',
      ...(tab ? { tabId: tab.tabId } : {}),
      budgetTokens: settings.pageTokenBudget,
    }, undefined, 180_000);

    if (reply.type === 'ERROR') {
      await recordSkippedRun(trigger, reply.error.message);
      useInbox.setState({ error: reply.error, lastRun: (await lastInboxRun()) ?? null });
      return null;
    }
    if (reply.type !== 'INBOX_COLLECTED') return null;

    const briefed = await refineWithModel(await runBriefing({ list: reply.list, settings, trigger }), settings);
    const markedRead = await applyReadPolicy(briefed, reply.via, tab, settings);
    const briefing: Briefing = markedRead ? { ...briefed, markedRead } : briefed;
    useInbox.setState({
      briefing,
      docs: await listInboxDocs(),
      lastRun: (await lastInboxRun()) ?? null,
    });
    return briefing;
  } catch (error) {
    const appError: AppError = { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) };
    await recordSkippedRun(trigger, appError.message);
    useInbox.setState({ error: appError, lastRun: (await lastInboxRun()) ?? null });
    return null;
  } finally {
    useInbox.setState({ running: false });
  }
}

/**
 * 규칙이 매긴 갈래를 모델 판단으로 보강한다(M4).
 *
 * ★ **실패해도 브리핑은 그대로 나간다.** Ollama가 꺼져 있거나 응답이 어긋나면 규칙 결과가
 *   남는다. 이 기능이 모델 없이 성립한다는 약속은 여기서도 지켜진다.
 *
 * ★ 모델 호출은 목록 전체에 1회다. 문서마다 부르면 20건에 몇 분이 걸린다.
 */
async function refineWithModel(briefing: Briefing, settings: Settings): Promise<Briefing> {
  const docs = briefing.groups.flatMap(group => group.docs);
  if (!docs.length) return briefing;
  try {
    const next = await classifyWithModel(docs, settings);
    const changed = next.filter((doc, index) => doc.category !== docs[index]!.category);
    if (!changed.length) return briefing;
    await saveInboxDocs(changed);
    const groups: BriefingGroup[] = [];
    for (const category of INBOX_CATEGORIES) {
      const members = next.filter(doc => doc.category === category);
      if (members.length && category !== 'filtered') groups.push({ category, docs: members });
    }
    return { ...briefing, groups };
  } catch {
    // 모델을 부르지 못했다. 규칙이 매긴 갈래가 그대로 남는다.
    return briefing;
  }
}

/**
 * 열람 정책(`mark-read`)을 실행한다. 실제로 열람 처리된 문서 수를 돌려준다.
 *
 * ★ **기본값에서는 아무 일도 하지 않는다.** 온나라에 열람 기록이 남고, 확장은 그것을
 *   되돌릴 수 없다. 설정을 켠 사용자에게만 일어나는 일이다.
 *
 * ★ 받은문서 목록을 보고 있는 탭에서만 할 수 있다. `읽기처리`는 그 목록의 체크 상태로
 *   처리하는 버튼이라, 목록이 화면에 없으면 누를 수 없다. 조용히 실패하지 않고 아무것도 하지 않는다.
 *
 * ★ 한 번에 체크해 한 번 누른다. 문서마다 누르면 목록이 그때마다 다시 그려진다.
 */
async function applyReadPolicy(
  briefing: Briefing,
  via: Extract<SWToPanel, { type: 'INBOX_COLLECTED' }>['via'],
  tab: TabSummary | null,
  settings: Settings,
): Promise<number> {
  if (settings.briefingReadPolicy !== 'mark-read' || via !== 'active-tab' || !tab) return 0;
  const targets = briefing.groups.flatMap(group => group.docs)
    .filter(doc => doc.readState === 'unread')
    .slice(0, settings.briefingOpenLimit);
  if (!targets.length) return 0;
  const reply = await sendToSW({ type: 'MARK_DOCUMENTS_READ', tabId: tab.tabId, titles: targets.map(doc => doc.title) }, undefined, MARK_READ_TIMEOUT_MS)
    .catch(() => null);
  if (reply?.type !== 'DOCUMENTS_MARKED_READ') return 0;
  const now = Date.now();
  const marked = new Set(reply.marked);
  for (const doc of targets) if (marked.has(doc.title)) await patchLocal(doc.key, { markedReadAt: now, readState: 'read' });
  return marked.size;
}

/** 체크 → `읽기처리` → 목록 재확인까지. 서비스 워커의 대기 한도(12초)보다 넉넉히 둔다. */
const MARK_READ_TIMEOUT_MS = 45_000;

async function patchLocal(key: string, patch: Partial<InboxDoc>): Promise<void> {
  await patchInboxDoc(key, patch);
  useInbox.setState(state => ({ docs: state.docs.map(doc => doc.key === key ? { ...doc, ...patch } : doc) }));
}

/**
 * 넘기기. 온나라 받은문서 목록에서 이 문서를 체크하고 `읽기처리`를 눌러 `미열람` → `열람`으로
 * 바꾸고, 다음 브리핑에도 다시 올라오지 않게 한다.
 *
 * ★ 문서를 열어서는 열람으로 바뀌지 않는다. 온나라가 열람 처리를 위해 둔 길은 목록의
 *   `읽기처리` 버튼이다(lib/onnara/mark-read.ts).
 *
 * ★ **열람으로 바뀐 것을 확인하지 못하면 넘기지 않는다.** 카드가 사라진 뒤에는 미열람으로
 *   남은 문서를 다시 짚을 길이 없다. 오류를 보이고 카드를 남겨 다시 누를 수 있게 한다.
 */
export async function dismissDoc(doc: InboxDoc, tab: TabSummary | null): Promise<boolean> {
  if (useInbox.getState().dismissing) return false;
  if (doc.readState !== 'unread') {
    await patchLocal(doc.key, { dismissedAt: Date.now() });
    return true;
  }
  if (!tab || isRestrictedUrl(tab.url)) {
    useInbox.setState({ error: { code: 'UNKNOWN', message: t('inbox.dismiss.noTab') } });
    return false;
  }
  useInbox.setState({ dismissing: doc.key, error: null });
  try {
    const reply = await sendToSW({ type: 'MARK_DOCUMENTS_READ', tabId: tab.tabId, titles: [doc.title] }, undefined, MARK_READ_TIMEOUT_MS);
    if (reply.type === 'ERROR') {
      useInbox.setState({ error: reply.error });
      return false;
    }
    if (reply.type !== 'DOCUMENTS_MARKED_READ' || !reply.marked.includes(doc.title)) {
      const said = reply.type === 'DOCUMENTS_MARKED_READ' ? reply.dialogs.filter(Boolean).at(-1) : undefined;
      useInbox.setState({ error: { code: 'UNKNOWN', message: t('inbox.dismiss.failed'), ...(said ? { hint: said } : {}) } });
      return false;
    }
    const now = Date.now();
    await patchLocal(doc.key, { readState: 'read', markedReadAt: now, dismissedAt: now });
    return true;
  } catch (error) {
    useInbox.setState({ error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } });
    return false;
  } finally {
    useInbox.setState({ dismissing: null });
  }
}

export async function restoreDoc(key: string): Promise<void> {
  await patchLocal(key, { dismissedAt: undefined, openedAt: undefined });
}

/* ── 일정 등록: 본문을 읽고 초안을 만든다 ───────────────── */

let draftSerial = 0;

/** 지난 실행의 늦은 응답이 지금 화면을 덮어쓰지 않게 한다. */
function patchDraft(id: number, patch: Partial<TaskDraftSession>): void {
  useInbox.setState(state =>
    state.draft && state.draft.id === id ? { draft: { ...state.draft, ...patch } } : {});
}

/**
 * "일정 등록"을 눌렀다. 아직 아무것도 열지 않는다 — 먼저 무슨 일이 일어나는지 알린다.
 *
 * ★ 이 걸음을 건너뛰지 않는다. 다음 걸음에서 문서가 열리고, 열리는 순간 온나라에
 *   열람 기록이 남는다. 그 사실을 보기 전에 되돌릴 수 없는 일이 일어나서는 안 된다.
 */
export function openTaskDraft(doc: InboxDoc): void {
  const current = useInbox.getState().draft;
  if (current?.key === doc.key) return;
  current?.abort?.abort();
  useInbox.setState({
    draft: {
      key: doc.key, id: ++draftSerial, stage: 'confirm', step: null, startedAt: null,
      drafts: [], chosen: 0, summary: '', readAt: null,
      fallback: false, fallbackReason: '', error: null, abort: null,
    },
  });
}

/** 접는다. 읽는 중이었으면 그 일도 멈춘다. */
export function closeTaskDraft(): void {
  const draft = useInbox.getState().draft;
  if (!draft) return;
  draft.abort?.abort();
  useInbox.setState({ draft: null });
}

/** 다른 후보를 폼에 올린다. */
export function chooseTaskDraft(index: number): void {
  const draft = useInbox.getState().draft;
  if (!draft || index < 0 || index >= draft.drafts.length) return;
  useInbox.setState({ draft: { ...draft, chosen: index } });
}

/** 폼에서 고친 값. 초안은 저장되기 전까지 여기에만 있다. */
export function editTaskDraft(patch: Partial<TaskDraft>): void {
  const draft = useInbox.getState().draft;
  const current = draft?.drafts[draft.chosen];
  if (!draft || !current) return;
  const drafts = draft.drafts.map((item, index) => index === draft.chosen ? { ...item, ...patch } : item);
  useInbox.setState({ draft: { ...draft, drafts } });
}

/**
 * 본문을 열어 읽고, AI가 뽑은 일정 초안을 폼에 올린다.
 *
 * ★ **문서가 열린다.** 온나라에 열람 기록이 남고 확장은 되돌릴 수 없다. 그래서 원장에도
 *   사실대로 적는다(`readState: 'read'`, `taskReadAt`) — 화면이 "아직 미열람"이라고
 *   말하는 동안 실제로는 열려 있는 상태를 만들지 않는다.
 *
 * ★ 모델이 실패해도 여기서 멈추지 않는다. 이미 문서를 연 뒤다. 목록에서 읽은 값으로
 *   초안을 채워 등록까지는 갈 수 있게 하고, 왜 그렇게 됐는지 화면에 적는다.
 */
export async function startTaskDraft(doc: InboxDoc, tab: TabSummary, settings: Settings): Promise<void> {
  const session = useInbox.getState().draft;
  if (!session || session.key !== doc.key || session.stage === 'working') return;
  const id = session.id;
  const abort = new AbortController();
  patchDraft(id, { stage: 'working', step: 'read', startedAt: Date.now(), error: null, fallback: false, fallbackReason: '', abort });

  try {
    const reply = await sendToSW({
      type: 'READ_DOCUMENT', tabId: tab.tabId, title: doc.title, budgetTokens: settings.pageTokenBudget,
    }, abort.signal, 180_000);

    if (reply.type === 'ERROR') {
      patchDraft(id, { stage: 'failed', step: null, error: reply.error, abort: null });
      return;
    }
    if (reply.type !== 'DOCUMENT_READ') {
      patchDraft(id, {
        stage: 'failed', step: null, abort: null,
        error: { code: 'UNKNOWN', message: '문서 본문 읽기 결과를 받지 못했습니다.' },
      });
      return;
    }

    // 여기까지 왔다는 것은 상세 화면이 실제로 열렸다는 뜻이다. 열람 상태를 사실대로 옮긴다.
    const readAt = Date.now();
    await patchLocal(doc.key, { readState: 'read', taskReadAt: readAt });
    patchDraft(id, { step: 'analyze', readAt });

    const page = reply.payload;
    try {
      const outcome = await draftTasksFromBody(doc, {
        // 제목은 목록에서 읽은 것을 쓴다. 상세 화면의 제목은 줄여 그려지는 일이 있다.
        url: page.url, title: doc.title, text: page.text, truncated: page.truncated, keptRatio: page.keptRatio,
      }, settings, abort.signal);
      if (outcome.drafts.length) {
        patchDraft(id, { stage: 'ready', step: null, drafts: outcome.drafts, chosen: 0, summary: outcome.summary, abort: null });
        return;
      }
      // 본문에 할 일도 기한도 없었다. 단순 공람일 수 있으므로 목록 값을 올려 두고 사용자가 정한다.
      patchDraft(id, {
        stage: 'ready', step: null, drafts: [draftFromDoc(doc)], chosen: 0, summary: outcome.summary,
        fallback: true, fallbackReason: '', abort: null,
      });
    } catch (error) {
      if (abort.signal.aborted) return;
      patchDraft(id, {
        stage: 'ready', step: null, drafts: [draftFromDoc(doc)], chosen: 0, summary: '',
        fallback: true, fallbackReason: error instanceof Error ? error.message : String(error), abort: null,
      });
    }
  } catch (error) {
    if (abort.signal.aborted) return;
    patchDraft(id, {
      stage: 'failed', step: null, abort: null,
      error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) },
    });
  }
}

/** 폼에 올라와 있는 초안을 일정으로 저장한다. 저장은 오직 이 함수뿐이다. */
export async function registerTaskDraft(doc: InboxDoc): Promise<number | null> {
  const session = useInbox.getState().draft;
  const draft = session?.drafts[session.chosen];
  if (!session || session.key !== doc.key || session.stage !== 'ready' || !draft) return null;
  if (doc.taskId) { closeTaskDraft(); return doc.taskId; }
  const id = await addTask(toNewTask(doc, draft));
  await patchLocal(doc.key, { taskId: id });
  useInbox.setState(state => state.draft?.id === session.id ? { draft: null } : {});
  return id;
}

/**
 * 공문 한 건을 일정 항목으로 등록한다. **본문을 열지 않는다.**
 *
 * ★ 코드만으로 만든다. 제목·기한·출처는 전부 목록에서 읽은 값이라 지어낸 것이 없다.
 *   근거 문장(`evidence`)에는 제목에서 실제로 읽어낸 기한 표기를 그대로 넣는다.
 *
 * ★ 본문을 읽는 길([startTaskDraft])과 나란히 남겨 둔다. 미열람을 지키는 것이 이
 *   기능의 약속이므로, 열람을 감수하지 않고도 일정을 만들 길이 반드시 있어야 한다.
 */
export async function registerDocTask(doc: InboxDoc): Promise<number | null> {
  if (doc.taskId) return doc.taskId;
  const id = await addTask({
    title: doc.title,
    status: 'todo',
    dueDate: doc.dueDate,
    ...(doc.due ? { due: doc.due, evidence: doc.due.text, evidenceVerified: true } : {}),
    source: { docTitle: doc.title },
    dedupeKey: `inbox:${doc.key}`,
  });
  await patchLocal(doc.key, { taskId: id });
  return id;
}

/** 머리말 한 줄. 열람 상태가 바뀌지 않았다는 사실은 코드가 센 수치다. */
export function briefingHeadline(briefing: Briefing | null): { count: number; scanned: number; unread: number; changed: number } | null {
  if (!briefing) return null;
  return {
    count: briefingCount(briefing),
    scanned: briefing.scanned,
    unread: briefing.readState.unread,
    changed: briefing.readState.changed,
  };
}
