// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderMarkdown } from '@/lib/markdown';
import { pageAnchors } from '@/lib/extract/pdf-text';
import {
  buildWorkPlanHandoff,
  handoffPrompt,
  parseWorkPlan,
  renderWorkPlan,
  pdfPageOf,
  sourceLocation,
  WORK_PLAN_SCHEMA,
  type WorkPlan,
} from './work-plan';

const notice = [
  '제목 2026년도 스마트 행정 혁신사업 수요조사 회신 요청',
  '1. 관련: 행정안전부 디지털정부혁신실-1234(2026. 9. 25.)',
  '2. 스마트 행정 혁신사업 수요를 다음과 같이 조사하오니 회신하여 주시기 바랍니다.',
  '가. 제출 기한: 2026. 10. 15.(목) 18:00까지 제출하여 주시기 바랍니다.',
  '나. 제출 서식: 별지 제2호 서식에 사업별 예산과 추진 일정을 작성하고 담당자 연락처를 기재한다.',
  '3. 신청 대상은 관내 소재 기업으로 한정하며 개인은 신청할 수 없다.',
].join('\n');

const plan: WorkPlan = {
  summary: '스마트 행정 혁신사업 수요조사 회신 요청',
  requester: '행정안전부 디지털정부혁신실',
  requestType: '회신·제출',
  actions: [
    { task: '수요조사 회신', evidence: '스마트 행정 혁신사업 수요를 다음과 같이 조사하오니 회신하여 주시기 바랍니다.' },
    { task: '개인 신청 접수', evidence: '신청 대상은 관내 소재 기업으로 한정하며 개인도 신청할 수 있다.' },
  ],
  deliverables: ['별지 제2호 서식'],
  deadlines: [{ date: '2026. 10. 15.', what: '수요조사 제출', evidence: '제출 기한: 2026. 10. 15.(목) 18:00까지 제출하여 주시기 바랍니다.' }],
  contact: '',
  conditions: [{ text: '관내 기업 한정(개인 제외)', evidence: '신청 대상은 관내 소재 기업으로 한정하며 개인은 신청할 수 없다.' }],
  requirements: [
    { item: '별지 제2호 서식', evidence: '별지 제2호 서식에 사업별 예산과 추진 일정을 작성하고 담당자 연락처를 기재한다.' },
    { item: '산출근거', evidence: '산출근거를 붙임으로 제출한다.' },
  ],
};

it('조치카드 스키마를 그대로 품고 업무계획 항목을 더한다', () => {
  expect(WORK_PLAN_SCHEMA.required).toEqual(expect.arrayContaining(['summary', 'actions', 'deadlines', 'requester', 'requestType', 'conditions', 'requirements']));
  expect(WORK_PLAN_SCHEMA.properties.requestType.enum).toEqual(['회신·제출', '시행·조치', '참고·알림']);
});

it('모델 답을 읽고, 빠진 항목은 비우며 갈래 밖의 값은 참고·알림으로 낮춘다', () => {
  const parsed = parseWorkPlan(JSON.stringify({
    summary: '요지', actions: [], deliverables: [], deadlines: [], contact: '',
    requestType: '긴급', requirements: [{ item: '  연락처 ', evidence: '문장' }, { item: '', evidence: '버림' }],
  }));
  expect(parsed).toMatchObject({ requester: '', requestType: '참고·알림', conditions: [], requirements: [{ item: '연락처', evidence: '문장' }] });
  expect(parseWorkPlan('JSON 아님')).toBeNull();
});

it('근거의 위치를 조문 또는 공문 항목 번호로 짓고, 본문 속 인용은 조문 제목으로 보지 않는다', () => {
  const rule = ['제3조(목적) 이 규정은 목적을 정한다.', '제4조(제출 의무) ① 시장은 매년 계획을 제출하여야 한다. ② 계획에는 예산을 포함한다.', '같은 법 제9조에 따라 보고한다.'].join('\n');
  expect(sourceLocation('계획에는 예산을 포함한다.', rule)).toBe('제4조 제2항');
  expect(sourceLocation('① 시장은 매년 계획을 제출하여야 한다.', rule)).toBe('제4조 제1항');
  // "같은 법 제9조에 따라"는 조문 제목이 아니다. 앞의 제4조에 속한다.
  expect(sourceLocation('같은 법 제9조에 따라 보고한다.', rule)).toBe('제4조 제2항');
  expect(sourceLocation('별지 제2호 서식에 사업별 예산과 추진 일정을 작성하고 담당자 연락처를 기재한다.', notice)).toBe('2. 나.');
  // 문장이 스스로 번호로 시작하면 위치를 따로 적지 않는다. 날짜의 "2026."은 항목 번호가 아니다.
  expect(sourceLocation('3. 신청 대상은 관내 소재 기업으로 한정하며 개인은 신청할 수 없다.', notice)).toBeNull();
  expect(sourceLocation('원문에 없는 문장', notice)).toBeNull();
});

