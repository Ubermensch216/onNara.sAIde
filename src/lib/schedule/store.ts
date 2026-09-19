/**
 * 일정 저장소(계획서 S07 · §8.2 "업무 항목 → IndexedDB").
 *
 * ★ 대화(conversations/messages)와 수명이 다르다. 공문을 읽은 대화를 지워도 그 공문에서
 *   등록한 기한은 남아야 한다. 그래서 같은 DB의 별도 테이블이고, 대화 삭제 경로는 이 테이블을 건드리지 않는다.
 *
 * ★ 등록은 항상 사용자가 확인한 뒤에만 일어난다. 이 모듈에는 "AI 결과를 자동으로 저장"하는 경로가 없다.
 */

import { create } from 'zustand';
import { db } from '@/lib/storage/db';
import type { CalendarMode } from './calendar';
import { compareTasks, type NewScheduleTask, type ScheduleTask } from './task';

/**
 * 일정 탭이 열릴 때 맞출 자리.
 *
 * ★ **답변 안의 링크를 눌렀을 때에만** 채워진다. `@일정`을 실행했다고 저절로 옮기지
 *   않는다 — 갈지 말지는 누르는 사람이 정한다(lib/panel/links.ts).
 *
 * ★ 탭만 바꾸고 이번 달 격자를 보여 주면 "5월 일정"의 답이 화면에 없다. 어디를 볼지도
 *   함께 넘긴다. `taskId`가 있으면 그 항목의 기한에서 커서와 보기를 정하므로 나머지는 없어도 된다.
 *
 * ★ `at`은 같은 자리를 두 번 눌러도 화면이 반응하게 하는 일련번호다. 값이 같으면
 *   useEffect가 돌지 않아 사용자가 손으로 옮겨 둔 커서가 되돌아오지 않는다.
 */
export interface ScheduleFocus {
  /** 이 항목을 짚는다. 커서·보기는 화면이 그 항목에서 정하고, 잠깐 강조한다. */
  taskId?: number;
  cursor?: string;
  mode?: CalendarMode;
  at: number;
}

interface ScheduleState {
  tasks: ScheduleTask[];
  /** 한 번이라도 읽어 왔는가. 빈 목록과 "아직 못 읽음"을 화면이 구분해야 한다. */
  loaded: boolean;
  /** 일정 탭이 아직 반영하지 않은 초점. 반영한 뒤 스스로 비운다. */
  focus: ScheduleFocus | null;
}

/**
 * 화면이 구독하는 목록.
 *
 * ★ 일정 탭과 AI 탭의 배지가 같은 목록을 본다. 두 곳이 따로 읽으면 등록 직후 한쪽만 바뀐다.
 *   모든 쓰기 함수가 끝에 refresh()를 부르므로 화면은 언제나 저장된 내용과 같다.
 */
export const useSchedule = create<ScheduleState>(() => ({ tasks: [], loaded: false, focus: null }));

/** 일정 탭을 이 날짜·보기로 열어 달라고 남긴다. 탭 전환 자체는 화면(App)이 한다. */
export function focusSchedule(cursor: string, mode: CalendarMode): void {
  useSchedule.setState({ focus: { cursor, mode, at: Date.now() } });
}

/** 이 항목을 짚어 달라고 남긴다. 어느 날짜·보기로 가야 하는지는 화면이 항목에서 읽는다. */
export function focusScheduleTask(taskId: number): void {
  useSchedule.setState({ focus: { taskId, at: Date.now() } });
}

/** 반영했다. 다음 지시가 올 때까지 비워 둔다. */
export function clearScheduleFocus(): void {
  if (useSchedule.getState().focus) useSchedule.setState({ focus: null });
}

export async function listTasks(): Promise<ScheduleTask[]> {
  return (await db.tasks.toArray()).sort(compareTasks);
}

/** 저장소에서 다시 읽어 화면 상태를 맞춘다. */
export async function refreshTasks(): Promise<void> {
  useSchedule.setState({ tasks: await listTasks(), loaded: true });
}

export async function getTask(id: number): Promise<ScheduleTask | undefined> {
  return db.tasks.get(id);
}

function stamp(input: NewScheduleTask, now: number): Omit<ScheduleTask, 'id'> {
  return {
    ...input,
    // 기한이 없으면 빈 문자열이다. undefined면 Dexie 색인에서 빠져 "기한 미정" 조회가 불가능해진다.
    dueDate: input.due?.date ?? input.dueDate ?? '',
    status: input.status ?? 'todo',
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export async function addTask(input: NewScheduleTask): Promise<number> {
  const id = await db.tasks.add(stamp(input, Date.now()) as ScheduleTask);
  await refreshTasks();
  return id;
}

/**
 * 여러 후보를 한 번에 등록한다. 이미 있는 것은 건너뛰고 몇 건을 건너뛰었는지 알린다.
 *
 * ★ 같은 공문을 두 번 분석하는 일은 흔하다(목록에서 다시 실행, 정정 공문 확인 등).
 *   그때마다 같은 할 일이 쌓이면 목록이 못 쓰게 된다. 조용히 덮어쓰지도 않는다 —
 *   사용자가 먼저 등록한 항목에 메모나 완료 표시를 해 두었을 수 있다.
 */
export async function addTasks(inputs: NewScheduleTask[]): Promise<{ added: number[]; skipped: number }> {
  if (!inputs.length) return { added: [], skipped: 0 };
  const now = Date.now();
  const keys = inputs.map(input => input.dedupeKey).filter((key): key is string => Boolean(key));
  const existing = new Set(keys.length
    ? (await db.tasks.where('dedupeKey').anyOf(keys).toArray()).map(task => task.dedupeKey)
    : []);

  const added: number[] = [];
  let skipped = 0;
  for (const input of inputs) {
    if (input.dedupeKey && existing.has(input.dedupeKey)) { skipped += 1; continue; }
    if (input.dedupeKey) existing.add(input.dedupeKey);
    added.push(await db.tasks.add(stamp(input, now) as ScheduleTask));
  }
  await refreshTasks();
  return { added, skipped };
}

export async function updateTask(id: number, patch: Partial<Omit<ScheduleTask, 'id'>>): Promise<void> {
  const next: Partial<ScheduleTask> = { ...patch, updatedAt: Date.now() };
  // 기한을 고치면 색인 필드도 함께 맞춘다. 한쪽만 바뀌면 목록 순서와 화면 표시가 어긋난다.
  if ('due' in patch) next.dueDate = patch.due?.date ?? '';
  await db.tasks.update(id, next);
  await refreshTasks();
}

export async function setTaskDone(id: number, done: boolean): Promise<void> {
  const now = Date.now();
  await db.tasks.update(id, done
    ? { status: 'done', completedAt: now, updatedAt: now }
    // 완료를 되돌리면 완료 시각도 지운다. 남겨 두면 목록 정렬이 끝난 일 기준으로 흔들린다.
    : { status: 'todo', completedAt: undefined, updatedAt: now });
  await refreshTasks();
}

export async function deleteTask(id: number): Promise<void> {
  await db.tasks.delete(id);
  await refreshTasks();
}

/** 완료한 항목을 한꺼번에 비운다. 지운 건수를 돌려준다. */
export async function clearDoneTasks(): Promise<number> {
  const removed = await db.tasks.where('status').equals('done').delete();
  await refreshTasks();
  return removed;
}

export async function deleteAllTasks(): Promise<void> {
  await db.tasks.clear();
  await refreshTasks();
}
