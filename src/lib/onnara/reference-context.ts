/**
 * 초안 프롬프트에 넣을 참고자료 묶음 (온나라 관련정보 + 내 참고자료, 최대 3건).
 *
 * ★ 문서마다 두 부분을 넣는다.
 *   ① 검증된 핵심 정보 카드 — 원문과 대조를 통과한 사실만. 확인하지 못한 항목은 넣지 않는다.
 *   ② 원문 — 예산 안이면 전문, 넘치면 발췌. 발췌는 첫 구간(배경), 기한·요구사항이 있는 구간,
 *      작성 요청과 낱말이 겹치는 구간(BM25) 순으로 고른다. 카드는 원문이 줄어도 항상 넣는다.
 *
 * ★ 예산을 넘는다고 초안을 거절하지 않는다. 발췌를 줄이고 "일부 구간만 반영"을 알린다.
 *   예전에는 32K를 넘으면 실패시켰는데, 여러 건을 고르면 거의 매번 넘는다.
 *
 * ★ 작성 예시는 별도 블록에 넣고 "사실을 인용하지 말 것"을 적는다. 작은 모델이 예전 공문의
 *   날짜·금액을 새 공문에 옮겨 적는 사고를 막기 위해서다.
 */

import { estimateTokens, fitToBudget } from '@/lib/extract/budget';
import { bm25, tokenize } from '@/lib/memory/keyword';
import { findDates, sameDate } from '@/lib/ai/action-card';
import {
  amountValue,
  findAmounts,
  splitForAnalysis,
  type CodeFacts,
  type ExampleAnalysis,
  type FactAnalysis,
  type RefRole,
} from './reference-analysis';

export const MAX_SELECTED_REFS = 3;
/** 발췌 단위(글자). */
const PASSAGE_CHARS = 900;
/** 작성 예시 원문은 형식만 보이면 되므로 이만큼만 넣는다(토큰). */
const EXAMPLE_EXCERPT_TOKENS = 1500;

export interface ReferenceSource {
  /** 'onnara:제목', 'upload:id' 또는 'tongdal:문서ID'. */
  key: string;
  origin: 'onnara' | 'upload' | 'tongdal';
  role: RefRole;
  title: string;
  /** 온나라 구분('문서', '보고문서') 또는 파일 형식('HWPX'). */
  docType?: string;
  docNumber?: string;
  text: string;
  memo?: string;
  attachments?: string[];
  codeFacts: CodeFacts;
  fact?: FactAnalysis;
  example?: ExampleAnalysis;
  /** 긴 관련정보 문서의 구간별 사실 노트(analyzeReferenceForDraft). */
  notes?: string;
}

export interface ReferenceContext {
  text: string;
  /** 원문을 전부 넣지 못한 자료 제목. */
  partial: string[];
  hasFact: boolean;
  hasExample: boolean;
}

const compact = (text: string) => text.normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

function factCard(source: ReferenceSource): string[] {
  const lines: string[] = [];
  const fact = source.fact;
  const facts = source.codeFacts;
  if (fact?.summary) lines.push(`- 요지: ${fact.summary}`);
  if (fact?.purpose) lines.push(`- 목적·배경: ${fact.purpose}`);
  const requirements = fact?.requirements.filter(r => r.verified) ?? [];
  if (requirements.length) lines.push('- 요구사항:', ...requirements.map(r => `  · ${r.item}`));
  const schedule = fact?.schedule.filter(s => s.verified) ?? [];
  if (schedule.length) lines.push('- 일정·기한(원문 표기):', ...schedule.map(s => `  · ${s.date} — ${s.what}`));
  else {
    const due = facts.dates.filter(d => d.due);
    if (due.length) lines.push('- 기한이 적힌 원문 문장:', ...due.slice(0, 8).map(d => `  · ${d.sentence}`));
  }
  const laws = fact?.legalBasis.filter(l => l.verified).map(l => l.name) ?? [];
  const lawNames = laws.length ? laws : facts.laws.map(l => l.text);
  if (lawNames.length) lines.push(`- 근거 법령·지침: ${lawNames.slice(0, 8).join(', ')}`);
  if (fact?.targets.length) lines.push(`- 대상: ${fact.targets.join(', ')}`);
  if (fact?.submissions.length) lines.push(`- 제출·회신 자료: ${fact.submissions.join(', ')}`);
  if (facts.amounts.length) lines.push(`- 금액(원문 표기): ${[...new Set(facts.amounts.map(a => a.text))].slice(0, 8).join(', ')}`);
  const attachments = source.attachments?.length ? source.attachments : facts.attachments;
  if (attachments.length) lines.push(`- 붙임: ${attachments.join(' / ')}`);
  if (fact?.contacts.length) lines.push(`- 문의처: ${fact.contacts.join(', ')}`);
  return lines;
}

