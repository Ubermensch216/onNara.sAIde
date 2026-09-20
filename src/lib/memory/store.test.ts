/**
 * 페이지 기억. 계획서 §5 Phase 6-1 / 6-2 / 6-3 / 6-4
 *
 * ★ 여기서 지키는 것 셋.
 *   ① 사용자가 "저장하지 말라"고 한 것은 저장되지 않는다 — 서브도메인 포함.
 *   ② 같은 페이지를 다시 읽으면 옛 기록이 남지 않는다.
 *   ③ 검색 결과가 한 페이지의 조각으로 채워지지 않는다.
 *   ①은 프라이버시라 조용히 깨지면 안 되고, ②③은 조용히 깨져도 한참 뒤에야
 *   "검색이 이상하다"는 형태로 드러난다.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/storage/db';
import {
  chunkText,
  clearAll,
  dot,
  forgetDomain,
  normalize,
  prune,
  savePage,
  search,
  shouldRemember,
  stats,
} from './store';

const MODEL = 'bge-m3';

/** 방향만 다른 3차원 벡터로 검색을 검증한다. 1024차원일 필요가 없다. */
const V = {
  a: [1, 0, 0],
  b: [0, 1, 0],
  ab: [1, 1, 0],
};

beforeEach(async () => {
  await clearAll();
});

