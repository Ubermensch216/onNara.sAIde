/**
 * 임베딩 큐. 계획서 §5 Phase 6-1 주의사항
 *
 * ★ 여기서 지키는 것은 검색 품질이 아니라 **대화가 느려지지 않는 것**이다.
 *   16GB에 gemma(6.9GB)가 상주한 상태에서 bge-m3(1.2GB)를 아무 때나 올리면
 *   대화용 모델이 밀려나고, 사용자는 다음 질문에서 콜드 스타트 21초를 문다.
 *   "대화 중에는 돌지 않는다"와 "keep_alive 0"이 그 방어선이고, 둘 다
 *   깨져도 테스트 없이는 드러나지 않는다 — 그냥 가끔 느려질 뿐이다.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/storage/settings';
import * as client from '@/lib/ollama/client';
import { createEmbedQueue } from './queue';
import { clearAll, savePage, search, stats } from './store';

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  memoryEnabled: true,
  embedModel: 'bge-m3',
  ...over,
});

function harness(over: Partial<Settings> = {}, busy = false) {
  const onError = vi.fn();
  const onSaved = vi.fn();
  const q = createEmbedQueue({
    isBusy: () => busy,
    getSettings: () => settings(over),
    onError,
    onSaved,
  });
  return { q, onError, onSaved };
}

beforeEach(async () => {
  await clearAll();
  vi.restoreAllMocks();
});

/** 조각 수만큼 서로 다른 벡터를 돌려주는 가짜 임베더. */
function fakeEmbed() {
  return vi
    .spyOn(client, 'embed')
    .mockImplementation(async (_e, _m, input) => {
      const arr = Array.isArray(input) ? input : [input];
      return arr.map((_, i) => [i + 1, 1, 0]);
    });
}

describe('큐에 넣기', () => {
  it('기억이 꺼져 있으면 받지 않는다', () => {
    const { q } = harness({ memoryEnabled: false });
    expect(q.enqueue({ url: 'https://a.com/1', title: 'A', text: '내용' })).toBe(false);
    expect(q.size()).toBe(0);
  });

  it('제외 도메인은 받지 않는다', () => {
    const { q } = harness({ memoryExcludedDomains: ['bank.com'] });
    expect(q.enqueue({ url: 'https://bank.com/x', title: 'B', text: '내용' })).toBe(false);
    expect(q.enqueue({ url: 'https://sub.bank.com/x', title: 'B', text: '내용' })).toBe(false);
    expect(q.enqueue({ url: 'https://ok.com/x', title: 'O', text: '내용' })).toBe(true);
  });

  it('빈 본문은 받지 않는다', () => {
    const { q } = harness();
    expect(q.enqueue({ url: 'https://a.com/1', title: 'A', text: '   ' })).toBe(false);
  });

  it('같은 URL은 최신 것 하나만 남는다', () => {
    const { q } = harness();
    q.enqueue({ url: 'https://a.com/1', title: '옛', text: '옛 내용' });
    q.enqueue({ url: 'https://a.com/1', title: '새', text: '새 내용' });
    expect(q.size()).toBe(1);
  });

  it('상한을 넘으면 오래된 것부터 버린다', () => {
    const { q } = harness();
    for (let i = 0; i < 30; i++) {
      q.enqueue({ url: `https://a.com/${i}`, title: `${i}`, text: '내용' });
    }
    expect(q.size()).toBe(20);
  });
});

