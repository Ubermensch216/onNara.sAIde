/**
 * 업무계획 카드 (`/업무계획`, 기획 "처리카드 · WorkCard"). 핵심·조치사항 카드(S01)를 흡수한 상위 카드다.
 *
 * 공문에서 ① 누가 무엇을 요청했는지 ② 내가 해야 할 일과 기한 ③ 그 판단의 근거 ④ 회신에 갖출 것을
 * 한 장에 모은다. ④는 기안 코파일럿(드로어)으로 넘겨 회신 초안의 작성 요청과 요구사항 점검에 쓴다.
 *
 * ★ 모델 호출은 한 번이다. CPU에서 출력은 초당 ~21토큰이라 두 번 부르면 기다림이 두 배가 된다.
 *   조항 위치·기한 보완·원문 대조는 모두 코드가 한다(action-card.ts의 규칙을 그대로 쓴다).
 * ★ 판정하지 않는 것:
 *   - 적용 조건(자격·대상)이 "우리에게 해당하는가"는 사용자·기관 정보가 없어 판정할 수 없다.
 *     조건을 원문과 대조해 보여 주기까지만 하고, 해당 여부는 사용자가 본다.
 *   - 요구사항 충족 여부는 초안이 있어야 잴 수 있다. 여기서는 체크리스트만 만들고,
 *     충족 점검은 기안 코파일럿에서 초안을 만든 뒤에 한다(requirement-check.ts).
 *   - 일정은 여기서 등록하지 않는다. 기한은 후보로만 남기고 `일정으로 등록` 카드에서 사용자가 고른다.
 */

import { escapeMarkdownText } from '@/lib/downloads/links';
import { MIN_ANCHOR_CHARS } from '@/lib/extract/pdf-text';
import {
  ACTION_CARD_SCHEMA,
  actionCardInstruction,
  isPlaceholder,
  findDates,
  findDueDates,
  locateEvidence,
  parseActionCard,
  sameDate,
  type ActionCard,
  type FoundDate,
} from './action-card';

/** 공문이 받는 부서에 요구하는 것의 갈래. 스키마의 enum이라 모델이 다른 말을 쓰지 못한다. */
export const REQUEST_TYPES = ['회신·제출', '시행·조치', '참고·알림'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export interface WorkPlan extends ActionCard {
  /** 요청 기관(발신 기관·부서). 원문에 없으면 빈 문자열. */
  requester: string;
  requestType: RequestType;
  /** 적용 대상·자격·예외 조건. 해당 여부는 사용자가 판단한다. */
  conditions: Array<{ text: string; evidence: string }>;
  /** 회신·제출물에 반드시 갖출 것(서식, 연락처, 산출근거 등). */
  requirements: Array<{ item: string; evidence: string }>;
}

/** 모델이 뽑은 항목 하나와 그 원문 대조 결과. 기안 코파일럿으로 넘기는 단위다. */
export interface CheckedItem {
  text: string;
  /** 근거를 원문에서 뜻이 바뀌지 않게 찾았는가(locateEvidence). */
  verified: boolean;
}

/**
 * 업무계획 → 기안 코파일럿으로 넘기는 회신 준비 묶음. 메시지·캐시에 함께 저장한다.
 *
 * ★ 원문 전체는 싣지 않는다. 대조를 마친 항목과 그 판정만 넘긴다 — 드로어는 원문을
 *   관련정보에서 따로 읽는다(원문을 두 곳에 복사해 두지 않는다).
 */
export interface WorkPlanHandoff {
  source: { title: string; url?: string };
  requester?: string;
  requestType: RequestType;
  summary: string;
  requirements: CheckedItem[];
  deliverables: string[];
  deadlines: CheckedItem[];
  conditions: CheckedItem[];
  contact?: string;
}

/** Ollama `format`에 넘기는 JSON 스키마. 조치카드 스키마에 네 항목을 더한다. */
export const WORK_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    ...ACTION_CARD_SCHEMA.properties,
    requester: { type: 'string' },
    requestType: { type: 'string', enum: [...REQUEST_TYPES] },
    conditions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, evidence: { type: 'string' } }, required: ['text', 'evidence'] } },
    requirements: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, evidence: { type: 'string' } }, required: ['item', 'evidence'] } },
  },
  required: [...ACTION_CARD_SCHEMA.required, 'requester', 'requestType', 'conditions', 'requirements'],
} as const;

