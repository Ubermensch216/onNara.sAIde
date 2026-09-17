/** Register duplicate tab IDs before activation events can reach the panel. */
export const workTabs = new Set<number>();
const pending = new Set<Promise<void>>();

/**
 * 작업 탭(또는 그 팝업)이 window.open·target 링크로 만든 탭.
 * 새 창(popup window)으로 열린 탭은 openerTabId가 비어 있어 이벤트로만 출처를 알 수 있다.
 */
const spawned = new Map<number, { root: number; at: number }>();
/** 최상위 프레임이 마지막으로 이동을 확정한 시각. 이름 있는 기존 창이 재사용되면 새 탭 없이 이동만 일어난다. */
const committed = new Map<number, number>();

export function registerWorkTabListeners(): void {
  chrome.webNavigation.onCreatedNavigationTarget.addListener(noteNavigationTarget);
  chrome.webNavigation.onCommitted.addListener(noteTopCommit);
  chrome.tabs.onRemoved.addListener(forgetWorkTab);
}

export function noteNavigationTarget(details: { sourceTabId: number; tabId: number }): void {
  if (!workTabs.has(details.sourceTabId)) return;
  const root = spawned.get(details.sourceTabId)?.root ?? details.sourceTabId;
  workTabs.add(details.tabId);
  spawned.set(details.tabId, { root, at: Date.now() });
}

export function noteTopCommit(details: { tabId: number; frameId: number }): void {
  // 백그라운드 읽기가 없을 때는 기록하지 않아 맵이 계속 자라지 않게 한다.
  if (details.frameId === 0 && workTabs.size) committed.set(details.tabId, Date.now());
}

/** 작업 탭에서 시작된 팝업 체인을 생성 순서대로 돌려준다. */
export function tabsSpawnedBy(root: number): number[] {
  return [...spawned].filter(([, info]) => info.root === root).sort((a, b) => a[1].at - b[1].at).map(([id]) => id);
}

export function committedSince(tabId: number, since: number): boolean {
  return (committed.get(tabId) ?? -1) >= since;
}

export function forgetWorkTab(tabId: number): void {
  workTabs.delete(tabId);
  spawned.delete(tabId);
  if (!workTabs.size) committed.clear();
}

export async function duplicateWorkTab(sourceId: number): Promise<chrome.tabs.Tab> {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  pending.add(barrier);
  try {
    const tab = await chrome.tabs.duplicate(sourceId);
    if (typeof tab?.id !== 'number') throw new Error('백그라운드 작업 탭을 만들지 못했습니다.');
    workTabs.add(tab.id);
    return tab;
  } finally {
    pending.delete(barrier);
    release();
  }
}

const SPAWN_EVENT_GRACE_MS = 300;

function isWorkTab(tab: chrome.tabs.Tab): boolean {
  return workTabs.has(tab.id!) || (tab.openerTabId !== undefined && workTabs.has(tab.openerTabId));
}

export async function panelTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  await Promise.all([...pending]);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || isWorkTab(tab)) return null;
  // 새 창 팝업의 활성화 이벤트가 onCreatedNavigationTarget보다 먼저 올 수 있다.
  // 백그라운드 읽기 중일 때만 잠시 기다렸다가 작업 팝업인지 다시 확인한다.
  if (workTabs.size) {
    await new Promise(resolve => setTimeout(resolve, SPAWN_EVENT_GRACE_MS));
    if (isWorkTab(tab)) return null;
  }
  return tab;
}
