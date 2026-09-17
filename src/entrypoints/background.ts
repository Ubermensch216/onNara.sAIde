import { assertCurrent, captureTab, trustedPanel, validPanelRequest } from '@/lib/browser/guards';
import type { RequestControl, SWToContent } from '@/lib/messaging/protocol';
/**
 * Service Worker — 계획서 §3 설계 결정 ①
 *
 * ★ LLM 호출은 여기서 하지 않는다. MV3 서비스 워커는 약 30초 유휴 시
 *   강제 종료되므로, 21초짜리 콜드 스타트와 수십 초짜리 생성이 중간에 끊긴다.
 *   LLM 호출 주체는 Side Panel 문서다. 여기서는 이벤트 라우팅과 스크립트
 *   주입만 담당한다.
 *
 * ★ 페이지 접근은 <all_urls> 상시 주입이 아니라 activeTab + executeScript
 *   온디맨드 방식이다. 사용자가 버튼을 누른 순간에만 주입한다.
 */

import { setLocale, t } from '@/lib/i18n';
import { loadSettings, onSettingsChanged } from '@/lib/storage/settings';
import {
  isRestrictedUrl,
  type ContentToSW,
  type PanelToSW,
  type SWToPanel,
  type TabSummary,
} from '@/lib/messaging/protocol';

const INJECTED_SCRIPT = 'injected.js';

export default defineBackground(() => {
  // ★ 워커에도 로케일을 물려준다.
  //   여기서 만든 오류 문구 중 일부는 UNKNOWN 코드로 패널에 그대로 뜬다 —
  //   describe.ts가 분류하지 못하는 것들이라 원문이 유일한 단서다. 그 원문이
  //   사용자의 언어여야 한다. 워커는 자체 모듈 인스턴스를 갖고 있으므로
  //   저장소에서 읽어 한 번 맞춰 두고, 이후 설정 변경도 따라간다.
  void loadSettings().then((s) => setLocale(s.locale));
  onSettingsChanged((s) => setLocale(s.locale));

  // 툴바 아이콘 클릭 → 사이드패널. 이 한 줄이 없으면 아이콘이 아무 반응도 없다.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.error('[sAIde] setPanelBehavior 실패', e));

  chrome.runtime.onInstalled.addListener(() => {
    registerContextMenus();
  });

  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    if (!trustedPanel(sender)) return false;
    if (!validPanelRequest(msg)) {
      sendResponse({ type: 'ERROR', error: { code: 'ACTION_DENIED', message: '유효하지 않거나 만료된 요청입니다.' } });
      return false;
    }
    handlePanelMessage(msg)
      .then(sendResponse)
      .catch((e: unknown) =>
        sendResponse({
          type: 'ERROR',
          error: { code: 'UNKNOWN', message: String(e) },
        } satisfies SWToPanel),
      );
    return true; // 비동기 응답을 쓰겠다는 신호
  });

  // 탭 전환 → 패널이 세션을 갈아끼울 수 있도록 알린다 (계획서 Phase 2-5)
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab) pushToPanel({ type: 'TAB_CHANGED', tab: toSummary(tab) });
  });

  /**
   * ★ status만 보면 안 된다.
   *
   *   `info.status === 'complete'`는 **전체 페이지 로드에서만** 발생한다.
   *   pushState로 화면을 갈아끼우는 SPA(요즘 뉴스 사이트 다수)에서는 끝내
   *   발생하지 않아, 패널이 이전 페이지를 그대로 물고 있게 된다 —
   *   기사 A를 요약한 뒤 기사 B로 넘어가도 A 기준으로 답하는 증상.
   *
   *   history API 이동은 `info.url`로 온다. 둘 다 받아야 한다.
   */
  chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
    if (!tab.active) return;
    if (info.url || info.status === 'complete') {
      pushToPanel({ type: 'TAB_CHANGED', tab: toSummary(tab) });
    }
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;
    await chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
    pushToPanel({
      type: 'CONTEXT_MENU',
      preset: String(info.menuItemId).replace('saide.', ''),
      selectionText: info.selectionText ?? '',
      tab: toSummary(tab),
    });
  });
});

