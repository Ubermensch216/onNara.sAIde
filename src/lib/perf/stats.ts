/**
 * 성능 계측 집계. 계획서 §5 Phase 7-1 / §6
 *
 * ★ 왜 필요한가.
 *   §6의 성능 목표는 2026-08-19에 이 컴퓨터에서 잰 값이다. 하드웨어가 바뀌거나
 *   모델을 바꾸면 전부 다시 재야 하는데(계획서 부록 A), 그때마다 손으로 스크립트를
 *   돌리게 두면 아무도 재지 않는다. 실사용 중에 이미 쌓이고 있는 `DoneChunk`
 *   기록으로 목표 대조표를 만들어 두면 재측정이 공짜가 된다.
 *
 * ★ 평균이 아니라 **중앙값**을 쓴다.
 *   콜드 스타트 한 번(21.5초)이 평균을 통째로 망가뜨린다. 사용자가 체감하는
 *   값은 "보통 얼마나 걸리는가"이므로 중앙값이 맞다. 콜드는 따로 센다.
 */

import type { PerfSample } from '@/types/ollama';

/**
 * 프롬프트 크기로 나눈 작업 구간. 계획서 §6 표와 같은 구분이다.
 * 경계는 §6의 "프롬프트 규모" 열에서 그대로 가져왔다.
 */
export type Bucket = 'short' | 'selection' | 'page' | 'huge';

export interface BucketSpec {
  id: Bucket;
  /** 이 구간에 들어오는 프롬프트 토큰 상한(미만) */
  maxTokens: number;
  /** §6이 정한 첫 토큰 목표(초). 콜드 스타트는 제외한 값이다. */
  targetTtfbSec: number;
}

/**
 * ★ 표시 이름은 여기 두지 않는다. 화면에 보일 문자열은 로케일을 타므로
 *   `id`로 카탈로그(`perf.bucket.*`)를 찾아 쓴다. 이 모듈은 순수 계산이다.
 */
export const BUCKETS: BucketSpec[] = [
  { id: 'short', maxTokens: 300, targetTtfbSec: 2 },
  { id: 'selection', maxTokens: 800, targetTtfbSec: 8 },
  { id: 'page', maxTokens: 3000, targetTtfbSec: 20 },
  { id: 'huge', maxTokens: Number.POSITIVE_INFINITY, targetTtfbSec: 60 },
];

export function bucketOf(promptTokens: number): Bucket {
  return (BUCKETS.find((b) => promptTokens < b.maxTokens) ?? BUCKETS[BUCKETS.length - 1]!).id;
}

export interface BucketStat {
  id: Bucket;
  count: number;
  /** 중앙값 TTFB(초). 콜드 스타트 표본은 뺀 값이다. */
  medianTtfbSec: number;
  targetTtfbSec: number;
  /** 목표 이내인가. 표본이 없으면 null — "달성"도 "미달"도 아니다. */
  meetsTarget: boolean | null;
}

export interface PerfSummary {
  total: number;
  /** 콜드 스타트 표본 수. 목표 대조에서는 빼고 따로 보여준다. */
  coldCount: number;
  medianPrefillTokPerSec: number;
  medianDecodeTokPerSec: number;
  medianTtfbSec: number;
  /** 지금까지 모델이 실제로 읽은 총 프롬프트 토큰. 비용 감각용. */
  totalPromptTokens: number;
  totalOutputTokens: number;
  buckets: BucketStat[];
  /**
   * GPU로 옮겼는지 판별하는 신호.
   * 실측 기준선(131 tok/s)의 3배를 넘으면 하드웨어가 바뀐 것으로 본다 —
   * 그때는 §6 목표와 기본 설정값을 다시 잡아야 한다.
   */
  looksFasterThanBaseline: boolean;
}

export const BASELINE_PREFILL_TOK_PER_SEC = 131;

export function summarize(samples: PerfSample[]): PerfSummary {
  const warm = samples.filter((s) => !s.wasCold);

  const buckets: BucketStat[] = BUCKETS.map((spec) => {
    const inBucket = warm.filter((s) => bucketOf(s.promptTokens) === spec.id);
    const med = median(inBucket.map((s) => s.ttfbMs / 1000));
    return {
      id: spec.id,
      count: inBucket.length,
      medianTtfbSec: round1(med),
      targetTtfbSec: spec.targetTtfbSec,
      meetsTarget: inBucket.length === 0 ? null : med <= spec.targetTtfbSec,
    };
  });

  const prefill = median(warm.map((s) => s.prefillTokPerSec).filter((v) => v > 0));

  return {
    total: samples.length,
    coldCount: samples.length - warm.length,
    medianPrefillTokPerSec: Math.round(prefill),
    medianDecodeTokPerSec: Math.round(median(warm.map((s) => s.decodeTokPerSec).filter((v) => v > 0))),
    medianTtfbSec: round1(median(warm.map((s) => s.ttfbMs / 1000))),
    totalPromptTokens: samples.reduce((sum, s) => sum + s.promptTokens, 0),
    totalOutputTokens: samples.reduce((sum, s) => sum + s.outputTokens, 0),
    buckets,
    looksFasterThanBaseline: prefill > BASELINE_PREFILL_TOK_PER_SEC * 3,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
