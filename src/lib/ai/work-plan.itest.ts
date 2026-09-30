/**
 * 업무계획 카드·요구사항 점검 — 실제 Ollama(gemma4:e2b) 점검. `npm run test:live`로만 돈다.
 *
 * 확인하는 것: 소형 모델이 늘어난 스키마(요청 기관·유형·조건·요구사항)를 지키는가, 근거가 원문 대조를
 * 통과하는가, 단순 알림을 회신 요청으로 부풀리지 않는가, 요구사항 점검이 초안에 없는 것을 충족으로 세지 않는가.
 * 결과를 눈으로 보려면 SAIDE_DUMP=<파일 경로>.
 */

import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildContext } from '@/lib/chat/context';
import { buildWorkPlanHandoff, parseWorkPlan, renderWorkPlan, WORK_PLAN_SCHEMA, workPlanInstruction, type WorkPlan } from './work-plan';
import { checkRequirements, metCount } from './requirement-check';

const endpoint = process.env.SAIDE_OLLAMA ?? 'http://localhost:11434';
const model = process.env.SAIDE_MODEL ?? 'gemma4:e2b';

function dump(label: string, value: unknown) {
  if (process.env.SAIDE_DUMP) appendFileSync(process.env.SAIDE_DUMP, `\n=== ${label} ===\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

/** 채팅 스토어(runWorkPlan)와 같은 문맥·옵션으로 부른다. */
async function extract(title: string, text: string): Promise<{ plan: WorkPlan; seconds: number }> {
  const started = Date.now();
  const messages = buildContext([{ role: 'user', content: workPlanInstruction(title) }], 8192,
    { url: 'https://onnara.test/doc', title, text, truncated: false, keptRatio: 1 });
  const res = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, think: false, format: WORK_PLAN_SCHEMA, options: { temperature: 0, num_ctx: 8192 } }),
  });
  const json = await res.json() as { message?: { content?: string } };
  const plan = parseWorkPlan(json.message?.content ?? '');
  if (!plan) throw new Error(`업무계획 형식으로 읽지 못함: ${json.message?.content}`);
  return { plan, seconds: (Date.now() - started) / 1000 };
}

const SURVEY = [
  '행정안전부',
  '수신 수신자 참조',
  '제목 2026년도 스마트 행정 혁신사업 수요조사 회신 요청',
  '1. 관련: 행정안전부 디지털정부혁신실-1234(2026. 9. 25.)',
  '2. 스마트 행정 혁신사업을 추진하고자 수요를 다음과 같이 조사하오니 기한 내 회신하여 주시기 바랍니다.',
  '가. 제출 기한: 2026. 10. 15.(목) 18:00까지',
  '나. 제출 서식: 별지 제2호 서식(사업별 예산, 추진 일정)을 작성하고 담당자 연락처를 기재',
  '다. 산출근거: 예산 산출근거를 붙임으로 함께 제출',
  '3. 신청 대상은 관내 소재 기업과 협업하는 사업으로 한정하며, 개인 단위 사업은 신청할 수 없습니다.',
  '4. 문의: 디지털정부혁신실 김OO 사무관(044-205-0000)',
  '붙임 별지 제2호 서식 1부. 끝.',
].join('\n');

const NOTICE = [
  '제목 청사 승강기 정기점검에 따른 운행 중지 알림',
  '1. 청사 승강기 정기점검을 다음과 같이 실시하오니 업무에 참고하시기 바랍니다.',
  '가. 일시: 2026. 10. 7.(수) 09:00~12:00',
  '나. 대상: 본관 1~2호기',
  '2. 점검 시간에는 계단을 이용하여 주시기 바랍니다. 끝.',
].join('\n');

it('회신 요청 공문: 요청 기관·유형·요구사항을 뽑고 근거가 원문 대조를 통과한다', async () => {
  const title = '2026년도 스마트 행정 혁신사업 수요조사 회신 요청';
  const { plan, seconds } = await extract(title, SURVEY);
  dump(`survey plan (${seconds.toFixed(1)}s)`, plan);
  dump('survey card', renderWorkPlan(title, plan, SURVEY, { reportDate: '2026-09-29' }));
  const handoff = buildWorkPlanHandoff(title, plan, SURVEY);
  dump('survey handoff', handoff);

  expect(plan.requestType).toBe('회신·제출');
  expect(plan.requester).toContain('행정안전부');
  expect(handoff.requirements.length).toBeGreaterThan(0);
  // 확인된 요구사항이 확인 안 된 것보다 많아야 한다(근거를 지어내지 않는다).
  expect(handoff.requirements.filter(item => item.verified).length)
    .toBeGreaterThanOrEqual(handoff.requirements.filter(item => !item.verified).length);
  expect(handoff.deadlines.some(deadline => deadline.verified && deadline.text.includes('10'))).toBe(true);
});

it('단순 알림 공문: 회신 요청으로 부풀리지 않는다', async () => {
  const title = '청사 승강기 정기점검에 따른 운행 중지 알림';
  const { plan, seconds } = await extract(title, NOTICE);
  dump(`notice plan (${seconds.toFixed(1)}s)`, plan);
  dump('notice card', renderWorkPlan(title, plan, NOTICE));
  expect(plan.requestType).not.toBe('회신·제출');
});

it('요구사항 점검: 초안에 있는 것만 인용과 함께 충족으로 센다', async () => {
  const draft = [
    '1. 관련: 행정안전부 디지털정부혁신실-1234(2026. 9. 25.)',
    '2. 위 호와 관련하여 우리 과 스마트 행정 혁신사업 수요조사 결과를 별지 제2호 서식에 따라 제출합니다.',
    '가. 사업명: 민원 안내 챗봇 고도화',
    '나. 사업 예산: 50,000천원',
    '다. 담당자: 정보화팀 홍길동(051-000-0000)',
    '붙임 별지 제2호 서식 1부. 끝.',
  ].join('\n');
  const requirements = ['별지 제2호 서식', '담당자 연락처', '예산 산출근거'];
  const started = Date.now();
  const results = await checkRequirements({ endpoint, model }, requirements, draft);
  dump(`requirement check (${((Date.now() - started) / 1000).toFixed(1)}s)`, results);
  // 초안에 산출근거는 없다. 이것을 충족으로 세면 점검이 쓸모없다.
  expect(results[2]!.status).not.toBe('met');
  expect(metCount(results)).toBeGreaterThanOrEqual(1);
});
