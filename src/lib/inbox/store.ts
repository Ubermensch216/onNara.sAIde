/**
 * 접수함 원장 저장소(N1).
 *
 * ★ 판단하지 않는다. 읽고 쓰고 지우기만 한다. "새 문서인가·어느 갈래인가"는
 *   [briefing.ts]의 순수 함수가 정한다 — 그래야 그 판단을 브라우저 없이 시험할 수 있다.
 *
 * ★ 저장소를 쓸 수 없어도 화면이 멈추지 않는다. 캐시·피드백과 같은 태도다.
 *   다만 원장이 비면 이미 브리핑한 문서를 다시 올리게 되므로, 실패를 삼키되 숨기지 않는다.
 */

import { db } from '@/lib/storage/db';
import { inboxGroupKey } from './identity';
import type { InboxDoc, InboxRun, InboxRow } from './types';

/** 남겨 둘 실행 기록 수. 화면에 보이는 것은 최근 몇 건뿐이다. */
export const MAX_INBOX_RUNS = 100;

/**
 * 원장에서 대조할 문서들.
 *
 * ★ 전량을 읽지 않는다. 목록에 있는 문서의 묶음(group)만 읽어 온다 — 보관 기간을 길게 둔
 *   사용자의 원장이 수천 건이 되어도 비용이 목록 크기에 비례한다.
 */
export async function loadInboxGroups(rows: InboxRow[]): Promise<InboxDoc[]> {
  const groups = [...new Set(rows.map(row => inboxGroupKey(row)))];
  if (!groups.length) return [];
  try {
    return await db.inboxDocs.where('group').anyOf(groups).toArray();
  } catch {
    return [];
  }
}

export async function saveInboxDocs(docs: InboxDoc[]): Promise<void> {
  if (!docs.length) return;
  try { await db.inboxDocs.bulkPut(docs); } catch { /* 다음 확인 때 다시 쓴다 */ }
}

export async function patchInboxDoc(key: string, patch: Partial<InboxDoc>): Promise<void> {
  try { await db.inboxDocs.update(key, patch); } catch { /* 저장소 없음 */ }
}

export async function getInboxDoc(key: string): Promise<InboxDoc | undefined> {
  try { return await db.inboxDocs.get(key); } catch { return undefined; }
}

/**
 * 브리핑에 실은 문서들을 표시한다.
 *
 * ★ 브리핑 카드를 만든 뒤에 표시한다. 표시부터 하면, 카드를 만드는 도중 실패했을 때
 *   사용자는 보지도 못한 문서가 "처리됨"으로 남아 영영 다시 올라오지 않는다.
 */
export async function markBriefed(keys: string[], at: number = Date.now()): Promise<void> {
  if (!keys.length) return;
  try {
    await db.transaction('rw', db.inboxDocs, async () => {
      for (const key of keys) await db.inboxDocs.update(key, { briefedAt: at });
    });
  } catch { /* 표시하지 못하면 다음 브리핑에 한 번 더 올라온다 — 잃는 것보다 낫다 */ }
}

/** 다시 분류. 브리핑 표시를 지워 다음 확인 때 새 문서처럼 다룬다(B1의 `다시 분석`과 같은 태도). */
export async function unmarkBriefed(keys: string[]): Promise<void> {
  if (!keys.length) return;
  try {
    await db.transaction('rw', db.inboxDocs, async () => {
      for (const key of keys) {
        const doc = await db.inboxDocs.get(key);
        if (!doc) continue;
        const { briefedAt: _dropped, ...rest } = doc;
        await db.inboxDocs.put(rest as InboxDoc);
      }
    });
  } catch { /* 저장소 없음 */ }
}

export async function listInboxDocs(limit = 500): Promise<InboxDoc[]> {
  try {
    return await db.inboxDocs.orderBy('firstSeenAt').reverse().limit(limit).toArray();
  } catch {
    return [];
  }
}

/** 보관 기간이 지난 문서를 지운다. 지운 건수를 돌려준다. */
export async function pruneInboxDocs(retentionDays: number, now: Date = new Date()): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  try {
    const stale = await db.inboxDocs.where('firstSeenAt').below(cutoff).primaryKeys();
    await db.inboxDocs.bulkDelete(stale);
    return stale.length;
  } catch {
    return 0;
  }
}

export async function recordInboxRun(run: Omit<InboxRun, 'id'>): Promise<void> {
  try {
    await db.inboxRuns.add(run as InboxRun);
    const total = await db.inboxRuns.count();
    if (total > MAX_INBOX_RUNS) {
      const stale = await db.inboxRuns.orderBy('at').limit(total - MAX_INBOX_RUNS).primaryKeys();
      await db.inboxRuns.bulkDelete(stale);
    }
  } catch { /* 기록하지 못해도 브리핑은 이미 나왔다 */ }
}

export async function listInboxRuns(limit = 20): Promise<InboxRun[]> {
  try {
    return await db.inboxRuns.orderBy('at').reverse().limit(limit).toArray();
  } catch {
    return [];
  }
}

export async function lastInboxRun(): Promise<InboxRun | undefined> {
  return (await listInboxRuns(1))[0];
}

export interface InboxStats {
  docs: number;
  briefed: number;
  oldestAt: number | null;
}

export async function inboxStats(): Promise<InboxStats> {
  try {
    const docs = await db.inboxDocs.toArray();
    return {
      docs: docs.length,
      briefed: docs.filter(doc => doc.briefedAt).length,
      oldestAt: docs.length ? Math.min(...docs.map(doc => doc.firstSeenAt)) : null,
    };
  } catch {
    return { docs: 0, briefed: 0, oldestAt: null };
  }
}

/** 접수함 기록 전체 삭제. 공문 제목이 남는 유일한 자리라 지우는 길을 반드시 둔다. */
export async function clearInbox(): Promise<void> {
  try {
    await db.inboxDocs.clear();
    await db.inboxRuns.clear();
  } catch { /* 지울 것이 없다 */ }
}
