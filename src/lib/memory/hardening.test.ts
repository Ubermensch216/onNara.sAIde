import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import * as client from '@/lib/ollama/client';
import { createEmbedQueue } from './queue';
import { clearAll, forgetDomain, savePage, search, stats, updateMemoryPolicy } from './store';

beforeEach(async () => { await clearAll(); await updateMemoryPolicy({ enabled: true, excluded: [] }); });
afterEach(() => vi.restoreAllMocks());
const input = (url: string) => ({ url, title: 'test', chunks: ['text'], vectors: [[1, 0]], model: 'test' });
it('deleting a parent domain removes existing subdomain records only', async () => {
  await savePage(input('https://mail.example.com/a'));
  await savePage(input('https://notexample.com/a'));
  expect(await forgetDomain(' .Example.com ')).toBe(1);
  expect((await stats()).pages).toBe(1);
});
it.each(['clear', 'exclude', 'disable', 'stop'] as const)('does not resurrect data after %s during embedding', async action => {
  let resolve!: (v: number[][]) => void;
  let entered!: () => void;
  const started = new Promise<void>(r => entered = r);
  vi.spyOn(client, 'embed').mockImplementation(() => { entered(); return new Promise(r => resolve = r); });
  const settings = { ...DEFAULT_SETTINGS, memoryEnabled: true };
  const queue = createEmbedQueue({ isBusy: () => false, getSettings: () => settings });
  queue.enqueue({ url: 'https://mail.example.com/a', title: 'A', text: 'content' });
  const running = queue.drainNow();
  await started;
  if (action === 'clear') await clearAll();
  if (action === 'exclude') { await updateMemoryPolicy({ excluded: ['example.com'] }); await forgetDomain('example.com'); }
  if (action === 'disable') await updateMemoryPolicy({ enabled: false });
  if (action === 'stop') queue.stop();
  resolve([[1, 0]]);
  await running;
  expect((await stats()).chunks).toBe(0);
  queue.stop();
});
it('search excludes expired, excluded and incompatible vectors', async () => {
  await savePage({ ...input('https://old.com'), visitedAt: 0 });
  await savePage(input('https://excluded.com'));
  await savePage({ ...input('https://dimensions.com'), vectors: [[1, 0, 0]] });
  expect(await search([1, 0], 5, 'test', { retentionDays: 30, excluded: ['excluded.com'] })).toEqual([]);
});
it('rejects non-finite vectors without replacing a saved page', async () => {
  await savePage(input('https://example.com'));
  await expect(savePage({ ...input('https://example.com'), vectors: [[NaN, 0]] })).rejects.toThrow();
  expect((await stats()).chunks).toBe(1);
});
