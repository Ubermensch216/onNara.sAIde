/**
 * `@일정`의 답변 문장. **모델이 아니라 코드가 쓴다.**
 *
 * ★ 이것이 참조 프로젝트(myAI)에서 가장 값진 결론이었다. 대화 모델에게는 저장된 일정이
 *   보이지 않으므로, 목록을 모델에게 쓰게 하면 그럴듯한 항목을 지어낸다. 모델은 분류만
 *   하고(intent.ts), 사용자가 읽는 문장은 IndexedDB에서 읽은 값으로 여기서 만든다.
 *
 * ★ 제목은 사용자와 공문에서 온 값이라 마크다운 특수문자가 섞일 수 있다. 그대로 흘리면
 *   목록이 깨지거나 엉뚱한 링크가 되므로 반드시 탈출시킨다.
 *
 * ★ 항목 제목은 일정 탭의 그 항목으로 가는 링크다. 화면을 대신 옮겨 주는 대신 길만
 *   놓아 둔다 — 결과를 읽고 다음 지시를 잇는 사람을 붙잡아 두지 않으려는 것이다.
 */

import { escapeMarkdownText } from '@/lib/downloads/links';
import { panelLink } from '@/lib/panel/links';
import { modeForRange } from './calendar';
import { daysUntil, ddayLabel, type ScheduleTask } from './task';
import type { SchedulePlan, PlanProblem } from './resolve';

/** 한 줄 항목. `- [제목](일정 탭으로) · 2026-09-30 18:00 · D-11` */
export function taskLine(task: ScheduleTask, now: Date = new Date()): string {
  const title = escapeMarkdownText(task.title);
  const parts = [`[${title}](${panelLink({ tab: 'schedule', taskId: task.id })})`];
  if (task.dueDate) {
    const days = daysUntil(task.dueDate, now);
    parts.push(`${task.dueDate}${task.due?.time ? ` ${task.due.time}` : ''}`);
    if (days !== null) parts.push(ddayLabel(days));
  } else {
    parts.push('기한 미정');
  }
  if (task.status === 'done') parts.push('완료');
  return `- ${parts.join(' · ')}`;
}

function rangeLabel(from?: string, to?: string): string {
  if (from && to) return from === to ? from : `${from} ~ ${to}`;
  if (from) return `${from} 이후`;
  if (to) return `${to} 까지`;
  return '전체 기간';
}

/** 조회 결과. 화면은 AI 창에 머무르고, 일정 탭으로 가는 길만 아래에 붙인다. */
export function renderList(plan: Extract<SchedulePlan, { kind: 'list' }>, now: Date = new Date()): string {
  const scope = [rangeLabel(plan.from, plan.to)];
  if (plan.query) scope.push(`'${escapeMarkdownText(plan.query)}' 검색`);
  const head = `**${scope.join(' · ')}** — ${plan.tasks.length}건`;

  // 범위를 물었으면 그 범위를 그대로 펼칠 길을, 아니면 목록 보기로 가는 길을 준다.
  const open = plan.from
    ? panelLink({ tab: 'schedule', cursor: plan.from, mode: modeForRange(plan.from, plan.to ?? plan.from) })
    : panelLink({ tab: 'schedule' });
  const goto = `\n\n[일정 탭에서 보기](${open})`;

  if (!plan.tasks.length) {
    const done = plan.doneHidden ? ` (완료한 ${plan.doneHidden}건은 제외했습니다)` : '';
    return `${head}\n\n이 조건에 해당하는 남은 일정이 없습니다.${done}${goto}`;
  }

  const lines = plan.tasks.map(task => taskLine(task, now));
  const done = plan.doneHidden ? `\n\n완료한 ${plan.doneHidden}건은 목록에서 제외했습니다.` : '';
  return `${head}\n\n${lines.join('\n')}${done}${goto}`;
}

/** 계획을 세우지 못했을 때의 안내. 무엇을 다시 말해야 하는지까지 적는다. */
export function renderProblem(problem: PlanProblem): string {
  switch (problem) {
    case 'empty-board':
      return '등록된 일정이 아직 없습니다. `@일정 내일까지 예산안 제출`처럼 말하면 등록 후보를 만들어 드립니다.';
    case 'no-match':
      return '말씀하신 일정을 찾지 못했습니다. 일정 탭에서 제목을 확인한 뒤 그 제목의 일부를 넣어 다시 말씀해 주세요.';
    case 'nothing-to-change':
      return '무엇을 바꿀지 알아듣지 못했습니다. `기한을 10월 2일로`처럼 바꿀 값을 함께 말씀해 주세요.';
    default:
      return [
        '일정 명령으로 이해하지 못했습니다. 이렇게 말씀해 보세요.',
        '',
        '- `@일정 내일까지 예산안 제출`  (등록)',
        '- `@일정 이번 주 일정 보여줘`  (조회)',
        '- `@일정 실적보고서 기한 10월 2일로 미뤄줘`  (수정)',
        '- `@일정 교육 신청 지워줘`  (삭제)',
      ].join('\n');
  }
}

/**
 * 실행하고 난 뒤 대화에 남기는 기록. 무엇이 실제로 바뀌었는지만 적는다.
 *
 * ★ 지운 항목에는 링크를 걸지 않는다. 눌러도 갈 곳이 없는 링크는 "아직 남아 있나?" 하는
 *   의심만 남긴다. 대신 그 자리가 비었음을 확인할 수 있게 탭으로 가는 길 하나를 둔다.
 */
export function renderOutcome(
  kind: 'create' | 'update' | 'delete',
  tasks: ScheduleTask[] | Array<{ title: string }>,
  now: Date = new Date(),
): string {
  const verb = kind === 'create' ? '등록' : kind === 'update' ? '수정' : '삭제';
  const head = `일정 ${tasks.length}건을 ${verb}했습니다.`;
  const lines = tasks.map(task =>
    'id' in task ? taskLine(task as ScheduleTask, now) : `- ${escapeMarkdownText(task.title)}`);
  const goto = kind === 'delete' ? `\n\n[일정 탭에서 보기](${panelLink({ tab: 'schedule' })})` : '';
  return `${head}\n\n${lines.join('\n')}${goto}`;
}

/** 아무것도 고르지 않고 닫았을 때. 기록을 남겨야 "눌렀는데 안 됐다"는 오해가 없다. */
export function renderCancelled(kind: 'create' | 'update' | 'delete'): string {
  const verb = kind === 'create' ? '등록' : kind === 'update' ? '수정' : '삭제';
  return `${verb}하지 않았습니다. 일정은 그대로입니다.`;
}
