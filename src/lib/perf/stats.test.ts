import { describe, expect, it } from 'vitest';
import { bucketOf, summarize } from './stats';
import type { PerfSample } from '@/types/ollama';

function sample(over: Partial<PerfSample> = {}): PerfSample {
  return {
    ttfbMs: 2000,
    prefillTokPerSec: 131,
    decodeTokPerSec: 21,
    promptTokens: 200,
    outputTokens: 100,
    totalMs: 7000,
    wasCold: false,
    ...over,
  };
}

describe('구간 분류 (계획서 §6)', () => {
  it('프롬프트 크기로 나눈다', () => {
    expect(bucketOf(100)).toBe('short');
    expect(bucketOf(500)).toBe('selection');
    expect(bucketOf(2500)).toBe('page');
    expect(bucketOf(12000)).toBe('huge');
  });
});

describe('집계', () => {
  it('표본이 없으면 목표 달성 여부를 단정하지 않는다', () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    for (const b of s.buckets) expect(b.meetsTarget).toBeNull();
  });

  /**
   * 콜드 스타트 한 번이 평균을 망가뜨린다. 중앙값이어야 사용자가 체감하는
   * "보통 얼마나 걸리는가"에 맞는다.
   */
  it('콜드 스타트는 목표 대조에서 빼고 따로 센다', () => {
    const s = summarize([
      sample({ ttfbMs: 1500 }),
      sample({ ttfbMs: 1700 }),
      sample({ ttfbMs: 22000, wasCold: true }),
    ]);

    expect(s.coldCount).toBe(1);
    expect(s.medianTtfbSec).toBe(1.6);
    expect(s.buckets.find((b) => b.id === 'short')?.count).toBe(2);
    expect(s.buckets.find((b) => b.id === 'short')?.meetsTarget).toBe(true);
  });

  it('목표를 넘기면 미달로 표시한다', () => {
    const s = summarize([
      sample({ promptTokens: 2500, ttfbMs: 30_000 }),
      sample({ promptTokens: 2500, ttfbMs: 32_000 }),
    ]);
    const page = s.buckets.find((b) => b.id === 'page')!;
    expect(page.medianTtfbSec).toBe(31);
    expect(page.meetsTarget).toBe(false);
  });

  it('토큰 총량은 콜드 표본까지 합산한다', () => {
    const s = summarize([
      sample({ promptTokens: 100, outputTokens: 50 }),
      sample({ promptTokens: 200, outputTokens: 70, wasCold: true }),
    ]);
    expect(s.totalPromptTokens).toBe(300);
    expect(s.totalOutputTokens).toBe(120);
  });

  /** 하드웨어가 바뀌면 §6 목표와 기본 설정값을 다시 잡아야 한다. */
  it('프리필이 기준선의 3배를 넘으면 하드웨어 변경 신호를 켠다', () => {
    expect(summarize([sample({ prefillTokPerSec: 140 })]).looksFasterThanBaseline).toBe(false);
    expect(summarize([sample({ prefillTokPerSec: 900 })]).looksFasterThanBaseline).toBe(true);
  });

  it('0 값은 중앙값 계산에서 제외한다 — 계측 실패 표본이다', () => {
    const s = summarize([
      sample({ decodeTokPerSec: 0 }),
      sample({ decodeTokPerSec: 20 }),
      sample({ decodeTokPerSec: 22 }),
    ]);
    expect(s.medianDecodeTokPerSec).toBe(21);
  });
});