/* ── 컨텍스트 메뉴 (계획서 Phase 3-6) ───────────────────── */

/**
 * ★ 여기서만 chrome.i18n을 쓴다.
 *   컨텍스트 메뉴는 서비스 워커가 만들고 크롬이 그린다. 우리 i18n 스토어는
 *   사이드패널 문서에 있어서 워커에서 읽을 수 없다. 대신 브라우저 언어를
 *   따르게 되므로, 앱 안에서 언어를 바꿔도 메뉴 문구는 그대로다 —
 *   크롬이 확장 메뉴를 다시 그리게 할 방법이 없어 감수한다.
 */
const MENUS: Array<{ id: string; messageKey: string }> = [
  { id: 'saide.translate', messageKey: 'menuTranslate' },
  { id: 'saide.explain', messageKey: 'menuExplain' },
  { id: 'saide.polish', messageKey: 'menuPolish' },
  { id: 'saide.send', messageKey: 'menuSend' },
];

function registerContextMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const m of MENUS) {
      chrome.contextMenus.create({
        id: m.id,
        title: chrome.i18n.getMessage(m.messageKey),
        contexts: ['selection'],
      });
    }
  });
}

/* ── 패널 요청 처리 ────────────────────────────────────── */

const cancelled = new Map<string, number>();
const inFlight = new Map<string, { tabId: number; control: RequestControl }>();

export async function handlePanelMessage(msg: PanelToSW): Promise<SWToPanel> {
  for (const [id, until] of cancelled) if (until < Date.now()) cancelled.delete(id);
  if (msg.type === 'CANCEL_REQUEST') {
    if (cancelled.size >= 1000) cancelled.delete(cancelled.keys().next().value!);
    cancelled.set(msg.requestId, Date.now() + 60_000);
    const pending = inFlight.get(msg.requestId);
    if (pending) void chrome.tabs.sendMessage(pending.tabId, { type: 'CANCEL', control: pending.control } satisfies SWToContent, { frameId: 0 }).catch(() => undefined);
    return { type: 'ACTIVE_TAB', tab: null };
  }
  const control = msg.control!;
  const isCancelled = () => cancelled.has(control?.id);
  switch (msg.type) {
    case 'GET_ACTIVE_TAB': {
      const tab = await activeTab();
      return { type: 'ACTIVE_TAB', tab: tab ? toSummary(tab) : null };
    }

    case 'LIST_TABS': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return { type: 'TABS', tabs: tabs.map(toSummary) };
    }

    case 'EXTRACT_PAGE': {
      const res = await withContentScript(msg.tabId, {
        type: 'EXTRACT',
        budgetTokens: msg.budgetTokens,
        control,
      });
      if (res.type === 'EXTRACTED') return { type: 'PAGE_EXTRACTED', payload: res.payload };
      if (res.type === 'FAILED') return { type: 'ERROR', error: res.error };
      return { type: 'ERROR', error: { code: 'UNKNOWN', message: t('sw.extractFailed') } };
    }

    case 'PREPARE_ACTION': {
      const res = await withContentScript(msg.tabId, { type: 'PREPARE', action: msg.action, control });
      if (res.type === 'PREPARED') return { type: 'ACTION_PREPARED', token: res.token, label: res.label };
      return res.type === 'FAILED' ? { type: 'ERROR', error: res.error } : { type: 'ERROR', error: { code: 'ACTION_DENIED', message: '대상을 확인할 수 없습니다.' } };
    }
    case 'EXEC_ACTION': {
      const res = await withContentScript(msg.tabId, { type: 'ACT', action: msg.action, control });
      if (res.type === 'ACTED') return { type: 'ACTION_RESULT', result: res.result };
      if (res.type === 'FAILED') return { type: 'ERROR', error: res.error };
      return { type: 'ERROR', error: { code: 'UNKNOWN', message: t('sw.actionFailed') } };
    }

    case 'CAPTURE_SCREENSHOT': {
      try {
        const dataUrl = await captureTab(msg.tabId, control, isCancelled);
        return { type: 'SCREENSHOT', dataUrl };
      } catch (e) {
        const raw = String(e);
        // captureVisibleTab은 사이트별 권한을 인정하지 않는다 — <all_urls> 또는 activeTab만.
        const needsAll = /all_urls|activeTab/i.test(raw);
        return {
          type: 'ERROR',
          error: needsAll
            ? {
                code: 'HOST_PERMISSION_REQUIRED',
                message: '화면 캡처 권한이 없습니다.',
                hint: '캡처는 모든 사이트 접근 권한이 필요합니다. 설정에서 허용하거나, 대신 페이지 본문 읽기를 사용하세요.',
              }
            : { code: 'TAB_RESTRICTED', message: '이 페이지는 캡처할 수 없습니다.', hint: raw },
        };
      }
    }
  }
}

