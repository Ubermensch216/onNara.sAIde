/**
 * `@일정` 실행 계획 테스트.
 *
 * ★ 여기서 고정하는 것은 "무엇이 일어날 것인가"이지 "무엇이 저장됐는가"가 아니다.
 *   planFor는 아무것도 쓰지 않는다. 특히 **무엇이 미리 체크되는가**가 핵심이다 —
 *   체크된 것만 실행되므로, 그 기본값이 곧 안전선이다.
 */

import { describe, expect, it } from 'vitest';
import { changeLines, findByTitle, oneLine, patchFor, planFor } from './resolve';
import type { ScheduleIntent } from './intent';
import type { ScheduleTask } from './task';

/** 2026-09-19 (토) */
const NOW = new Date(2026, 8, 19);

let seq = 0;
function task(partial: Partial<ScheduleTask> & { title: string }): ScheduleTask {
  seq += 1;
  const dueDate = partial.dueDate ?? '';
  return {
    id: seq,
    status: 'todo',
    dueDate,
    ...(dueDate ? { due: { date: dueDate, text: dueDate, yearInferred: false } } : {}),
    createdAt: seq,
    updatedAt: seq,
    ...partial,
  };
}

const BOARD: ScheduleTask[] = [
  task({ id: 1, title: '예산안 제출', dueDate: '2026-09-20' }),
  task({ id: 2, title: '실적보고서 제출', dueDate: '2026-09-30' }),
  task({ id: 3, title: '실적보고서 검토', dueDate: '2026-10-05' }),
  task({ id: 4, title: '교육 신청 접수' }),
  task({ id: 5, title: '지난달 정산', dueDate: '2026-08-31', status: 'done', completedAt: 10 }),
];

describe('planFor — 등록', () => {
  it('등록 후보를 만든다 (아직 저장하지 않는다)', () => {
    const intent: ScheduleIntent = {
      intent: 'schedule.create',
      payload: { title: '감사 자료 제출', date: '2026-09-25', time: '18:00' },
    };
    const plan = planFor(intent, BOARD, '25일 18시까지 감사 자료 제출');
    expect(plan).toMatchObject({
      kind: 'create',
      task: { title: '감사 자료 제출', dueDate: '2026-09-25', status: 'todo' },
      duplicate: null,
    });
    if (plan.kind !== 'create') throw new Error('create여야 한다');
    expect(plan.task.due).toEqual({
      date: '2026-09-25',
      time: '18:00',
      // ★ 사용자가 친 문장을 그대로 남긴다. 목록만 보고도 무슨 말로 넣었는지 되짚는다.
      text: '25일 18시까지 감사 자료 제출',
      yearInferred: false,
    });
  });

  it('★ 사용자가 직접 적은 항목에는 dedupeKey를 붙이지 않는다', () => {
    // 공문에서 뽑은 후보와 달리, 같은 문장을 일부러 두 번 적을 수 있다.
    const plan = planFor({ intent: 'schedule.create', payload: { title: 'x', date: '' } }, BOARD, 'x');
    if (plan.kind !== 'create') throw new Error('create여야 한다');
    expect(plan.task.dedupeKey).toBeUndefined();
    expect(plan.task.due).toBeUndefined();
    expect(plan.task.dueDate).toBe('');
  });

  it('같은 제목·같은 기한이 있으면 알린다 (막지는 않는다)', () => {
    const plan = planFor(
      { intent: 'schedule.create', payload: { title: '예산안 제출', date: '2026-09-20' } },
      BOARD, '내일 예산안 제출',
    );
    if (plan.kind !== 'create') throw new Error('create여야 한다');
    expect(plan.duplicate?.id).toBe(1);
  });
});

describe('planFor — 조회', () => {
  it('범위 안의 남은 일만 이른 기한부터', () => {
    const plan = planFor(
      { intent: 'schedule.list', payload: { from: '2026-09-01', to: '2026-09-30' } },
      BOARD, '이번 달 일정',
    );
    if (plan.kind !== 'list') throw new Error('list여야 한다');
    expect(plan.tasks.map(t => t.id)).toEqual([1, 2]);
  });

  it('★ 기한 미정 항목은 어떤 범위에도 들지 않는다', () => {
    const plan = planFor(
      { intent: 'schedule.list', payload: { from: '2020-01-01', to: '2030-12-31' } },
      BOARD, '전체 일정',
    );
    if (plan.kind !== 'list') throw new Error('list여야 한다');
    expect(plan.tasks.map(t => t.id)).not.toContain(4);
  });

  it('★ 끝난 일은 목록에서 빼고 건수만 알린다', () => {
    const plan = planFor(
      { intent: 'schedule.list', payload: { from: '2026-08-01', to: '2026-08-31' } },
      BOARD, '지난달 일정',
    );
    if (plan.kind !== 'list') throw new Error('list여야 한다');
    expect(plan.tasks).toEqual([]);
    expect(plan.doneHidden).toBe(1);
  });

  it('제목 검색은 범위 없이도 된다 (기한 미정도 걸린다)', () => {
    const plan = planFor({ intent: 'schedule.list', payload: { query: '실적' } }, BOARD, '실적 관련 뭐 남았지');
    if (plan.kind !== 'list') throw new Error('list여야 한다');
    expect(plan.tasks.map(t => t.id)).toEqual([2, 3]);
  });

  it('등록된 일정이 하나도 없으면 빈 목록이 아니라 안내다', () => {
    expect(planFor({ intent: 'schedule.list', payload: {} }, [], '일정 보여줘'))
      .toEqual({ kind: 'none', problem: 'empty-board' });
  });
});

