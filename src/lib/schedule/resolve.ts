/**
 * 의도 → 실행 계획(`@일정`).
 *
 * ★ 여기서는 **아무것도 저장하지 않는다**. 저장된 목록과 의도를 견주어 "무엇이 일어날
 *   것인가"를 만들어 낼 뿐이고, 실제 쓰기는 사용자가 확인 카드에서 누른 뒤에 일어난다.
 *   [store.ts]의 규칙("AI 결과를 자동으로 저장하는 경로가 없다")을 `@일정`에서도 지킨다.
 *   참조 프로젝트(myAI)는 시간 충돌만 없으면 곧바로 기록했는데, 그 동작은 가져오지 않았다.
 *
 * ★ 대상을 짐작하지 않는다. "실적보고서 미뤄줘"가 두 건에 걸리면 하나를 골라 주는 대신
 *   둘 다 내놓고 사용자가 고르게 한다. 하나만 걸렸을 때에만 미리 체크해 둔다 —
 *   핵심·조치사항 카드가 "원문에서 확인한 후보만 기본 체크"하는 것과 같은 태도다.
 */

import type { ScheduleIntent, TaskChanges } from './intent';
import { daysUntil, type NewScheduleTask, type ScheduleTask } from './task';
import type { TaskDue } from './due-date';

/** 계획을 세우지 못한 까닭. 화면은 이 값으로 안내 문구를 고른다. */
export type PlanProblem =
  | 'not-a-command'
  | 'no-match'
  | 'nothing-to-change'
  | 'empty-board';

export type SchedulePlan =
  | {
      kind: 'create';
      task: NewScheduleTask;
      /** 제목·기한이 똑같은 항목이 이미 있는가. 막지는 않고 알리기만 한다. */
      duplicate: ScheduleTask | null;
    }
  | {
      kind: 'update';
      targets: ScheduleTask[];
      /** 처음부터 체크해 둘 대상. 하나만 걸렸을 때만 채운다. */
      preselected: number[];
      changes: TaskChanges;
    }
  | {
      kind: 'delete';
      targets: ScheduleTask[];
      preselected: number[];
    }
  | {
      kind: 'list';
      tasks: ScheduleTask[];
      from?: string;
      to?: string;
      query?: string;
      /** 조건에는 맞지만 이미 끝난 항목 수. 목록에서는 빼고 건수만 알린다. */
      doneHidden: number;
    }
  | { kind: 'none'; problem: PlanProblem; reason?: string };

