import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureTab, trustedPanel, validPanelRequest } from './guards';
import { sendToSW } from '@/lib/messaging/protocol';

const control = () => ({ id: 'test', deadline: Date.now() + 15000, expectedUrl: 'https://example.com/a' });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function tabs() {
  const tab = { id: 1, windowId: 2, url: 'https://example.com/a', status: 'complete' };
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  const api = { onActivated: event(), onUpdated: event(), onRemoved: event(), get: vi.fn(async () => ({ ...tab })), query: vi.fn(async () => [{ ...tab }]), captureVisibleTab: vi.fn(async () => 'data:image/png;base64,abc') };
  vi.stubGlobal('chrome', { tabs: api });
  return { api, tab };
}
describe('capture binding', () => {
  it('captures the requested window, not the currently focused window', async () => {
    const { api } = tabs();
    await expect(captureTab(1, control(), () => false)).resolves.toContain('base64');
    expect(api.captureVisibleTab).toHaveBeenCalledWith(2, { format: 'png' });
  });
  it('refuses a different active tab before capturing', async () => {
    const { api, tab } = tabs();
    api.query.mockResolvedValue([{ ...tab, id: 9 }]);
    await expect(captureTab(1, control(), () => false)).rejects.toThrow();
    expect(api.captureVisibleTab).not.toHaveBeenCalled();
  });
  it('discards a screenshot after navigation during capture', async () => {
    const { api, tab } = tabs();
    api.captureVisibleTab.mockImplementation(async () => { tab.url = 'https://example.com/b'; return 'wrong image'; });
    await expect(captureTab(1, control(), () => false)).rejects.toThrow();
  });
  it('does not capture cancelled requests', async () => {
    const { api } = tabs();
    await expect(captureTab(1, control(), () => true)).rejects.toThrow();
    expect(api.captureVisibleTab).not.toHaveBeenCalled();
  });
  it('discards capture if the user switches away and back before the final check', async () => {
    const { api } = tabs();
    api.captureVisibleTab.mockImplementation(async () => {
      const listener = api.onActivated.addListener.mock.calls[0]![0];
      listener({ tabId: 9, windowId: 2 }); listener({ tabId: 1, windowId: 2 });
      return 'possibly wrong';
    });
    await expect(captureTab(1, control(), () => false)).rejects.toThrow();
    expect(api.onActivated.removeListener).toHaveBeenCalledOnce();
  });
});
it('validates sender and rejects unapproved, expired, or non-HTTP actions', () => {
  vi.stubGlobal('chrome', { runtime: { id: 'ext', getURL: () => 'chrome-extension://ext/' } });
  expect(trustedPanel({ id: 'ext', url: 'chrome-extension://ext/sidepanel.html' })).toBe(true);
  expect(trustedPanel({ id: 'ext', url: 'https://example.com', tab: { id: 1 } } as chrome.runtime.MessageSender)).toBe(false);
  expect(validPanelRequest({ type: 'EXEC_ACTION', tabId: 1, action: { kind: 'click', selector: 'x' }, control: control() })).toBe(false);
  expect(validPanelRequest({ type: 'CAPTURE_SCREENSHOT', tabId: 1, control: { ...control(), deadline: 0 } })).toBe(false);
  expect(validPanelRequest({ type: 'PREPARE_ACTION', tabId: 1, action: { kind: 'navigate', url: 'javascript:alert(1)' }, control: control() })).toBe(false);
});
it('cancels the wait and notifies the worker when the browser ignores AbortSignal', async () => {
  const sendMessage = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const controller = new AbortController();
  const pending = sendToSW({ type: 'LIST_TABS' }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'CANCEL_REQUEST' }));
});
