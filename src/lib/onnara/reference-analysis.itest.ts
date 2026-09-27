/**
 * 내 참고자료 정밀 분석 — 실제 Ollama(gemma4:e2b) 점검. `npm run test:live`로만 돈다.
 *
 * 확인하는 것: 소형 모델이 JSON 스키마를 지키는가, 근거 문장이 원문 대조를 통과하는가,
 * 날짜를 바꿔 쓰지 않는가, 구간당 시간이 UI 어림(SECONDS_PER_CHUNK)과 맞는가.
 */

import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { extractCodeFacts, runAnalysis, SECONDS_PER_CHUNK } from './reference-analysis';

const endpoint = process.env.SAIDE_OLLAMA ?? 'http://localhost:11434';
const model = process.env.SAIDE_MODEL ?? 'gemma4:e2b';

const GUIDE = [
  '2026년 공공데이터 개방 확대 추진계획 알림',
  '1. 관련: 행정안전부 공공데이터정책과-3120(2026. 9. 1.)',
  '2. 「공공데이터의 제공 및 이용 활성화에 관한 법률」 제17조에 따라 2026년 공공데이터 개방 확대 계획을 다음과 같이 알리니, 각 기관은 기한 내 제출하여 주시기 바랍니다.',
  '가. 제출 자료: 개방 대상 데이터 목록(붙임 서식 1)',
  '나. 제출 기한: 2026. 10. 15.(목)까지',
  '다. 제출 방법: 온나라 문서유통(수신: 정보화담당관)',
  '3. 우수기관에는 사업비 50,000천원 범위에서 인센티브를 지원할 예정입니다.',
  '4. 결과 보고는 2026. 11. 30.까지 완료하여 주시기 바랍니다.',
  '붙임: 1. 개방 대상 데이터 목록 서식 1부.',
  '2. 작성 예시 1부. 끝.',
].join('\n');

it('내용 근거 분석: 스키마를 지키고, 기한·요구사항이 원문 대조를 통과한다', async () => {
  const started = Date.now();
  const analysis = await runAnalysis({
    text: GUIDE, title: '공공데이터 개방 확대 추진계획', role: 'fact',
    target: { endpoint, model }, codeFacts: extractCodeFacts(GUIDE),
  });
  const seconds = (Date.now() - started) / 1000;
  const fact = analysis.fact!;
  // 결과를 눈으로 보려면 SAIDE_DUMP=<파일 경로>
  if (process.env.SAIDE_DUMP) writeFileSync(process.env.SAIDE_DUMP, JSON.stringify({ seconds, fact }, null, 2));

  expect(fact.summary.length).toBeGreaterThan(5);
  expect(fact.schedule.some(s => s.verified && s.date.includes('10'))).toBe(true);
  expect(fact.schedule.some(s => s.date.includes('11') && s.verified)).toBe(true);
  // 확인된 항목이 확인 안 된 항목보다 많아야 한다(모델이 근거를 지어내지 않는다).
  const items = [...fact.requirements, ...fact.schedule, ...fact.legalBasis];
  expect(items.filter(i => i.verified).length).toBeGreaterThanOrEqual(items.filter(i => !i.verified).length);
  // 구간 하나의 시간이 UI 어림의 3배를 넘지 않는다.
  expect(seconds).toBeLessThan(SECONDS_PER_CHUNK * 3);
});

it('작성 예시 분석: 문서 유형과 문체를 뽑는다', async () => {
  const analysis = await runAnalysis({
    text: GUIDE, title: '예전 공문', role: 'example',
    target: { endpoint, model }, codeFacts: extractCodeFacts(GUIDE),
  });
  expect(analysis.example!.docType.length).toBeGreaterThan(1);
  expect(analysis.example!.structure.length).toBeGreaterThan(0);
});