/** 제목 비교용. 띄어쓰기와 문장부호가 달라도 같은 일로 본다. */
function compact(text: string): string {
  return String(text ?? '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * 제목에 이 말이 들어 있는 항목.
 *
 * ★ 완료한 항목도 찾는다. "예산안 제출 완료 취소해줘"가 통해야 하고, 지우려는 대상이
 *   끝난 일일 수도 있다. 대신 급한 것이 위로 오게 정렬해 둔다.
 */
export function findByTitle(tasks: ScheduleTask[], matchTitle: string): ScheduleTask[] {
  const needle = compact(matchTitle);
  if (!needle) return [];
  return tasks.filter(task => compact(task.title).includes(needle));
}

/** 기한이 닫힌 구간 안에 드는가. 기한 미정 항목은 어떤 범위에도 들지 않는다. */
function inRange(task: ScheduleTask, from?: string, to?: string): boolean {
  if (!from && !to) return true;
  if (!task.dueDate) return false;
  if (from && task.dueDate < from) return false;
  if (to && task.dueDate > to) return false;
  return true;
}

/** 하나만 걸렸을 때만 미리 체크한다. 여럿이면 사용자가 고른다. */
function preselect(targets: ScheduleTask[]): number[] {
  return targets.length === 1 ? [targets[0]!.id] : [];
}

/** 확인 카드에 보일 등록 후보를 만든다. */
function toNewTask(title: string, date: string, time: string | undefined, notes: string | undefined, typed: string): NewScheduleTask {
  const due: TaskDue | undefined = date
    ? {
        date,
        ...(time ? { time } : {}),
        // ★ 원문에 적힌 표기 그대로라는 약속을 지킨다. 여기서 "원문"은 공문이 아니라
        //   사용자가 친 문장이다. 며칠 뒤 목록만 보고도 무슨 말로 넣었는지 되짚을 수 있다.
        text: typed,
        // 사용자가 직접 말한 기한이다. 코드가 연도를 추론한 것이 아니다.
        yearInferred: false,
      }
    : undefined;

  return {
    title,
    status: 'todo',
    dueDate: date,
    ...(due ? { due } : {}),
    ...(notes ? { notes } : {}),
    // ★ dedupeKey를 붙이지 않는다. 공문에서 뽑은 후보와 달리 사용자가 직접 적은 항목은
    //   같은 문장을 일부러 두 번 적을 수 있다(store.ts의 addTasks 주석과 같은 규칙).
  };
}

/** 제목과 기한이 모두 같은 항목. 등록을 막지는 않고 카드에서 알리기만 한다. */
function findDuplicate(tasks: ScheduleTask[], title: string, date: string): ScheduleTask | null {
  const needle = compact(title);
  return tasks.find(task => compact(task.title) === needle && task.dueDate === date && task.status !== 'done') ?? null;
}

/**
 * 의도와 저장된 목록으로 실행 계획을 세운다.
 *
 * @param typed 사용자가 친 문장. 등록 항목의 `due.text`로 남는다.
 */
export function planFor(
  intent: ScheduleIntent,
  tasks: ScheduleTask[],
  typed: string,
): SchedulePlan {
  switch (intent.intent) {
    case 'schedule.create': {
      const { title, date, time, notes } = intent.payload;
      return {
        kind: 'create',
        task: toNewTask(title, date, time, notes, typed),
        duplicate: date ? findDuplicate(tasks, title, date) : null,
      };
    }

    case 'schedule.list': {
      const { from, to, query } = intent.payload;
      if (!tasks.length) return { kind: 'none', problem: 'empty-board' };
      const needle = compact(query ?? '');
      const hit = tasks.filter(task =>
        inRange(task, from, to) && (!needle || compact(task.title).includes(needle)));
      // 끝난 일은 목록에서 빼고 건수만 알린다. 남은 일을 보려고 부른 명령이다.
      const live = hit.filter(task => task.status !== 'done');
      return {
        kind: 'list',
        tasks: live.sort(byDue),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(query ? { query } : {}),
        doneHidden: hit.length - live.length,
      };
    }

    case 'schedule.update': {
      const targets = findByTitle(tasks, intent.payload.matchTitle).sort(byDue);
      if (!targets.length) return { kind: 'none', problem: 'no-match' };
      return { kind: 'update', targets, preselected: preselect(targets), changes: intent.payload.changes };
    }

    case 'schedule.delete': {
      const { matchTitle, from, to } = intent.payload;
      const byTitle = matchTitle ? findByTitle(tasks, matchTitle) : tasks;
      const targets = byTitle.filter(task => inRange(task, from, to)).sort(byDue);
      if (!targets.length) return { kind: 'none', problem: 'no-match' };
      // ★ 제목으로 딱 하나를 지목했을 때만 미리 체크한다. 범위 삭제는 되돌릴 수 없으므로
      //   "이번 주 전부 지워"라고 말했더라도 무엇이 지워지는지 보고 고르게 한다.
      return { kind: 'delete', targets, preselected: matchTitle ? preselect(targets) : [] };
    }

    default:
      return { kind: 'none', problem: 'not-a-command', ...(intent.reason ? { reason: intent.reason } : {}) };
  }
}

/** 기한이 이른 것부터. 기한 미정은 뒤로. */
function byDue(a: ScheduleTask, b: ScheduleTask): number {
  if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  return a.createdAt - b.createdAt;
}

/* ── 수정 내용 적용 ────────────────────────────────────── */

/** 저장소에 넘길 변경분. `changes`를 항목 한 건에 맞춰 편다. */
export function patchFor(task: ScheduleTask, changes: TaskChanges): Partial<Omit<ScheduleTask, 'id'>> {
  const patch: Partial<Omit<ScheduleTask, 'id'>> = {};
  if (changes.title) patch.title = changes.title;
  if (changes.notes !== undefined) patch.notes = changes.notes;
  if (changes.status) patch.status = changes.status;

  // 기한과 시각은 함께 움직인다. `due`를 통째로 새로 만들어야 색인(dueDate)이 어긋나지 않는다.
  if (changes.date !== undefined || changes.time !== undefined) {
    const date = changes.date !== undefined ? changes.date : task.dueDate;
    if (!date) {
      // 기한을 지웠다. 시각만 남겨 두면 놓을 자리가 없는 기한이 된다.
      patch.due = undefined;
      patch.dueDate = '';
    } else {
      const time = changes.time !== undefined ? changes.time : task.due?.time;
      patch.due = {
        date,
        ...(time ? { time } : {}),
        // 사용자가 직접 고친 값이다. 공문 표기를 그대로 둘 수 없다.
        text: time ? `${date} ${time}` : date,
        yearInferred: false,
      };
      patch.dueDate = date;
    }
  }
  return patch;
}

/** 수정 카드에 보일 "무엇이 어떻게 바뀌는가" 한 줄씩. */
export function changeLines(task: ScheduleTask, changes: TaskChanges): Array<{ field: string; before: string; after: string }> {
  const lines: Array<{ field: string; before: string; after: string }> = [];
  const patch = patchFor(task, changes);

  if (patch.title !== undefined && patch.title !== task.title) {
    lines.push({ field: 'title', before: task.title, after: patch.title });
  }
  if (patch.dueDate !== undefined) {
    const label = (date: string, time?: string) => (date ? (time ? `${date} ${time}` : date) : '');
    const before = label(task.dueDate, task.due?.time);
    const after = label(patch.dueDate, patch.due?.time);
    if (before !== after) lines.push({ field: 'due', before, after });
  }
  if (patch.notes !== undefined && patch.notes !== (task.notes ?? '')) {
    lines.push({ field: 'notes', before: task.notes ?? '', after: patch.notes });
  }
  if (patch.status && patch.status !== task.status) {
    lines.push({ field: 'status', before: task.status, after: patch.status });
  }
  return lines;
}

/** 목록·카드에 쓰는 한 줄 요약. 모델이 아니라 코드가 만든다. */
export function oneLine(task: ScheduleTask, now: Date = new Date()): string {
  const days = task.dueDate ? daysUntil(task.dueDate, now) : null;
  const when = task.dueDate
    ? `${task.dueDate}${task.due?.time ? ` ${task.due.time}` : ''}${days === null ? '' : ` (D${days === 0 ? '-DAY' : days > 0 ? `-${days}` : `+${-days}`})`}`
    : '기한 미정';
  return `${task.title} · ${when}`;
}
