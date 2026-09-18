/**
 * 공문 핵심·조치사항 카드 (계획서 S01).
 *
 * ★ 소형 모델(gemma4:e2b)은 자유 형식으로 쓰게 하면 항목을 빠뜨리거나 날짜를 바꿔 쓴다.
 *   그래서 JSON 스키마로만 답하게 하고, 사용자에게 보여 주기 전에 코드가 원문과 대조한다.
 *   - 근거 문장이 원문에 실제로 있는지
 *   - 기한 날짜가 원문에 나오는 날짜인지
 *   - 원문의 "…까지" 기한을 모델이 빠뜨리지 않았는지(코드로 직접 추출)
 *   확인하지 못한 값은 지우지 않고 "원문에서 찾지 못함"으로 표시한다. 판단은 사용자가 한다.
 */

import { escapeMarkdownText } from '@/lib/downloads/links';

export interface ActionCard {
  summary: string;
  actions: Array<{ task: string; evidence: string }>;
  deliverables: string[];
  deadlines: Array<{ date: string; what: string; evidence: string }>;
  contact: string;
}

/** Ollama `format`에 넘기는 JSON 스키마. */
export const ACTION_CARD_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    actions: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, evidence: { type: 'string' } }, required: ['task', 'evidence'] } },
    deliverables: { type: 'array', items: { type: 'string' } },
    deadlines: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, what: { type: 'string' }, evidence: { type: 'string' } }, required: ['date', 'what', 'evidence'] } },
    contact: { type: 'string' },
  },
  required: ['summary', 'actions', 'deliverables', 'deadlines', 'contact'],
} as const;

export function actionCardInstruction(title: string): string {
  return [
    `첨부된 페이지 내용은 공문 '${title}'의 상세 화면이다. 이 공문을 받은 부서가 해야 할 일을 정리해 JSON으로만 답하라.`,
    'summary: 공문의 요지를 1~2문장으로.',
    'actions: 받은 부서가 해야 할 일. task는 짧은 동사형 문장, evidence는 그 근거가 되는 원문 문장을 그대로 옮겨 적는다.',
    'deliverables: 제출하거나 회신해야 하는 자료 이름. 없으면 빈 배열.',
    'deadlines: 기한. date는 원문에 적힌 날짜 표기 그대로, what은 그날까지 할 일, evidence는 원문 문장 그대로.',
    'contact: 문의처(부서·담당자·전화). 원문에 없으면 빈 문자열.',
    '원문에 없는 내용은 만들지 말고 빈 배열이나 빈 문자열로 둔다. 단순 알림이라 할 일이 없으면 actions는 빈 배열이다.',
  ].join('\n');
}

