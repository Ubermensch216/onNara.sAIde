/**
 * 일정 항목(계획서 S07 · P4-4). 공문에서 뽑은 "내가 할 일"과 그 기한.
 *
 * ★ 이것은 캘린더 이벤트가 아니라 **업무 항목**이다. 회의 시간이 아니라 처리 기한이 중심이고,
 *   대부분 종일 기한이며, 완료 여부가 있다. 그래서 시작·종료 시각을 가진 이벤트 모델 대신
 *   기한 하나 + 상태를 쓴다. (참조 프로젝트의 달력은 시작·종료가 있는 약속 모델이다.)
 *
 * ★ 근거를 지우지 않는다. 어느 공문의 어느 문장에서 나온 할 일인지, 그 문장이 원문에서
 *   확인됐는지를 항목에 함께 저장한다. 사용자가 며칠 뒤 목록만 보고도 되짚을 수 있어야 한다.
 */

import type { TaskDue } from './due-date';

export type TaskStatus = 'todo' | 'done';

/** 이 할 일이 나온 공문. 목록에서 원문으로 되돌아가는 통로다. */
export interface TaskSource {
  docTitle: string;
  /** 문서 상세 화면 주소. 온나라는 세션에 따라 열리지 않을 수 있어 참고용이다. */
  docUrl?: string;
  /** 어느 대화에서 나왔는가. 대화를 지워도 일정은 남는다(고아 참조 허용). */
  conversationId?: number;
}

export interface ScheduleTask {
  id: number;
  /** 할 일 한 줄. 카드의 actions[].task 또는 사용자가 직접 쓴 문장. */
  title: string;
  status: TaskStatus;
  /**
   * 색인·정렬용 기한 날짜(YYYY-MM-DD). 기한이 없으면 빈 문자열.
   *
   * ★ due 안에 두지 않고 밖으로 꺼낸 이유는 Dexie 색인 때문이다. 중첩 객체의 필드로는
   *   범위 조회(다음 7일 등)를 걸 수 없다.
   */
  dueDate: string;
  due?: TaskDue;
  /** 근거가 된 원문 문장. */
  evidence?: string;
  /** 그 문장을 원문에서 찾았는가(핵심·조치사항 카드의 `원문 확인`과 같은 판정). */
  evidenceVerified?: boolean;
  /** 제출물 이름. */
  deliverables?: string[];
  /** 문의처(부서·담당자·전화). */
  contact?: string;
  /** 사용자가 덧붙인 메모. */
  notes?: string;
  source?: TaskSource;
  /**
   * 같은 공문의 같은 할 일을 두 번 등록하지 않기 위한 키.
   * 사용자가 직접 만든 항목에는 없다(같은 문장을 일부러 두 번 적을 수 있다).
   */
  dedupeKey?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** 저장 전 항목. id·시각은 저장소가 붙인다. */
export type NewScheduleTask = Omit<ScheduleTask, 'id' | 'createdAt' | 'updatedAt'> & { createdAt?: number };

/* ── D-day ────────────────────────────────────────────── */

export function todayISO(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 오늘부터 기한까지 남은 날수. 오늘이면 0, 지났으면 음수.
 *
 * ★ 시각이 아니라 날짜로 센다. 오늘 오전 9시가 기한이어도 오늘은 D-DAY지 D-1이 아니다.
 */
export function daysUntil(dateISO: string, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO ?? ''));
  if (!match) return null;
  const due = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((due - today) / 86_400_000);
}

/** 화면에 쓰는 D-day 표기. 지난 기한은 D+n으로 남긴다 — 숨기면 놓친 기한을 모른다. */
export function ddayLabel(days: number): string {
  if (days === 0) return 'D-DAY';
  return days > 0 ? `D-${days}` : `D+${-days}`;
}

export type TaskBucket = 'overdue' | 'today' | 'soon' | 'later' | 'someday' | 'done';

/**
 * 목록을 나눌 구간. 좁은 사이드패널에서는 달력 격자보다 이 구분이 읽기 쉽다.
 * soon = 내일부터 7일 이내.
 */
export function bucketOf(task: ScheduleTask, now: Date = new Date()): TaskBucket {
  if (task.status === 'done') return 'done';
  const days = task.dueDate ? daysUntil(task.dueDate, now) : null;
  if (days === null) return 'someday';
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= 7 ? 'soon' : 'later';
}

/** 급한 것이 위로. 기한 없는 항목은 기한 있는 항목 뒤, 완료는 맨 뒤. */
export function compareTasks(a: ScheduleTask, b: ScheduleTask): number {
  if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
  if (a.status === 'done') return (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt);
  if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  // 같은 날이면 시각이 있는 쪽이 먼저다(시각이 없으면 종일 기한).
  const time = (task: ScheduleTask) => task.due?.time ?? '99:99';
  return time(a).localeCompare(time(b)) || a.createdAt - b.createdAt;
}

/** 구간별로 나눈 목록. 각 구간 안은 compareTasks 순서다. */
export function groupTasks(tasks: ScheduleTask[], now: Date = new Date()): Record<TaskBucket, ScheduleTask[]> {
  const groups: Record<TaskBucket, ScheduleTask[]> = { overdue: [], today: [], soon: [], later: [], someday: [], done: [] };
  for (const task of [...tasks].sort(compareTasks)) groups[bucketOf(task, now)].push(task);
  return groups;
}

/** 탭 배지에 쓰는 수 — 지난 기한과 오늘·이번 주 기한의 합. */
export function urgentCount(tasks: ScheduleTask[], now: Date = new Date()): number {
  return tasks.filter(task => {
    const bucket = bucketOf(task, now);
    return bucket === 'overdue' || bucket === 'today' || bucket === 'soon';
  }).length;
}

/** 공문 제목 + 할 일 문장으로 만드는 중복 등록 방지 키. */
export function dedupeKeyOf(docTitle: string, title: string): string {
  const compact = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/g, '');
  return `${compact(docTitle)}|${compact(title)}`;
}
