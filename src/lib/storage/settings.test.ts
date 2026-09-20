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
it('이전 버전에 저장된 LLM 무응답 제한은 다시 적용하지 않는다', async () => {
  data['saide.settings'] = { model: 'test:model', agentIdleTimeoutMs: 30_000 };
  const settings = await loadSettings();
  expect(settings.model).toBe('test:model');
  expect(settings).not.toHaveProperty('agentIdleTimeoutMs');
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

it('브리핑 설정의 손상된 값은 안전한 쪽으로 떨어진다', () => {
  const next = normalizeSettings({
    briefingEnabled: 'yes',
    briefingHour: 99,
    briefingReadPolicy: 'brief-body',
    briefingOpenLimit: 0,
    briefingRetentionDays: 1,
    briefingScope: 'everything',
    briefingKeywords: ['  예산 편성 ', '예산 편성', 42, 'x'.repeat(41), ''],
    briefingFields: ['title', 'nope'],
  });
  // ★ 알 수 없는 열람 정책은 기본값(미열람 유지)으로 떨어진다. 설정을 잘못 읽어 문서가 열리는 일은 없어야 한다.
  expect(next.briefingReadPolicy).toBe('keep-unread');
  expect(next.briefingEnabled).toBe(false);
  expect(next.briefingScope).toBe('all');
  expect(next.briefingHour).toBe(23);
  expect(next.briefingOpenLimit).toBe(1);
  expect(next.briefingRetentionDays).toBe(7);
  // 키워드는 다듬되 글자는 바꾸지 않는다. 화면에 적은 그대로 다시 보여야 한다.
  expect(next.briefingKeywords).toEqual(['예산 편성']);
  expect(next.briefingFields).toEqual(['title']);
});

it('대조할 칸을 모두 지운 설정은 받지 않는다', () => {
  // 대조할 칸이 없으면 모든 키워드가 빗나가, 사용자는 키워드를 잘못 적은 줄 알고 계속 고치게 된다.
  expect(normalizeSettings({ briefingFields: [] }).briefingFields).toEqual(DEFAULT_SETTINGS.briefingFields);
});
