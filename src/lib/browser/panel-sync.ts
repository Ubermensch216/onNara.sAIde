import { sameDocument, type TabSummary } from '@/lib/messaging/protocol';

/**
 * 패널이 어떤 탭을 붙들지 정하는 규칙.
 *
 * 온나라는 목록에서 문서를 열면 **새 창 팝업**을 띄운다. 창·탭 구분 없이
 * 활성 탭 이벤트를 그대로 받으면 패널은 그 팝업을 "다른 문서"로 보고
 * 빈 대화로 갈아끼운다. 사용자 입장에서는 문서를 하나 열었을 뿐인데
 * 화면이 바뀌고 방금 붙여 둔 본문이 사라진다.
 */

/**
 * 사용자가 연 팝업의 부모 탭.
 *
 * ★ 새 창으로 뜬 팝업은 openerTabId가 비어 있어 탭 정보만으로는 출처를 알 수 없다.
 *   webNavigation 이벤트로만 알 수 있으므로 워커가 여기에 기록해 둔다.
 */
const openers = new Map<number, number>();
/** 팝업이 계속 쌓여도 메모리가 자라지 않도록 상한을 둔다. 오래된 것부터 버린다. */
const MAX_TRACKED = 200;

export function notePanelSpawn(details: { sourceTabId: number; tabId: number }): void {
  if (details.sourceTabId === details.tabId) return;
  openers.set(details.tabId, details.sourceTabId);
  while (openers.size > MAX_TRACKED) openers.delete(openers.keys().next().value!);
}

export function panelOpener(tabId: number | undefined): number | undefined {
  return tabId === undefined ? undefined : openers.get(tabId);
}

export function forgetPanelSpawn(tabId: number): void {
  openers.delete(tabId);
  forgetReportedTab(tabId);
  for (const [child, parent] of openers) if (parent === tabId) openers.delete(child);
}

/**
 * 창마다 패널이 마지막으로 보고받은 탭.
 *
 * ★ 화면 변화 알림을 브라우저의 모든 프레임 이동마다 보내면, 광고 프레임이 많은
 *   탭 하나 때문에 패널이 쉼 없이 깨어난다. 패널이 실제로 보고 있는 탭만 알린다.
 */
const reported = new Map<number, number>();

export function rememberPanelTab(tab: { tabId: number; windowId?: number }): void {
  if (tab.tabId < 0) return;
  reported.set(tab.windowId ?? -1, tab.tabId);
}

/**
 * 패널이 보고 있을 수 있는 탭인가.
 *
 * ★ 아는 것이 없으면(워커가 방금 깨어난 경우) 알린다. 알림이 한 번 더 가는 것보다
 *   지난 문서의 본문으로 답이 만들어지는 쪽이 훨씬 나쁘다.
 */
export function isReportedPanelTab(tabId: number): boolean {
  return reported.size === 0 || [...reported.values()].includes(tabId);
}

export function forgetReportedTab(tabId: number): void {
  for (const [windowId, reportedId] of reported) if (reportedId === tabId) reported.delete(windowId);
}

/** 테스트 전용. 이벤트 기록을 비운다. */
export function resetPanelSpawns(): void {
  openers.clear();
  reported.clear();
}

export type TabChangeDecision =
  /** 다른 창의 일이다. 패널은 그대로 둔다. */
  | 'ignore'
  /** 같은 작업의 연장(문서 팝업·같은 문서 재방문). 대화는 유지하고 대상 탭만 옮긴다. */
  | 'follow'
  /** 다른 문서다. 그 문서의 대화로 갈아끼운다. */
  | 'switch';

function origin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string): boolean {
  const left = origin(a);
  return left !== null && left === origin(b);
}

/**
 * 들어온 탭 이벤트를 어떻게 처리할지 정한다.
 *
 * ★ 순서가 규칙의 전부다.
 *   ① 같은 탭·같은 문서면 요약만 갱신한다(새로고침·탭 왕복으로도 이벤트가 온다).
 *   ② 지금 탭이 띄운 팝업(또는 그 팝업을 띄운 부모)으로의 이동은 같은 작업이다.
 *      대화를 유지한 채 읽을 대상만 옮긴다. 창이 달라도 마찬가지다 — 문서 팝업이 바로 그 경우다.
 *   ③ 그 외에 다른 창에서 벌어지는 일은 이 패널의 일이 아니다.
 */
export function decideTabChange(
  panel: { windowId?: number | null; tab: TabSummary | null },
  incoming: TabSummary,
): TabChangeDecision {
  if (!incoming || incoming.tabId < 0) return 'ignore';
  const current = panel.tab;

  if (current && current.tabId === incoming.tabId) {
    return sameDocument(current.url, incoming.url) ? 'follow' : 'switch';
  }

  if (current && sameOrigin(current.url, incoming.url)) {
    const openedByCurrent = incoming.openedFrom === current.tabId;
    const parentOfCurrent = current.openedFrom === incoming.tabId;
    if (openedByCurrent || parentOfCurrent) return 'follow';
  }

  if (panel.windowId != null && incoming.windowId != null && incoming.windowId !== panel.windowId) {
    return 'ignore';
  }
  return 'switch';
}