describe('처리', () => {
  it('조각을 임베딩해 저장한다', async () => {
    const spy = fakeEmbed();
    const { q, onSaved } = harness();
    q.enqueue({
      url: 'https://a.com/1',
      title: 'A',
      text: ['첫 문단입니다.', '둘째 문단입니다.'].join('\n\n'),
    });
    await q.drainNow();

    expect(spy).toHaveBeenCalledTimes(1);
    expect((await stats()).pages).toBe(1);
    expect(onSaved).toHaveBeenCalledWith('https://a.com/1', expect.any(Number));
    q.stop();
  });

  // ★ 이 두 가지가 계획서 6-1 주의사항의 전부다.
  it('대화 중에는 한 건도 처리하지 않는다', async () => {
    const spy = fakeEmbed();
    const { q } = harness({}, true);
    q.enqueue({ url: 'https://a.com/1', title: 'A', text: '내용' });
    await q.drainNow();

    expect(spy).not.toHaveBeenCalled();
    expect(q.size()).toBe(1); // 버리지 않고 들고 있는다
    q.stop();
  });

  it("keep_alive '0'으로 부른다 — 끝나면 즉시 내려가야 한다", async () => {
    const spy = fakeEmbed();
    const { q } = harness();
    q.enqueue({ url: 'https://a.com/1', title: 'A', text: '내용' });
    await q.drainNow();

    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      'bge-m3',
      expect.any(Array),
      '0',
      expect.any(AbortSignal),
    );
    q.stop();
  });

  it('임베딩 개수가 어긋나면 저장하지 않는다', async () => {
    // 벡터는 하나만 돌려주는데 조각은 여럿 나오도록 문단을 길게 잡는다.
    vi.spyOn(client, 'embed').mockResolvedValue([[1, 0, 0]]);
    const { q, onError } = harness();
    const long = (c: string) => c.repeat(900);
    q.enqueue({
      url: 'https://a.com/1',
      title: 'A',
      text: [long('가'), long('나'), long('다')].join('\n\n'),
    });
    await q.drainNow();

    expect(onError).toHaveBeenCalled();
    expect((await stats()).chunks).toBe(0);
    q.stop();
  });

  it('임베딩이 실패해도 큐가 죽지 않는다', async () => {
    vi.spyOn(client, 'embed').mockRejectedValueOnce(new Error('연결 끊김'));
    const { q, onError } = harness();
    q.enqueue({ url: 'https://a.com/1', title: 'A', text: '내용' });
    await q.drainNow();
    expect(onError).toHaveBeenCalled();

    fakeEmbed();
    q.enqueue({ url: 'https://b.com/1', title: 'B', text: '내용' });
    await q.drainNow();
    expect((await stats()).pages).toBe(1);
    q.stop();
  });

  it('처리 중 기억이 꺼지면 대기 중인 것을 버린다', async () => {
    const spy = fakeEmbed();
    let on = true;
    const q = createEmbedQueue({
      isBusy: () => false,
      getSettings: () => settings({ memoryEnabled: on }),
    });
    q.enqueue({ url: 'https://a.com/1', title: 'A', text: '내용' });
    on = false;
    await q.drainNow();

    expect(spy).not.toHaveBeenCalled();
    expect(q.size()).toBe(0);
    q.stop();
  });

  it('저장한 것이 검색된다 — 끝에서 끝까지', async () => {
    fakeEmbed();
    const { q } = harness();
    q.enqueue({ url: 'https://a.com/1', title: '검색될 페이지', text: '내용입니다' });
    await q.drainNow();

    const hits = await search([1, 1, 0], 5, 'bge-m3');
    expect(hits[0]!.title).toBe('검색될 페이지');
    q.stop();
  });
});

describe('청소', () => {
  it('보관 기간이 지난 것을 지운다', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    await savePage({
      url: 'https://old.com/1',
      title: '옛',
      chunks: ['옛것'],
      vectors: [[1, 0, 0]],
      model: 'bge-m3',
      visitedAt: Date.now() - 40 * DAY,
    });
    const { q } = harness({ memoryRetentionDays: 30 });
    expect(await q.sweep()).toBe(1);
    q.stop();
  });

  it('기억이 꺼져 있으면 청소도 하지 않는다 — 끄는 것은 삭제가 아니다', async () => {
    await savePage({
      url: 'https://old.com/1',
      title: '옛',
      chunks: ['옛것'],
      vectors: [[1, 0, 0]],
      model: 'bge-m3',
      visitedAt: 0,
    });
    const { q } = harness({ memoryEnabled: false, memoryRetentionDays: 1 });
    expect(await q.sweep()).toBe(0);
    expect((await stats()).pages).toBe(1);
    q.stop();
  });
});