export function workPlanInstruction(title: string): string {
  return [
    actionCardInstruction(title),
    'requester: 이 공문을 보낸 기관·부서 이름. 원문에 없으면 빈 문자열.',
    `requestType: 받은 부서에 요구하는 것. 자료를 보내거나 회신해야 하면 "${REQUEST_TYPES[0]}", 사업·지침을 시행해야 하면 "${REQUEST_TYPES[1]}", 알리기만 하면 "${REQUEST_TYPES[2]}".`,
    'conditions: 적용 대상·자격·예외 조건. text는 짧은 요약, evidence는 원문 문장 그대로. 없으면 빈 배열.',
    'requirements: 회신이나 제출물에 반드시 갖춰야 할 것(서식, 작성 항목, 첨부, 연락처 등). item은 짧은 명사구, evidence는 원문 문장 그대로. 알리기만 하는 공문이거나 없으면 빈 배열.',
  ].join('\n');
}

export function parseWorkPlan(raw: string): WorkPlan | null {
  const card = parseActionCard(raw);
  if (!card) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const pairs = <K extends string>(v: unknown, key: K) =>
      (Array.isArray(v) ? v : []).flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const record = item as Record<string, unknown>;
        const main = text(record[key]);
        return main && !isPlaceholder(main) ? [{ [key]: main, evidence: text(record.evidence) } as Record<K, string> & { evidence: string }] : [];
      });
    const type = text(value.requestType);
    return {
      ...card,
      requester: text(value.requester),
      // enum 밖의 값(구속 출력을 못 쓰는 공급자)은 가장 흔한 갈래로 두지 않고 "참고·알림"으로 낮춘다 —
      // 회신이 필요하다고 부풀리는 것보다, 할 일·요구사항 목록이 비어 있지 않은지를 사용자가 보게 하는 편이 안전하다.
      requestType: (REQUEST_TYPES as readonly string[]).includes(type) ? type as RequestType : '참고·알림',
      conditions: pairs(value.conditions, 'text'),
      requirements: pairs(value.requirements, 'item'),
    };
  } catch {
    return null;
  }
}

