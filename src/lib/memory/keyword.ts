/**
 * 키워드 검색 (B9 · 계획서 §7.3 "키워드 색인 + RRF").
 *
 * ★ 왜 벡터만으로는 모자란가.
 *   공문 질의는 `2026-1234호`, `지방재정법`, `제3차 기본계획`처럼 **정확히 그 글자**를 찾는
 *   경우가 많다. bge-m3는 뜻이 가까운 글을 잘 찾지만, 숫자가 섞인 고유 표기는 의미 공간에서
 *   서로 가깝게 몰려 있어 1234호와 5678호를 가르지 못한다. 그 구간은 키워드가 이긴다.
 *
 * ★ 색인 테이블을 따로 두지 않는다.
 *   검색은 어차피 전량 스캔이다(store.ts 머리말). 조각 수천 개에서 토큰을 세는 비용은
 *   1024차원 내적과 같은 자릿수라, 스키마를 하나 더 늘릴 값이 되지 않는다. 조각 수가
 *   수만을 넘어가면 그때 역색인을 만든다.
 *
 * ★ 한국어는 띄어쓰기만으로 자르면 조사에 걸린다.
 *   `예산을`·`예산은`·`예산의`가 모두 다른 토큰이 된다. 그래서 낱말 토큰과 함께
 *   **한글 2-gram**을 만든다. `예산편성` → `예산`,`산편`,`편성`. 조사가 붙어도 앞쪽 2-gram이
 *   그대로 남아 걸린다. 형태소 분석기를 넣지 않고 얻는 가장 값싼 대안이다.
 */

/** BM25 항. 문서 길이 정규화 정도. 표준값을 쓴다. */
const B = 0.75;
/** BM25 항. 같은 낱말이 여러 번 나와도 점수가 무한히 오르지 않게 한다. */
const K1 = 1.2;
/** 너무 흔해 변별력이 없는 2-gram을 버리는 문서 비율 상한. */
const MAX_DOC_RATIO = 0.6;

/**
 * 검색용 토큰으로 자른다.
 *
 * - 한글·영숫자 덩어리를 낱말로 삼는다.
 * - 한글 덩어리는 2-gram도 함께 낸다(조사 대응).
 * - 한 글자 낱말은 버린다. 변별력이 없고 2-gram과 겹친다.
 */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[가-힣]+|[a-z0-9]+(?:[.\-_/][a-z0-9]+)*/g) ?? [];
  const out: string[] = [];
  for (const word of words) {
    if (word.length >= 2) out.push(word);
    if (/^[가-힣]+$/.test(word) && word.length >= 2) {
      for (let i = 0; i + 2 <= word.length; i++) out.push(word.slice(i, i + 2));
    }
  }
  return out;
}

export interface KeywordDoc<T> {
  row: T;
  tokens: string[];
}

export interface KeywordHit<T> {
  row: T;
  score: number;
}

/**
 * BM25로 점수를 매겨 높은 순으로 돌려준다. 점수가 0인 것은 넣지 않는다.
 *
 * ★ 문서가 적을 때 IDF가 음수가 되는 구간이 있어 0에서 자른다. 음수 IDF를 그대로 쓰면
 *   흔한 낱말을 가진 조각이 아예 없는 조각보다 낮게 나온다.
 */
export function bm25<T>(query: string, docs: Array<KeywordDoc<T>>): Array<KeywordHit<T>> {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !docs.length) return [];

  const avgLen = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / docs.length || 1;
  const counts = docs.map(doc => {
    const map = new Map<string, number>();
    for (const token of doc.tokens) map.set(token, (map.get(token) ?? 0) + 1);
    return map;
  });

  const hits: Array<KeywordHit<T>> = [];
  for (const [index, doc] of docs.entries()) {
    let score = 0;
    for (const term of terms) {
      const freq = counts[index]!.get(term) ?? 0;
      if (!freq) continue;
      const containing = counts.reduce((n, map) => n + (map.has(term) ? 1 : 0), 0);
      // 거의 모든 조각에 있는 2-gram은 잡음이다.
      if (containing / docs.length > MAX_DOC_RATIO && term.length <= 2) continue;
      const idf = Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5));
      if (idf <= 0) continue;
      const norm = 1 - B + B * (doc.tokens.length / avgLen);
      score += idf * ((freq * (K1 + 1)) / (freq + K1 * norm));
    }
    if (score > 0) hits.push({ row: doc.row, score });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** RRF 상수. 60은 원 논문의 기본값이고, 상위권의 순위 차이를 과하게 벌리지 않는다. */
export const RRF_K = 60;

/**
 * 순위 융합 (Reciprocal Rank Fusion).
 *
 * ★ 점수를 직접 더하지 않는 이유: 코사인 유사도(0~1)와 BM25(상한 없음)는 자릿수가 달라
 *   정규화 없이 더하면 한쪽이 항상 이긴다. 정규화 상수는 자료에 따라 계속 바뀐다.
 *   RRF는 **순위만** 쓰므로 두 점수 체계를 손대지 않고 섞을 수 있다.
 *
 * ★ 한쪽에만 있는 항목도 살아남는다. 그것이 이 기능의 요점이다 —
 *   벡터가 놓친 `2026-1234호`를 키워드가 끌어올린다.
 */
export function fuseByRank<T>(
  lists: Array<Array<T>>,
  keyOf: (item: T) => string,
  k = RRF_K,
): Array<{ item: T; score: number; ranks: Array<number | null> }> {
  const merged = new Map<string, { item: T; score: number; ranks: Array<number | null> }>();
  for (const [listIndex, list] of lists.entries()) {
    for (const [rank, item] of list.entries()) {
      const key = keyOf(item);
      const entry = merged.get(key) ?? { item, score: 0, ranks: lists.map(() => null) };
      entry.score += 1 / (k + rank + 1);
      entry.ranks[listIndex] = rank + 1;
      merged.set(key, entry);
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}
