/**
 * 첫 실행 안내를 봤는지 (B3).
 *
 * ★ 왜 chrome.storage.local인가.
 *   대화(IndexedDB)와 수명이 다르다. 대화를 모두 지운 사람에게 안내를 다시 띄우는 것은
 *   "처음 온 사람"으로 대하는 것이라 무례하다. 설정과 같은 자리에 둔다.
 *
 * ★ 판(version)을 함께 적는다.
 *   명령 체계가 크게 바뀌면(예: `/`·`@` 분리 같은 변화) 판을 올려 한 번 더 보여 준다.
 *   바뀌지 않았는데 다시 띄우면 그것도 방해다.
 */

export const ONBOARDING_KEY = 'saide.onboardingSeen';
/** 지금 안내가 설명하는 내용의 판. 안내를 실질적으로 고칠 때만 올린다. */
export const ONBOARDING_VERSION = 1;

export type OnboardingLaunch = 'first-run' | 'guide' | 'hidden';

/**
 * 첫 설치인지, 설정에서 다시 연 안내인지까지 구분한다.
 *
 * 저장값이 전혀 없을 때만 웰컴 영상을 튼다. 따라서 이미 안내를 본 사용자는
 * 업데이트 뒤에 영상이 갑자기 뜨지 않고, "사용법 다시 보기"도 영상 없이 바로
 * 설명으로 들어간다.
 */
export async function getOnboardingLaunch(): Promise<OnboardingLaunch> {
  try {
    const seen = (await chrome.storage.local.get(ONBOARDING_KEY))[ONBOARDING_KEY];
    if (typeof seen !== 'number') return 'first-run';
    return seen < ONBOARDING_VERSION ? 'guide' : 'hidden';
  } catch {
    return 'hidden';
  }
}

/** 지금 안내를 보여야 하는가. 저장소를 읽지 못하면 보여 주지 않는다(조용한 쪽이 안전하다). */
export async function shouldShowOnboarding(): Promise<boolean> {
  return (await getOnboardingLaunch()) !== 'hidden';
}

export async function markOnboardingSeen(version = ONBOARDING_VERSION): Promise<void> {
  try { await chrome.storage.local.set({ [ONBOARDING_KEY]: version }); } catch { /* 다음에 한 번 더 볼 뿐이다 */ }
}

/** 설정에서 "사용법 다시 보기"를 눌렀을 때. 다음에 패널을 열면 안내가 뜬다. */
export async function resetOnboarding(): Promise<void> {
  try { await chrome.storage.local.set({ [ONBOARDING_KEY]: 0 }); } catch { /* 다음에 안내를 못 볼 뿐이다 */ }
}
