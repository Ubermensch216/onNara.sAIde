/**
 * 토큰 예산 테스트. 계획서 §9
 *
 * 이 모듈이 틀리면 사용자가 2분을 기다리거나(예산 초과), 모델이 본문을 거의
 * 못 보게 된다(과도한 절단). 실측 비율을 기준선으로 고정한다.
 */

import { describe, expect, it } from 'vitest';
import {
  estimateCharsPerToken,
  estimateTokens,
  fitToBudget,
  truncationNotice,
} from './budget';

const KO = '로컬에서 동작하는 대규모 언어 모델은 사용자의 데이터를 외부로 보내지 않는다. ';
const EN = 'Local language models keep user data on the machine and never send it out. ';

describe('estimateCharsPerToken', () => {
  it('한국어는 2자/토큰에 가깝다', () => {
    const r = estimateCharsPerToken(KO.repeat(20));
    expect(r).toBeGreaterThan(2.0);
    expect(r).toBeLessThan(2.9);
  });

  it('영문은 4자/토큰에 가깝다', () => {
    expect(estimateCharsPerToken(EN.repeat(20))).toBeCloseTo(4.0, 1);
  });

  it('빈 문자열에서 터지지 않는다', () => {
    expect(estimateCharsPerToken('')).toBe(4.0);
    expect(estimateTokens('')).toBe(0);
  });

  it('실측 표본과 크게 어긋나지 않는다', () => {
    // 실측: 한국어 5,960자 → 3,182 토큰. 추정이 그 ±40% 안에 들어야 한다.
    const text = KO.repeat(Math.ceil(5960 / KO.length)).slice(0, 5960);
    const est = estimateTokens(text);
    expect(est).toBeGreaterThan(3182 * 0.6);
    expect(est).toBeLessThan(3182 * 1.4);
  });
});

describe('fitToBudget', () => {
  it('예산 안에 드는 본문은 건드리지 않는다', () => {
    const r = fitToBudget(KO, 2000);
    expect(r.truncated).toBe(false);
    expect(r.keptRatio).toBe(1);
    expect(r.text).toBe(KO.trim());
  });

  it('예산을 넘으면 자르고 절단을 표시한다', () => {
    const r = fitToBudget(KO.repeat(200), 2000);
    expect(r.truncated).toBe(true);
    expect(r.keptRatio).toBeLessThan(1);
    expect(r.estimatedTokens).toBeLessThanOrEqual(2000);
  });

  it('절단 결과가 실제로 예산을 지킨다', () => {
    // 예산을 못 지키면 사용자가 예고 없이 오래 기다리게 된다.
    for (const budget of [200, 500, 1000, 2000, 4000]) {
      const r = fitToBudget(KO.repeat(500), budget);
      expect(r.estimatedTokens).toBeLessThanOrEqual(budget);
    }
  });

  it('문장 경계에서 자른다', () => {
    const r = fitToBudget(KO.repeat(200), 500);
    // 한국어 문장은 '다.'로 끝난다. 중간에 뚝 끊기면 요약 품질이 나빠진다.
    expect(r.text.trimEnd().endsWith('다.')).toBe(true);
  });

  it('경계가 너무 앞이면 문자 단위로 자른다 (과도한 손실 방지)', () => {
    // 문장 부호가 전혀 없는 본문
    const noBoundary = '가'.repeat(10000);
    const r = fitToBudget(noBoundary, 100);
    expect(r.truncated).toBe(true);
    // 경계가 없다고 빈 문자열이 되면 안 된다
    expect(r.text.length).toBeGreaterThan(100);
  });

  it('빈 입력을 안전하게 처리한다', () => {
    const r = fitToBudget('   ', 2000);
    expect(r.text).toBe('');
    expect(r.truncated).toBe(false);
    expect(r.estimatedTokens).toBe(0);
  });
});

describe('truncationNotice', () => {
  it('절단되지 않았으면 아무것도 알리지 않는다', () => {
    expect(truncationNotice(fitToBudget(KO, 2000))).toBeNull();
  });

  it('절단되었으면 비율을 알린다', () => {
    // 계획서 §6 완료 기준: "절단 발생 시 사용자에게 항상 고지"
    const notice = truncationNotice(fitToBudget(KO.repeat(200), 500));
    expect(notice).toMatch(/앞부분 \d+%/);
  });
});
