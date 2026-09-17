import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, onSettingsChanged, saveSettings } from './settings';

let data: Record<string, unknown>;
const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
beforeEach(() => {
  data = {}; listeners.clear();
  vi.stubGlobal('navigator', {}); // exercise the serialized fallback without Web Locks
  vi.stubGlobal('chrome', { storage: {
    local: {
      get: vi.fn(async () => structuredClone(data)),
      set: vi.fn(async (next: Record<string, unknown>) => {
        data = structuredClone(next);
        for (const callback of listeners) callback({ 'saide.settings': { newValue: data['saide.settings'] } }, 'local');
      }),
    }, onChanged: { addListener: (cb: never) => listeners.add(cb), removeListener: (cb: never) => listeners.delete(cb) },
  } });
});
afterEach(() => vi.unstubAllGlobals());

it('손상된 저장값의 타입·범위·프로토콜을 정규화한다', () => {
  expect(normalizeSettings({ endpoint: 'javascript:alert(1)', temperature: NaN, numCtx: 1e9, memoryEnabled: 'true', locale: 'xx', memoryExcludedDomains: [' .Example.COM.', null, 'example.com', 'https://bad'] }))
    .toMatchObject({ endpoint: DEFAULT_SETTINGS.endpoint, temperature: 0.7, numCtx: 32768, memoryEnabled: false, locale: 'ko', memoryExcludedDomains: ['example.com'] });
});
it('동시 부분 저장이 다른 필드의 변경을 잃지 않는다', async () => {
  await Promise.all([saveSettings({ model: 'test:model' }), saveSettings({ theme: 'dark' }), saveSettings({ locale: 'en' })]);
  expect(await loadSettings()).toMatchObject({ model: 'test:model', theme: 'dark', locale: 'en' });
});
it('Web Locks가 있으면 확장 문서 간 공유 잠금을 사용한다', async () => {
  const request = vi.fn(async (_name, work) => work());
  vi.stubGlobal('navigator', { locks: { request } });
  await saveSettings({ theme: 'dark' });
  expect(request).toHaveBeenCalledWith('saide.settings', expect.any(Function));
});
it('주소를 완성해서 저장하며 잘못된 주소는 기존 값을 유지한다', async () => {
  await saveSettings({ endpoint: 'HTTP://LOCALHOST:11434/' });
  await expect(saveSettings({ endpoint: 'http://' })).rejects.toThrow('HTTP/HTTPS');
  expect((await loadSettings()).endpoint).toBe(DEFAULT_SETTINGS.endpoint);
});
it('설정 변경을 정규화해서 전달하고 구독 해제가 가능하다', async () => {
  const listener = vi.fn(); const stop = onSettingsChanged(listener);
  await saveSettings({ locale: 'en' });
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
  stop(); await saveSettings({ theme: 'dark' });
  expect(listener).toHaveBeenCalledTimes(1);
});
