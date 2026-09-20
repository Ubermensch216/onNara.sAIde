/**
 * 정확도 피드백 (B4).
 *
 * ★ 여기서 지키는 것 셋.
 *   ① 같은 대상에 다시 누르면 **덮어쓴다.** 잘못 누른 값이 통계에 영구히 남으면
 *      사용자는 아예 누르지 않게 되고, 그러면 이 기능이 있으나 마나다.
 *   ② 대상 종류를 섞어 세지 않는다. 기한 추출의 정확도와 요약의 정확도는 다른 수치다.
 *   ③ 평가가 하나도 없을 때 정확도는 0%가 아니라 "없음"이다. 0%는 "다 틀렸다"로 읽힌다.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/storage/db';
import {
  clearAllFeedback,
  clearFeedbackFor,
  feedbackSummary,
  loadFeedbackMap,
  recordFeedback,
  summarizeFeedback,
  type FeedbackEntry,
} from './store';

const MODEL = 'gemma4:e2b';

beforeEach(async () => {
  await clearAllFeedback();
});

describe('기록', () => {
  it('누른 평가를 읽어 올 수 있다', async () => {
    await recordFeedback({ kind: 'action-card', targetKey: '1:10', verdict: 'good', model: MODEL });

    expect((await loadFeedbackMap('action-card')).get('1:10')).toBe('good');
  });

  // ★ 잘못 누른 값이 남으면 아무도 누르지 않는다.
  it('★ 같은 대상에 다시 누르면 덮어쓴다', async () => {
    await recordFeedback({ kind: 'action-card', targetKey: '1:10', verdict: 'good', model: MODEL });
    await recordFeedback({ kind: 'action-card', targetKey: '1:10', verdict: 'bad', model: MODEL });

    expect(await db.feedback.count()).toBe(1);
    expect((await loadFeedbackMap('action-card')).get('1:10')).toBe('bad');
  });

  it('취소하면 기록이 사라진다', async () => {
    await recordFeedback({ kind: 'summary', targetKey: '1:11', verdict: 'bad', model: MODEL });
    await clearFeedbackFor('summary', '1:11');

    expect((await loadFeedbackMap('summary')).size).toBe(0);
  });

  // ★ 같은 자리 식별자라도 종류가 다르면 다른 평가다.
  it('대상 종류가 다르면 서로 덮어쓰지 않는다', async () => {
    await recordFeedback({ kind: 'action-card', targetKey: 'k', verdict: 'good', model: MODEL });
    await recordFeedback({ kind: 'task-candidate', targetKey: 'k', verdict: 'bad', model: MODEL });

    expect(await db.feedback.count()).toBe(2);
  });
});

describe('집계', () => {
  const rows = (...pairs: Array<[FeedbackEntry['kind'], FeedbackEntry['verdict']]>): FeedbackEntry[] =>
    pairs.map(([kind, verdict], index) => ({ id: index + 1, kind, verdict, targetKey: `k${index}`, model: MODEL, at: 1000 + index }));

  it('정확도는 맞음 비율이다', () => {
    const summary = summarizeFeedback(rows(['summary', 'good'], ['summary', 'good'], ['summary', 'bad'], ['summary', 'good']));
    expect(summary.accuracy).toBeCloseTo(0.75);
    expect(summary.total).toBe(4);
  });

  // ★ 표본이 없을 때 0%로 보이면 "다 틀렸다"로 읽힌다.
  it('★ 평가가 없으면 정확도는 null이다', () => {
    expect(summarizeFeedback([]).accuracy).toBeNull();
  });

  it('대상 종류별로 나눠 센다', () => {
    const summary = summarizeFeedback(rows(['action-card', 'good'], ['task-candidate', 'bad'], ['task-candidate', 'good']));
    expect(summary.buckets).toEqual([
      { kind: 'action-card', good: 1, bad: 0 },
      { kind: 'task-candidate', good: 1, bad: 1 },
    ]);
  });

  it('평가가 없는 종류는 표에 넣지 않는다', () => {
    expect(summarizeFeedback(rows(['summary', 'good'])).buckets).toHaveLength(1);
  });

  it('저장소에서 읽어 집계한다', async () => {
    await recordFeedback({ kind: 'summary', targetKey: 'a', verdict: 'good', model: MODEL });
    await recordFeedback({ kind: 'summary', targetKey: 'b', verdict: 'bad', model: MODEL });

    expect((await feedbackSummary()).total).toBe(2);
  });
});
