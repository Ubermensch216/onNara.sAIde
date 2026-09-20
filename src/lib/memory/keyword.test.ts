/**
 * 키워드 검색과 순위 융합 (B9).
 *
 * ★ 여기서 지키는 것 셋.
 *   ① 조사가 붙어도 걸린다. `예산을`과 `예산 편성`이 서로를 찾지 못하면 한국어 검색이 아니다.
 *   ② 문서번호·법령명처럼 **정확히 그 글자**를 찾는 질의에서 해당 조각이 1위로 온다.
 *      이것이 벡터 단독으로는 되지 않아 하이브리드를 들인 이유다.
 *   ③ RRF는 한쪽 목록에만 있는 항목도 살린다. 그래야 벡터가 놓친 것을 키워드가 끌어올린다.
 */

import { describe, expect, it } from 'vitest';
import { bm25, fuseByRank, tokenize } from './keyword';

describe('토큰 나누기', () => {
  it('한글 덩어리에서 2-gram을 함께 낸다', () => {
    expect(tokenize('예산편성')).toEqual(['예산편성', '예산', '산편', '편성']);
  });

  // ★ 형태소 분석기 없이 조사를 넘기는 방법이 이것뿐이다.
  it('★ 조사가 붙어도 앞쪽 2-gram이 남는다', () => {
    const a = new Set(tokenize('예산을 편성한다'));
    const b = new Set(tokenize('예산 편성 지침'));
    expect([...a].some(token => b.has(token))).toBe(true);
  });

  it('문서번호 같은 영숫자 표기를 한 덩어리로 둔다', () => {
    expect(tokenize('2026-1234호 관련')).toContain('2026-1234');
  });

  it('한 글자 낱말은 버린다', () => {
    expect(tokenize('이 안')).toEqual([]);
  });
});

describe('BM25', () => {
  const docs = [
    { row: 'A', tokens: tokenize('2026-1234호 예산 편성 지침 통보') },
    { row: 'B', tokens: tokenize('2026-5678호 실적 제출 요청') },
    { row: 'C', tokens: tokenize('직원 교육 신청 안내') },
  ];

  // ★ 벡터는 1234호와 5678호를 가르지 못한다. 그 구간을 키워드가 맡는다.
  it('★ 문서번호로 찾으면 그 문서가 1위다', () => {
    expect(bm25('2026-5678호', docs)[0]!.row).toBe('B');
  });

  it('걸리지 않는 문서는 목록에 넣지 않는다', () => {
    expect(bm25('교육', docs).map(hit => hit.row)).toEqual(['C']);
  });

  it('질의에 쓸 만한 낱말이 없으면 빈 목록이다', () => {
    expect(bm25('   ', docs)).toEqual([]);
  });
});

describe('순위 융합(RRF)', () => {
  it('두 목록에 모두 상위인 것이 가장 높다', () => {
    const fused = fuseByRank([['a', 'b', 'c'], ['b', 'a', 'd']], item => item);
    expect(fused[0]!.item).toBe('a');
  });

  // ★ 이게 깨지면 하이브리드가 아니라 벡터 검색에 잡음을 더한 것이 된다.
  it('★ 한쪽 목록에만 있는 항목도 살아남는다', () => {
    const fused = fuseByRank([['a', 'b'], ['z']], item => item);
    expect(fused.map(entry => entry.item)).toContain('z');
  });

  it('어느 목록의 몇 위였는지를 남긴다', () => {
    const fused = fuseByRank([['a', 'b'], ['b']], item => item);
    const b = fused.find(entry => entry.item === 'b')!;
    expect(b.ranks).toEqual([2, 1]);
  });
});
