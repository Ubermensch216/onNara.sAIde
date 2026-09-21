/**
 * 공유/공람 브리핑의 실행 조건과 알람(N1).
 *
 * ★ 확인 주기는 둘 중 하나다. 기본은 **하루 한 번**(`briefingIntervalMinutes === 0`)이고,
 *   사용자가 주기를 고르면 업무시간 창 안에서 그 간격마다 확인한다. 주기를 짧게 해도
 *   알림이 쏟아지지 않는다 — 이미 브리핑한 문서는 다시 실리지 않고, 실을 것이 없으면
 *   알림 자체가 뜨지 않는다([briefing.ts]의 `planBriefing`, [briefingNotice]).
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
import { loadSettings, onSettingsChanged, type Settings } from '@/lib/storage/settings';
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
/** 주기를 따로 정하지 않았을 때 워커를 깨우는 간격. 하루 한 번 모드의 확인 간격이기도 하다. */
const CHECK_MINUTES = 60;
/** 알람이 깨운 수집에 주는 마감. 사용자의 요청이 이 뒤에서 오래 기다리지 않게 묶어 둔다. */
const ALARM_BUDGET_MS = 45_000;
/** 알림을 눌러 연 것으로 볼 시간. 그보다 오래된 표시는 무시한다. */
const OPEN_INBOX_TTL_MS = 60_000;

export type BriefSkip =
  | 'off' | 'no-location' | 'too-early' | 'after-hours' | 'weekend' | 'done-today' | 'too-soon' | 'busy';
export type BriefDecision = { run: true } | { run: false; skip: BriefSkip };

type BriefSettings = Pick<Settings,
  'briefingEnabled' | 'briefingHour' | 'briefingIntervalMinutes' | 'briefingEndHour' | 'briefingSkipWeekend'>;

export interface BriefConditions {
  settings: BriefSettings;
  /** 마지막으로 **성공한** 확인 시각. 건너뛴 실행은 여기 들어오지 않는다. */
  lastSuccessAt: number | null;
  /**
   * 성공·실패를 가리지 않은 마지막 **시도** 시각.
   *
   * ★ 주기 확인의 기준은 성공이 아니라 시도다. 성공만 보면 온나라 세션이 끊긴 동안
   *   매 알람마다 같은 실패를 되풀이한다.
   */
  lastAttemptAt: number | null;
  /** 마지막 성공 이후 연이어 실패한 횟수. 물러나는 폭을 정한다. */
  consecutiveFailures: number;
  now: Date;
  /** 작업 탭이 지금 다른 일에 쓰이고 있는가. */
  busy: boolean;
  hasLocation: boolean;
}

/**
 * 연속 실패에 따라 확인 간격을 늘리는 배수.
 *
 * ★ 실패의 거의 전부는 온나라 세션 만료다. 그것은 다음 30분 안에 저절로 낫지 않는다.
 *   같은 간격으로 계속 두드리면 실패 기록만 쌓여 기록 화면이 쓸모없어진다.
 */
export function backoffFactor(consecutiveFailures: number): number {
  if (consecutiveFailures >= 6) return 4;
  if (consecutiveFailures >= 3) return 2;
  return 1;
}

/**
 * 업무시간 창의 끝.
 *
 * ★ 종료 시각이 시작 시각보다 앞서면 창이 비어 **영영 확인하지 않는** 설정이 된다.
 *   그런 설정은 화면에서 고를 수 없지만, 저장된 값이 손상됐을 때 조용히 기능이 죽는 쪽보다
 *   한 시간이라도 여는 쪽이 낫다.
 */
function endHour(settings: BriefSettings): number {
  return Math.max(settings.briefingEndHour, settings.briefingHour + 1);
}

/** 알람이 몇 초 늦게 와도 한 주기를 통째로 건너뛰지 않도록 두는 여유. */
const INTERVAL_GRACE_MS = 60_000;