describe('벡터', () => {
  it('정규화하면 길이가 1이다', () => {
    const n = normalize([3, 4]);
    expect(Math.hypot(n[0]!, n[1]!)).toBeCloseTo(1);
  });

  it('영벡터는 0으로 나누지 않는다', () => {
    expect([...normalize([0, 0])]).toEqual([0, 0]);
  });

  it('정규화된 벡터의 내적이 코사인 유사도다', () => {
    expect(dot(normalize(V.a), normalize(V.a))).toBeCloseTo(1);
    expect(dot(normalize(V.a), normalize(V.b))).toBeCloseTo(0);
    expect(dot(normalize(V.a), normalize(V.ab))).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('조각내기', () => {
  it('문단 경계를 지킨다', () => {
    const text = ['가'.repeat(600), '나'.repeat(600)].join('\n\n');
    const chunks = chunkText(text, 400);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe('가'.repeat(600));
  });

  it('문단이 예산보다 크면 그때만 강제로 자른다', () => {
    const chunks = chunkText('다'.repeat(4000), 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('다'.repeat(4000).slice(0, chunks.join('').length));
  });

  it('상한을 넘지 않는다 — CPU 임베딩은 무한정 늘릴 수 없다', () => {
    const text = Array.from({ length: 50 }, (_, i) => `문단 ${i} ${'라'.repeat(900)}`).join('\n\n');
    expect(chunkText(text, 400, 4)).toHaveLength(4);
  });

  it('빈 조각을 만들지 않는다', () => {
    expect(chunkText('\n\n\n   \n\n')).toEqual([]);
  });
});

describe('저장', () => {
  it('조각마다 한 행씩 남는다', async () => {
    const n = await savePage({
      url: 'https://a.example.com/1',
      title: '가',
      chunks: ['하나', '둘'],
      vectors: [V.a, V.b],
      model: MODEL,
    });
    expect(n).toBe(2);
    expect((await stats()).chunks).toBe(2);
    expect((await stats()).pages).toBe(1);
  });

  // ★ 덮어쓰지 않으면 같은 페이지를 두 번 읽었을 때 검색이 그 페이지로 찬다.
  //   내용이 바뀌었다면 옛 조각은 이미 틀린 정보이기도 하다.
  it('같은 URL을 다시 저장하면 이전 기록이 남지 않는다', async () => {
    const url = 'https://a.example.com/1';
    await savePage({ url, title: '옛것', chunks: ['옛 내용'], vectors: [V.a], model: MODEL });
    await savePage({ url, title: '새것', chunks: ['새 내용'], vectors: [V.a], model: MODEL });

    const s = await stats();
    expect(s.chunks).toBe(1);
    const [hit] = await search(V.a, 5);
    expect(hit!.title).toBe('새것');
    expect(hit!.text).toBe('새 내용');
  });
});

describe('검색', () => {
  beforeEach(async () => {
    await savePage({
      url: 'https://a.example.com/1',
      title: 'A',
      chunks: ['a1', 'a2'],
      vectors: [V.a, V.ab],
      model: MODEL,
    });
    await savePage({
      url: 'https://b.example.com/1',
      title: 'B',
      chunks: ['b1'],
      vectors: [V.b],
      model: MODEL,
    });
  });

  it('가까운 것이 먼저 온다', async () => {
    const hits = await search(V.a, 5);
    expect(hits[0]!.url).toContain('a.example.com');
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  // ★ 이게 없으면 상위 5건이 한 페이지의 조각 다섯 개가 된다.
  it('한 페이지는 가장 잘 맞는 조각 하나로만 나온다', async () => {
    const hits = await search(V.a, 5);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.text).toBe('a1');
  });

  it('상한을 지킨다', async () => {
    expect(await search(V.a, 1)).toHaveLength(1);
  });

  // ★ 좌표계가 다른 벡터끼리 비교하면 점수가 아무 뜻도 없다.
  it('다른 모델로 만든 벡터와는 비교하지 않는다', async () => {
    expect(await search(V.a, 5, 'nomic-embed-text')).toHaveLength(0);
    expect(await search(V.a, 5, MODEL)).toHaveLength(2);
  });

  it('영벡터로는 검색하지 않는다', async () => {
    expect(await search([0, 0, 0], 5)).toEqual([]);
  });
});

/**
 * 하이브리드 검색 (B9 · 계획서 §7.3).
 *
 * ★ 공문 질의는 `2026-1234호`처럼 **정확히 그 글자**를 찾는 경우가 많다. 그런 표기는 의미
 *   공간에서 서로 가깝게 몰려 있어 벡터 단독으로는 1234호와 5678호를 가르지 못한다.
 */
describe('하이브리드 검색', () => {
  beforeEach(async () => {
    await savePage({
      url: 'https://a.example.com/1',
      title: '예산 편성 지침 통보',
      chunks: ['2026-1234호에 따라 예산을 편성한다'],
      // 질의 벡터와 가까운 쪽. 벡터만으로도 잘 걸린다.
      vectors: [V.a],
      model: MODEL,
    });
    await savePage({
      url: 'https://b.example.com/1',
      title: '실적 제출 요청',
      chunks: ['2026-5678호 실적을 제출하라'],
      // 질의 벡터와 직교한다. 벡터만으로는 절대 1위가 되지 않는다.
      vectors: [V.b],
      model: MODEL,
    });
  });

  it('질의 문장이 없으면 예전처럼 벡터 단독이다', async () => {
    const hits = await search(V.a, 5, MODEL);
    expect(hits[0]!.url).toContain('a.example.com');
    expect(hits[0]!.matched).toBeUndefined();
  });

  // ★ 이것이 하이브리드를 들인 이유다. 벡터 순위로는 꼴찌인 조각이 1위로 올라온다.
  it('★ 벡터가 놓친 문서번호를 키워드가 끌어올린다', async () => {
    const vectorOnly = await search(V.a, 5, MODEL);
    expect(vectorOnly[0]!.url).toContain('a.example.com');

    const hits = await search(V.a, 5, MODEL, { query: '2026-5678호' });
    expect(hits[0]!.url).toContain('b.example.com');
    expect(hits[0]!.keywordScore).toBeGreaterThan(0);
  });

  it('둘 다 걸린 조각은 both로 표시한다', async () => {
    const hits = await search(V.a, 5, MODEL, { query: '예산 편성' });
    const hit = hits.find(item => item.url.includes('a.example.com'))!;
    expect(hit.matched).toBe('both');
    expect(hit.vectorScore).toBeGreaterThan(0);
    expect(hit.keywordScore).toBeGreaterThan(0);
  });

  // ★ 임베딩 모델이 없거나 Ollama가 꺼져 있어도 "찾아는 준다"가 못 찾는 것보다 낫다.
  it('★ 임베딩이 없어도 질의 문장만으로 찾는다', async () => {
    const hits = await search([], 5, MODEL, { query: '실적 제출' });
    expect(hits[0]!.url).toContain('b.example.com');
  });

  it('최소 점수는 벡터 목록에만 건다 — 키워드로 걸린 것은 살아남는다', async () => {
    const hits = await search(V.a, 5, MODEL, { query: '2026-5678호', minScore: 0.9 });
    expect(hits.map(hit => hit.url)).toContain('https://b.example.com/1');
  });

  it('한 페이지는 여전히 조각 하나로만 나온다', async () => {
    await savePage({
      url: 'https://c.example.com/1',
      title: '교육 안내',
      chunks: ['예산 교육 1차 안내', '예산 교육 2차 안내'],
      vectors: [V.ab, V.a],
      model: MODEL,
    });
    const hits = await search(V.a, 5, MODEL, { query: '예산 교육' });
    expect(hits.filter(hit => hit.url.includes('c.example.com'))).toHaveLength(1);
  });
});

describe('통제 — 저장 범위', () => {
  it('제외 도메인은 서브도메인까지 막는다', () => {
    const ex = ['example.com'];
    expect(shouldRemember('https://example.com/x', ex)).toBe(false);
    expect(shouldRemember('https://mail.example.com/x', ex)).toBe(false);
    expect(shouldRemember('https://other.com/x', ex)).toBe(true);
  });

  // ★ notexample.com 은 example.com 의 서브도메인이 아니다.
  it('이름이 겹치기만 하는 도메인은 막지 않는다', () => {
    expect(shouldRemember('https://notexample.com/x', ['example.com'])).toBe(true);
  });

  it('앞의 점과 대소문자를 흘려 넘긴다', () => {
    expect(shouldRemember('https://Mail.Example.com/x', ['.EXAMPLE.com'])).toBe(false);
  });

  it('http/https가 아니면 저장하지 않는다', () => {
    expect(shouldRemember('file:///c:/secret.txt', [])).toBe(false);
    expect(shouldRemember('chrome://extensions', [])).toBe(false);
    expect(shouldRemember('not a url', [])).toBe(false);
  });

  it('빈 제외 항목은 무시한다 — 전부를 막지 않는다', () => {
    expect(shouldRemember('https://example.com/x', ['', '  '])).toBe(true);
  });
});

describe('통제 — 보관과 삭제', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_700_000_000_000;

  beforeEach(async () => {
    await savePage({
      url: 'https://old.example.com/1',
      title: '옛 페이지',
      chunks: ['옛것'],
      vectors: [V.a],
      model: MODEL,
      visitedAt: now - 40 * DAY,
    });
    await savePage({
      url: 'https://new.example.com/1',
      title: '새 페이지',
      chunks: ['새것'],
      vectors: [V.b],
      model: MODEL,
      visitedAt: now - 2 * DAY,
    });
  });

  it('보관 기간이 지난 것만 지운다', async () => {
    expect(await prune(30, now)).toBe(1);
    const hits = await search(V.a, 5);
    expect(hits.map((h) => h.title)).toEqual(['새 페이지']);
  });

  // ★ 0을 "전부 지운다"로 해석하면 사고가 난다. 무기한이라는 뜻이다.
  it('보관 기간 0은 무기한이다 — 아무것도 지우지 않는다', async () => {
    expect(await prune(0, now)).toBe(0);
    expect((await stats()).pages).toBe(2);
  });

  it('도메인 단위로 지운다', async () => {
    expect(await forgetDomain('old.example.com')).toBe(1);
    expect((await stats()).pages).toBe(1);
  });

  it('전량 삭제는 한 번에 비운다', async () => {
    await clearAll();
    expect(await stats()).toEqual({ pages: 0, chunks: 0, oldestAt: null });
  });

  it('가장 오래된 기록 시각을 알려준다 — 보관 기간 UI가 쓴다', async () => {
    expect((await stats()).oldestAt).toBe(now - 40 * DAY);
  });
});

describe('저장 형식', () => {
  it('벡터는 Float32Array로 남는다 — 계획서 6-1의 완료 기준', async () => {
    await savePage({
      url: 'https://a.example.com/1',
      title: 'A',
      chunks: ['x'],
      vectors: [V.a],
      model: MODEL,
    });
    const row = await db.table('pageVectors').toCollection().first();
    expect(row.vector).toBeInstanceOf(Float32Array);
  });
});
