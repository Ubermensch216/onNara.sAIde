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
import { selectEvidence, MIN_TOKENS_PER_ITEM, type KnowledgeSource } from './evidence';

export interface GatheredKnowledge {
  evidence: KnowledgeEvidence[];
  sources: KnowledgeSource[];
  /** 답변 위에 남길 안내. 근거를 정상적으로 붙였으면 키워드 전용 여부만 알린다. */
  notice?: string;
}

/** 검색할 결과 수. 예산이 모자라면 selectEvidence가 더 줄인다. */
const SEARCH_TOP_K = 4;

export async function gatherKnowledge(question: string, budgetTokens: number, signal?: AbortSignal): Promise<GatheredKnowledge> {
  const empty = (notice: string): GatheredKnowledge => ({ evidence: [], sources: [], notice });
  if (budgetTokens < MIN_TOKENS_PER_ITEM) return empty(t('tongdal.chat.noBudget'));

  const connection = await loadConnection();
  if (!isPaired(connection)) return empty(t('tongdal.chat.notPaired'));

  let result;
  try {
    result = await search(connection, { query: question.slice(0, 500), topK: SEARCH_TOP_K, maxChars: 3000 }, signal);
  } catch (error) {
    if (error instanceof TongdalError && error.code === 'aborted') throw error;
    const reason = error instanceof Error ? error.message : String(error);
    return empty(t('tongdal.chat.unavailable', { reason }));
  }

  if (!result.results.length) return empty(t('tongdal.chat.noResults'));
  const { evidence, sources } = selectEvidence(result.results, budgetTokens);
  if (!evidence.length) return empty(t('tongdal.chat.noBudget'));
  return {
    evidence,
    sources,
    notice: result.searchMode === 'keyword' ? t('tongdal.chat.keywordOnly') : undefined,
  };
}
