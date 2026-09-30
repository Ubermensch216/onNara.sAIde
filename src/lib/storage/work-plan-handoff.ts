/**
 * 업무계획(사이드패널) → 기안 코파일럿(기안기 드로어)으로 회신 준비를 넘기는 자리.
 *
 * ★ 두 화면은 서로 다른 문서에서 산다. 사이드패널은 받은 공문을 보는 탭 옆에, 드로어는 나중에 여는
 *   기안기 화면 안에 있다. 그래서 메시지로 주고받지 않고 chrome.storage.local에 한 건을 걸어 둔다.
 *   드로어는 열릴 때 읽고, 열려 있는 동안 바뀌면 다시 읽는다.
 * ★ 한 자리만 쓴다. 새로 보내면 앞의 것을 대신한다 — 사용자가 "방금 보낸 것"이 드로어에 뜬다.
 * ★ 사흘이 지나면 버린다. 며칠 전에 보낸 요구사항이 다른 기안에 불쑥 뜨면 안 된다.
 * ★ 백업하지 않는다(backup.ts의 TRANSIENT_KEYS). 데이터가 아니라 화면 사이의 전달 신호다.
 */

import type { WorkPlanHandoff } from '@/lib/ai/work-plan';

export const WORK_PLAN_HANDOFF_KEY = 'saide.workPlanHandoff';
export const HANDOFF_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export interface StoredHandoff extends WorkPlanHandoff {
  sentAt: number;
}

function valid(value: unknown, now: number): StoredHandoff | null {
  if (!value || typeof value !== 'object') return null;
  const handoff = value as Partial<StoredHandoff>;
  if (typeof handoff.sentAt !== 'number' || now - handoff.sentAt > HANDOFF_TTL_MS) return null;
  if (!handoff.source?.title || !Array.isArray(handoff.requirements) || !Array.isArray(handoff.deadlines)) return null;
  return {
    ...handoff,
    deliverables: Array.isArray(handoff.deliverables) ? handoff.deliverables : [],
    conditions: Array.isArray(handoff.conditions) ? handoff.conditions : [],
  } as StoredHandoff;
}

export async function sendHandoff(handoff: WorkPlanHandoff, now = Date.now()): Promise<void> {
  await chrome.storage.local.set({ [WORK_PLAN_HANDOFF_KEY]: { ...handoff, sentAt: now } satisfies StoredHandoff });
}

/** 걸려 있는 회신 준비. 없거나 기한이 지났으면 null(지난 것은 이때 지운다). */
export async function loadHandoff(now = Date.now()): Promise<StoredHandoff | null> {
  const raw = (await chrome.storage.local.get(WORK_PLAN_HANDOFF_KEY))[WORK_PLAN_HANDOFF_KEY];
  const handoff = valid(raw, now);
  if (raw && !handoff) await clearHandoff();
  return handoff;
}

export async function clearHandoff(): Promise<void> {
  try { await chrome.storage.local.remove(WORK_PLAN_HANDOFF_KEY); } catch { /* 지울 것이 없다 */ }
}

export function onHandoffChanged(cb: (handoff: StoredHandoff | null) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(WORK_PLAN_HANDOFF_KEY in changes)) return;
    cb(valid(changes[WORK_PLAN_HANDOFF_KEY]!.newValue, Date.now()));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