function exampleCard(source: ReferenceSource): string[] {
  const example = source.example;
  const outline = example?.structure.length ? example.structure : source.codeFacts.outline;
  const lines: string[] = [];
  if (example?.docType) lines.push(`- 문서 유형: ${example.docType}`);
  if (outline.length) lines.push(`- 구성(대항목 순서): ${outline.join(' → ')}`);
  if (example?.numbering) lines.push(`- 번호 체계: ${example.numbering}`);
  if (example?.toneFeatures.length) lines.push(`- 문체 특징: ${example.toneFeatures.join(', ')}`);
  const samples = example?.sampleSentences.filter(s => s.verified) ?? [];
  if (samples.length) lines.push('- 예문:', ...samples.map(s => `  · ${s.text}`));
  return lines;
}

/** 원문을 예산에 맞게 전문 또는 발췌로 만든다. */
export function selectExcerpt(source: ReferenceSource, userPrompt: string, budgetTokens: number): { text: string; partial: boolean } {
  if (budgetTokens <= 0) return { text: '', partial: true };
  if (estimateTokens(source.text) <= budgetTokens) return { text: source.text, partial: false };

  const passages = splitForAnalysis(source.text, PASSAGE_CHARS);
  const priority: number[] = [0];
  if (source.role === 'fact') {
    const anchors = [
      ...source.codeFacts.dates.filter(d => d.due).map(d => d.sentence),
      ...(source.fact?.requirements.filter(r => r.verified).map(r => r.evidence) ?? []),
      ...(source.fact?.schedule.filter(s => s.verified).map(s => s.evidence) ?? []),
    ].map(text => compact(text.replace(/…$/, '')).slice(0, 20)).filter(key => key.length >= 6);
    passages.forEach((passage, index) => {
      const body = compact(passage);
      if (anchors.some(key => body.includes(key))) priority.push(index);
    });
    const query = [userPrompt, ...(source.fact?.keyTerms ?? [])].join(' ');
    const ranked = bm25(query, passages.map((passage, index) => ({ row: index, tokens: tokenize(passage) })));
    priority.push(...ranked.map(hit => hit.row));
  }
  priority.push(...passages.keys());

  const chosen = new Set<number>();
  let used = 0;
  for (const index of priority) {
    if (chosen.has(index)) continue;
    const cost = estimateTokens(passages[index]!) + 8;
    if (used + cost > budgetTokens) continue;
    chosen.add(index);
    used += cost;
  }
  if (!chosen.size) return { text: fitToBudget(passages[0] ?? '', budgetTokens).text, partial: true };

  const ordered = [...chosen].sort((a, b) => a - b);
  const parts: string[] = [];
  ordered.forEach((index, i) => {
    if (i === 0 && index > 0) parts.push('[… 앞 생략 …]');
    if (i > 0 && index !== ordered[i - 1]! + 1) parts.push('[… 중략 …]');
    parts.push(passages[index]!);
  });
  if (ordered.at(-1)! < passages.length - 1) parts.push('[… 뒤 생략 …]');
  return { text: parts.join('\n'), partial: true };
}

