/**
 * 호스트 권한 관리. 계획서 §3 설계 결정 ② 수정
 *
 * ★ 계획서의 "activeTab + executeScript 온디맨드" 안은 사이드패널에서 성립하지 않는다.
 *
 *   activeTab은 사용자가 **그 탭에서 확장을 직접 호출한 순간**에만 부여되고,
 *   페이지를 이동하면 즉시 회수된다. 그런데 사이드패널은 한 번 열면 사용자가
 *   탭을 옮기고 링크를 타는 내내 열려 있다. "이 페이지 요약"을 누르는 시점에는
 *   부여 조건이 이미 사라진 뒤라 executeScript가 다음으로 실패한다:
 *
 *     Cannot access contents of url "...".
 *     Extension manifest must request permission to access this host.
 *
 *   계획서가 activeTab을 고른 이유(설치 시점에 광범위 권한을 요구하지 않는다)는
 *   여전히 타당하므로, 그 취지는 optional_host_permissions로 지킨다 —
 *   설치할 때는 아무 사이트 권한도 없고, 사용자가 버튼을 누른 순간에만 요청한다.
 */

/** URL을 권한 패턴으로 바꾼다. 예: https://a.com/b?c → https://a.com/* */
export function originPatternFor(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export const ALL_URLS = '<all_urls>';

/** 이 URL에 접근할 권한이 이미 있는가. */
export async function hasHostAccess(url: string): Promise<boolean> {
  const pattern = originPatternFor(url);
  if (!pattern) return false;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * 이 URL에 대한 접근 권한을 요청한다.
 *
 * ★ 반드시 클릭 핸들러의 **첫 동작**으로 호출해야 한다.
 *   chrome.permissions.request는 사용자 제스처를 요구하는데, 앞에 await가
 *   끼면 제스처가 소실돼 "This function must be called during a user gesture"로
 *   실패한다. 이미 허용된 상태면 대화상자 없이 즉시 true를 돌려주므로,
 *   contains로 먼저 확인하지 말고 곧장 request를 부르는 편이 안전하다.
 */
export async function requestHostAccess(url: string): Promise<boolean> {
  const pattern = originPatternFor(url);
  if (!pattern) return false;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

/** 모든 사이트 접근을 한 번에 허용받는다(설정 화면의 선택지). */
export async function requestAllUrls(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [ALL_URLS] });
  } catch {
    return false;
  }
}

/**
 * 화면 캡처 권한을 확보한다.
 *
 * ★ `chrome.tabs.captureVisibleTab`은 **사이트별 권한을 받아주지 않는다.**
 *   `https://example.com/*`를 허용해 둬도 다음으로 거부한다:
 *
 *     Either the '<all_urls>' or 'activeTab' permission is required.
 *
 *   activeTab은 상주 사이드패널에서 신뢰할 수 없으므로(§0.7), 캡처만은
 *   `<all_urls>`가 필요하다. 본문 읽기(executeScript)는 사이트별 권한으로
 *   충분하므로 그쪽은 그대로 두고, **캡처에서만 권한을 올린다.**
 *
 *   호출 규칙은 requestHostAccess와 같다 — 클릭 핸들러의 첫 동작이어야 한다.
 */
export async function requestCaptureAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [ALL_URLS] });
  } catch {
    return false;
  }
}

export async function hasAllUrls(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [ALL_URLS] });
  } catch {
    return false;
  }
}

/** 지금까지 허용된 사이트 목록. 로컬 Ollama 항목은 뺀다. */
export async function grantedOrigins(): Promise<string[]> {
  try {
    const p = await chrome.permissions.getAll();
    return (p.origins ?? []).filter((o) => !o.includes('11434'));
  } catch {
    return [];
  }
}

export async function revokeOrigin(pattern: string): Promise<boolean> {
  try {
    return await chrome.permissions.remove({ origins: [pattern] });
  } catch {
    return false;
  }
}

export async function revokeAllSites(): Promise<void> {
  const origins = await grantedOrigins();
  if (origins.length === 0) return;
  try {
    await chrome.permissions.remove({ origins });
  } catch {
    /* 일부는 제거 불가할 수 있다 — 조용히 넘어간다 */
  }
}
