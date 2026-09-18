/**
 * 핵심·조치사항 카드 → 일정 후보(계획서 S07).
 *
 * ★ 여기서 하는 일은 "등록"이 아니라 "후보 만들기"다. 저장은 사용자가 확인 카드에서
 *   체크한 것만 들어간다. AI가 뽑은 할 일이 곧 내 업무라고 단정하지 않는다.
 *
 * ★ 카드가 이미 해 둔 원문 대조 결과를 그대로 물려받는다. 근거 문장이 원문에 있는지,
 *   기한 날짜가 원문에 나오는 날짜인지, 모델이 빠뜨려 코드가 찾아낸 기한인지를
 *   후보마다 표시해 확인 카드에서 보인다. 다시 판정하지 않는다 — 두 곳에서 판정하면 어긋난다.
 */

import { evidenceFound, findDates, findDueDates, sameDate, type ActionCard, type FoundDate } from '@/lib/ai/action-card';
import { normalizeDueDate, type TaskDue } from './due-date';

export interface TaskCandidate {
  /** 할 일 한 줄. */
  title: string;
  /** 근거가 된 원문 문장. */
  evidence?: string;
  /** 그 문장을 원문에서 찾았는가. */
  evidenceVerified: boolean;
  due?: TaskDue;
  /** 기한 날짜가 원문에 나오는 날짜인가. 기한이 없으면 undefined. */
  dueVerified?: boolean;
  /** AI가 빠뜨려 코드가 원문에서 직접 찾은 기한인가. */
  foundByCode?: boolean;
  deliverables?: string[];
  contact?: string;
}

/** 비교용: 공백·문장부호를 없앤다(action-card의 대조 규칙과 같다). */
function compact(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 두 문구가 두 글자 이상 겹치는가. "붙임 서식 작성 후 제출"과 "제출 마감"을 이어 준다. */
function overlaps(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  for (let i = 0; i + 2 <= short.length; i += 1) if (long.includes(short.slice(i, i + 2))) return true;
  return false;
}

/**
 * 기한 문구가 어느 할 일에 붙는가.
 *
 * ★ 근거 문장이 같다는 것만으로 묶지 않는다. 한 문장에 서로 다른 조치가 함께 적힌 공문이 흔하고,
 *   그때 묶어 버리면 할 일 하나가 목록에서 사라진다. 낱말이 겹치는지까지 확인한 뒤에 묶는다.
 *   묶을지 말지 애매하면 따로 둔다 — 중복은 사용자가 체크를 풀면 되지만, 빠진 할 일은 보이지 않는다.
 */
function matchIndex(what: string, evidence: string, actions: ActionCard['actions']): number {
  const target = compact(what);
  if (target.length >= 4) {
    const found = actions.findIndex(action => {
      const task = compact(action.task);
      return task.includes(target) || target.includes(task);
    });
    if (found >= 0) return found;
  }
  const key = compact(evidence);
  if (key.length < 6) return -1;
  return actions.findIndex(action => compact(action.evidence) === key && overlaps(target, compact(action.task)));
}

/** 문장에서 할 일 제목을 만든다. 너무 길면 자른다 — 목록 한 줄에 들어가야 한다. */
function titleFromSentence(sentence: string): string {
  const clean = sentence.replace(/\s+/g, ' ').trim();
  return clean.length <= 40 ? clean : `${clean.slice(0, 40)}…`;
}

/**
 * 후보를 만든다.
 *
 * @param card 모델이 낸 핵심·조치사항 카드
 * @param source 공문 원문(대조 기준)
 * @param reference 연도가 없는 기한을 해석할 기준일(문서 보고일자 → 없으면 오늘)
 */
export function buildTaskCandidates(card: ActionCard, source: string, reference: Date = new Date()): TaskCandidate[] {
  const sourceDates = findDates(source);
  const shared = {
    ...(card.deliverables.length ? { deliverables: card.deliverables } : {}),
    ...(card.contact ? { contact: card.contact } : {}),
  };

  // 1. 할 일. 기한은 아래에서 붙인다.
  const candidates: TaskCandidate[] = card.actions.map(action => ({
    title: action.task,
    ...(action.evidence ? { evidence: action.evidence } : {}),
    evidenceVerified: evidenceFound(action.evidence, source),
    ...shared,
  }));

  // 2. 기한. 짝이 되는 할 일이 있으면 거기에 붙이고, 없으면 그 자체로 하나의 후보가 된다.
  const usedDates: FoundDate[] = [];
  for (const deadline of card.deadlines) {
    const parsed = findDates(deadline.date)[0];
    const due = normalizeDueDate(deadline.date, reference);
    if (parsed) usedDates.push(parsed);
    const verified = parsed ? sourceDates.some(date => sameDate(date, parsed)) : false;
    const index = matchIndex(deadline.what, deadline.evidence, card.actions);
    // 이미 기한이 붙은 할 일에 또 붙이지 않는다. 기한이 둘이면 별도 항목으로 남긴다.
    if (index >= 0 && candidates[index] && !candidates[index].due) {
      candidates[index] = { ...candidates[index], ...(due ? { due, dueVerified: verified } : {}) };
      continue;
    }
    candidates.push({
      title: deadline.what || titleFromSentence(deadline.evidence || deadline.date),
      ...(deadline.evidence ? { evidence: deadline.evidence } : {}),
      evidenceVerified: evidenceFound(deadline.evidence, source),
      ...(due ? { due, dueVerified: verified } : {}),
      ...shared,
    });
  }

  // 3. 모델이 빠뜨린 원문의 "…까지" 기한. 코드가 찾은 것이므로 근거는 원문 확인으로 본다.
  for (const missed of findDueDates(source)) {
    if (usedDates.some(date => sameDate(date, missed))) continue;
    usedDates.push(missed);
    const due = normalizeDueDate(missed.sentence, reference);
    if (!due) continue;
    candidates.push({
      title: titleFromSentence(missed.sentence),
      evidence: missed.sentence,
      evidenceVerified: true,
      due,
      dueVerified: true,
      foundByCode: true,
      ...shared,
    });
  }

  return dedupe(candidates);
}

/** 제목과 기한이 같은 후보는 한 건으로 본다. 기한이 있는 쪽을 남긴다. */
function dedupe(candidates: TaskCandidate[]): TaskCandidate[] {
  const out: TaskCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.title.trim()) continue;
    const index = out.findIndex(item => compact(item.title) === compact(candidate.title));
    const existing = index >= 0 ? out[index] : undefined;
    if (!existing) { out.push(candidate); continue; }
    if (!existing.due && candidate.due) out[index] = candidate;
  }
  return out;
}
