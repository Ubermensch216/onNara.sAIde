/**
 * `@일정` 답변 문장 테스트.
 *
 * ★ 이 문장들은 모델을 거치지 않는다. 그러므로 여기서 고정한 내용이 곧 사용자가 보는
 *   내용이다 — 특히 제목 탈출은 목록이 깨지지 않게 하는 마지막 관문이다.
 */

import { describe, expect, it } from 'vitest';
import { renderCancelled, renderList, renderOutcome, renderProblem, taskLine } from './report';
import { parsePanelLink } from '@/lib/panel/links';
import type { ScheduleTask } from './task';

/** 2026-09-19 (토) */
const NOW = new Date(2026, 8, 19);

function task(partial: Partial<ScheduleTask> & { title: string; id: number }): ScheduleTask {
  return { status: 'todo', dueDate: '', createdAt: 0, updatedAt: 0, ...partial };
}

const 예산 = task({ id: 1, title: '예산안 제출', dueDate: '2026-09-20' });
const 실적 = task({
  id: 2, title: '실적보고서 제출', dueDate: '2026-09-30',
  due: { date: '2026-09-30', time: '18:00', text: '9. 30. 18:00까지', yearInferred: false },
});
const 미정 = task({ id: 3, title: '교육 신청 접수' });

describe('taskLine', () => {
  it('기한과 D-day를 붙인다', () => {
    expect(taskLine(예산, NOW)).toBe('- [예산안 제출](#saide-goto=schedule:task:1) · 2026-09-20 · D-1');
    expect(taskLine(실적, NOW)).toBe('- [실적보고서 제출](#saide-goto=schedule:task:2) · 2026-09-30 18:00 · D-11');
  });

  it('기한이 없으면 그렇게 적는다', () => {
    expect(taskLine(미정, NOW)).toBe('- [교육 신청 접수](#saide-goto=schedule:task:3) · 기한 미정');
  });

  it('지난 기한은 D+n으로 남긴다 (숨기면 놓친 기한을 모른다)', () => {
    expect(taskLine(task({ id: 4, title: '정산', dueDate: '2026-09-10' }), NOW))
      .toBe('- [정산](#saide-goto=schedule:task:4) · 2026-09-10 · D+9');
  });

  /*
   * ★ 제목이 곧 그 항목으로 가는 길이다. 실행했다고 화면을 옮기지 않으므로,
   *   링크가 없으면 방금 등록한 항목을 일정 탭에서 눈으로 찾아야 한다.
   */
  it('★ 제목은 그 항목으로 가는 링크다', () => {
    expect(parsePanelLink(/\]\((.+?)\)/.exec(taskLine(예산, NOW))![1]))
      .toEqual({ tab: 'schedule', taskId: 1 });
  });

  it('★ 제목의 마크다운 특수문자를 탈출시킨다 (링크 문법이 깨지지 않게)', () => {
    const line = taskLine(task({ id: 5, title: '[긴급] 예산*안* 제출' }), NOW);
    expect(line).toContain('\\[긴급\\]');
    expect(line).toContain('예산\\*안\\*');
    // 탈출하지 않으면 제목 속 대괄호가 링크 글자를 끊어 주소가 본문으로 새어 나온다.
    expect(line).toContain('](#saide-goto=schedule:task:5)');
  });
});

