/**
 * 정확도 피드백 (B4). 계획서 §12 평가 계획을 제품 안에서 수행한다.
 *
 * ★ 왜 두는가.
 *   `원문 확인` 배지와 확인 카드는 **그 한 건**의 판단을 돕는다. 그러나 "이 도구가 지금까지
 *   얼마나 맞았는가"는 아무도 모른다. 기관 도입 심사에 낼 수치도, 모델을 바꿔도 좋은지
 *   판단할 근거도 제품에서 나오지 않았다.
 *
 * ★ 밖으로 나가지 않는다.
 *   전부 이 브라우저의 IndexedDB에만 쌓인다. 문서 제목조차 넣지 않는다 — 수치를 보는 데
 *   필요하지 않고, 남기면 공문 제목 목록이 한곳에 모이는 꼴이 된다.
 *
 * ★ 한 번 누르면 바꿀 수 있어야 한다. 같은 대상(targetKey)에 다시 누르면 덮어쓴다.
 *   잘못 누른 값이 통계에 영구히 남으면 사용자가 아예 누르지 않게 된다.
 */

import { db } from '@/lib/storage/db';

/** 무엇에 대한 평가인가. 정확도의 성격이 달라 섞어 세지 않는다. */
export type FeedbackKind = 'action-card' | 'task-candidate' | 'summary' | 'inbox-relevance';
export type FeedbackVerdict = 'good' | 'bad';

export interface FeedbackEntry {
  id: number;
  kind: FeedbackKind;
  verdict: FeedbackVerdict;
  /** 같은 대상에 다시 누르면 덮어쓰기 위한 식별자. 내용이 아니라 자리를 가리킨다. */
  targetKey: string;
  /** 어떤 모델이 만든 결과였는가. 모델을 바꿨을 때 비교할 수 있어야 한다. */
  model: string;
  at: number;
}

export type NewFeedback = Omit<FeedbackEntry, 'id' | 'at'> & { at?: number };

/**
 * 평가를 기록한다. 같은 대상의 이전 평가는 지우고 새 값을 남긴다.
 * 저장소를 쓸 수 없어도 화면 동작을 막지 않는다 — 피드백은 부수적인 기능이다.
 */
export async function recordFeedback(entry: NewFeedback): Promise<void> {
  try {
    await db.transaction('rw', db.feedback, async () => {
      await db.feedback.where('kind').equals(entry.kind)
        .filter(row => row.targetKey === entry.targetKey).delete();
      await db.feedback.add({ ...entry, at: entry.at ?? Date.now() } as FeedbackEntry);
    });
  } catch { /* 기록하지 못해도 사용자가 하던 일은 계속된다 */ }
}

/** 같은 대상의 평가를 지운다(다시 눌러 취소). */
export async function clearFeedbackFor(kind: FeedbackKind, targetKey: string): Promise<void> {
  try {
    await db.feedback.where('kind').equals(kind).filter(row => row.targetKey === targetKey).delete();
  } catch { /* 지울 것이 없다 */ }
}

/** 현재 걸려 있는 평가들. 화면이 눌린 상태를 그리는 데 쓴다. */
export async function loadFeedbackMap(kind: FeedbackKind): Promise<Map<string, FeedbackVerdict>> {
  try {
    const rows = await db.feedback.where('kind').equals(kind).toArray();
    return new Map(rows.map(row => [row.targetKey, row.verdict]));
  } catch {
    return new Map();
  }
}

export interface FeedbackBucket {
  kind: FeedbackKind;
  good: number;
  bad: number;
}

export interface FeedbackSummary {
  total: number;
  good: number;
  bad: number;
  /** 0~1. 평가가 하나도 없으면 null — 0%로 보이면 "다 틀렸다"로 읽힌다. */
  accuracy: number | null;
  buckets: FeedbackBucket[];
  firstAt: number | null;
  lastAt: number | null;
}

const KINDS: FeedbackKind[] = ['action-card', 'task-candidate', 'summary', 'inbox-relevance'];

export function summarizeFeedback(rows: FeedbackEntry[]): FeedbackSummary {
  const buckets = KINDS.map(kind => ({
    kind,
    good: rows.filter(row => row.kind === kind && row.verdict === 'good').length,
    bad: rows.filter(row => row.kind === kind && row.verdict === 'bad').length,
  })).filter(bucket => bucket.good + bucket.bad > 0);

  const good = rows.filter(row => row.verdict === 'good').length;
  const bad = rows.length - good;
  return {
    total: rows.length,
    good,
    bad,
    accuracy: rows.length ? good / rows.length : null,
    buckets,
    firstAt: rows.length ? Math.min(...rows.map(row => row.at)) : null,
    lastAt: rows.length ? Math.max(...rows.map(row => row.at)) : null,
  };
}

export async function feedbackSummary(): Promise<FeedbackSummary> {
  try {
    return summarizeFeedback(await db.feedback.toArray());
  } catch {
    return summarizeFeedback([]);
  }
}

export async function clearAllFeedback(): Promise<void> {
  try { await db.feedback.clear(); } catch { /* 지울 것이 없다 */ }
}
