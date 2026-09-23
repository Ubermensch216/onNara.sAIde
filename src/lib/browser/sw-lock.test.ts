import { afterEach, expect, it, vi } from 'vitest';
import { isWorkTabBusy, resetWorkTabLock, runExclusive } from './sw-lock';

afterEach(() => { vi.useRealTimers(); resetWorkTabLock(); });

it('멈춘 작업의 점유 시간이 끝나면 다음 요청이 실행된다', async () => {
  vi.useFakeTimers();
  const hung = new Promise<void>(() => undefined);
  const first = runExclusive(() => hung, 1000);
  const secondWork = vi.fn(async () => '완료');
  const second = runExclusive(secondWork, 1000);
  expect(isWorkTabBusy()).toBe(true);
  await vi.advanceTimersByTimeAsync(999);
  expect(secondWork).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await second).toBe('완료');
  expect(isWorkTabBusy()).toBe(false);
  void first;
});