/** 비교용: 공백·문장부호를 없앤다. */
function compact(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 근거 문장이 원문에 있는가. 모델이 앞뒤를 조금 줄이는 경우를 허용해 핵심 구간(앞 20자)으로도 확인한다. */
export function evidenceFound(evidence: string, source: string): boolean {
  const needle = compact(evidence);
  if (needle.length < 6) return false;
  const haystack = compact(source);
  return haystack.includes(needle) || (needle.length > 20 && haystack.includes(needle.slice(0, 20)));
}

export interface FoundDate { year?: number; month: number; day: number; text: string }

const DATE_PATTERNS: RegExp[] = [
  /(?:(\d{4})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?(?:\s*\([월화수목금토일]\))?/g,
];

/** 공문식 날짜(2026. 9. 30.(수), 9월 30일, 2026-09-30)를 찾는다. */
export function findDates(text: string): FoundDate[] {
  const found: FoundDate[] = [];
  for (const pattern of DATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      // "1. 2." 같은 항목 번호를 날짜로 오인하지 않도록, 연도나 월·일 글자가 없으면 요일 괄호가 있어야 인정한다.
      const explicit = Boolean(match[1]) || /[월일]/.test(match[0]) || /\([월화수목금토일]\)/.test(match[0]);
      if (!explicit) continue;
      found.push({ ...(match[1] ? { year: Number(match[1]) } : {}), month, day, text: match[0].trim() });
    }
  }
  return found;
}

/** 같은 날짜인가. 한쪽에 연도가 없으면 월·일만 비교한다(공문은 연도를 자주 생략한다). */
export function sameDate(a: FoundDate, b: FoundDate): boolean {
  return a.month === b.month && a.day === b.day && (a.year === undefined || b.year === undefined || a.year === b.year);
}

/** 원문에서 "…까지"로 끝나는 기한을 코드로 직접 뽑는다. 모델이 빠뜨린 기한을 보완한다. */
export function findDueDates(source: string): Array<FoundDate & { sentence: string }> {
  const results: Array<FoundDate & { sentence: string }> = [];
  // "2026. 9. 30."처럼 날짜 안에도 마침표와 공백이 있으므로 ". "로 자르면 날짜가 조각난다. 줄과 "다." 뒤에서만 나눈다.
  for (const sentence of source.split(/(?<=다\.)\s+|\n+/)) {
    if (!/까지/.test(sentence)) continue;
    const dueClause = sentence.slice(0, sentence.lastIndexOf('까지'));
    const dates = findDates(dueClause);
    const last = dates.at(-1);
    if (last && !results.some(item => sameDate(item, last))) results.push({ ...last, sentence: sentence.trim() });
  }
  return results;
}

export function parseActionCard(raw: string): ActionCard | null {
  try {
    const value = JSON.parse(raw) as Partial<ActionCard>;
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const list = <T>(v: unknown, map: (item: Record<string, unknown>) => T | null): T[] =>
      Array.isArray(v) ? v.flatMap(item => (item && typeof item === 'object' ? [map(item as Record<string, unknown>)] : [])).filter((item): item is T => item !== null) : [];
    return {
      summary: text(value.summary),
      actions: list(value.actions, item => text(item.task) ? { task: text(item.task), evidence: text(item.evidence) } : null),
      deliverables: Array.isArray(value.deliverables) ? value.deliverables.map(text).filter(Boolean) : [],
      deadlines: list(value.deadlines, item => text(item.date) ? { date: text(item.date), what: text(item.what), evidence: text(item.evidence) } : null),
      contact: text(value.contact),
    };
  } catch {
    return null;
  }
}

const OK = '원문 확인';
const MISSING = '원문에서 찾지 못함';

/** 검증 결과를 붙여 답변용 마크다운으로 만든다. */
export function renderActionCard(title: string, card: ActionCard, source: string): string {
  // "2026. 9. 30."이 줄 앞에 오면 마크다운이 번호 목록으로 읽어 "30."만 남긴다. 숫자 뒤 마침표도 이스케이프한다.
  const md = (text: string) => escapeMarkdownText(text).replace(/(\d)\./g, '$1\\.');
  const sourceDates = findDates(source);
  const lines: string[] = [`**핵심·조치사항** · ${md(title)}`, '', `**요지** ${md(card.summary || '요지를 만들지 못했습니다.')}`, ''];

  lines.push('**할 일**');
  if (card.actions.length) {
    for (const action of card.actions) lines.push(`- ${md(action.task)} (${evidenceFound(action.evidence, source) ? OK : MISSING})`);
  } else lines.push('- 본문에서 요청된 조치를 찾지 못했습니다(단순 알림일 수 있음).');
  lines.push('');

  lines.push('**제출물**');
  lines.push(...(card.deliverables.length ? card.deliverables.map(item => `- ${md(item)}`) : ['- 없음']));
  lines.push('');

  lines.push('**기한**');
  const shown: FoundDate[] = [];
  for (const deadline of card.deadlines) {
    const parsed = findDates(deadline.date)[0];
    const inSource = parsed ? sourceDates.some(date => sameDate(date, parsed)) : false;
    if (parsed) shown.push(parsed);
    lines.push(`- ${md(deadline.date)} · ${md(deadline.what)} (${inSource ? OK : `날짜를 ${MISSING}`})`);
  }
  // 모델이 빠뜨린 원문 기한은 코드가 찾아 따로 표시한다.
  for (const due of findDueDates(source)) {
    if (shown.some(date => sameDate(date, due))) continue;
    lines.push(`- ${md(due.text)} · 원문의 기한 문장: "${md(due.sentence.slice(0, 80))}" (AI가 빠뜨려 코드가 찾음)`);
  }
  if (!card.deadlines.length && !findDueDates(source).length) lines.push('- 없음');
  lines.push('');

  lines.push(`**문의처** ${md(card.contact || '본문에 없음')}`);

  const evidence = [...card.actions.map(action => action.evidence), ...card.deadlines.map(deadline => deadline.evidence)]
    .filter((sentence, index, all) => sentence && all.indexOf(sentence) === index && evidenceFound(sentence, source));
  if (evidence.length) {
    lines.push('', '**근거 문장**');
    for (const sentence of evidence.slice(0, 4)) lines.push(`> ${md(sentence)}`);
  }
  return lines.join('\n');
}
