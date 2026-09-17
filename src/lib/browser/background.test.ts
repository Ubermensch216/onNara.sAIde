import { afterEach, expect, it, vi } from 'vitest';
import { handlePanelMessage } from '@/entrypoints/background';

afterEach(() => vi.unstubAllGlobals());
it('스크립트 주입을 기다리는 동안 취소하면 실행 메시지를 보내지 않는다', async () => {
  let resume!: () => void;
  let started!: () => void;
  const injected = new Promise<void>(resolve => { started = resolve; });
  const sendMessage = vi.fn(async () => ({ type: 'ACTED', result: { ok: true } }));
  vi.stubGlobal('chrome', {
    tabs: { get: vi.fn(async () => ({ id: 1, url: 'https://example.com' })), sendMessage },
    scripting: { executeScript: vi.fn(async () => { started(); await new Promise<void>(resolve => { resume = resolve; }); }) },
  });
  const control = { id: crypto.randomUUID(), deadline: Date.now() + 15000, expectedUrl: 'https://example.com', approvalToken: 'ticket' };
  const pending = handlePanelMessage({ type: 'EXEC_ACTION', tabId: 1, action: { kind: 'click', selector: '#go' }, control });
  await injected;
  await handlePanelMessage({ type: 'CANCEL_REQUEST', requestId: control.id });
  resume();
  expect(await pending).toMatchObject({ type: 'ERROR' });
  expect(sendMessage.mock.calls.some(call => (call as unknown as [number, { type: string }])[1].type === 'ACT')).toBe(false);
});
