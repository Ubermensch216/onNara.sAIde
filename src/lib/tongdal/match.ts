/**
 * 검색 결과가 검색어를 **실제로 담고 있는가**.
 *
 * ★ TONGDAL 검색은 벡터 검색을 섞는다. 벡터 검색은 거리 하한 없이 "가장 가까운" 청크를 늘 돌려주므로,
 *   지식 공간에 없는 낱말로 찾아도 결과가 나온다. 자료가 몇 건뿐인 공간에서는 무엇을 찾든 같은 문서가
 *   나와 "검색해도 바뀌지 않는다"로 보이고, "없다"는 말은 끝내 나오지 않는다.
 * ★ 그래서 화면은 낱말이 들어 있는 결과와, 의미만 가까운 결과를 나눠 보인다. 낱말 일치가 하나도 없으면
 *   "없다"고 먼저 말하고, 의미가 가까운 자료는 사용자가 원할 때만 펼친다.
 * ★ 한 글자 낱말(조사·단위)은 대조하지 않는다. 거의 모든 문서에 들어 있어 일치 표시가 무의미해진다.
 */

import type { TongdalSearchHit } from './types';

const normalize = (text: string) => text.normalize('NFC').toLocaleLowerCase('ko');

export function queryTerms(query: string): string[] {
  const words = [...new Set(normalize(query).split(/\s+/).map(word => word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')).filter(Boolean))];
  const meaningful = words.filter(word => word.length >= 2);
  return meaningful.length ? meaningful : words;
}

export function matchesQuery(hit: Pick<TongdalSearchHit, 'title' | 'fileName' | 'relativePath' | 'sectionPath' | 'text'>, terms: string[]): boolean {
  if (!terms.length) return false;
  const haystack = normalize([hit.title, hit.fileName, hit.relativePath, hit.sectionPath, hit.text].join('\n'));
  return terms.some(term => haystack.includes(term));
}

/** 같은 문서의 여러 절이 나오면 첫 번째(순위가 가장 높은 것)만 남긴다. */
export function dedupeByDocument<T extends Pick<TongdalSearchHit, 'sourceDocumentId' | 'relativePath'>>(hits: T[]): T[] {
  const seen = new Set<string>();
  return hits.filter(hit => {
    const key = hit.sourceDocumentId ?? `path:${hit.relativePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 낱말이 든 결과와 의미만 가까운 결과로 나눈다. 각 묶음 안의 순위는 그대로 둔다. */
export function splitByMatch<T extends TongdalSearchHit>(hits: T[], query: string): { matched: T[]; related: T[] } {
  const terms = queryTerms(query);
  const matched: T[] = [];
  const related: T[] = [];
  for (const hit of hits) (matchesQuery(hit, terms) ? matched : related).push(hit);
  return { matched, related };
}