function heading(source: ReferenceSource, index: number): string {
  const origin = source.origin === 'onnara' ? '온나라 관련정보' : source.origin === 'tongdal' ? 'TONGDAL 서고' : '내 참고자료';
  const type = source.docType ? ` · ${source.docType}` : '';
  const number = source.docNumber ? ` (문서번호: ${source.docNumber})` : '';
  return source.role === 'example'
    ? `[작성 예시 ${index} — 구성·번호 체계·문체만 본뜨고, 이 문서의 날짜·금액·기관·사업 내용은 인용하지 말 것] ${source.title}${number} (${origin}${type})`
    : `[참고 문서 ${index}] ${source.title}${number} (${origin}${type})`;
}

export function buildReferenceContext(sources: ReferenceSource[], userPrompt: string, budgetTokens: number): ReferenceContext {
  const selected = sources.slice(0, MAX_SELECTED_REFS);
  const share = Math.floor(budgetTokens / Math.max(1, selected.length));
  const blocks: string[] = [];
  const partial: string[] = [];
  let factIndex = 0;
  let exampleIndex = 0;

  for (const source of selected) {
    const index = source.role === 'example' ? ++exampleIndex : ++factIndex;
    const lines = [heading(source, index)];
    const card = source.role === 'example' ? exampleCard(source) : factCard(source);
    if (card.length) lines.push('■ 원문과 대조를 마친 핵심 정보', ...card);
    if (source.memo?.trim()) lines.push('■ 작성자 메모(이 자료에 대한 요구사항)', source.memo.trim());
    let head = lines.join('\n');
    // 카드가 몫의 60%를 넘으면 카드도 줄인다. 원문 자리를 조금은 남긴다.
    if (estimateTokens(head) > share * 0.6) head = fitToBudget(head, Math.floor(share * 0.6)).text;

    let remaining = share - estimateTokens(head) - 16;
    let notes = '';
    if (source.notes?.trim()) {
      notes = fitToBudget(source.notes.trim(), Math.floor(remaining * 0.4)).text;
      remaining -= estimateTokens(notes) + 8;
    }
    const excerptBudget = source.role === 'example' ? Math.min(remaining, EXAMPLE_EXCERPT_TOKENS) : remaining;
    const excerpt = selectExcerpt(source, userPrompt, excerptBudget);
    if (excerpt.partial && source.role === 'fact') partial.push(source.title);

    const parts = [head];
    if (notes) parts.push('■ 원문 전 구간 분석 노트', notes);
    if (excerpt.text) {
      parts.push(excerpt.partial ? '■ 원문 발췌(일부 구간)' : '■ 원문 전문', '<<<', excerpt.text, '>>>');
    }
    blocks.push(parts.join('\n'));
  }

  return {
    text: blocks.join('\n\n'),
    partial,
    hasFact: selected.some(source => source.role === 'fact'),
    hasExample: selected.some(source => source.role === 'example'),
  };
}

/* ── 생성 후 사실 대조 ─────────────────────────────────── */

export interface UnsupportedFact { kind: 'date' | 'amount'; text: string }

/**
 * 초안에 나온 날짜·금액 중 근거 자료(내용 근거 원문 + 메모 + 작성 요청) 어디에도 없는 것을 찾는다.
 * 작성 예시의 원문은 근거로 치지 않는다 — 예시의 날짜가 옮겨 적혔다면 그것이 바로 잡아야 할 사고다.
 */
export function findUnsupportedFacts(draft: string, sources: ReferenceSource[], userPrompt: string): UnsupportedFact[] {
  const evidence = [
    userPrompt,
    ...sources.flatMap(source => [source.memo ?? '', source.role === 'fact' ? source.text : '']),
  ].join('\n');
  const evidenceDates = findDates(evidence);
  const evidenceAmounts = new Set(findAmounts(evidence).map(amountValue).filter((v): v is number => v !== null));
  const out: UnsupportedFact[] = [];
  const seen = new Set<string>();
  for (const date of findDates(draft)) {
    if (evidenceDates.some(known => sameDate(known, date)) || seen.has(date.text)) continue;
    seen.add(date.text);
    out.push({ kind: 'date', text: date.text });
  }
  for (const amount of findAmounts(draft)) {
    const value = amountValue(amount);
    if (value === null || evidenceAmounts.has(value) || seen.has(amount)) continue;
    seen.add(amount);
    out.push({ kind: 'amount', text: amount });
  }
  return out;
}
