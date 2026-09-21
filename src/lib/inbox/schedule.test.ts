import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import { alarmPeriodMinutes, backoffFactor, briefingNotice, shouldBriefNow, type BriefConditions } from './schedule';
import type { Briefing } from './briefing';
import type { InboxDoc } from './types';

const NOW = new Date('2026-09-20T09:30:00');

function conditions(overrides: Partial<BriefConditions> = {}): BriefConditions {
  return {
    settings: { ...DEFAULT_SETTINGS, briefingEnabled: true, briefingHour: 9 },
    lastSuccessAt: null,
    lastAttemptAt: null,
    consecutiveFailures: 0,
    now: NOW,
    busy: false,
    hasLocation: true,
    ...overrides,
  };
}

it('기본값에서는 아무 일도 하지 않는다 — 켜는 순간이 사용자의 승인이다', () => {
  expect(shouldBriefNow(conditions({ settings: DEFAULT_SETTINGS }))).toEqual({ run: false, skip: 'off' });
});

it('대상 화면을 지정하기 전에는 실행하지 않는다', () => {
  expect(shouldBriefNow(conditions({ hasLocation: false }))).toEqual({ run: false, skip: 'no-location' });
});

it('정한 시각 전에는 실행하지 않는다', () => {
  expect(shouldBriefNow(conditions({ now: new Date('2026-09-20T08:59:00') }))).toEqual({ run: false, skip: 'too-early' });
  expect(shouldBriefNow(conditions({ now: new Date('2026-09-20T09:00:00') }))).toEqual({ run: true });
});

it('오늘 이미 성공했으면 다시 하지 않는다 — 어제 것은 오늘을 막지 않는다', () => {
  expect(shouldBriefNow(conditions({ lastSuccessAt: new Date('2026-09-20T09:05:00').getTime() })))
    .toEqual({ run: false, skip: 'done-today' });
  expect(shouldBriefNow(conditions({ lastSuccessAt: new Date('2026-09-19T23:59:00').getTime() })))
    .toEqual({ run: true });
});

/* ── 주기 확인 ─────────────────────────────────────────── */

/** 평일 업무시간 안. NOW(2026-09-20)는 일요일이라 주기 확인의 기준으로 쓸 수 없다. */
const WEEKDAY = new Date('2026-09-18T09:30:00');
const before = (minutes: number) => WEEKDAY.getTime() - minutes * 60_000;

/** 30분마다 확인하는 설정. */
function every30(overrides: Partial<BriefConditions> = {}): BriefConditions {
  return conditions({
    settings: {
      ...DEFAULT_SETTINGS, briefingEnabled: true, briefingHour: 9,
      briefingIntervalMinutes: 30, briefingEndHour: 18, briefingSkipWeekend: true,
    },
    now: WEEKDAY,
    ...overrides,
  });
}

it('주기를 정하면 그 간격이 지나야 다시 확인한다', () => {
  expect(shouldBriefNow(every30({ lastAttemptAt: before(10) }))).toEqual({ run: false, skip: 'too-soon' });
  expect(shouldBriefNow(every30({ lastAttemptAt: before(30) }))).toEqual({ run: true });
});

it('간격 판단의 기준은 성공이 아니라 시도다 — 실패해도 곧바로 되풀이하지 않는다', () => {
  // 온나라 세션이 끊겨 방금 실패했다. 성공 기록은 어제 것뿐이다.
  const justFailed = every30({
    lastAttemptAt: before(5),
    lastSuccessAt: new Date('2026-09-17T09:00:00').getTime(),
    consecutiveFailures: 1,
  });
  expect(shouldBriefNow(justFailed)).toEqual({ run: false, skip: 'too-soon' });
});

it('연속 실패가 쌓이면 간격을 늘려 물러난다', () => {
  expect([backoffFactor(0), backoffFactor(2), backoffFactor(3), backoffFactor(6)]).toEqual([1, 1, 2, 4]);
  // 실패 3회 뒤에는 30분이 아니라 60분을 기다린다.
  expect(shouldBriefNow(every30({ lastAttemptAt: before(40), consecutiveFailures: 3 })))
    .toEqual({ run: false, skip: 'too-soon' });
  expect(shouldBriefNow(every30({ lastAttemptAt: before(40), consecutiveFailures: 2 }))).toEqual({ run: true });
});

it('업무시간이 끝나면 확인하지 않는다', () => {
  expect(shouldBriefNow(every30({ now: new Date('2026-09-18T17:30:00') }))).toEqual({ run: true });
  expect(shouldBriefNow(every30({ now: new Date('2026-09-18T18:00:00') }))).toEqual({ run: false, skip: 'after-hours' });
});

it('주말에는 주기 확인을 건너뛴다', () => {
  // 2026-09-19는 토요일이다.
  expect(shouldBriefNow(every30({ now: new Date('2026-09-19T10:00:00') }))).toEqual({ run: false, skip: 'weekend' });
});

it('업무시간 창과 주말 제외는 하루 한 번 모드를 막지 않는다', () => {
  // ★ 저녁에 브라우저를 처음 켠 사용자가 그날의 브리핑을 통째로 잃어서는 안 된다.
  expect(shouldBriefNow(conditions({ now: new Date('2026-09-19T22:00:00') }))).toEqual({ run: true });
});

it('알람 주기는 확인 주기보다 성기지 않다', () => {
  expect(alarmPeriodMinutes({ briefingIntervalMinutes: 0 })).toBe(60);
  expect(alarmPeriodMinutes({ briefingIntervalMinutes: 30 })).toBe(30);
  expect(alarmPeriodMinutes({ briefingIntervalMinutes: 240 })).toBe(60);
});

it('작업 탭이 바쁘면 줄을 서지 않고 물러난다', () => {
  // 사용자가 첨부를 받는 중이라면 아침 브리핑은 다음 알람에 다시 오면 그만이다.
  expect(shouldBriefNow(conditions({ busy: true }))).toEqual({ run: false, skip: 'busy' });
});

function doc(title: string): InboxDoc {
  return {
    key: title, group: 'g', title, reportDate: '2026-09-19', sender: '부산광역시', department: '감사담당관',
    hasAttachment: false, readState: 'unread', category: 'deadline', reason: '', dueDate: '2026-09-22',
    classifier: 'rule', firstSeenAt: 1, lastSeenAt: 1,
  };
}

it('실을 것이 없는 날은 알리지 않는다', () => {
  const quiet: Briefing = {
    at: NOW.getTime(), listName: '받은문서', trigger: 'alarm', scanned: 12, added: 0, filtered: 0,
    groups: [], readState: { unread: 12, read: 0, unknown: 0, changed: 0 },
  };
  expect(briefingNotice(quiet)).toBeNull();
});

it('알림에는 건수와 급한 제목 몇 개만 싣는다', () => {
  const briefing: Briefing = {
    at: NOW.getTime(), listName: '받은문서', trigger: 'alarm', scanned: 12, added: 4, filtered: 0,
    groups: [
      { category: 'deadline', docs: [doc('정산자료 제출'), doc('실적 보고')] },
      { category: 'mine', docs: [doc('수요조사 협조'), doc('의견조회')] },
    ],
    readState: { unread: 12, read: 0, unknown: 0, changed: 0 },
  };
  const notice = briefingNotice(briefing)!;
  expect(notice.title).toContain('4');
  expect(notice.message.split('\n')).toHaveLength(3);
  expect(notice.message).toContain('기한 임박');
});
