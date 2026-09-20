/**
 * 아침 공유/공람 브리핑의 실행 조건과 알람(N1).
 *
 * ★ 브라우저가 떠 있어야만 동작한다. MV3 확장의 수명은 브라우저의 수명이다.
 *   다만 **사이드패널은 닫혀 있어도 된다** — 기한 알림(S07)과 같은 구조로,
 *   `chrome.alarms`가 서비스 워커를 깨워 확인한다.
 *
 * ★ 실행 주체는 둘이다. 패널이 열려 있으면 패널이 한다(모델도 화면도 거기 있다).
 *   닫혀 있으면 서비스 워커가 규칙 분류만으로 브리핑하고 알림을 띄운다.
 *
 * ★ "오늘 이미 했는가"는 별도 표시를 두지 않고 **실행 기록**으로 판단한다.
 *   표시와 기록이 갈라지면 어느 쪽이 사실인지 알 수 없게 된다.
 */

import { t } from '@/lib/i18n';
import type { RequestControl, SWToPanel } from '@/lib/messaging/protocol';
import { loadSettings, type Settings } from '@/lib/storage/settings';
import { todayISO } from '@/lib/schedule/task';
import { briefingCount, type Briefing } from './briefing';
import { loadInboxLocation } from './location';
import { recordSkippedRun, runBriefing } from './run';
import { listInboxRuns } from './store';

/** 서비스 워커를 깨우는 알람 이름. */
export const BRIEFING_ALARM = 'saide.inboxBriefing';
/** 알림 id. 같은 id로 덮어써 알림이 쌓이지 않게 한다. */
export const BRIEFING_NOTIFICATION_ID = 'saide.inboxBriefing';
/** 알림을 눌러 패널을 열었을 때 공유/공람 탭을 펴게 하는 표시. */
export const OPEN_INBOX_KEY = 'saide.openInbox';
/** 워커가 죽어 있어도 한 시간에 한 번은 깨어나 확인한다. */
const CHECK_MINUTES = 60;
/** 알람이 깨운 수집에 주는 마감. 사용자의 요청이 이 뒤에서 오래 기다리지 않게 묶어 둔다. */
const ALARM_BUDGET_MS = 45_000;
/** 알림을 눌러 연 것으로 볼 시간. 그보다 오래된 표시는 무시한다. */
const OPEN_INBOX_TTL_MS = 60_000;

export type BriefSkip = 'off' | 'no-location' | 'too-early' | 'done-today' | 'busy';
export type BriefDecision = { run: true } | { run: false; skip: BriefSkip };

export interface BriefConditions {
  settings: Pick<Settings, 'briefingEnabled' | 'briefingHour'>;
  /** 마지막으로 **성공한** 확인 시각. 건너뛴 실행은 여기 들어오지 않는다. */
  lastSuccessAt: number | null;
  now: Date;
  /** 작업 탭이 지금 다른 일에 쓰이고 있는가. */
  busy: boolean;
  hasLocation: boolean;
}

/**
 * 지금 브리핑할 때인가.
 *
 * ★ 바쁘면 **줄을 서지 않고 물러난다**. 사용자가 첨부를 받는 중이라면 아침 브리핑은
 *   다음 알람에 다시 오면 그만이다. 기다리게 하면 사용자의 작업이 느려진다.
 */
export function shouldBriefNow(input: BriefConditions): BriefDecision {
  if (!input.settings.briefingEnabled) return { run: false, skip: 'off' };
  if (!input.hasLocation) return { run: false, skip: 'no-location' };
  if (input.now.getHours() < input.settings.briefingHour) return { run: false, skip: 'too-early' };
  if (input.lastSuccessAt !== null && todayISO(new Date(input.lastSuccessAt)) === todayISO(input.now)) {
    return { run: false, skip: 'done-today' };
  }
  if (input.busy) return { run: false, skip: 'busy' };
  return { run: true };
}

/** 마지막으로 성공한 확인 시각. 건너뛴 기록(error)은 세지 않는다. */
export async function lastSuccessAt(): Promise<number | null> {
  const runs = await listInboxRuns(20);
  return runs.find(run => !run.error)?.at ?? null;
}

/** 알림 문구. 실을 것이 없으면 null이다 — 조용한 날은 알리지 않는다. */
export function briefingNotice(briefing: Briefing): { title: string; message: string } | null {
  const total = briefingCount(briefing);
  if (!total) return null;
  const lines = briefing.groups
    .flatMap(group => group.docs.slice(0, 2).map(doc => `· [${t(`inbox.cat.${group.category}` as 'inbox.cat.deadline')}] ${doc.title}`))
    .slice(0, 3);
  return { title: t('inbox.notifyTitle', { n: total }), message: lines.join('\n') };
}

