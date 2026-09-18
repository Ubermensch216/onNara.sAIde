import { describe, expect, it } from 'vitest';
import type { ActionCard } from '@/lib/ai/action-card';
import { buildTaskCandidates } from './candidates';

const REPORT_DAY = new Date(2026, 8, 18); // 문서 보고일자 2026-09-18

const SOURCE = [
  '수신 ○○과장',
  '제목 2026년 지역공동체 공모사업 신청 안내',
  '1. 관련: 행정안전부 지역정책과-1234(2026. 9. 1.)',
  '2. 2026년 지역공동체 공모사업을 안내하니 기한 내 신청하여 주시기 바랍니다.',
  '  가. 제출서류: 사업계획서 1부, 예산내역서 1부',
  '3. 붙임 서식을 작성하여 2026. 9. 30.(수)까지 제출하여 주시기 바랍니다.',
  '4. 문의: 기획예산과 홍길동 주무관(051-000-0000)',
].join('\n');

const PROOF = '3. 붙임 서식을 작성하여 2026. 9. 30.(수)까지 제출하여 주시기 바랍니다.';

/** 기한 문장이 없는 공문. 기한과 무관한 판정을 볼 때 쓴다. */
const NOTICE = '2. 부서 의견을 취합하여 회신하여 주시기 바랍니다. 별도 기한은 없습니다.';

function card(patch: Partial<ActionCard> = {}): ActionCard {
  return {
    summary: '공모사업 신청 안내',
    actions: [],
    deliverables: ['사업계획서', '예산내역서'],
    deadlines: [],
    contact: '기획예산과 홍길동 주무관(051-000-0000)',
    ...patch,
  };
}

describe('buildTaskCandidates', () => {
  it('할 일과 기한이 짝이면 한 건으로 묶는다', () => {
    const candidates = buildTaskCandidates(card({
      actions: [{ task: '사업계획서와 예산내역서를 제출', evidence: PROOF }],
      deadlines: [{ date: '2026. 9. 30.(수)', what: '사업계획서와 예산내역서를 제출', evidence: PROOF }],
    }), SOURCE, REPORT_DAY);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      title: '사업계획서와 예산내역서를 제출',
      evidenceVerified: true,
      dueVerified: true,
      due: { date: '2026-09-30', yearInferred: false },
      deliverables: ['사업계획서', '예산내역서'],
      contact: '기획예산과 홍길동 주무관(051-000-0000)',
    });
  });

  it('문장이 조금 달라도 근거가 같으면 같은 일로 본다', () => {
    const candidates = buildTaskCandidates(card({
      actions: [{ task: '붙임 서식 작성 후 제출', evidence: PROOF }],
      deadlines: [{ date: '2026. 9. 30.', what: '제출 마감', evidence: PROOF }],
    }), SOURCE, REPORT_DAY);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.due?.date).toBe('2026-09-30');
  });

  it('기한이 없는 할 일도 후보로 남는다 — 기한 미정으로 관리한다', () => {
    const candidates = buildTaskCandidates(card({
      actions: [{ task: '부서 의견 취합', evidence: '2. 부서 의견을 취합하여 회신하여 주시기 바랍니다.' }],
    }), NOTICE, REPORT_DAY);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.due).toBeUndefined();
    expect(candidates[0]!.evidenceVerified).toBe(true);
  });

  it('★ 근거를 원문에서 찾지 못해도 후보를 지우지 않는다 — 판단은 사용자가 한다', () => {
    const candidates = buildTaskCandidates(card({
      actions: [{ task: '전 직원 교육 이수', evidence: '원문에 없는 문장이다.' }],
    }), NOTICE, REPORT_DAY);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.evidenceVerified).toBe(false);
  });

  it('★ 원문에 없는 날짜는 기한으로 붙되 확인되지 않았다고 표시한다', () => {
    const candidates = buildTaskCandidates(card({
      actions: [{ task: '결과 보고', evidence: PROOF }],
      deadlines: [{ date: '2026. 10. 15.', what: '결과 보고', evidence: PROOF }],
    }), SOURCE, REPORT_DAY);

    expect(candidates[0]!.due?.date).toBe('2026-10-15');
    expect(candidates[0]!.dueVerified).toBe(false);
  });

  it('★ 모델이 기한을 통째로 빠뜨리면 코드가 찾은 기한이 후보가 된다', () => {
    const candidates = buildTaskCandidates(card(), SOURCE, REPORT_DAY);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ due: { date: '2026-09-30' }, foundByCode: true, evidenceVerified: true });
  });

  it('모델이 이미 잡은 기한을 코드가 또 만들지 않는다', () => {
    const candidates = buildTaskCandidates(card({
      actions: [{ task: '붙임 서식 제출', evidence: PROOF }],
      deadlines: [{ date: '2026. 9. 30.(수)', what: '붙임 서식 제출', evidence: PROOF }],
    }), SOURCE, REPORT_DAY);

    expect(candidates.filter(item => item.foundByCode)).toHaveLength(0);
  });

  it('짝이 없는 기한은 그 자체로 후보가 된다', () => {
    const candidates = buildTaskCandidates(card({
      actions: [{ task: '부서 의견 취합', evidence: PROOF }],
      deadlines: [{ date: '2026. 9. 30.(수)', what: '붙임 서식 제출', evidence: PROOF }],
    }), SOURCE, REPORT_DAY);

    expect(candidates.map(item => item.title)).toEqual(['부서 의견 취합', '붙임 서식 제출']);
    expect(candidates[1]!.due?.date).toBe('2026-09-30');
  });

  it('연도가 없는 기한은 보고일자를 기준으로 해석하고 추론했다고 표시한다', () => {
    const candidates = buildTaskCandidates(card({
      actions: [{ task: '서식 제출', evidence: PROOF }],
      deadlines: [{ date: '9월 30일', what: '서식 제출', evidence: PROOF }],
    }), SOURCE, REPORT_DAY);

    expect(candidates[0]!.due).toMatchObject({ date: '2026-09-30', yearInferred: true });
  });

  it('할 일이 없는 단순 알림은 후보가 없다', () => {
    expect(buildTaskCandidates(card(), '단순 알림 공문입니다. 별도 조치는 없습니다.', REPORT_DAY)).toEqual([]);
  });

  it('같은 할 일이 두 번 나오면 한 건만 남긴다', () => {
    const candidates = buildTaskCandidates(card({
      actions: [{ task: '부서 의견 취합', evidence: PROOF }, { task: '부서 의견  취합', evidence: PROOF }],
    }), NOTICE, REPORT_DAY);

    expect(candidates).toHaveLength(1);
  });
});
