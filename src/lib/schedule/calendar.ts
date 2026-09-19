/**
 * 달력 격자 계산(계획서 S07 · 일정 탭의 월·주·일 보기).
 *
 * ★ 날짜는 전부 `YYYY-MM-DD` 문자열로 주고받는다. Date 객체를 그대로 넘기면 시간대와 시각이
 *   딸려 다니며, 자정 근처에서 하루가 어긋난다. 계산할 때만 로컬 Date로 바꿔 쓴다(UTC로 바꾸지 않는다).
 *
 * ★ 한 주는 일요일에 시작한다. 공문·업무 달력의 관례이자 참조 프로젝트의 규칙과 같다.
 */

import type { ScheduleTask } from './task';

/** 달력 보기 방식. 'list'는 달력이 아니라 D-day 목록이다. */
export type CalendarMode = 'month' | 'week' | 'day' | 'list';

export const CALENDAR_MODES: CalendarMode[] = ['month', 'week', 'day', 'list'];

export function isCalendarMode(value: unknown): value is CalendarMode {
  return CALENDAR_MODES.includes(value as CalendarMode);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` → 그 날 0시의 로컬 Date. 형식이 아니면 null. */
export function parseDateISO(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function at(dateISO: string): Date {
  return parseDateISO(dateISO) ?? new Date();
}

export function addDays(dateISO: string, days: number): string {
  const date = at(dateISO);
  return toISO(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

/** 달을 옮긴다. 31일에서 2월로 가면 그 달의 마지막 날로 맞춘다(3월 3일로 넘어가지 않는다). */
export function addMonths(dateISO: string, months: number): string {
  const date = at(dateISO);
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toISO(new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay)));
}

export function startOfWeek(dateISO: string): string {
  return addDays(dateISO, -at(dateISO).getDay());
}

export function weekday(dateISO: string): number {
  return at(dateISO).getDay();
}

export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/** 화면에 보기 좋은 짧은 날짜. 2026.09.18 */
export function shortDate(dateISO: string): string {
  return dateISO.replace(/-/g, '.');
}

/**
 * 월 보기 격자. 그 달의 1일이 든 주의 일요일부터 6주 42칸.
 *
 * ★ 칸 수를 달마다 바꾸지 않고 6주로 고정한다. 달을 넘길 때 격자 높이가 들쭉날쭉하면
 *   같은 자리를 누르려던 손이 매번 어긋난다.
 */
export function monthGrid(cursorISO: string): string[][] {
  const date = at(cursorISO);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  let cell = toISO(new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay()));
  const weeks: string[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      row.push(cell);
      cell = addDays(cell, 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/** 주 보기의 일요일~토요일 7일. */
export function weekDates(cursorISO: string): string[] {
  const start = startOfWeek(cursorISO);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** 보기에 걸리는 날짜 범위. 달력이 아닌 목록 보기에는 범위가 없다. */
export function visibleRange(cursorISO: string, mode: CalendarMode): { from: string; to: string } | null {
  if (mode === 'day') return { from: cursorISO, to: cursorISO };
  if (mode === 'week') {
    const dates = weekDates(cursorISO);
    return { from: dates[0]!, to: dates[6]! };
  }
  if (mode === 'month') {
    const weeks = monthGrid(cursorISO);
    return { from: weeks[0]![0]!, to: weeks[5]![6]! };
  }
  return null;
}

/**
 * 이 범위를 가장 잘 담는 보기.
 *
 * ★ `@일정` 조회가 일정 탭을 열 때 쓴다. 하루를 물었는데 월 격자로 던져 놓으면
 *   사용자가 그 칸을 다시 찾아야 하고, 한 해를 물었는데 일 보기로 열면 아무것도 없다.
 */
export function modeForRange(from: string, to: string): CalendarMode {
  if (from === to) return 'day';
  const start = parseDateISO(from);
  const end = parseDateISO(to);
  if (!start || !end) return 'month';
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return days <= 6 ? 'week' : 'month';
}

/** 커서를 한 칸 옮긴다. 월 보기는 한 달, 주 보기는 한 주, 일 보기는 하루. */
export function shiftCursor(cursorISO: string, mode: CalendarMode, delta: number): string {
  if (mode === 'month') return addMonths(cursorISO, delta);
  if (mode === 'week') return addDays(cursorISO, delta * 7);
  return addDays(cursorISO, delta);
}

/**
 * 날짜별 일정. 기한이 없는 항목은 어느 칸에도 들어가지 않는다.
 *
 * ★ 기한 미정 항목을 오늘 칸에 넣지 않는다. 달력에 놓는 순간 "오늘까지 할 일"로 읽히는데
 *   그것은 원문에 없는 사실이다. 화면은 따로 세어 보여 준다(그래야 잊히지도 않는다).
 */
export function tasksByDate(tasks: ScheduleTask[]): Map<string, ScheduleTask[]> {
  const byDate = new Map<string, ScheduleTask[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const list = byDate.get(task.dueDate);
    if (list) list.push(task); else byDate.set(task.dueDate, [task]);
  }
  return byDate;
}

/** 기한이 없어 달력에 놓을 수 없는 미완료 항목. */
export function undatedTasks(tasks: ScheduleTask[]): ScheduleTask[] {
  return tasks.filter(task => !task.dueDate && task.status !== 'done');
}
