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
import { sendToSW, type AppError, type SWToPanel, type TabSummary } from '@/lib/messaging/protocol';
import { addTask } from '@/lib/schedule/store';
import type { Settings } from '@/lib/storage/settings';
import { briefingCount, type Briefing, type BriefingGroup } from './briefing';
import { classifyWithModel } from './classify';
import { loadInboxLocation, type InboxLocation } from './location';
import { recordSkippedRun, runBriefing } from './run';
import { lastInboxRun, listInboxDocs, patchInboxDoc, saveInboxDocs } from './store';
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
}

export const useInbox = create<InboxState>(() => ({
  docs: [], briefing: null, lastRun: null, location: null, loaded: false, running: false, error: null, focus: null,
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
 * 열람 정책(`mark-read`)을 실행한다. 실제로 연 문서 수를 돌려준다.
 *
 * ★ **기본값에서는 아무 일도 하지 않는다.** 문서를 여는 순간 온나라 서버에 열람 기록이
 *   남고, 확장은 그것을 되돌릴 수 없다. 설정을 켠 사용자에게만 일어나는 일이다.
 *
 * ★ 받은문서 목록을 보고 있는 탭에서만 할 수 있다. 문서를 여는 길은 "그 목록에서 제목을
 *   누르는 것"뿐이라, 목록이 화면에 없으면 열 대상을 찾을 수 없다. 조용히 실패하지 않고
 *   아무것도 하지 않는다.
 *
 * ★ 한 건이 실패하면 멈춘다. 같은 이유로 나머지도 실패하고, 그동안 작업 탭이 묶인다.
 */
async function applyReadPolicy(
  briefing: Briefing,
  via: Extract<SWToPanel, { type: 'INBOX_COLLECTED' }>['via'],
  tab: TabSummary | null,
  settings: Settings,
): Promise<number> {
  if (settings.briefingReadPolicy !== 'mark-read' || via !== 'active-tab' || !tab) return 0;
  const targets = briefing.groups.flatMap(group => group.docs).slice(0, settings.briefingOpenLimit);
  let opened = 0;
  try {
    for (const doc of targets) {
      const reply = await sendToSW({
        type: 'READ_DOCUMENT', tabId: tab.tabId, title: doc.title,
        // 본문은 쓰지 않는다. 여는 것 자체가 목적이라 예산을 최소로 둔다.
        budgetTokens: 500, keepWorkTab: true,
      }, undefined, 90_000);
      if (reply.type !== 'DOCUMENT_READ') break;
      await patchLocal(doc.key, { markedReadAt: Date.now(), readState: 'read' });
      opened++;
    }
  } finally {
    if (opened) await sendToSW({ type: 'RELEASE_WORK_TAB', tabId: tab.tabId }).catch(() => undefined);
  }
  return opened;
}

async function patchLocal(key: string, patch: Partial<InboxDoc>): Promise<void> {
  await patchInboxDoc(key, patch);
  useInbox.setState(state => ({ docs: state.docs.map(doc => doc.key === key ? { ...doc, ...patch } : doc) }));
}

/** 넘기기. 다음 브리핑에도 다시 올라오지 않는다. */
export async function dismissDoc(key: string): Promise<void> {
  await patchLocal(key, { dismissedAt: Date.now() });
}

export async function restoreDoc(key: string): Promise<void> {
  await patchLocal(key, { dismissedAt: undefined, openedAt: undefined });
}

/**
 * 공문 한 건을 일정 항목으로 등록한다.
 *
 * ★ 코드만으로 만든다. 제목·기한·출처는 전부 목록에서 읽은 값이라 지어낸 것이 없다.
 *   근거 문장(`evidence`)에는 제목에서 실제로 읽어낸 기한 표기를 그대로 넣는다.
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