/**
 * 지금 브리핑할 때인가.
 *
 * ★ 바쁘면 **줄을 서지 않고 물러난다**. 사용자가 첨부를 받는 중이라면 브리핑은
 *   다음 알람에 다시 오면 그만이다. 기다리게 하면 사용자의 작업이 느려진다.
 *
 * ★ 업무시간 창과 주말 제외는 **주기 확인에서만** 본다. 하루 한 번 모드에까지 적용하면,
 *   저녁에 브라우저를 처음 켜는 사용자가 그날의 브리핑을 통째로 잃는다.
 */
export function shouldBriefNow(input: BriefConditions): BriefDecision {
  const { settings, now } = input;
  if (!settings.briefingEnabled) return { run: false, skip: 'off' };
  if (!input.hasLocation) return { run: false, skip: 'no-location' };
  if (now.getHours() < settings.briefingHour) return { run: false, skip: 'too-early' };

  const interval = settings.briefingIntervalMinutes;
  if (interval > 0) {
    if (settings.briefingSkipWeekend && (now.getDay() === 0 || now.getDay() === 6)) {
      return { run: false, skip: 'weekend' };
    }
    if (now.getHours() >= endHour(settings)) return { run: false, skip: 'after-hours' };
    const wait = interval * backoffFactor(input.consecutiveFailures) * 60_000;
    if (input.lastAttemptAt !== null && now.getTime() - input.lastAttemptAt < wait - INTERVAL_GRACE_MS) {
      return { run: false, skip: 'too-soon' };
    }
  } else if (input.lastSuccessAt !== null && todayISO(new Date(input.lastSuccessAt)) === todayISO(now)) {
    return { run: false, skip: 'done-today' };
  }

  if (input.busy) return { run: false, skip: 'busy' };
  return { run: true };
}

/** 실행 기록에서 판단에 필요한 세 값을 한 번에 읽는다. */
export interface BriefHistory {
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  consecutiveFailures: number;
}

export async function briefHistory(): Promise<BriefHistory> {
  const runs = await listInboxRuns(20);
  let consecutiveFailures = 0;
  for (const run of runs) {
    if (!run.error) break;
    consecutiveFailures += 1;
  }
  return {
    lastSuccessAt: runs.find(run => !run.error)?.at ?? null,
    lastAttemptAt: runs[0]?.at ?? null,
    consecutiveFailures,
  };
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
    ...(await briefHistory()),
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

/* ── 알람 주기 ─────────────────────────────────────────── */

/**
 * 설정에 맞는 알람 주기(분).
 *
 * ★ 확인 주기보다 성기게 깨우면 그 주기를 지킬 수 없다. 반대로 더 촘촘히 깨울 이유도 없다 —
 *   깨어난 워커는 [shouldBriefNow]에 막혀 아무것도 하지 않고 다시 죽는다.
 */
export function alarmPeriodMinutes(settings: Pick<Settings, 'briefingIntervalMinutes'>): number {
  const interval = settings.briefingIntervalMinutes;
  return interval > 0 ? Math.min(interval, CHECK_MINUTES) : CHECK_MINUTES;
}

/** 알람 주기를 설정에 맞춘다. 이미 맞으면 건드리지 않는다 — 다시 만들면 다음 발화가 뒤로 밀린다. */
async function syncBriefingAlarm(): Promise<void> {
  try {
    const period = alarmPeriodMinutes(await loadSettings());
    const existing = await chrome.alarms.get(BRIEFING_ALARM);
    if (existing?.periodInMinutes === period) return;
    chrome.alarms.create(BRIEFING_ALARM, { periodInMinutes: period, delayInMinutes: Math.min(period, 2) });
  } catch { /* 알람을 걸지 못하면 패널의 "지금 확인"만 남는다 */ }
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

  void syncBriefingAlarm();
  // 주기를 바꾼 순간부터 그 주기로 동작해야 한다. 알람은 한 번 만들면 스스로 바뀌지 않는다.
  onSettingsChanged(() => void syncBriefingAlarm());

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
