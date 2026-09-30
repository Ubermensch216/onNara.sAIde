/**
 * 근거 필수 모드 — 업무 규정 질문은 내 지식에서 근거를 찾았을 때만 답한다.
 *
 * ★ "내 지식 포함"으로 물었는데 검색이 실패하거나 결과가 없으면, 예전에는 안내 한 줄만 달고 일반 답변을
 *   이어 갔다. 일상 질문이면 괜찮지만 "출장 여비 한도", "연가 며칠" 같은 규정 질문에서 소형 모델은
 *   그럴듯한 조항·금액을 지어낸다. 그런 답은 안내 문구가 있어도 사람이 그대로 옮겨 적기 쉽다.
 *   그래서 규정 질문은 근거가 없으면 **모델을 부르지 않고** 답하지 않았음을 알린다.
 * ★ 판정은 코드로 한다(낱말 목록). 모델에게 "규정 질문이냐"를 묻는 것은 또 한 번의 추론이고 틀릴 수 있다.
 *   빗나가면(규정 질문인데 못 가림) 예전 동작으로 떨어질 뿐이고, 사용자가 설정에서 "늘 근거 필수"로 바꿀 수 있다.
 * ★ 근거를 찾아 답했더라도, 답에 근거 번호가 없거나 없는 번호를 대면 안내를 붙인다(checkCitations).
 */

import { t } from '@/lib/i18n';
import type { KnowledgeMissing } from './chat-knowledge';

/** 'regulation' = 규정 질문만 근거 필수(기본). 'always' = "내 지식 포함" 질문은 모두 근거 필수. */
export type GroundingPolicy = 'regulation' | 'always';

/**
 * 업무 규정·지침을 묻는 질문에 나오는 말. 공무원 업무에서 조항·금액·일수를 지어내면 곤란한 주제를 모았다.
 * "기준"처럼 일상 질문에도 흔한 말은 단독으로 넣지 않고 "지급 기준"처럼 묶어서만 본다.
 */
const REGULATION_TERMS = new RegExp([
  '규정', '규칙', '지침', '훈령', '예규', '고시', '조례', '법령', '법률', '시행령', '시행규칙', '조항', '요령', '편람', '매뉴얼',
  '제\\s*\\d+\\s*조', '법\\s*제\\s*\\d+',
  '(?:지급|산정|처리|적용|선정|평가|집행|계약)\\s*기준',
  '전결', '위임전결', '복무', '여비', '출장비', '일비', '숙박비', '수당', '초과근무', '시간외', '연가', '병가', '공가', '휴직', '징계',
  '수의계약', '예산\\s*(?:집행|전용|이용)', '회계\\s*처리', '보안\\s*(?:규정|지침|점검)', '개인정보\\s*(?:처리|보호)',
].join('|'));

/** 업무 규정·지침에 관한 질문인가. */
export function isRegulationQuestion(question: string): boolean {
  return REGULATION_TERMS.test(question.normalize('NFC'));
}

/** 이 질문은 근거 없이 답하면 안 되는가. */
export function requiresGrounding(question: string, policy: GroundingPolicy): boolean {
  return policy === 'always' || isRegulationQuestion(question);
}

export interface CitationCheck {
  /** 답에 나온 올바른 근거 번호. */
  cited: number[];
  /** 근거 목록에 없는 번호. 모델이 지어낸 인용이다. */
  invalid: number[];
  /** 모델이 "내 지식에서 찾지 못했다"고 스스로 밝혔는가. 그렇다면 번호가 없어도 정상이다. */
  declined: boolean;
}

/** 답변의 [n] 인용을 근거 목록(1..count)과 대조한다. */
export function checkCitations(answer: string, count: number): CitationCheck {
  const numbers = new Set<number>();
  for (const match of answer.matchAll(/\[(\d{1,2}(?:\s*[,，]\s*\d{1,2})*)\]/g)) {
    for (const part of match[1]!.split(/[,，]/)) numbers.add(Number(part.trim()));
  }
  const all = [...numbers].sort((a, b) => a - b);
  return {
    cited: all.filter(n => n >= 1 && n <= count),
    invalid: all.filter(n => n < 1 || n > count),
    declined: /(?:내\s*지식|자료)에서\s*찾지\s*못/.test(answer),
  };
}

/** 근거 필수인데 근거가 없을 때 모델 대신 남기는 답. 무엇을 하면 답을 받을 수 있는지까지 적는다. */
export function refusalMessage(regulation: boolean, missing: { code: KnowledgeMissing; reason?: string }): string {
  const reason = missing.code === 'unavailable'
    ? t('tongdal.strict.reason.unavailable', { reason: missing.reason ?? '' })
    : t(`tongdal.strict.reason.${missing.code}`);
  return [
    `**${t('tongdal.strict.title')}**`,
    '',
    t(regulation ? 'tongdal.strict.whyRegulation' : 'tongdal.strict.whyAlways'),
    '',
    `- ${t('tongdal.strict.reason', { reason })}`,
    `- ${t('tongdal.strict.tipQuery')}`,
    `- ${t('tongdal.strict.tipIndex')}`,
  ].join('\n');
}

/**
 * 근거를 붙여 받은 답의 인용 안내. 없는 번호를 댔으면 늘 알리고, 번호가 하나도 없으면 근거 필수일 때만 알린다
 * (일반 질문은 자료 밖 상식으로 답해도 되므로). 모델이 "찾지 못했다"고 밝혔으면 번호가 없어도 정상이다.
 */
export function citationNotice(answer: string, count: number, required: boolean): string | undefined {
  const check = checkCitations(answer, count);
  if (check.invalid.length) return t('tongdal.cite.invalid', { numbers: check.invalid.map(n => `[${n}]`).join(', ') });
  if (required && !check.cited.length && !check.declined) return t('tongdal.cite.none');
  return undefined;
}