/** 비교용: 공백·문장부호를 없앤다(action-card의 대조 규칙과 같다). */
function compact(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 짧은 이름(기관명 등)이 원문에 있는가. 근거 문장과 달리 문장 단위가 아니라 글자 포함으로 본다. */
function nameInSource(name: string, source: string): boolean {
  const needle = compact(name);
  return needle.length >= 2 && compact(source).includes(needle);
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/**
 * 근거 문장이 원문의 어디에 있는지 사람이 찾아갈 수 있는 이름으로 돌려준다.
 *
 * - 조문이 있으면 `제4조 제1항`: 앞쪽에서 가장 가까운 조문 제목(줄 머리이거나 뒤에 괄호 제목이 붙은
 *   "제N조")과 그 뒤의 항 번호(①…)로 짓는다. 본문 속 인용("같은 법 제5조에 따라")은 조문 제목으로 보지 않는다.
 * - 조문이 없으면 공문 항목 번호 `2. 가.`.
 * - 본문이 PDF 한 건에서 왔으면(`pageAnchors`) 앞에 쪽 번호를 붙인다: `3쪽 · 제4조 제1항`.
 * - 찾지 못하면 null. 지어내지 않는다.
 */
export function sourceLocation(sentence: string, source: string, pageAnchors?: string[]): string | null {
  const page = pdfPageOf(sentence, source, pageAnchors);
  const place = placeInText(sentence, source);
  if (page === null) return place;
  return place ? `${page}쪽 · ${place}` : `${page}쪽`;
}

/**
 * 근거 문장이 PDF의 몇 쪽에 있는가.
 *
 * 쪽마다의 첫머리 표식을 본문에서 차례로 찾아, 문장보다 앞에 나온 마지막 표식의 쪽으로 본다.
 * 차례로 찾으므로 머리글이 같은 쪽들도 순서대로 짝이 맞는다. 본문이 잘려 표식을 못 찾은 쪽은 건너뛴다.
 */
export function pdfPageOf(sentence: string, source: string, pageAnchors?: string[]): number | null {
  if (!pageAnchors?.length) return null;
  const haystack = compact(source);
  const at = haystack.indexOf(compact(sentence).slice(0, 60));
  if (at < 0) return null;
  let cursor = 0;
  let page: number | null = null;
  pageAnchors.forEach((anchor, index) => {
    if (anchor.length < MIN_ANCHOR_CHARS) return;
    const found = haystack.indexOf(anchor, cursor);
    if (found < 0) return;
    cursor = found + 1;
    if (found <= at) page = index + 1;
  });
  return page;
}

/** 조문(제N조 제M항) 또는 공문 항목 번호(2. 가.)로 된 위치. */
function placeInText(sentence: string, source: string): string | null {
  let at = source.indexOf(sentence);
  if (at < 0) at = source.indexOf(sentence.slice(0, 12));
  if (at < 0) return null;
  // 문장 첫머리의 번호까지 보이도록 문장 앞부분도 본다. "제4조(제출 의무) ① …"처럼 조문 제목과 항 번호가
  // 한 문장에 붙어 오면 ①이 몇 글자 뒤에 있다. 문장은 "다." 뒤에서 나뉘므로 ②는 보통 다음 문장이다.
  const head = source.slice(0, at + Math.min(sentence.length, 30));

  const articles = [...head.matchAll(/(?:^|\n)[ \t]*제\s*(\d+)\s*조(?:\s*의\s*(\d+))?|제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*[(（]/g)];
  const article = articles.at(-1);
  if (article) {
    const number = article[1] ?? article[3];
    const branch = article[2] ?? article[4];
    const name = `제${number}조${branch ? `의${branch}` : ''}`;
    const paragraphs = [...head.slice(article.index! + article[0].length).matchAll(new RegExp(`[${CIRCLED}]`, 'g'))];
    const paragraph = paragraphs.at(-1);
    return paragraph ? `${name} 제${CIRCLED.indexOf(paragraph[0]) + 1}항` : name;
  }

  // "2026. 9. 30."의 연도·월이 항목 번호로 읽히지 않도록 줄 머리의 1~2자리 번호만 본다.
  const items = [...head.matchAll(/(?:^|\n)[ \t]*(\d{1,2})\.[ \t]/g)];
  const item = items.at(-1);
  if (!item) return null;
  const subs = [...head.slice(item.index! + item[0].length).matchAll(/(?:^|\n)[ \t]*([가-하])\.[ \t]/g)];
  const sub = subs.at(-1);
  if (sub) return `${item[1]}. ${sub[1]}.`;
  // 원문 문장이 스스로 그 번호로 시작하면 위치를 따로 적을 필요가 없다. "나."로 시작하는 문장은
  // 윗 항목(2.)을 알려 줄 필요가 있어 위에서 그대로 적는다.
  return sentence.trimStart().startsWith(`${item[1]}.`) ? null : `${item[1]}.`;
}

const OK = '원문 확인';
const MISSING = '원문에서 찾지 못함';

function checked(text: string, evidence: string, source: string): CheckedItem {
  return { text, verified: Boolean(evidence && locateEvidence(evidence, source)) };
}

/** 원문에서 찾은 기한까지 합친 기한 목록. 카드와 드로어가 같은 목록을 본다. */
function deadlineItems(plan: WorkPlan, source: string): CheckedItem[] {
  const sourceDates = findDates(source);
  const shown: FoundDate[] = [];
  const items: CheckedItem[] = plan.deadlines.map(deadline => {
    const parsed = findDates(deadline.date)[0];
    if (parsed) shown.push(parsed);
    const verified = parsed ? sourceDates.some(date => sameDate(date, parsed)) : false;
    return { text: [deadline.date, deadline.what].filter(Boolean).join(' · '), verified };
  });
  // 모델이 빠뜨린 원문 기한은 코드가 찾아 넣는다. 원문 문장이므로 확인된 것으로 본다.
  for (const due of findDueDates(source)) {
    if (shown.some(date => sameDate(date, due))) continue;
    shown.push(due);
    items.push({ text: `${due.text} · ${due.sentence.slice(0, 80)}`, verified: true });
  }
  return items;
}

/**
 * 기안 코파일럿으로 넘길 회신 준비 묶음을 만든다. 판정은 카드와 같은 함수로 한다.
 *
 * ★ 모델이 요구사항을 따로 뽑지 못했으면 제출물 이름을 요구사항으로 쓴다(카드의 4번 칸과 같은 규칙).
 *   제출물은 근거 문장이 없으므로 그 이름이 원문에 있는지로 확인한다.
 */
export function buildWorkPlanHandoff(title: string, plan: WorkPlan, source: string, url?: string): WorkPlanHandoff {
  return {
    source: { title, ...(url ? { url } : {}) },
    ...(plan.requester ? { requester: plan.requester } : {}),
    requestType: plan.requestType,
    summary: plan.summary,
    requirements: plan.requirements.length
      ? plan.requirements.map(item => checked(item.item, item.evidence, source))
      : plan.deliverables.map(item => ({ text: item, verified: nameInSource(item, source) })),
    deliverables: plan.deliverables,
    deadlines: deadlineItems(plan, source),
    conditions: plan.conditions.map(item => checked(item.text, item.evidence, source)),
    ...(plan.contact ? { contact: plan.contact } : {}),
  };
}

/**
 * 기안 코파일럿의 작성 요청 문장. 사용자가 고른 요구사항만 싣는다.
 *
 * ★ 원문에서 확인한 기한만 싣는다. 확인하지 못한 날짜를 작성 요청에 넣으면 초안에 사실처럼 박힌다.
 * ★ 문의처는 싣지 않는다. 받은 공문의 문의처는 상대 기관의 연락처라 회신 공문에 옮길 값이 아니다.
 */
export function handoffPrompt(handoff: WorkPlanHandoff, chosen: string[]): string {
  const lines = [`'${handoff.source.title}'에 대한 회신 공문 초안을 작성해줘.`];
  if (handoff.requester) lines.push(`- 요청 기관: ${handoff.requester}`);
  if (handoff.summary) lines.push(`- 요청 요지: ${handoff.summary}`);
  if (chosen.length) {
    lines.push('- 회신에 반드시 담을 것:');
    for (const item of chosen) lines.push(`  · ${item}`);
  }
  const deadlines = handoff.deadlines.filter(deadline => deadline.verified).map(deadline => deadline.text);
  if (deadlines.length) lines.push(`- 기한: ${deadlines.join(' / ')}`);
  // 요구사항으로 이미 고른 제출물은 한 번만 적는다.
  const deliverables = handoff.deliverables.filter(item => !chosen.some(choice => compact(choice) === compact(item)));
  if (deliverables.length) lines.push(`- 제출물: ${deliverables.join(', ')}`);
  return lines.join('\n');
}

/** 목록 화면에서 코드가 읽은 그 문서의 행 정보. 모델에게 묻지 않는 값이다. */
export interface WorkPlanListRow {
  sender?: string | undefined;
  reportDate?: string | undefined;
}

/** 검증 결과를 붙여 답변용 마크다운으로 만든다. */
export function renderWorkPlan(
  title: string, plan: WorkPlan, source: string, row: WorkPlanListRow = {},
  /** 본문이 PDF 한 건이면 쪽 표식(ExtractedPage.pdfPageAnchors). 근거 위치에 쪽 번호를 붙인다. */
  pageAnchors?: string[],
): string {
  // "2026. 9. 30."이 줄 앞에 오면 마크다운이 번호 목록으로 읽어 "30."만 남긴다. 숫자 뒤 마침표도 이스케이프한다.
  const md = (text: string) => escapeMarkdownText(text).replace(/(\d)\./g, '$1\\.');
  const badge = (verified: boolean) => (verified ? OK : MISSING);
  const lines: string[] = [`**업무계획** · ${md(title)}`, ''];

  // ── 1. 수신 요청 ──
  lines.push('**1. 수신 요청**');
  if (plan.requester) lines.push(`- 요청 기관: ${md(plan.requester)} (${badge(nameInSource(plan.requester, source))})`);
  else if (row.sender) lines.push(`- 요청 기관: ${md(row.sender)} (목록의 발신 칸)`);
  else lines.push('- 요청 기관: 본문에 없음');
  if (row.reportDate) lines.push(`- 목록 일자: ${md(row.reportDate)}`);
  lines.push(`- 요청 유형: ${plan.requestType}`);
  lines.push(`- 요지: ${md(plan.summary || '요지를 만들지 못했습니다.')}`, '');

  // ── 2. 해야 할 일 ──
  lines.push('**2. 해야 할 일**');
  if (plan.actions.length) {
    for (const action of plan.actions) lines.push(`- ${md(action.task)} (${badge(Boolean(locateEvidence(action.evidence, source)))})`);
  } else lines.push('- 본문에서 요청된 조치를 찾지 못했습니다(단순 알림일 수 있음).');
  const deadlines = deadlineItems(plan, source);
  const modelDeadlines = plan.deadlines.length;
  if (deadlines.length) {
    deadlines.forEach((deadline, index) => {
      const note = index < modelDeadlines ? (deadline.verified ? OK : `날짜를 ${MISSING}`) : 'AI가 빠뜨려 코드가 찾음';
      lines.push(`- 기한: ${md(deadline.text)} (${note})`);
    });
  } else lines.push('- 기한: 없음');
  lines.push(`- 제출물: ${plan.deliverables.length ? plan.deliverables.map(md).join(', ') : '없음'}`);
  lines.push(`- 문의처: ${md(plan.contact || '본문에 없음')}`, '');

  // ── 3. 근거 ──
  lines.push('**3. 근거**');
  const claims = [
    ...plan.actions.map(action => action.evidence),
    ...plan.deadlines.map(deadline => deadline.evidence),
    ...plan.requirements.map(item => item.evidence),
  ].filter(Boolean);
  const located = claims.map(evidence => locateEvidence(evidence, source));
  // 모델이 옮긴 조각이 아니라 확인된 원문 문장 전체를 보여 준다. 조각만 보이면 빠진 단서를 사용자가 알 수 없다.
  const sentences = located.filter((sentence, index, all): sentence is string => sentence !== null && all.indexOf(sentence) === index);
  for (const sentence of sentences.slice(0, 5)) {
    const where = sourceLocation(sentence, source, pageAnchors);
    lines.push(`> ${where ? `[${md(where)}] ` : ''}${md(sentence)}`, '>');
  }
  if (sentences.length) lines.pop();
  const unverified = located.filter(sentence => sentence === null).length;
  if (!sentences.length) lines.push('- 원문에서 확인한 근거 문장이 없습니다.');
  if (unverified) lines.push('', `- 원문에서 찾지 못한 근거 ${unverified}건은 싣지 않았습니다.`);
  if (plan.conditions.length) {
    lines.push('', '적용 조건 — 해당 여부는 직접 확인하세요');
    for (const condition of plan.conditions) {
      const sentence = condition.evidence ? locateEvidence(condition.evidence, source) : null;
      const where = sentence ? sourceLocation(sentence, source, pageAnchors) : null;
      lines.push(`- ${md(condition.text)} (${sentence ? `${OK}${where ? ` · ${md(where)}` : ''}` : MISSING})`);
    }
  }
  lines.push('');

  // ── 4. 회신 준비 ──
  lines.push('**4. 회신 준비**');
  if (plan.requirements.length) {
    // 알림으로 분류했는데 요구사항이 나왔으면 둘 중 하나가 틀렸다. 지우지 않고 사용자가 보게 한다.
    if (plan.requestType === '참고·알림') lines.push('- 알림 공문으로 보여 회신이 필요 없을 수 있습니다. 아래는 AI가 뽑은 항목입니다.');
    for (const item of plan.requirements) lines.push(`- ☐ ${md(item.item)} (${badge(Boolean(locateEvidence(item.evidence, source)))})`);
  } else if (plan.deliverables.length) {
    for (const item of plan.deliverables) lines.push(`- ☐ ${md(item)} (제출물)`);
  } else if (plan.requestType === '참고·알림') {
    lines.push('- 회신·제출 요구를 찾지 못했습니다(단순 알림일 수 있음).');
  } else {
    lines.push('- 회신에 갖출 항목을 찾지 못했습니다. 원문을 확인하세요.');
  }
  lines.push('- 초안을 만든 뒤 기안 코파일럿의 `요구사항 점검`으로 충족 여부를 확인합니다.');
  return lines.join('\n');
}