describe('planFor — 수정', () => {
  it('하나만 걸리면 미리 체크한다', () => {
    const plan = planFor(
      { intent: 'schedule.update', payload: { matchTitle: '예산안', changes: { date: '2026-09-22' } } },
      BOARD, '예산안 22일로 미뤄줘',
    );
    expect(plan).toMatchObject({ kind: 'update', preselected: [1] });
  });

  it('★ 여럿이 걸리면 하나도 체크하지 않는다 (고르는 것은 사용자다)', () => {
    const plan = planFor(
      { intent: 'schedule.update', payload: { matchTitle: '실적보고서', changes: { date: '2026-10-02' } } },
      BOARD, '실적보고서 미뤄줘',
    );
    if (plan.kind !== 'update') throw new Error('update여야 한다');
    expect(plan.targets.map(t => t.id)).toEqual([2, 3]);
    expect(plan.preselected).toEqual([]);
  });

  it('맞는 항목이 없으면 계획을 세우지 않는다', () => {
    expect(planFor(
      { intent: 'schedule.update', payload: { matchTitle: '없는일', changes: { status: 'done' } } },
      BOARD, '없는일 완료',
    )).toEqual({ kind: 'none', problem: 'no-match' });
  });

  it('완료한 항목도 찾는다 (완료 취소가 가능해야 한다)', () => {
    expect(findByTitle(BOARD, '정산').map(t => t.id)).toEqual([5]);
  });
});

describe('planFor — 삭제', () => {
  it('제목으로 하나를 지목하면 미리 체크한다', () => {
    expect(planFor({ intent: 'schedule.delete', payload: { matchTitle: '교육 신청' } }, BOARD, '교육 신청 지워'))
      .toMatchObject({ kind: 'delete', preselected: [4] });
  });

  it('★ 범위 삭제는 "전부"라고 말했어도 미리 체크하지 않는다', () => {
    // 되돌릴 수 없다. 무엇이 지워지는지 보고 고르게 한다.
    const plan = planFor(
      { intent: 'schedule.delete', payload: { from: '2026-09-01', to: '2026-10-31' } },
      BOARD, '9~10월 일정 전부 지워',
    );
    if (plan.kind !== 'delete') throw new Error('delete여야 한다');
    expect(plan.targets.map(t => t.id)).toEqual([1, 2, 3]);
    expect(plan.preselected).toEqual([]);
  });

  it('제목과 범위를 함께 주면 둘 다 만족하는 것만', () => {
    const plan = planFor(
      { intent: 'schedule.delete', payload: { matchTitle: '실적보고서', from: '2026-10-01', to: '2026-10-31' } },
      BOARD, '10월 실적보고서 지워',
    );
    expect(plan).toMatchObject({ kind: 'delete', preselected: [3] });
  });
});

describe('planFor — 명령이 아닐 때', () => {
  it('까닭을 들고 물러난다', () => {
    expect(planFor({ intent: 'chat', payload: {}, reason: 'parse_failure' }, BOARD, '고마워'))
      .toEqual({ kind: 'none', problem: 'not-a-command', reason: 'parse_failure' });
  });
});

describe('patchFor / changeLines', () => {
  const target = BOARD[1]!; // 실적보고서 제출 · 2026-09-30

  it('기한을 고치면 색인 필드도 함께 맞춘다', () => {
    const patch = patchFor(target, { date: '2026-10-02' });
    expect(patch.dueDate).toBe('2026-10-02');
    expect(patch.due).toMatchObject({ date: '2026-10-02', yearInferred: false });
  });

  it('★ 기한을 지우면 시각도 함께 지운다', () => {
    const withTime = { ...target, due: { date: '2026-09-30', time: '18:00', text: 'x', yearInferred: false } };
    const patch = patchFor(withTime, { date: '' });
    expect(patch.dueDate).toBe('');
    expect(patch.due).toBeUndefined();
  });

  it('시각만 고치면 날짜는 그대로 둔다', () => {
    const patch = patchFor(target, { time: '09:00' });
    expect(patch.due).toMatchObject({ date: '2026-09-30', time: '09:00' });
  });

  it('바뀌지 않는 값은 대비표에 넣지 않는다', () => {
    expect(changeLines(target, { title: '실적보고서 제출' })).toEqual([]);
    expect(changeLines(target, { date: '2026-10-02' }).map(l => l.field)).toEqual(['due']);
    expect(changeLines(target, { status: 'done' }).map(l => l.field)).toEqual(['status']);
  });
});

describe('oneLine', () => {
  it('기한과 D-day를 붙인다', () => {
    expect(oneLine(BOARD[0]!, NOW)).toBe('예산안 제출 · 2026-09-20 (D-1)');
    expect(oneLine(BOARD[4]!, NOW)).toBe('지난달 정산 · 2026-08-31 (D+19)');
  });

  it('기한이 없으면 그렇게 적는다', () => {
    expect(oneLine(BOARD[3]!, NOW)).toBe('교육 신청 접수 · 기한 미정');
  });
});
