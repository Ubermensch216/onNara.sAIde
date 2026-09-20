import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import { briefingNotice, shouldBriefNow, type BriefConditions } from './schedule';
import type { Briefing } from './briefing';
import type { InboxDoc } from './types';

const NOW = new Date('2026-09-20T09:30:00');

function conditions(overrides: Partial<BriefConditions> = {}): BriefConditions {
  return {
    settings: { ...DEFAULT_SETTINGS, briefingEnabled: true, briefingHour: 9 },
    lastSuccessAt: null,
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
