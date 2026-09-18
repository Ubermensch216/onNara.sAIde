/**
 * 기한 알림(계획서 S07 · P4-4 "D-day·알림").
 *
 * ★ 참조 프로젝트의 달력은 `setInterval`로 1분마다 확인하고 브라우저 Notification을 띄운다.
 *   그 방식은 **화면이 열려 있는 동안만** 동작한다. 사이드패널은 사용자가 닫으면 문서째 사라지므로
 *   여기서는 서비스 워커의 `chrome.alarms`가 깨워 확인한다. 패널을 닫아 두어도 기한은 알려야 한다.
 *
 * ★ 하루에 한 번만 알린다. 기한 보드의 알림은 "오늘 무엇이 남았는가"를 알리는 것이지
 *   항목마다 울리는 알람이 아니다. 항목별로 울리면 공문 한 건에서 할 일이 다섯이면 다섯 번 울린다.
 *
 * ★ 알린 사실은 날짜 한 줄(`YYYY-MM-DD`)로만 남긴다. 참조 프로젝트는 알림 키를 배열에 계속
 *   덧붙여 이벤트마다 무한히 자란다. 여기서는 마지막으로 알린 날짜만 있으면 충분하다.
 */

import { t } from '@/lib/i18n';
import { loadSettings } from '@/lib/storage/settings';
import { listTasks } from './store';
import { daysUntil, todayISO, type ScheduleTask } from './task';

/** 서비스 워커를 깨우는 알람 이름. */
export const TASK_ALARM = 'saide.taskAlerts';
/** 마지막으로 알린 날짜를 적어 두는 자리. */
export const ALERT_STATE_KEY = 'saide.taskAlertOn';
/** 알림 id. 같은 id로 덮어써 알림이 쌓이지 않게 한다. */
const NOTIFICATION_ID = 'saide.taskAlert';
/** 워커가 죽어 있어도 한 시간에 한 번은 깨어나 확인한다. */
const CHECK_MINUTES = 60;

export interface AlertDigest {
  overdue: ScheduleTask[];
  today: ScheduleTask[];
  tomorrow: ScheduleTask[];
}

/**
 * 오늘 알릴 것. 지난 기한·오늘·내일까지만 본다.
 *
 * ★ "이번 주"까지 넣으면 같은 항목을 이레 내리 알리게 된다. 탭 배지는 이번 주까지 보여 주되,
 *   울리는 것은 손쓸 시간이 정말 얼마 남지 않은 것만이다.
 */
export function dueSoon(tasks: ScheduleTask[], now: Date = new Date()): AlertDigest {
  const digest: AlertDigest = { overdue: [], today: [], tomorrow: [] };
  for (const task of tasks) {
    if (task.status === 'done' || !task.dueDate) continue;
    const days = daysUntil(task.dueDate, now);
    if (days === null) continue;
    if (days < 0) digest.overdue.push(task);
    else if (days === 0) digest.today.push(task);
    else if (days === 1) digest.tomorrow.push(task);
  }
  return digest;
}

export function digestCount(digest: AlertDigest): number {
  return digest.overdue.length + digest.today.length + digest.tomorrow.length;
}

/** 알림 문구. 알릴 것이 없으면 null이다. */
export function alertText(digest: AlertDigest): { title: string; message: string } | null {
  const total = digestCount(digest);
  if (!total) return null;
  const parts = [
    digest.overdue.length ? t('alert.overdue', { n: digest.overdue.length }) : '',
    digest.today.length ? t('alert.today', { n: digest.today.length }) : '',
    digest.tomorrow.length ? t('alert.tomorrow', { n: digest.tomorrow.length }) : '',
  ].filter(Boolean);
  // 급한 것부터 제목을 보인다. 숫자만 있으면 패널을 열기 전까지 무엇이 급한지 알 수 없다.
  const titles = [...digest.overdue, ...digest.today, ...digest.tomorrow].slice(0, 3).map(task => `· ${task.title}`);
  return { title: t('alert.title', { n: total }), message: [parts.join(' · '), ...titles].join('\n') };
}

async function lastAlertDate(): Promise<string> {
  try { return String((await chrome.storage.local.get(ALERT_STATE_KEY))[ALERT_STATE_KEY] ?? ''); } catch { return ''; }
}

/**
 * 알릴 때가 되었으면 알린다. 실제로 알렸으면 true.
 *
 * 알리지 않는 경우: 설정에서 껐을 때, 정해진 시각 전, 오늘 이미 알렸을 때, 알릴 항목이 없을 때.
 */
export async function maybeNotify(now: Date = new Date()): Promise<boolean> {
  const settings = await loadSettings();
  if (!settings.taskAlerts) return false;
  if (now.getHours() < settings.taskAlertHour) return false;

  const today = todayISO(now);
  if (await lastAlertDate() === today) return false;

  const text = alertText(dueSoon(await listTasks(), now));
  // ★ 알릴 것이 없는 날은 표시를 남기지 않는다. 남기면 그날 오후에 기한이 생겨도 알리지 못한다.
  if (!text) return false;

  if (typeof chrome === 'undefined' || !chrome.notifications?.create) return false;
  await chrome.notifications.create(NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: chrome.runtime?.getURL?.('icon/128.png') ?? '',
    title: text.title,
    message: text.message,
  }).catch?.(() => undefined);
  try { await chrome.storage.local.set({ [ALERT_STATE_KEY]: today }); } catch { /* 표시를 못 남기면 다음 확인 때 한 번 더 알린다 */ }
  return true;
}

/**
 * 서비스 워커에 알람과 알림 처리기를 건다.
 *
 * ★ 최상위에서 부른다. 서비스 워커는 이벤트마다 깨었다 죽으므로, 깨어날 때마다 처리기가 붙어 있어야 한다.
 */
export function registerTaskAlerts(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;

  void chrome.alarms.get(TASK_ALARM).then(existing => {
    if (!existing) chrome.alarms.create(TASK_ALARM, { periodInMinutes: CHECK_MINUTES, delayInMinutes: 1 });
  }).catch(() => undefined);

  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === TASK_ALARM) void maybeNotify().catch(() => undefined);
  });

  // 알람은 브라우저를 켠 뒤 최대 한 시간 안에 온다. 아침에 켜자마자 한 번 더 확인해 그 지연을 없앤다.
  chrome.runtime.onStartup?.addListener(() => void maybeNotify().catch(() => undefined));

  // 알림을 누르면 패널을 연다. 브라우저가 제스처로 인정하지 않으면 조용히 닫기만 한다.
  chrome.notifications?.onClicked?.addListener(async id => {
    if (id !== NOTIFICATION_ID) return;
    await chrome.notifications.clear(id).catch(() => undefined);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [] as chrome.tabs.Tab[]);
    if (typeof tab?.id === 'number') await chrome.sidePanel?.open?.({ tabId: tab.id }).catch(() => undefined);
  });
}
