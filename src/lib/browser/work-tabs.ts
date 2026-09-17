/** Register duplicate tab IDs before activation events can reach the panel. */
export const workTabs = new Set<number>();
const pending = new Set<Promise<void>>();

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

export async function panelTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  await Promise.all([...pending]);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || workTabs.has(tabId) || (tab.openerTabId !== undefined && workTabs.has(tab.openerTabId))) return null;
  return tab;
}
