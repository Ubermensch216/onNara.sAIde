import { aiFetch } from '@/lib/llm/destination';
/**
 * 회신 초안의 요구사항 점검 (업무계획 4번 칸 → 기안 코파일럿).
 *
 * 업무계획에서 넘어온 "회신에 반드시 담을 것"이 생성한 초안에 들어 있는지 본다.
 *
 * ★ 모델은 항목마다 "들어 있다/없다"와 **초안에서 그 자리를 그대로 옮긴 인용**을 낸다. 코드는 그 인용이
 *   초안에 실제로 있는지 대조한다. 인용을 찾지 못한 "들어 있다"는 충족으로 세지 않고 `확인 못함`으로
 *   남긴다 — 조치카드가 "원문에서 찾지 못함"을 지우지 않고 보이는 것과 같은 태도다.
 * ★ 충족률의 분자는 인용까지 확인한 것만이다. 모델의 주장만으로 3/3을 띄우지 않는다.
 * ★ 인용이 초안에 있다는 것만으로는 부족하다. 실측(gemma4:e2b)에서 "예산 산출근거"를 초안의
 *   "사업 예산: 50,000천원"으로 충족 처리했다. 그래서 인용에 요구사항의 핵심어가 들어 있는지도 본다
 *   (`coversRequirement`). 핵심어가 없는 인용은 `확인 못함`이다.
 */

import type { Settings } from '@/lib/storage/settings';

export type RequirementStatus = 'met' | 'missing' | 'unverified';

export interface RequirementResult {
  requirement: string;
  status: RequirementStatus;
  /** 충족으로 판정한 근거 — 초안에서 확인한 인용. */
  quote?: string;
}

export const REQUIREMENT_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { index: { type: 'integer' }, met: { type: 'boolean' }, quote: { type: 'string' } },
        required: ['index', 'met', 'quote'],
      },
    },
  },
  required: ['items'],
} as const;

export function requirementCheckMessages(requirements: string[], draft: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: [
        '너는 공문 초안 검토자다. 요구사항 목록의 각 항목이 초안에 들어 있는지 JSON으로만 답하라.',
        'index: 요구사항 번호. met: 초안에 그 내용이 들어 있으면 true.',
        'quote: met이 true면 그 내용이 적힌 초안 문장을 한 글자도 바꾸지 말고 그대로 옮긴다. false면 빈 문자열.',
        '초안에 없는 내용을 있다고 하지 않는다. 비슷한 말만 있고 요구한 내용이 없으면 false다.',
        '예: 요구사항이 "예산 산출근거"인데 초안에 예산 금액만 있고 산출근거(계산 내역)가 없으면 false다.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '[요구사항]',
        ...requirements.map((item, index) => `${index + 1}. ${item}`),
        '',
        '[초안]',
        draft,
      ].join('\n'),
    },
  ];
}

/** 비교용: 공백·문장부호를 없앤다(action-card의 대조 규칙과 같다). */
function compact(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 요구사항에 흔히 붙지만 그 자체로는 무엇을 갖췄는지 말하지 않는 낱말. 핵심어에서 뺀다. */
const GENERIC_WORDS = new Set(['제출', '작성', '기재', '포함', '첨부', '회신', '명시', '여부', '내용', '자료', '작성후', '제출물', '반드시', '함께']);
/** 낱말 끝의 조사. "예산과", "서식을"의 핵심어는 "예산", "서식"이다. */
const PARTICLE = /(?:과|와|을|를|의|및|은|는|이|가|에|로|으로|등)$/;
/** 연락처를 뜻하는 낱말은 전화번호·전자우편이 적혀 있으면 갖춘 것으로 본다. */
const CONTACT_WORD = /^(?:연락처|연락|전화|전화번호|이메일|전자우편)$/;
const CONTACT_VALUE = /\d{2,4}\s*[-)]\s*\d{3,4}\s*-\s*\d{4}|[\w.+-]+@[\w-]+\.[\w.]+/;

/** 요구사항의 핵심어. 뜻을 담지 않는 낱말과 조사를 뺀다. */
export function requirementKeywords(requirement: string): string[] {
  return requirement
    .split(/[\s,·/()（）]+/)
    .map(word => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .map(word => (word.length > 2 ? word.replace(PARTICLE, '') : word))
    .filter(word => word.length >= 2 && !GENERIC_WORDS.has(word));
}

/**
 * 인용이 그 요구사항을 담고 있는가. 핵심어가 모두 인용에 있어야 한다.
 * 핵심어가 하나도 남지 않는 요구사항("제출")은 인용이 초안에 있는 것으로 충분하다고 본다.
 */
export function coversRequirement(requirement: string, quote: string): boolean {
  const text = compact(quote);
  return requirementKeywords(requirement).every(word =>
    text.includes(compact(word)) || (CONTACT_WORD.test(word) && CONTACT_VALUE.test(quote)));
}

/**
 * 모델의 답을 판정으로 바꾼다. 형식을 읽지 못하면 null.
 *
 * - met + 인용이 초안에 있음 → `met`
 * - met + 인용을 찾지 못함, 또는 인용에 요구사항의 핵심어가 없음 → `unverified` (충족으로 세지 않는다)
 * - met이 아님 → `missing`
 * - 모델이 그 항목을 빠뜨림 → `unverified`
 */
export function judgeRequirements(raw: string, requirements: string[], draft: string): RequirementResult[] | null {
  let items: unknown;
  try { items = (JSON.parse(raw) as { items?: unknown }).items; } catch { return null; }
  if (!Array.isArray(items)) return null;
  const haystack = compact(draft);
  return requirements.map((requirement, index) => {
    const answer = items.find((item): item is { index: number; met?: unknown; quote?: unknown } =>
      Boolean(item) && typeof item === 'object' && (item as { index?: unknown }).index === index + 1);
    if (!answer) return { requirement, status: 'unverified' };
    if (answer.met !== true) return { requirement, status: 'missing' };
    const quote = typeof answer.quote === 'string' ? answer.quote.trim() : '';
    const needle = compact(quote);
    return needle.length >= 4 && haystack.includes(needle) && coversRequirement(requirement, quote)
      ? { requirement, status: 'met', quote }
      : { requirement, status: 'unverified' };
  });
}

/** 초안을 점검한다. 로컬 Ollama를 한 번 부른다. */
export async function checkRequirements(
  settings: Pick<Settings, 'endpoint' | 'model'>,
  requirements: string[],
  draft: string,
  signal?: AbortSignal,
): Promise<RequirementResult[]> {
  const messages = requirementCheckMessages(requirements, draft);
  // 입력(요구사항 + 초안)과 출력(항목당 인용 한 줄)을 담을 만큼만 잡는다. 초안은 수천 자 안팎이다.
  const numCtx = Math.min(16384, Math.max(4096, Math.ceil((draft.length + 400 * requirements.length) / 1024) * 1024 + 2048));
  const res = await aiFetch(settings.endpoint, '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: false,
      think: false,
      format: REQUIREMENT_CHECK_SCHEMA,
      options: { temperature: 0, num_ctx: numCtx },
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw new Error(`Ollama 응답 오류 (${res.status})`);
  const json = await res.json() as { message?: { content?: string } };
  const results = judgeRequirements(json.message?.content ?? '', requirements, draft);
  if (!results) throw new Error('AI 응답을 요구사항 점검 형식으로 읽지 못했습니다. 다시 점검해 보세요.');
  return results;
}

/** 충족으로 셀 수 있는 건수(인용까지 확인한 것). */
export function metCount(results: RequirementResult[]): number {
  return results.filter(result => result.status === 'met').length;
}
