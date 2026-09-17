import { requiresApproval, type PageAction, type PanelToSW, type RequestControl } from '@/lib/messaging/protocol';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
export function validAction(v: unknown): v is PageAction {
  if (!record(v)) return false;
  switch (v.kind) {
    case 'read_page': return true;
    case 'find_element': return text(v.query);
    case 'describe_target': case 'click': return text(v.selector);
    case 'type_text': return text(v.selector) && typeof v.text === 'string' && v.text.length <= 20_000;
    case 'navigate': {
      if (!text(v.url)) return false;
      try { return ['http:', 'https:'].includes(new URL(v.url).protocol); } catch { return false; }
    }
    case 'scroll': return ['up', 'down', 'top', 'bottom'].includes(String(v.direction)) &&
      (v.amount === undefined || (typeof v.amount === 'number' && Number.isFinite(v.amount) && v.amount > 0 && v.amount <= 100_000));
    default: return false;
  }
}

export function validControl(v: unknown): v is RequestControl {
  return record(v) && text(v.id, 100) && typeof v.deadline === 'number' && Number.isFinite(v.deadline) &&
    v.deadline > Date.now() && v.deadline <= Date.now() + 60_000 &&
    (v.expectedUrl === undefined || text(v.expectedUrl, 8192)) &&
    (v.approvalToken === undefined || text(v.approvalToken, 100));
}

/** Only extension documents may request privileged work; content-script senders are excluded. */
export function trustedPanel(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab && !!sender.url &&
    sender.url.startsWith(chrome.runtime.getURL(''));
}

export function validPanelRequest(v: unknown): v is PanelToSW {
  if (!record(v)) return false;
  if (v.type === 'CANCEL_REQUEST') return text(v.requestId, 100);
  if (v.type === 'GET_ACTIVE_TAB' || v.type === 'LIST_TABS') return true;
  if (!Number.isInteger(v.tabId) || (v.tabId as number) < 0 || !validControl(v.control)) return false;
  if (v.type === 'CAPTURE_SCREENSHOT') return true;
  if (v.type === 'EXTRACT_PAGE') return Number.isInteger(v.budgetTokens) && (v.budgetTokens as number) >= 1 && (v.budgetTokens as number) <= 8000;
  if (v.type === 'PREPARE_ACTION') return validAction(v.action) && requiresApproval(v.action);
  if (v.type === 'EXEC_ACTION') return validAction(v.action) && (!requiresApproval(v.action) || !!v.control.approvalToken);
  return false;
}

export function assertCurrent(control: RequestControl, url: string, cancelled = false) {
  if (cancelled || Date.now() >= control.deadline) throw new Error('작업이 취소되었거나 제한 시간을 초과했습니다.');
  if (control.expectedUrl && control.expectedUrl !== url) throw new Error('대상 페이지가 바뀌었습니다. 다시 요청하세요.');
}

/** Verify before and after capture; never activate another tab on the user's behalf. */
export async function captureTab(tabId: number, control: RequestControl, cancelled: () => boolean) {
  const changedWindows = new Set<number>();
  let documentChanged = false;
  const activated = (info: { windowId: number }) => { changedWindows.add(info.windowId); };
  const updated = (id: number, info: { url?: string; status?: string }) => { if (id === tabId && (info.url || info.status === 'loading')) documentChanged = true; };
  const removed = (id: number) => { if (id === tabId) documentChanged = true; };
  chrome.tabs.onActivated.addListener(activated);
  chrome.tabs.onUpdated.addListener(updated);
  chrome.tabs.onRemoved.addListener(removed);
  try {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? '';
  assertCurrent(control, url, cancelled());
  const check = async () => {
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const current = await chrome.tabs.get(tabId);
    assertCurrent(control, current.url ?? '', cancelled());
    if (documentChanged || changedWindows.has(tab.windowId) || active?.id !== tabId || current.url !== url || current.windowId !== tab.windowId || current.status === 'loading') {
      throw new Error('캡처할 탭이 변경되었습니다. 대상 탭에서 다시 시도하세요.');
    }
  };
  await check();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  await check();
  return dataUrl;
  } finally {
    chrome.tabs.onActivated.removeListener(activated);
    chrome.tabs.onUpdated.removeListener(updated);
    chrome.tabs.onRemoved.removeListener(removed);
  }
}