/**
 * content script를 온디맨드 주입한 뒤 메시지를 보낸다.
 * 이미 주입돼 있으면 재주입은 무해하다(WXT가 중복 실행을 막는다).
 */
async function withContentScript(
  tabId: number,
  msg: SWToContent,
): Promise<ContentToSW> {
  inFlight.set(msg.control.id, { tabId, control: msg.control });
  const expiry = setTimeout(() => inFlight.delete(msg.control.id), Math.max(0, msg.control.deadline - Date.now()));
  try { return await dispatchContent(tabId, msg); }
  finally { clearTimeout(expiry); inFlight.delete(msg.control.id); }
}

async function dispatchContent(tabId: number, msg: SWToContent): Promise<ContentToSW> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || isRestrictedUrl(tab.url)) {
    return {
      type: 'FAILED',
      error: {
        code: 'TAB_RESTRICTED',
        message: '이 페이지에서는 sAIde가 내용을 읽을 수 없습니다.',
        hint: 'chrome:// 페이지와 웹스토어에서는 확장 스크립트 실행이 금지되어 있습니다.',
      },
    };
  }

  try {
    assertCurrent(msg.control, tab.url ?? '', cancelled.has(msg.control.id));
    await chrome.scripting.executeScript({ target: { tabId }, files: [INJECTED_SCRIPT] });
  } catch (e) {
    // 대부분은 해당 사이트 권한이 아직 없는 경우다. 원문 오류만 보여주면
    // 사용자가 무엇을 해야 할지 알 수 없으므로 해결 방법으로 바꿔서 알린다.
    const raw = String(e);
    const needsPermission = /must request permission|Cannot access contents/i.test(raw);
    return {
      type: 'FAILED',
      error: needsPermission
        ? {
            code: 'HOST_PERMISSION_REQUIRED',
            message: '이 사이트의 내용을 읽을 권한이 없습니다.',
            hint: '권한 요청 대화상자에서 허용하거나, 설정에서 모든 사이트를 한 번에 허용하세요.',
          }
        : { code: 'TAB_RESTRICTED', message: '페이지에 접근할 수 없습니다.', hint: raw },
    };
  }

  try {
    const current = await chrome.tabs.get(tabId);
    assertCurrent(msg.control, current.url ?? '', cancelled.has(msg.control.id));
    return (await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })) as ContentToSW;
  } catch (e) {
    return { type: 'FAILED', error: { code: 'UNKNOWN', message: String(e) } };
  }
}

/* ── 유틸 ──────────────────────────────────────────────── */

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function toSummary(tab: chrome.tabs.Tab): TabSummary {
  return {
    tabId: tab.id ?? -1,
    url: tab.url ?? '',
    title: tab.title ?? '',
    active: tab.active ?? false,
  };
}

/** 패널이 닫혀 있으면 수신자가 없어 예외가 난다. 정상 상황이므로 삼킨다. */
function pushToPanel(msg: SWToPanel) {
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}
