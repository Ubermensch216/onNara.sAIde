import { describe, expect, it } from 'vitest';
import { bucketOf, compareTasks, daysUntil, ddayLabel, dedupeKeyOf, groupTasks, urgentCount } from './task';
import type { ScheduleTask } from './task';

const NOW = new Date(2026, 8, 18); // 2026-09-18

function task(patch: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id: 1, title: '할 일', status: 'todo', dueDate: '', createdAt: 1, updatedAt: 1, ...patch };
}

describe('daysUntil / ddayLabel', () => {
  it('오늘은 0, 미래는 양수, 지난 기한은 음수', () => {
    expect(daysUntil('2026-09-18', NOW)).toBe(0);
    expect(daysUntil('2026-09-21', NOW)).toBe(3);
    expect(daysUntil('2026-09-16', NOW)).toBe(-2);
  });

  it('달을 넘어도 날수가 어긋나지 않는다', () => {
    expect(daysUntil('2026-10-01', NOW)).toBe(13);
  });

  it('날짜 형식이 아니면 null', () => {
    expect(daysUntil('', NOW)).toBeNull();
    expect(daysUntil('2026-09', NOW)).toBeNull();
  });

  it('지난 기한도 숨기지 않고 D+n으로 적는다', () => {
    expect(ddayLabel(0)).toBe('D-DAY');
    expect(ddayLabel(3)).toBe('D-3');
    expect(ddayLabel(-2)).toBe('D+2');
  });
});

describe('bucketOf', () => {
  it.each([
    ['2026-09-16', 'overdue'],
    ['2026-09-18', 'today'],
    ['2026-09-25', 'soon'],
    ['2026-09-26', 'later'],
    ['', 'someday'],
  ])('%s → %s', (dueDate, expected) => {
    expect(bucketOf(task({ dueDate }), NOW)).toBe(expected);
  });

  it('완료한 항목은 기한과 무관하게 완료 구간이다', () => {
    expect(bucketOf(task({ dueDate: '2026-09-16', status: 'done' }), NOW)).toBe('done');
  });
});

describe('compareTasks', () => {
  it('급한 기한이 위로, 기한 없는 항목은 그 뒤, 완료는 맨 뒤', () => {
    const sorted = [
      task({ id: 3, status: 'done', dueDate: '2026-09-01', completedAt: 9 }),
      task({ id: 2, dueDate: '' }),
      task({ id: 1, dueDate: '2026-09-20' }),
    ].sort(compareTasks);
    expect(sorted.map(item => item.id)).toEqual([1, 2, 3]);
  });

  it('같은 날이면 시각이 있는 항목이 먼저다', () => {
    const withTime = task({ id: 1, dueDate: '2026-09-20', due: { date: '2026-09-20', time: '09:00', text: '9. 20.', yearInferred: false } });
    const allDay = task({ id: 2, dueDate: '2026-09-20' });
    expect([allDay, withTime].sort(compareTasks).map(item => item.id)).toEqual([1, 2]);
  });
});

describe('groupTasks / urgentCount', () => {
  const tasks = [
    task({ id: 1, dueDate: '2026-09-16' }),
    task({ id: 2, dueDate: '2026-09-18' }),
    task({ id: 3, dueDate: '2026-09-25' }),
    task({ id: 4, dueDate: '2026-12-01' }),
    task({ id: 5 }),
    task({ id: 6, status: 'done', dueDate: '2026-09-17' }),
  ];

  it('구간별로 나눈다', () => {
    const groups = groupTasks(tasks, NOW);
    expect(groups.overdue.map(item => item.id)).toEqual([1]);
    expect(groups.today.map(item => item.id)).toEqual([2]);
    expect(groups.soon.map(item => item.id)).toEqual([3]);
    expect(groups.later.map(item => item.id)).toEqual([4]);
    expect(groups.someday.map(item => item.id)).toEqual([5]);
    expect(groups.done.map(item => item.id)).toEqual([6]);
  });

  it('탭 배지 수는 지난 기한 + 오늘 + 이번 주다', () => {
    expect(urgentCount(tasks, NOW)).toBe(3);
  });
});

describe('dedupeKeyOf', () => {
  it('공백과 대소문자 차이는 같은 항목으로 본다', () => {
    expect(dedupeKeyOf('공모전 안내', '계획서  제출')).toBe(dedupeKeyOf('공모전  안내', '계획서 제출'));
  });

  it('다른 공문의 같은 할 일은 다른 항목이다', () => {
    expect(dedupeKeyOf('공문 A', '계획서 제출')).not.toBe(dedupeKeyOf('공문 B', '계획서 제출'));
  });
});