export interface BriefingDeps {
  /** 공유/공람 목록을 읽어 온다. 서비스 워커의 수집 경로를 그대로 받는다. */
  collect: (budgetTokens: number, control: RequestControl) => Promise<SWToPanel>;
  /** 패널이 열려 있는가. */
  panelOpen: () => Promise<boolean>;
  /** 패널에 알린다. */
  notifyPanel: (msg: SWToPanel) => void;
  /** 작업 탭이 바쁜가. */
  busy: () => boolean;
}

/**
 * 때가 되었으면 브리핑한다. 실제로 무언가 했으면 true.
 *
 * ★ 패널이 열려 있으면 여기서 수집하지 않는다. 같은 일을 두 곳에서 하면 작업 탭이 겹친다.
 */
export async function maybeBrief(deps: BriefingDeps, now: Date = new Date()): Promise<boolean> {
  const settings = await loadSettings();
  const decision = shouldBriefNow({
    settings,
    lastSuccessAt: await lastSuccessAt(),
    now,
    busy: deps.busy(),
    hasLocation: Boolean(await loadInboxLocation()),
  });
  if (!decision.run) return false;

  if (await deps.panelOpen()) {
    deps.notifyPanel({ type: 'BRIEFING_DUE' });
    return true;
  }

  const control: RequestControl = { id: crypto.randomUUID(), deadline: Date.now() + ALARM_BUDGET_MS };
  const reply = await deps.collect(settings.pageTokenBudget, control).catch(error => ({
    type: 'ERROR' as const,
    error: { code: 'UNKNOWN' as const, message: error instanceof Error ? error.message : String(error) },
  }));

  if (reply.type !== 'INBOX_COLLECTED') {
    // ★ 읽지 못한 날도 기록에 남긴다. 화면이 그냥 비어 있으면 사용자는 "받은 문서가 없구나"로 오해한다.
    await recordSkippedRun('alarm', reply.type === 'ERROR' ? reply.error.message : '공유/공람 목록을 읽지 못했습니다', now);
    return false;
  }

  const briefing = await runBriefing({ list: reply.list, settings, trigger: 'alarm', now });
  await notify(briefing);
  return true;
}

async function notify(briefing: Briefing): Promise<void> {
  const text = briefingNotice(briefing);
  if (!text || typeof chrome === 'undefined' || !chrome.notifications?.create) return;
  await chrome.notifications.create(BRIEFING_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: chrome.runtime?.getURL?.('icon/128.png') ?? '',
    title: text.title,
    message: text.message,
  }).catch?.(() => undefined);
}

/* ── 알림을 눌러 연 패널은 공유/공람 탭을 편다 ──────────────── */

export async function requestInboxView(): Promise<void> {
  try { await chrome.storage.local.set({ [OPEN_INBOX_KEY]: Date.now() }); } catch { /* 표시를 못 남기면 탭만 안 열린다 */ }
}

/** 표시가 있으면 지우고 true. 오래된 표시는 무시한다. */
export async function takeInboxViewRequest(now: Date = new Date()): Promise<boolean> {
  try {
    const at = Number((await chrome.storage.local.get(OPEN_INBOX_KEY))[OPEN_INBOX_KEY] ?? 0);
    if (!at) return false;
    await chrome.storage.local.remove(OPEN_INBOX_KEY);
    return now.getTime() - at <= OPEN_INBOX_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * 서비스 워커에 알람과 알림 처리기를 건다.
 *
 * ★ 최상위에서 부른다. 서비스 워커는 이벤트마다 깨었다 죽으므로, 깨어날 때마다 처리기가 붙어 있어야 한다.
 */
export function registerInboxBriefing(deps: BriefingDeps): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;

  void chrome.alarms.get(BRIEFING_ALARM).then(existing => {
    if (!existing) chrome.alarms.create(BRIEFING_ALARM, { periodInMinutes: CHECK_MINUTES, delayInMinutes: 2 });
  }).catch(() => undefined);

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === BRIEFING_ALARM) void maybeBrief(deps).catch(() => undefined);
  });

  // 알람은 브라우저를 켠 뒤 최대 한 시간 안에 온다. 아침에 켜자마자 한 번 더 확인해 그 지연을 없앤다.
  chrome.runtime.onStartup?.addListener(() => void maybeBrief(deps).catch(() => undefined));

  chrome.notifications?.onClicked?.addListener(async id => {
    if (id !== BRIEFING_NOTIFICATION_ID) return;
    await chrome.notifications.clear(id).catch(() => undefined);
    await requestInboxView();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [] as chrome.tabs.Tab[]);
    if (typeof tab?.id === 'number') await chrome.sidePanel?.open?.({ tabId: tab.id }).catch(() => undefined);
  });
}
