import { describe, expect, it } from 'vitest';
import {
  addDays, addMonths, isCalendarMode, monthGrid, monthOf, parseDateISO, shiftCursor,
  shortDate, startOfWeek, tasksByDate, toISO, undatedTasks, visibleRange, weekDates, weekday,
} from './calendar';
import type { ScheduleTask } from './task';

function task(patch: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id: 1, title: '할 일', status: 'todo', dueDate: '', createdAt: 1, updatedAt: 1, ...patch };
}

describe('날짜 이동', () => {
  it('하루씩 옮긴다 — 달과 해를 넘겨도 맞는다', () => {
    expect(addDays('2026-09-18', 1)).toBe('2026-09-19');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('★ 달을 옮길 때 31일은 그 달의 마지막 날로 맞춘다 — 3월 3일로 튀지 않는다', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('한 주는 일요일에 시작한다', () => {
    // 2026-09-18은 금요일이다.
    expect(weekday('2026-09-18')).toBe(5);
    expect(startOfWeek('2026-09-18')).toBe('2026-09-13');
    expect(startOfWeek('2026-09-13')).toBe('2026-09-13');
  });

  it('보기 방식에 따라 한 칸이 달라진다', () => {
    expect(shiftCursor('2026-09-18', 'month', 1)).toBe('2026-10-18');
    expect(shiftCursor('2026-09-18', 'week', -1)).toBe('2026-09-11');
    expect(shiftCursor('2026-09-18', 'day', 1)).toBe('2026-09-19');
  });
});

describe('monthGrid', () => {
  it('★ 어느 달이든 6주 42칸이다 — 달을 넘길 때 격자 높이가 바뀌면 손이 어긋난다', () => {
    for (const month of ['2026-02-01', '2026-09-18', '2027-01-31']) {
      const weeks = monthGrid(month);
      expect(weeks).toHaveLength(6);
      expect(weeks.every(week => week.length === 7)).toBe(true);
    }
  });

  it('1일이 든 주의 일요일부터 시작하고 하루도 건너뛰지 않는다', () => {
    const weeks = monthGrid('2026-09-18');
    // 2026-09-01은 화요일 → 그 주 일요일은 8월 30일.
    expect(weeks[0]![0]).toBe('2026-08-30');
    const flat = weeks.flat();
    expect(flat).toHaveLength(42);
    for (let i = 1; i < flat.length; i += 1) expect(flat[i]).toBe(addDays(flat[i - 1]!, 1));
  });

  it('그 달의 모든 날이 격자에 들어간다', () => {
    const flat = monthGrid('2026-02-10').flat().filter(date => monthOf(date) === '2026-02');
    expect(flat).toHaveLength(28);
  });
});

describe('weekDates / visibleRange', () => {
  it('주 보기는 일요일부터 이레', () => {
    expect(weekDates('2026-09-18')).toEqual([
      '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19',
    ]);
  });

  it('보기마다 걸리는 범위가 다르고, 목록 보기에는 범위가 없다', () => {
    expect(visibleRange('2026-09-18', 'day')).toEqual({ from: '2026-09-18', to: '2026-09-18' });
    expect(visibleRange('2026-09-18', 'week')).toEqual({ from: '2026-09-13', to: '2026-09-19' });
    expect(visibleRange('2026-09-18', 'month')).toEqual({ from: '2026-08-30', to: '2026-10-10' });
    expect(visibleRange('2026-09-18', 'list')).toBeNull();
  });
});

describe('tasksByDate / undatedTasks', () => {
  const tasks = [
    task({ id: 1, dueDate: '2026-09-18' }),
    task({ id: 2, dueDate: '2026-09-18' }),
    task({ id: 3, dueDate: '2026-09-30' }),
    task({ id: 4 }),
    task({ id: 5, status: 'done' }),
  ];

  it('같은 날 일정은 한 칸에 모인다', () => {
    const byDate = tasksByDate(tasks);
    expect(byDate.get('2026-09-18')!.map(item => item.id)).toEqual([1, 2]);
    expect(byDate.get('2026-09-30')).toHaveLength(1);
    expect(byDate.has('2026-09-19')).toBe(false);
  });

  it('★ 기한 미정 항목은 달력 어느 칸에도 넣지 않는다 — 오늘 칸에 넣으면 없는 기한이 생긴다', () => {
    const dated = [...tasksByDate(tasks).values()].flat().map(item => item.id);
    expect(dated).not.toContain(4);
    // 대신 따로 세어 화면에 남긴다. 끝난 일은 세지 않는다.
    expect(undatedTasks(tasks).map(item => item.id)).toEqual([4]);
  });
});

describe('형식 변환', () => {
  it('로컬 날짜를 그대로 왕복한다', () => {
    expect(toISO(new Date(2026, 8, 18))).toBe('2026-09-18');
    expect(parseDateISO('2026-09-18')!.getMonth()).toBe(8);
    expect(parseDateISO('2026-09')).toBeNull();
    expect(shortDate('2026-09-18')).toBe('2026.09.18');
  });

  it('저장된 보기 방식만 받아들인다', () => {
    expect(isCalendarMode('month')).toBe(true);
    expect(isCalendarMode('year')).toBe(false);
  });
});
