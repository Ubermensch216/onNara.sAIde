/**
 * 채팅 "내 지식 포함" — 질문으로 TONGDAL.ai를 검색해 근거를 만든다.
 *
 * ★ 조용히 넘어가지 않는다(계획서 G6). 연결이 없거나 검색이 실패하거나 결과가 없으면
 *   근거 없이 답하되, 그 사실을 답변 위 안내(notice)로 남긴다. 사용자는 이 답이
 *   내 자료를 본 답인지 아닌지를 늘 알 수 있어야 한다.
 */

import { t } from '@/lib/i18n';
import type { KnowledgeEvidence } from '@/lib/prompts/knowledge';
import { search, TongdalError } from './client';
import { isPaired, loadConnection } from './connection';
import { pinExcerpts, selectEvidence, MIN_TOKENS_PER_ITEM, type KnowledgeSource } from './evidence';

/** 근거를 붙이지 못한 사유. 근거 필수 모드가 거절 문구를 고를 때 쓴다(grounding.ts). */
export type KnowledgeMissing = 'noBudget' | 'notPaired' | 'unavailable' | 'noResults';

export interface GatheredKnowledge {
  evidence: KnowledgeEvidence[];
  sources: KnowledgeSource[];
  /** 답변 위에 남길 안내. 근거를 정상적으로 붙였으면 키워드 전용 여부만 알린다. */
  notice?: string;
  /** 근거가 비었을 때만 있다. */
  missing?: { code: KnowledgeMissing; reason?: string };
}

/** 검색할 결과 수. 예산이 모자라면 selectEvidence가 더 줄인다. */
const SEARCH_TOP_K = 4;

export async function gatherKnowledge(question: string, budgetTokens: number, signal?: AbortSignal): Promise<GatheredKnowledge> {
  const empty = (code: KnowledgeMissing, reason?: string): GatheredKnowledge => ({
    evidence: [], sources: [],
    notice: code === 'unavailable' ? t('tongdal.chat.unavailable', { reason: reason ?? '' }) : t(`tongdal.chat.${code}`),
    missing: { code, ...(reason ? { reason } : {}) },
  });
  if (budgetTokens < MIN_TOKENS_PER_ITEM) return empty('noBudget');

  const connection = await loadConnection();
  if (!isPaired(connection)) return empty('notPaired');

  let result;
  try {
    result = await search(connection, { query: question.slice(0, 500), topK: SEARCH_TOP_K, maxChars: 3000 }, signal);
  } catch (error) {
    if (error instanceof TongdalError && error.code === 'aborted') throw error;
    return empty('unavailable', error instanceof Error ? error.message : String(error));
  }

  if (!result.results.length) return empty('noResults');
  const { evidence, sources } = selectEvidence(result.results, budgetTokens);
  if (!evidence.length) return empty('noBudget');
  return {
    evidence,
    sources: await pinExcerpts(evidence, sources),
    notice: result.searchMode === 'keyword' ? t('tongdal.chat.keywordOnly') : undefined,
  };
}
