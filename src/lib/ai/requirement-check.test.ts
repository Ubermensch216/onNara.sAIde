import { afterEach, expect, it, vi } from 'vitest';
import { checkRequirements, judgeRequirements, metCount, requirementCheckMessages } from './requirement-check';

const draft = [
  '1. 관련: 행정안전부 디지털정부혁신실-1234',
  '2. 위 호와 관련하여 우리 과 수요조사 결과를 별지 제2호 서식에 따라 제출합니다.',
  '가. 담당자: 정보화팀 홍길동(051-000-0000)',
  '붙임 수요조사서 1부. 끝.',
].join('\n');

const requirements = ['별지 제2호 서식', '담당자 연락처', '산출근거'];

afterEach(() => vi.unstubAllGlobals());

it('인용을 초안에서 확인한 것만 충족으로 센다', () => {
  const results = judgeRequirements(JSON.stringify({ items: [
    { index: 1, met: true, quote: '우리 과 수요조사 결과를 별지 제2호 서식에 따라 제출합니다.' },
    // 초안에 없는 문장을 인용했다 — 충족으로 세지 않는다.
    { index: 2, met: true, quote: '담당자 연락처는 추후 통보' },
    { index: 3, met: false, quote: '' },
  ] }), requirements, draft);
  expect(results?.map(result => result.status)).toEqual(['met', 'unverified', 'missing']);
  expect(results?.[0]?.quote).toContain('별지 제2호 서식');
  expect(metCount(results!)).toBe(1);
});

it('모델이 빠뜨린 항목은 확인 못함으로 남기고, 형식을 읽지 못하면 null', () => {
  expect(judgeRequirements(JSON.stringify({ items: [{ index: 1, met: true, quote: '별지 제2호 서식에 따라 제출합니다' }] }), requirements, draft)
    ?.map(result => result.status)).toEqual(['met', 'unverified', 'unverified']);
  expect(judgeRequirements('{"items": "없음"}', requirements, draft)).toBeNull();
  expect(judgeRequirements('JSON 아님', requirements, draft)).toBeNull();
});

it('너무 짧은 인용은 어디에나 맞으므로 근거로 인정하지 않는다', () => {
  expect(judgeRequirements(JSON.stringify({ items: [{ index: 1, met: true, quote: '제출' }] }), ['제출'], draft)?.[0]?.status).toBe('unverified');
});

it('요구사항에 번호를 붙여 초안과 함께 보낸다', () => {
  const [system, user] = requirementCheckMessages(requirements, draft);
  expect(system!.content).toContain('그대로 옮긴다');
  expect(user!.content).toContain('1. 별지 제2호 서식');
  expect(user!.content).toContain('3. 산출근거');
  expect(user!.content).toContain(draft);
});

it('Ollama를 구조화 출력·온도 0으로 한 번 부른다', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: JSON.stringify({ items: [
    { index: 1, met: true, quote: '별지 제2호 서식에 따라 제출합니다.' },
  ] }) } })));
  vi.stubGlobal('fetch', fetchMock);
  const results = await checkRequirements({ endpoint: 'http://localhost:11434', model: 'gemma4:e2b' }, ['별지 제2호 서식'], draft);
  expect(results).toEqual([{ requirement: '별지 제2호 서식', status: 'met', quote: '별지 제2호 서식에 따라 제출합니다.' }]);
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body).toMatchObject({ model: 'gemma4:e2b', stream: false, think: false, options: { temperature: 0 } });
  expect(body.format.required).toEqual(['items']);
});

it('응답 형식이 어긋나면 오류로 알린다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: { content: '모르겠습니다' } }))));
  await expect(checkRequirements({ endpoint: 'http://x', model: 'm' }, ['a'], draft)).rejects.toThrow('요구사항 점검 형식');
});

it('인용이 초안에 있어도 요구사항의 핵심어가 없으면 충족으로 세지 않는다(실측 사례)', () => {
  const survey = [
    '2. 수요조사 결과를 별지 제2호 서식에 따라 제출합니다.',
    '나. 사업 예산: 50,000천원',
    '다. 담당자: 정보화팀 홍길동(051-000-0000)',
  ].join('\n');
  const results = judgeRequirements(JSON.stringify({ items: [
    { index: 1, met: true, quote: '수요조사 결과를 별지 제2호 서식에 따라 제출합니다.' },
    // gemma4:e2b가 실제로 낸 답: 예산 금액만으로 "산출근거"를 충족 처리했다.
    { index: 2, met: true, quote: '나. 사업 예산: 50,000천원' },
    // "연락처"라는 낱말은 없지만 전화번호가 적혀 있다.
    { index: 3, met: true, quote: '다. 담당자: 정보화팀 홍길동(051-000-0000)' },
  ] }), ['별지 제2호 서식', '예산 산출근거', '담당자 연락처'], survey);
  expect(results?.map(result => result.status)).toEqual(['met', 'unverified', 'met']);
});

it('핵심어에서는 뜻을 담지 않는 낱말과 조사를 뺀다', async () => {
  const { requirementKeywords, coversRequirement } = await import('./requirement-check');
  expect(requirementKeywords('제출 서식 작성')).toEqual(['서식']);
  expect(requirementKeywords('사업별 예산과 추진 일정')).toEqual(['사업별', '예산', '추진', '일정']);
  expect(coversRequirement('제출', '아무 문장')).toBe(true);
  expect(coversRequirement('담당자 연락처', '담당자: 홍길동')).toBe(false);
});