describe('renderList', () => {
  it('범위와 건수를 머리에 적고 항목을 편다', () => {
    const text = renderList(
      { kind: 'list', tasks: [예산, 실적], from: '2026-09-01', to: '2026-09-30', doneHidden: 0 },
      NOW,
    );
    expect(text).toContain('2026-09-01 ~ 2026-09-30');
    expect(text).toContain('2건');
    expect(text).toContain('예산안 제출');
    expect(text).toContain('실적보고서 제출');
  });

  it('하루짜리 범위는 한 번만 적는다', () => {
    expect(renderList({ kind: 'list', tasks: [예산], from: '2026-09-20', to: '2026-09-20', doneHidden: 0 }, NOW))
      .toContain('**2026-09-20** — 1건');
  });

  it('★ 비었을 때 "없다"고 분명히 말한다 (빈 목록은 오류처럼 보인다)', () => {
    const text = renderList({ kind: 'list', tasks: [], from: '2026-10-01', to: '2026-10-31', doneHidden: 0 }, NOW);
    expect(text).toContain('남은 일정이 없습니다');
  });

  it('숨긴 완료 건수를 알린다', () => {
    expect(renderList({ kind: 'list', tasks: [], doneHidden: 3 }, NOW)).toContain('완료한 3건');
    expect(renderList({ kind: 'list', tasks: [예산], doneHidden: 2 }, NOW)).toContain('완료한 2건');
  });

  it('검색어도 머리에 적는다', () => {
    expect(renderList({ kind: 'list', tasks: [예산], query: '예산', doneHidden: 0 }, NOW))
      .toContain("'예산' 검색");
  });

  /*
   * ★ 화면을 옮기지 않으므로 길은 답변 안에 있어야 한다. 물어본 범위를 그대로 펼쳐야
   *   "5월 일정"을 물은 사람이 5월을 본다.
   */
  it('★ 물어본 범위를 그대로 펼치는 링크를 붙인다', () => {
    const text = renderList({ kind: 'list', tasks: [예산], from: '2026-05-01', to: '2026-05-31', doneHidden: 0 }, NOW);
    const href = /\[일정 탭에서 보기\]\((.+?)\)/.exec(text)![1];
    expect(parsePanelLink(href)).toEqual({ tab: 'schedule', cursor: '2026-05-01', mode: 'month' });
  });

  it('하루를 물으면 일 보기로, 한 주면 주 보기로 연다', () => {
    const day = renderList({ kind: 'list', tasks: [예산], from: '2026-09-20', to: '2026-09-20', doneHidden: 0 }, NOW);
    expect(parsePanelLink(/\[일정 탭에서 보기\]\((.+?)\)/.exec(day)![1])).toMatchObject({ mode: 'day' });
    const week = renderList({ kind: 'list', tasks: [예산], from: '2026-09-13', to: '2026-09-19', doneHidden: 0 }, NOW);
    expect(parsePanelLink(/\[일정 탭에서 보기\]\((.+?)\)/.exec(week)![1])).toMatchObject({ mode: 'week' });
  });

  it('비어 있어도 길은 남긴다', () => {
    expect(renderList({ kind: 'list', tasks: [], from: '2026-10-01', to: '2026-10-31', doneHidden: 0 }, NOW))
      .toContain('[일정 탭에서 보기]');
  });
});

describe('renderProblem', () => {
  it('찾지 못했을 때 무엇을 해야 하는지 적는다', () => {
    expect(renderProblem('no-match')).toContain('제목');
  });

  it('★ 알아듣지 못했을 때 예문을 보여 준다 (문법을 외우게 하지 않는다)', () => {
    const text = renderProblem('not-a-command');
    expect(text).toContain('@일정 내일까지');
    expect(text).toContain('@일정 이번 주');
  });

  it('보드가 비었으면 등록하는 법을 알린다', () => {
    expect(renderProblem('empty-board')).toContain('@일정');
  });
});

describe('renderOutcome / renderCancelled', () => {
  it('무엇이 바뀌었는지만 적고, 그 항목으로 가는 길을 준다', () => {
    const text = renderOutcome('create', [예산], NOW);
    expect(text).toContain('일정 1건을 등록했습니다');
    expect(text).toContain('예산안 제출');
    expect(parsePanelLink(/\]\((.+?)\)/.exec(text)![1])).toEqual({ tab: 'schedule', taskId: 1 });
  });

  /*
   * ★ 지운 항목에 링크를 걸면 눌러도 갈 곳이 없다. "아직 남아 있나?" 하는 의심만 남는다.
   */
  it('삭제한 항목은 제목만 남고 링크가 없다', () => {
    const text = renderOutcome('delete', [{ title: '교육 신청 접수' }]);
    expect(text).toContain('- 교육 신청 접수');
    expect(text).not.toContain('schedule:task:');
    // 대신 그 자리가 비었음을 확인할 길 하나는 둔다.
    expect(text).toContain('[일정 탭에서 보기]');
  });

  it('★ 취소해도 기록을 남긴다 ("눌렀는데 안 됐다"는 오해를 막는다)', () => {
    expect(renderCancelled('delete')).toContain('삭제하지 않았습니다');
  });
});