it('카드는 네 칸으로 그리고, 뜻이 뒤집힌 근거는 싣지 않으며 조건은 판정하지 않는다', () => {
  const md = renderWorkPlan('수요조사 회신 요청', plan, notice, { reportDate: '2026-09-29' });
  expect(md).toContain('**1. 수신 요청**');
  expect(md).toContain('요청 기관: 행정안전부 디지털정부혁신실 (원문 확인)');
  expect(md).toContain('목록 일자: 2026-09-29');
  expect(md).toContain('요청 유형: 회신·제출');
  expect(md).toContain('수요조사 회신 (원문 확인)');
  // "개인도 신청할 수 있다"는 원문과 반대 뜻이다.
  expect(md).toContain('개인 신청 접수 (원문에서 찾지 못함)');
  expect(md).toContain('**3. 근거**');
  expect(md).toContain('[2\\. 나.] 나. 제출 서식');
  expect(md).toContain('원문에서 찾지 못한 근거 2건은 싣지 않았습니다.');
  expect(md).toContain('해당 여부는 직접 확인하세요');
  expect(md).toContain('관내 기업 한정\\(개인 제외\\) (원문 확인)');
  expect(md).toContain('☐ 별지 제2호 서식 (원문 확인)');
  expect(md).toContain('☐ 산출근거 (원문에서 찾지 못함)');
  // 자동 등록을 말하지 않는다. 일정은 확인 카드에서만 들어간다.
  expect(md).not.toContain('자동 등록');
  const html = renderMarkdown(md);
  expect(html).toContain('2026. 10. 15.');
});

it('발신 기관을 모델이 못 뽑으면 목록의 발신 칸을 쓰고 그 출처를 밝힌다', () => {
  const md = renderWorkPlan('제목', { ...plan, requester: '' }, notice, { sender: '행정안전부' });
  expect(md).toContain('요청 기관: 행정안전부 (목록의 발신 칸)');
});

it('기안 코파일럿으로 넘길 묶음과 작성 요청에는 확인한 기한만 싣고 문의처는 싣지 않는다', () => {
  const handoff = buildWorkPlanHandoff('수요조사 회신 요청', { ...plan, contact: '051-000-0000',
    deadlines: [...plan.deadlines, { date: '11월 3일', what: '추가 제출', evidence: '' }] }, notice, 'https://onnara.test/doc');
  expect(handoff.requirements).toEqual([{ text: '별지 제2호 서식', verified: true }, { text: '산출근거', verified: false }]);
  expect(handoff.conditions).toEqual([{ text: '관내 기업 한정(개인 제외)', verified: true }]);
  expect(handoff.deadlines).toEqual([{ text: '2026. 10. 15. · 수요조사 제출', verified: true }, { text: '11월 3일 · 추가 제출', verified: false }]);
  expect(handoff.source).toEqual({ title: '수요조사 회신 요청', url: 'https://onnara.test/doc' });

  const prompt = handoffPrompt(handoff, ['별지 제2호 서식']);
  expect(prompt).toContain("'수요조사 회신 요청'에 대한 회신 공문 초안");
  expect(prompt).toContain('· 별지 제2호 서식');
  expect(prompt).not.toContain('산출근거');
  expect(prompt).toContain('기한: 2026. 10. 15. · 수요조사 제출');
  expect(prompt).not.toContain('11월 3일');
  expect(prompt).not.toContain('051-000-0000');
});

it('모델이 빠뜨린 원문 기한은 코드가 찾아 넘긴다', () => {
  const handoff = buildWorkPlanHandoff('제목', { ...plan, deadlines: [] }, notice);
  expect(handoff.deadlines).toHaveLength(1);
  expect(handoff.deadlines[0]).toMatchObject({ verified: true });
  expect(handoff.deadlines[0]!.text).toContain('2026. 10. 15.');
});

it('본문이 PDF 한 건이면 근거 위치에 쪽 번호를 붙이고, 머리글이 같은 쪽들도 순서대로 가린다', () => {
  const pages = [
    '스마트 행정 혁신사업 안내\n제1조(목적) 이 지침은 사업 추진에 필요한 사항을 정한다.',
    '스마트 행정 혁신사업 안내\n제4조(제출 의무) ① 시장은 수요조사서를 제출하여야 한다.',
    '스마트 행정 혁신사업 안내\n제7조(평가) 제출된 계획은 평가위원회가 심사한다.',
  ];
  const source = `[본문 PDF · 3쪽]\n${pages.join('\n\n')}`;
  const anchors = pageAnchors(pages);
  expect(pdfPageOf('시장은 수요조사서를 제출하여야 한다.', source, anchors)).toBe(2);
  expect(pdfPageOf('제출된 계획은 평가위원회가 심사한다.', source, anchors)).toBe(3);
  expect(sourceLocation('시장은 수요조사서를 제출하여야 한다.', source, anchors)).toBe('2쪽 · 제4조 제1항');
  // 표식이 없으면(HTML 본문, PDF 두 건) 쪽을 적지 않는다.
  expect(sourceLocation('시장은 수요조사서를 제출하여야 한다.', source)).toBe('제4조 제1항');
  const md = renderWorkPlan('안내', { ...plan, actions: [{ task: '제출', evidence: '시장은 수요조사서를 제출하여야 한다.' }], deadlines: [], requirements: [], conditions: [] }, source, {}, anchors);
  expect(md).toContain('[2쪽 · 제4조 제1항]');
});

it('모델이 빈칸 대신 적은 "없음"은 항목으로 만들지 않고, 알림인데 요구사항이 나오면 그 사실을 알린다', () => {
  const parsed = parseWorkPlan(JSON.stringify({
    summary: '승강기 점검 알림', actions: [], deliverables: ['없음'], deadlines: [], contact: '해당 없음',
    requester: '', requestType: '참고·알림', conditions: [], requirements: [{ item: '없음', evidence: '' }, { item: '계단 이용', evidence: '점검 시간에는 계단을 이용하여 주시기 바랍니다.' }],
  }))!;
  expect(parsed.deliverables).toEqual([]);
  expect(parsed.contact).toBe('');
  expect(parsed.requirements.map(item => item.item)).toEqual(['계단 이용']);
  const md = renderWorkPlan('승강기 점검 알림', parsed, '2. 점검 시간에는 계단을 이용하여 주시기 바랍니다. 끝.');
  expect(md).toContain('알림 공문으로 보여 회신이 필요 없을 수 있습니다');
});
