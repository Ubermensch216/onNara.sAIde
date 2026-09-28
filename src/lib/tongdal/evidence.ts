/**
 * 채팅 "내 지식 포함"에 넣을 근거 고르기.
 *
 * ★ 예산이 먼저다. TONGDAL 검색 결과는 부모 절 문맥이라 한 건이 수천 자일 수 있고,
 *   num_ctx 4096에서 그대로 다 넣으면 답할 자리가 없다(계획서 G7). 남은 예산을 결과 수로 나눠
 *   건마다 자르고, 한 건에 줄 몫이 너무 작아지면 건수를 줄인다.
 */

import { estimateTokens } from '@/lib/extract/budget';
import type { KnowledgeEvidence } from '@/lib/prompts/knowledge';
import type { TongdalSearchHit } from './types';

/** 답변 카드에 남기는 출처. 대화 기록에 저장된다(StoredMessage.sources). */
export interface KnowledgeSource {
  n: number;
  documentId: string | null;
  title: string;
  relativePath: string;
  sectionPath: string;
  pageStart: number | null;
  pageEnd: number | null;
}

/** 근거 한 건에 적어도 이만큼은 준다. 이보다 작으면 문맥 없는 조각이 되어 오히려 해롭다. */
export const MIN_TOKENS_PER_ITEM = 180;
/** 근거 전체 상한. 프리필 131 tok/s에서 약 11초. */
export const MAX_EVIDENCE_TOKENS = 1500;

export function pageLabel(hit: Pick<TongdalSearchHit, 'pageStart' | 'pageEnd'>): string {
  if (!hit.pageStart) return '';
  return hit.pageEnd && hit.pageEnd !== hit.pageStart ? `${hit.pageStart}–${hit.pageEnd}쪽` : `${hit.pageStart}쪽`;
}

export function locationOf(hit: Pick<TongdalSearchHit, 'relativePath' | 'sectionPath' | 'pageStart' | 'pageEnd'>): string {
  return [hit.relativePath, hit.sectionPath, pageLabel(hit)].filter(Boolean).join(' · ');
}

/** 토큰 예산에 맞게 자른다. 글자 비율은 본문에서 추정한다. */
function clip(text: string, tokens: number): string {
  if (estimateTokens(text) <= tokens) return text;
  const perToken = text.length / Math.max(1, estimateTokens(text));
  const chars = Math.max(0, Math.floor(tokens * perToken) - 1);
  return `${text.slice(0, chars).trimEnd()}…`;
}

export function selectEvidence(hits: TongdalSearchHit[], budgetTokens: number): { evidence: KnowledgeEvidence[]; sources: KnowledgeSource[] } {
  const budget = Math.min(MAX_EVIDENCE_TOKENS, Math.max(0, Math.floor(budgetTokens)));
  const usable = hits.filter(hit => hit.text.trim());
  const count = Math.min(usable.length, Math.floor(budget / MIN_TOKENS_PER_ITEM));
  if (count <= 0) return { evidence: [], sources: [] };
  const per = Math.floor(budget / count);

  const chosen = usable.slice(0, count);
  return {
    evidence: chosen.map((hit, index) => ({
      n: index + 1,
      title: hit.title,
      location: locationOf(hit),
      text: clip(hit.text.trim(), per),
    })),
    sources: chosen.map((hit, index) => ({
      n: index + 1,
      documentId: hit.sourceDocumentId,
      title: hit.title,
      relativePath: hit.relativePath,
      sectionPath: hit.sectionPath,
      pageStart: hit.pageStart,
      pageEnd: hit.pageEnd,
    })),
  };
}
