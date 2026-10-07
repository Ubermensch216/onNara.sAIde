import { afterEach, expect, it, vi } from 'vitest';
import { withOffscreen } from './pdf-offscreen';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('PDF 작업이 먼저 끝나도 AI 작업이 남아 있으면 오프스크린 문서를 닫지 않는다', async () => {
  vi.useFakeTimers();
  const close = vi.fn(async () => undefined);
  const heartbeat = vi.fn(async () => ({}));
  vi.stubGlobal('chrome', { runtime: { getURL: (x: string) => x, ContextType: { OFFSCREEN_DOCUMENT: 'offscreen' }, getContexts: async () => [{}], getPlatformInfo: heartbeat }, offscreen: { closeDocument: close } });
  let finishPdf!: () => void; let finishAi!: () => void;
  const pdf = withOffscreen(() => new Promise<void>(resolve => { finishPdf = resolve; }));
  const ai = withOffscreen(() => new Promise<void>(resolve => { finishAi = resolve; }));
  await vi.advanceTimersByTimeAsync(0);
  finishPdf(); await pdf;
  await vi.advanceTimersByTimeAsync(60_001);
  expect(close).not.toHaveBeenCalled(); expect(heartbeat).toHaveBeenCalled();
  finishAi(); await ai;
  await vi.advanceTimersByTimeAsync(59_999); expect(close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(close).toHaveBeenCalledOnce();
});
