/**
 * 첫 실행 안내 표시 여부 (B3).
 *
 * ★ 여기서 지키는 것 둘.
 *   ① 한 번 본 사람에게 다시 띄우지 않는다. 매번 뜨는 안내는 곧 닫는 법만 익히게 한다.
 *   ② 저장소를 읽지 못하면 **띄우지 않는다.** 읽을 수 없다는 이유로 매번 띄우면
 *      그 환경의 사용자는 패널을 열 때마다 안내를 닫아야 한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ONBOARDING_KEY,
  ONBOARDING_VERSION,
  markOnboardingSeen,
  resetOnboarding,
  shouldShowOnboarding,
} from './onboarding';

let stored: Record<string, unknown>;

beforeEach(() => {
  stored = {};
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items); }),
    remove: vi.fn(async (key: string) => { delete stored[key]; }),
  } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('표시 여부', () => {
  it('처음 열면 보여 준다', async () => {
    expect(await shouldShowOnboarding()).toBe(true);
  });

  it('★ 한 번 보고 나면 다시 띄우지 않는다', async () => {
    await markOnboardingSeen();
    expect(stored[ONBOARDING_KEY]).toBe(ONBOARDING_VERSION);
    expect(await shouldShowOnboarding()).toBe(false);
  });

  // ★ 명령 체계가 바뀌면 한 번 더 알려야 한다. 그때만 판을 올린다.
  it('안내의 판이 올라가면 한 번 더 보여 준다', async () => {
    await markOnboardingSeen(ONBOARDING_VERSION - 1);
    expect(await shouldShowOnboarding()).toBe(true);
  });

  it('설정에서 다시 보기를 누르면 다음에 뜬다', async () => {
    await markOnboardingSeen();
    await resetOnboarding();
    expect(await shouldShowOnboarding()).toBe(true);
  });

  it('★ 저장소를 읽지 못하면 띄우지 않는다', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => { throw new Error('no storage'); }) } } });
    expect(await shouldShowOnboarding()).toBe(false);
  });
});
