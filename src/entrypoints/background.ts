import { assertCurrent, captureTab, trustedPanel, validPanelRequest } from '@/lib/browser/guards';
import { committedSince, duplicateWorkTab, forgetWorkTab, panelTab, registerWorkTabListeners, tabsSpawnedBy, workTabs } from '@/lib/browser/work-tabs';
import { forgetPanelSpawn, isReportedPanelTab, notePanelSpawn, panelOpener, rememberPanelTab } from '@/lib/browser/panel-sync';
import type { AppError, AttachmentDownloadResult, AttachmentNaming, ExtractedPage, RequestControl, SWToContent } from '@/lib/messaging/protocol';
import { isHtmlAttachmentName } from '@/lib/onnara/attachments';
import { clearDownloadName, registerDownloadNaming, reserveDownloadName } from '@/lib/downloads/rename';
import { documentReadState, isReceivedDocumentList, normalizeForMatch, sameDocumentTitle, type StructuredDocumentList } from '@/lib/onnara/document-list';
import {
  clickMarkedReadButton, READ_BUTTON_MARK, READ_DIALOG_ATTR, READ_FAILURE_PATTERN, READ_SUCCESS_PATTERN, readMarkReadDialogs,
} from '@/lib/onnara/mark-read';
import { loadInboxLocation, saveInboxLocation } from '@/lib/inbox/location';
import { firstInboxPage } from '@/lib/onnara/inbox-pages';
import { isWorkTabBusy, runExclusive } from '@/lib/browser/sw-lock';
import { fitToBudget } from '@/lib/extract/budget';
import { generatePdfFromText, pdfText, withPdfSections } from '@/lib/extract/pdf-offscreen';
import type { DocumentListLocation } from '@/lib/onnara/document-navigation';
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
import { registerTaskAlerts } from '@/lib/schedule/alerts';
import { registerInboxBriefing } from '@/lib/inbox/schedule';
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

  // 작업 탭이 새 창으로 띄운 문서 팝업을 추적한다. 서비스 워커가 깨어날 때마다 최상위에서 등록해야 한다.
  registerWorkTabListeners();
  // 사용자가 직접 연 문서 팝업도 같은 방식으로 출처를 기록해 둔다(새 창 팝업은 openerTabId가 비어 있다).
  registerPanelSyncListeners();

  // 기한 알림(S07). 패널이 닫혀 있어도 알람이 워커를 깨워 확인한다.
  registerTaskAlerts();
  // 공유/공람 브리핑(N1). 기본 꺼짐이며, 켠 사용자에게만 알람이 동작한다. 주기는 설정을 따른다.
  registerInboxBriefing(BRIEFING_DEPS);
  // 첨부 파일명 정규화(B5). 브라우저가 이름을 정하기 직전에 한 번 끼어든다.
  registerDownloadNaming();

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
    const tab = await panelTab(tabId);
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
  chrome.tabs.onUpdated.addListener(async (_tabId, info, tab) => {
    if (!tab.active) return;
    if (info.url || info.status === 'complete') {
      const visible = await panelTab(_tabId);
      if (visible?.active) pushToPanel({ type: 'TAB_CHANGED', tab: toSummary(visible) });
    }
  });

  /**
   * ★ 탭 주소가 그대로여도 화면은 바뀐다.
   *
   *   온나라는 목록에서 문서를 고르면 iframe만 갈아끼우거나 같은 주소로 다시
   *   POST한다. onUpdated의 url은 오지 않고 와도 값이 같아, 패널은 앞 문서 본문을
   *   그대로 붙들고 답을 만든다 — 다른 문서를 근거로 한 그럴듯한 오답이다.
   *   프레임 단위 이동을 그대로 알려, 붙어 있던 본문을 떼어낼 수 있게 한다.
   */
  chrome.webNavigation.onCommitted.addListener(details => notifyScreenChange(details));
  chrome.webNavigation.onHistoryStateUpdated?.addListener(details => notifyScreenChange(details));

  // 팝업을 닫으면 패널이 붙들던 탭이 사라진다. 알려 주지 않으면 없는 탭을 계속 읽으려 한다.
  chrome.tabs.onRemoved.addListener(tabId => {
    forgetPanelSpawn(tabId);
    pushToPanel({ type: 'TAB_CLOSED', tabId });
  });

  /**
   * 단축키(`focus-input`) → 입력창.
   *
   * ★ 패널을 먼저 연다. 닫혀 있는데 메시지만 보내면 받을 사람이 없다.
   *   `sidePanel.open()`은 사용자 제스처를 요구하는데, 단축키 실행이 그 제스처다.
   *   이미 열려 있으면 여는 쪽은 조용히 실패하고 메시지만 남는다.
   */
  chrome.commands?.onCommand.addListener(async (command, tab) => {
    if (command !== 'focus-input') return;
    const windowId = tab?.windowId ?? (await chrome.windows.getCurrent().then(w => w?.id).catch(() => undefined));
    await (tab?.id
      ? chrome.sidePanel.open({ tabId: tab.id })
      : windowId === undefined
        ? Promise.resolve()
        : chrome.sidePanel.open({ windowId })
    ).catch(() => undefined);
    pushToPanel({ type: 'FOCUS_COMPOSER' });
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

/**
 * 브리핑이 서비스 워커에서 쓸 통로.
 *
 * ★ 스케줄러에 수집 함수를 **넘겨 준다**. 스케줄러가 background를 직접 가져오면 순환 참조가 되고,
 *   무엇보다 시험할 수 없게 된다 — 조건 판정(shouldBriefNow)은 브라우저 없이 돌아야 한다.
 */
const BRIEFING_DEPS = {
  collect: (budgetTokens: number, control: RequestControl) =>
    runExclusive(() => collectInbox(undefined, budgetTokens, control), control.deadline - Date.now()),
  panelOpen: panelIsOpen,
  notifyPanel: pushToPanel,
  busy: isWorkTabBusy,
};

/**
 * 사이드패널 문서가 열려 있는가.
 *
 * ★ `sendMessage`의 성공 여부로 가리지 않는다. 오프스크린 문서처럼 다른 수신자가 있으면
 *   패널이 닫혀 있어도 성공하고, 그러면 브리핑이 아무도 받지 않는 요청을 보낸 채 끝난다.
 */
async function panelIsOpen(): Promise<boolean> {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.SIDE_PANEL] });
    return contexts.length > 0;
  } catch {
    return false;
  }
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
    case 'DOWNLOAD_ATTACHMENTS': {
      const mode = msg.mode ?? 'attachments';
      const perform = async (targetTabId: number, targetControl: RequestControl, payload?: ExtractedPage): Promise<SWToPanel> => {
        if (mode === 'body') {
          return downloadBodyInTab(targetTabId, targetControl, msg.naming, payload);
        }
        if (mode === 'all') {
          const bodyOutcome = await downloadBodyInTab(targetTabId, targetControl, msg.naming, payload);
          const attachOutcome = await downloadAttachmentsInTab(targetTabId, targetControl, msg.naming);
          const results: AttachmentDownloadResult[] = [];
          if (bodyOutcome.type === 'ATTACHMENTS_DOWNLOADED') results.push(...bodyOutcome.results);
          if (attachOutcome.type === 'ATTACHMENTS_DOWNLOADED') results.push(...attachOutcome.results);
          return { type: 'ATTACHMENTS_DOWNLOADED', results };
        }
        return downloadAttachmentsInTab(targetTabId, targetControl, msg.naming);
      };

      if (msg.title) {
        return runExclusive(() => readDocumentInBackground(msg.tabId, msg.title!, 1000, control,
          target => perform(target.tabId, target.control, target.payload), { keepWorkTab: msg.keepWorkTab }));
      }
      const tab = await chrome.tabs.get(msg.tabId);
      assertCurrent(control, tab.url ?? '', isCancelled());
      return runExclusive(() => perform(msg.tabId, control));
    }

    case 'CAPTURE_INBOX_LOCATION': {
      /**
       * ★ 목록이 있는 **프레임을 먼저 찾는다.**
       *
       *   예전에는 `LOCATE_INBOX`를 곧바로 보냈는데, 추출(EXTRACT)이 아닌 메시지는
       *   `dispatchContent`가 최상위 프레임에만 보낸다. 온나라 목록은 하위 iframe에 있는
       *   경우가 대부분이라, 표가 없는 최상위에서 "받은문서 목록을 찾지 못했습니다"가 났다.
       *   문서 한 건을 여는 경로(`readDocumentInBackground`)가 이미 같은 이유로
       *   추출 결과의 `sourceFrameId`에 대고 `LOCATE_DOCUMENT`를 보낸다.
       */
      const found = await dispatchContent(msg.tabId, { type: 'EXTRACT', budgetTokens: LOCATE_BUDGET_TOKENS, purpose: 'page', control });
      if (found.type === 'FAILED') return { type: 'ERROR', error: found.error };
      // ★ 행이 없어도 받는다. 받은문서가 0건인 날에도 머리글은 그대로 있고,
      //   사용자는 그 화면을 보면서 지정하는 중이다.
      const list = found.type === 'EXTRACTED' ? found.payload.structuredData : undefined;
      if (!list) {
        return { type: 'ERROR', error: {
          code: 'UNKNOWN',
          message: '현재 화면에서 문서 목록을 찾지 못했습니다.',
          hint: '온나라 공유/공람 > 받은문서 목록이 화면에 보이는 상태에서 다시 지정하세요. 문서 상세 화면에서는 지정할 수 없습니다.',
        } };
      }
      const located = await sendToFrame(msg.tabId, found.type === 'EXTRACTED' ? found.payload.sourceFrameId ?? 0 : 0,
        { type: 'LOCATE_INBOX', control: { ...control, expectedUrl: undefined } });
      if (located.type === 'FAILED') return { type: 'ERROR', error: located.error };
      if (located.type !== 'INBOX_LOCATED') return { type: 'ERROR', error: { code: 'UNKNOWN', message: '받은문서 화면을 확인하지 못했습니다.' } };
      const saved = await saveInboxLocation(located.location, located.listName);
      return saved
        ? { type: 'INBOX_LOCATION_SAVED', listName: saved.listName }
        : { type: 'ERROR', error: { code: 'UNKNOWN', message: '브리핑 대상 위치를 저장하지 못했습니다.' } };
    }

    case 'COLLECT_INBOX':
      return runExclusive(() => collectInbox(msg.tabId, msg.budgetTokens, control), control.deadline - Date.now());
    case 'MARK_DOCUMENTS_READ':
      return runExclusive(() => markDocumentsRead(msg.tabId, msg.titles, control), control.deadline - Date.now());
    case 'GET_ACTIVE_TAB': {
      const tab = await activeTab(msg.windowId);
      const summary = tab ? toSummary(tab) : null;
      // 패널이 보고 있는 탭을 기억해 둔다. 화면 변화 알림을 그 탭에만 보낸다.
      if (summary) rememberPanelTab(summary);
      return { type: 'ACTIVE_TAB', tab: summary };
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

    case 'READ_DOCUMENT': {
      const title = msg.title;
      // 본문을 읽은 그 상세 화면에서 첨부까지 받는다. 문서를 두 번 열면 목록 복원 실패 위험도 두 배가 된다.
      const withAttachments = msg.withAttachments
        ? async (target: DetailTarget): Promise<SWToPanel> => {
            const downloaded = await downloadAttachmentsInTab(target.tabId, target.control);
            return {
              type: 'DOCUMENT_READ', requestedTitle: title, payload: target.payload,
              ...(downloaded.type === 'ATTACHMENTS_DOWNLOADED' ? { attachments: downloaded.results } : {}),
              ...(downloaded.type === 'ERROR' ? { attachmentError: downloaded.error } : {}),
            };
          }
        : undefined;
      return runExclusive(() => readDocumentInBackground(msg.tabId, title, msg.budgetTokens, control, withAttachments, { keepWorkTab: msg.keepWorkTab }));
    }

    case 'RELEASE_WORK_TAB':
      await releaseKeptWorkTab(msg.tabId);
      return { type: 'ACTIVE_TAB', tab: null };

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
  if (!tab) {
    // 닫힌 탭을 chrome:// 제한 페이지로 안내하면 사용자가 원인을 찾을 수 없다.
    return {
      type: 'FAILED',
      error: {
        code: 'UNKNOWN',
        message: '읽을 탭을 찾을 수 없습니다. 탭이 닫혔거나 다시 열렸을 수 있습니다.',
        hint: '읽을 페이지 탭에서 사이드패널을 열고 다시 요청하세요.',
      },
    };
  }
  if (isRestrictedUrl(tab.url)) {
    return {
      type: 'FAILED',
      error: {
        code: 'TAB_RESTRICTED',
        message: '이 페이지에서는 sAIde가 내용을 읽을 수 없습니다.',
        hint: 'chrome:// 페이지와 웹스토어에서는 확장 스크립트 실행이 금지되어 있습니다.',
      },
    };
  }

  // 온나라 업무 화면은 목록이 하위 iframe에 있는 경우가 많다. 추출 요청만
  // 접근 가능한 모든 프레임에서 실행하고, 구조화된 문서 목록을 최우선 선택한다.
  if (msg.type === 'EXTRACT') return dispatchExtractionAcrossFrames(tabId, msg, tab);

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
        : { code: 'UNKNOWN', message: '페이지에 접근할 수 없습니다.', hint: raw },
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

type ExtractRequest = SWToContent & { type: 'EXTRACT' };
type ExtractedCandidate = { frameId: number; frameUrl: string; response: ContentToSW };

export function chooseBestExtraction(
  candidates: ExtractedCandidate[],
  options: { purpose?: 'page' | 'document-detail'; preferredFrameId?: number; targetTitle?: string } = {},
): ExtractedCandidate | null {
  const extracted = candidates.filter(candidate => candidate.response.type === 'EXTRACTED');
  return extracted.sort((left, right) => extractionScore(right, options) - extractionScore(left, options))[0] ?? null;
}

function extractionScore(
  candidate: ExtractedCandidate,
  options: { purpose?: 'page' | 'document-detail'; preferredFrameId?: number; targetTitle?: string },
): number {
  const response = candidate.response;
  if (response.type !== 'EXTRACTED') return -1;
  const list = response.payload.structuredData;
  const rows = list?.rows.length ?? 0;
  if (options.purpose === 'document-detail') {
    // ★ 행 수가 아니라 목록인지로 가린다. 0건짜리 목록도 목록이지 상세 화면이 아니다.
    if (list) return -1;
    const titleKey = compactText(options.targetTitle ?? '');
    const contentKey = compactText(`${response.payload.title} ${response.payload.text}`);
    return response.payload.charCount +
      (candidate.frameId === options.preferredFrameId ? 10_000_000 : 0) +
      (titleKey && contentKey.includes(titleKey) ? 1_000_000 : 0);
  }
  const containsTarget = options.targetTitle && list?.rows.some(row => row.title && sameDocumentTitle(row.title, options.targetTitle!));
  // ★ 0건짜리 목록에도 자리를 준다. 그러지 않으면 문서가 없는 날 메뉴·머리말 프레임이 이겨,
  //   "목록 프레임이 어디인가"를 묻는 쪽(브리핑 대상 지정)이 엉뚱한 프레임을 받는다.
  return (containsTarget ? 100_000_000 : 0) + (list ? 500_000 : 0) +
    (rows ? 1_000_000 + rows * 10_000 : 0) + response.payload.charCount;
}

async function dispatchExtractionAcrossFrames(
  tabId: number,
  msg: ExtractRequest,
  tab: chrome.tabs.Tab,
): Promise<ContentToSW> {
  const topUrl = tab.url ?? '';
  assertCurrent(msg.control, topUrl, cancelled.has(msg.control.id));
  let frames: Array<{ frameId: number; parentFrameId: number; url: string }> = [{ frameId: 0, parentFrameId: -1, url: topUrl }];
  try {
    const discovered = await chrome.webNavigation.getAllFrames({ tabId });
    if (discovered?.length) frames = discovered.map(frame => ({ frameId: frame.frameId, parentFrameId: frame.parentFrameId ?? -1, url: frame.url || topUrl }));
  } catch {
    // webNavigation이 없는 개발 mock이나 구형 환경에서는 최상위 프레임만 읽는다.
  }

  const attempts = await Promise.all(frames.map(async frame => {
    const control = { ...msg.control, expectedUrl: frame.url || topUrl };
    try {
      // 로딩이 끝나지 않는 프레임 하나가 executeScript(document_idle 대기)를 붙잡으면
      // Promise.all 전체가 제한 시간을 다 써 버린다. 프레임마다 짧게 끊는다.
      const response = await frameTimeout((async () => {
        assertCurrent(msg.control, topUrl, cancelled.has(msg.control.id));
        await chrome.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, files: [INJECTED_SCRIPT] });
        assertCurrent(msg.control, topUrl, cancelled.has(msg.control.id));
        return await chrome.tabs.sendMessage(tabId, { ...msg, control }, { frameId: frame.frameId }) as ContentToSW;
      })(), msg.control);
      return { frameId: frame.frameId, frameUrl: frame.url, response } satisfies ExtractedCandidate;
    } catch (error) {
      return {
        frameId: frame.frameId,
        frameUrl: frame.url,
        response: { type: 'FAILED', error: accessError(error) },
      } satisfies ExtractedCandidate;
    }
  }));

  await attachPdfText(attempts, msg.budgetTokens);
  const current = await chrome.tabs.get(tabId);
  assertCurrent(msg.control, current.url ?? '', cancelled.has(msg.control.id));
  const best = chooseBestExtraction(attempts, msg);
  const blockedFrameUrls = [...new Set(attempts.flatMap(candidate => candidate.response.type === 'FAILED' &&
    candidate.response.error.code === 'HOST_PERMISSION_REQUIRED' && /^https?:/.test(candidate.frameUrl) ? [candidate.frameUrl] : []))];
  if (!best || best.response.type !== 'EXTRACTED') {
    if (blockedFrameUrls.length) return { type: 'FAILED', error: blockedFramesError(blockedFrameUrls) };
    return attempts.find(candidate => candidate.response.type === 'FAILED')?.response ?? {
      type: 'FAILED',
      error: { code: 'UNKNOWN', message: t('sw.extractFailed') },
    };
  }

  // 이미 연 상세 화면을 그대로 요약할 때(purpose 'page')도 본문이 PDF 프레임에 있으면
  // PDF 프레임 하나만 고르지 말고 바깥 화면(제목·첨부 목록)까지 최상위부터 합친다.
  const hasPdf = attempts.some(candidate => candidate.response.type === 'EXTRACTED' && candidate.response.payload.method === 'pdf');
  const top = attempts.find(candidate => candidate.frameId === 0 && candidate.response.type === 'EXTRACTED');
  const payload = best.response.payload.structuredData
    ? best.response.payload
    : msg.purpose === 'document-detail'
      ? mergeDetailFrames(best, attempts, frames, msg.budgetTokens)
      : hasPdf && top
        ? mergeDetailFrames(top, attempts, frames, msg.budgetTokens)
        : best.response.payload;
  return {
    type: 'EXTRACTED',
    payload: {
      ...payload,
      // 첨부물의 동일성 검사는 탭 URL 기준으로 유지한다. 실제 iframe 주소는 별도 기록한다.
      url: topUrl || payload.url,
      title: payload.structuredData?.listName
        ? `${payload.structuredData.listName} · ${tab.title || payload.title}`
        : payload.title,
      sourceFrameId: best.frameId,
      sourceFrameUrl: best.frameUrl,
      ...(blockedFrameUrls.length ? { blockedFrameUrls } : {}),
      attachments: payload.structuredData ? payload.attachments : {
        links: [...new Map(attempts.flatMap(candidate => candidate.response.type === 'EXTRACTED' && !candidate.response.payload.structuredData
          ? candidate.response.payload.attachments?.links ?? [] : []).map(link => [link.url, link])).values()],
        unsupported: attempts.reduce((sum, candidate) => sum + (candidate.response.type === 'EXTRACTED' && !candidate.response.payload.structuredData
          ? candidate.response.payload.attachments?.unsupported ?? 0 : 0), 0),
      },
    },
  };
}

/** 프레임이 넘긴 PDF 원본을 글자로 바꿔 그 프레임의 추출 결과에 합친다. */
async function attachPdfText(attempts: ExtractedCandidate[], budgetTokens: number): Promise<void> {
  await Promise.all(attempts.map(async candidate => {
    const response = candidate.response;
    if (response.type !== 'EXTRACTED' || !response.pdf?.length || response.payload.structuredData) return;
    // 같은 PDF를 바깥 문서의 embed와 PDF 프레임이 함께 알려 올 수 있다. 해석 결과는 주소별로 재사용된다.
    const results = await Promise.all(response.pdf.map(pdfText));
    candidate.response = { type: 'EXTRACTED', payload: withPdfSections(response.payload, results, budgetTokens) };
  }));
}

/**
 * 상세 화면은 제목·결재정보 프레임 안에 본문 프레임이 따로 있는 경우가 많다.
 * 고른 프레임 하나만 보내면 LLM이 제목과 버튼만 보고 요약하게 되므로,
 * 그 프레임과 하위 프레임의 본문을 모두 합쳐 예산 안에 담는다.
 */
export function mergeDetailFrames(
  best: ExtractedCandidate,
  attempts: ExtractedCandidate[],
  frames: Array<{ frameId: number; parentFrameId: number }>,
  budgetTokens: number,
): ExtractedPage {
  const base = (best.response as ContentToSW & { type: 'EXTRACTED' }).payload;
  const parents = new Map(frames.map(frame => [frame.frameId, frame.parentFrameId]));
  const isDescendant = (frameId: number) => {
    for (let parent = parents.get(frameId); parent !== undefined && parent >= 0; parent = parents.get(parent)) {
      if (parent === best.frameId) return true;
    }
    return false;
  };
  const segments = attempts
    .filter(candidate => candidate.frameId === best.frameId || isDescendant(candidate.frameId))
    .flatMap(candidate => candidate.response.type === 'EXTRACTED' && !candidate.response.payload.structuredData && candidate.response.payload.text.trim()
      ? [candidate.response.payload] : [])
    // 본문 프레임이 대개 가장 길다. 예산을 넘으면 뒤쪽이 잘리므로 긴 것부터 담는다.
    .sort((left, right) => right.charCount - left.charCount);
  const merged: ExtractedPage[] = [];
  let charCount = 0;
  for (const segment of segments) {
    // 부모 프레임이 같은 출처 하위 프레임 본문을 이미 포함했으면 중복해서 넣지 않는다.
    const probe = compactText(segment.text.slice(0, 200));
    if (probe && merged.some(kept => compactText(kept.text).includes(probe))) continue;
    merged.push(segment);
    charCount += segment.charCount;
  }
  // 글자가 하위 프레임(PDF 뷰어 등)에만 있으면 그 프레임 결과를 쓰되 화면 제목은 기준 프레임 것을 유지한다.
  if (merged.length === 1 && merged[0] !== base) return { ...merged[0]!, title: base.title || merged[0]!.title };
  if (merged.length <= 1) return base;
  const fitted = fitToBudget(merged.map(segment => segment.text).join('\n\n'), budgetTokens);
  const truncated = fitted.truncated || segments.some(segment => segment.truncated);
  return {
    ...base,
    method: merged.some(segment => segment.method === 'pdf') ? 'pdf' : base.method,
    text: fitted.text,
    charCount,
    truncated,
    keptRatio: truncated ? Math.min(1, fitted.text.length / Math.max(1, charCount)) : 1,
    estimatedTokens: fitted.estimatedTokens,
  };
}

/**
 * 원본 탭을 보존하기 위해 복제 탭에서만 문서를 연다. 온나라가 상세 문서를
 * 같은 iframe, 같은 탭, 새 팝업 중 어디에 띄우든 모두 감시하고 작업 탭은 닫는다.
 */
export async function readDocumentInBackground(
  sourceTabId: number,
  title: string,
  budgetTokens: number,
  control: RequestControl,
  /** 상세 화면을 찾은 뒤 작업 탭이 닫히기 전에 실행할 후속 작업(예: 첨부 다운로드). */
  onDetail?: (target: DetailTarget) => Promise<SWToPanel>,
  options: { keepWorkTab?: boolean } = {},
): Promise<SWToPanel> {
  const temporary = new Set<number>();
  let keptWorkTabId: number | undefined;
  const source = await chrome.tabs.get(sourceTabId).catch(() => null);
  if (!source) {
    return { type: 'ERROR', error: { code: 'UNKNOWN', message: '온나라 탭을 찾을 수 없습니다. 탭이 닫혔거나 다시 열렸을 수 있습니다.', hint: '온나라 문서 목록 탭에서 사이드패널을 열고 다시 요청하세요.' } };
  }
  if (isRestrictedUrl(source.url)) {
    return { type: 'ERROR', error: { code: 'TAB_RESTRICTED', message: '현재 온나라 화면을 복제할 수 없습니다.' } };
  }

  const taskControl: RequestControl = { ...control, deadline: control.deadline - 5000, expectedUrl: undefined };
  let stage: ReadStage = 'source';
  const observed: DetailObservation = { popup: false, frameChanged: false, state: 'none', chars: 0 };
  try {
    assertCurrent(control, source.url ?? '', cancelled.has(control.id));
    // duplicate()는 JS로 바뀐 iframe·검색·페이지 상태를 보장하지 않는다.
    // 복제 전에 실제 목록 프레임에서 읽기 전용으로 복원 정보를 확보한다.
    const originalList = await dispatchContent(sourceTabId, { type: 'EXTRACT', budgetTokens, purpose: 'page', targetTitle: title, control });
    if (originalList.type === 'FAILED') return { type: 'ERROR', error: originalList.error };
    if (originalList.type !== 'EXTRACTED' || !originalList.payload.structuredData?.rows.some(row => row.title && sameDocumentTitle(row.title, title))) {
      return { type: 'ERROR', error: { code: 'UNKNOWN', message: '현재 목록에서 요청한 문서를 찾을 수 없습니다. 목록을 다시 확인한 뒤 요청하세요.' } };
    }
    const located = await sendToFrame(sourceTabId, originalList.payload.sourceFrameId ?? 0, {
      type: 'LOCATE_DOCUMENT', title,
      control: { ...control, expectedUrl: originalList.payload.sourceFrameUrl ?? source.url },
    });
    if (located.type === 'FAILED') return { type: 'ERROR', error: located.error };
    if (located.type !== 'DOCUMENT_LOCATED') throw new Error('원본 문서 목록 위치를 확인하지 못했습니다.');
    assertCurrent(control, (await chrome.tabs.get(sourceTabId)).url ?? '', cancelled.has(control.id));
    const before = new Set((await chrome.tabs.query({})).flatMap(tab => typeof tab.id === 'number' ? [tab.id] : []));
    stage = 'list';
    // 앞 문서에서 남겨 둔 작업 탭의 목록에 이 문서가 그대로 있으면 복제·복원 없이 이어서 쓴다.
    // 문서마다 복제하면 목록 복원을 매번 반복하게 되고, 한 번만 실패해도 그 문서를 읽지 못한다.
    let chosenTabId: number | undefined;
    let chosenList: ExtractedPage | undefined;
    const kept = await takeKeptWorkTab(sourceTabId, source.url);
    if (kept !== undefined) {
      temporary.add(kept);
      workTabs.add(kept);
      const current = await dispatchContent(kept, { type: 'EXTRACT', budgetTokens, purpose: 'page', targetTitle: title, control: taskControl });
      if (current.type === 'EXTRACTED' && current.payload.structuredData?.rows.some(row => row.title && sameDocumentTitle(row.title, title))) {
        chosenTabId = kept;
        chosenList = current.payload;
      }
    }
    if (chosenTabId === undefined || !chosenList) {
      if (kept !== undefined) {
        await chrome.tabs.remove(kept).catch(() => undefined);
        temporary.delete(kept);
        forgetWorkTab(kept);
      }
      const duplicate = await duplicateWorkTab(sourceTabId);
      if (!duplicate || typeof duplicate.id !== 'number') throw new Error('백그라운드 작업 탭을 만들지 못했습니다.');
      chosenTabId = duplicate.id;
      temporary.add(chosenTabId);
      await keepBackground(chosenTabId, source);
      try {
        chosenList = await waitForDocumentList(chosenTabId, documentTarget(title), budgetTokens, taskControl, located.location);
      } catch (listError) {
        if (cancelled.has(control.id)) throw listError;
        // 복제 탭에서 검색 조건이나 세션 상태를 복원하지 못했더라도,
        // 원본 탭 화면에는 요청한 문서가 이미 표시되어 있다.
        // 복제 탭을 닫고 원본 탭에서 직접 열기를 시도한다 (온나라는 새 창 팝업으로 열리므로 원본 목록이 유지된다).
        await chrome.tabs.remove([chosenTabId]).catch(() => undefined);
        temporary.delete(chosenTabId);
        forgetWorkTab(chosenTabId);

        const recheck = await dispatchContent(sourceTabId, { type: 'EXTRACT', budgetTokens, purpose: 'page', targetTitle: title, control: taskControl });
        if (recheck.type === 'EXTRACTED' && recheck.payload.structuredData?.rows.some(row => row.title && sameDocumentTitle(row.title, title))) {
          chosenTabId = sourceTabId;
          chosenList = recheck.payload;
        } else {
          throw listError;
        }
      }
    }
    // 목록을 확보한 작업 탭만 다음 문서에 넘긴다 (원본 탭은 재사용 보관 대상에서 제외).
    const workTabId: number = chosenTabId;
    const list: ExtractedPage = chosenList;
    if (options.keepWorkTab && workTabId !== sourceTabId) keptWorkTabId = workTabId;
    const openFrameId = list.sourceFrameId ?? 0;
    stage = 'open';
    await injectDialogInterceptor(workTabId, openFrameId);
    if (workTabId !== sourceTabId) {
      await injectDialogInterceptor(sourceTabId, openFrameId);
    }
    const framesBefore = await frameUrls(workTabId);
    const openedAt = Date.now();
    const opened = await sendToFrame(workTabId, openFrameId, {
      type: 'OPEN_DOCUMENT', title, control: taskControl,
    });
    if (opened.type === 'FAILED') return { type: 'ERROR', error: opened.error };
    if (opened.type !== 'OPENING_DOCUMENT') {
      return { type: 'ERROR', error: { code: 'UNKNOWN', message: '문서 열기 동작을 시작하지 못했습니다.' } };
    }
    observed.target = opened.target;

    stage = 'detail';
    const detailStarted = Date.now();
    const detailDeadline = Math.min(taskControl.deadline, detailStarted + DETAIL_WAIT_MS);
    const finish = async (detail: ExtractedPage, tabId: number): Promise<SWToPanel> => {
      const payload = { ...detail, url: source.url ?? detail.url, title: detail.title || title };
      if (onDetail) {
        stage = 'followUp';
        return await onDetail({ tabId, payload, control: taskControl });
      }
      return { type: 'DOCUMENT_READ', requestedTitle: title, payload };
    };
    let stableChars = -1;
    let stableSince = 0;
    let readableSince = 0;
    let readable: { payload: ExtractedPage; tabId: number } | undefined;
    let blockedStreak = 0;
    while (Date.now() < detailDeadline) {
      assertCurrent(taskControl, '', cancelled.has(control.id));
      await delay(300);
      const tabs = new Map((await chrome.tabs.query({})).flatMap(tab => typeof tab.id === 'number' ? [[tab.id, tab] as const] : []));
      // 새 창(popup window) 팝업은 openerTabId가 비어 있으므로 window.open 이벤트로 기록한 체인을 먼저 본다.
      const children = [
        ...tabsSpawnedBy(workTabId),
        ...[...tabs.values()]
          .filter(tab => !before.has(tab.id!) && (tab.openerTabId === workTabId || (workTabId === sourceTabId && sameOrigin(tab.url, source.url))))
          .map(tab => tab.id!),
      ];
      for (const id of children) {
        if (id === workTabId || temporary.has(id)) continue;
        temporary.add(id);
        workTabs.add(id);
        await keepBackground(id, source);
      }

      // 로더 창이 스스로 닫히는 경우가 있어 살아 있는 가장 최근 팝업을 읽는다.
      const created = [...temporary].filter(id => id !== workTabId && tabs.has(id)).at(-1);
      // 복제 탭은 원본과 같은 브라우징 그룹이라, 같은 이름의 창이 이미 열려 있으면 새 창 대신 그 창이 이동한다.
      // 사용자가 연 창일 수 있으므로 읽기만 하고 닫지 않는다.
      const reused = created === undefined ? await reusedPopup(tabs, before, sourceTabId, source.url, openedAt) : undefined;
      const popup = created ?? reused;
      observed.popup = popup !== undefined;
      if (!observed.popup && !observed.frameChanged) observed.frameChanged = (await frameUrls(workTabId)) !== framesBefore;

      // 온나라 alert/confirm 팝업(과제 미지정 등)이 뜬 경우 대기시간을 소모하지 않고 즉시 실패 처리한다.
      const dialogMsg = (await checkDialogMessage(workTabId, openFrameId, taskControl)) ??
        (workTabId !== sourceTabId ? await checkDialogMessage(sourceTabId, openFrameId, taskControl) : undefined) ??
        (popup ? await checkDialogMessage(popup, 0, taskControl) : undefined);
      if (dialogMsg) {
        return {
          type: 'ERROR',
          error: {
            code: 'UNKNOWN',
            message: `문서 열람 불가: ${dialogMsg.trim()}`,
          },
        };
      }

      // 팝업 차단 등으로 클릭에 아무 반응이 없으면 2분을 기다리지 않는다.
      if (!observed.popup && !observed.frameChanged && Date.now() - detailStarted >= NO_REACTION_MS) break;
      const targetTabId = popup ?? workTabId;
      const preferredFrameId = popup ? 0 : openFrameId;
      const result = await dispatchContent(targetTabId, {
        type: 'EXTRACT',
        budgetTokens,
        purpose: 'document-detail',
        preferredFrameId,
        targetTitle: title,
        control: taskControl,
      });
      if (result.type !== 'EXTRACTED') {
        // 팝업이 권한 없는 주소(전용 뷰어 등)로 열리면 기다려도 읽을 수 없다.
        if (result.type === 'FAILED' && result.error.code === 'HOST_PERMISSION_REQUIRED') return { type: 'ERROR', error: result.error };
        Object.assign(observed, { state: 'failed', error: result.type === 'FAILED' ? result.error.hint ?? result.error.message : result.type });
        continue;
      }
      // 본문이 다른 호스트(전용 뷰어 등) 프레임에 있으면 그 주소 권한 없이는 끝내 읽을 수 없다.
      // 조용히 기다리지 말고 어떤 주소를 허용해야 하는지 바로 알린다. 로딩 중 순간값을 피하려고 두 번 연속 확인한다.
      const blocked = result.payload.blockedFrameUrls ?? [];
      blockedStreak = blocked.length ? blockedStreak + 1 : 0;
      if (blockedStreak >= 2) return { type: 'ERROR', error: blockedFramesError(blocked) };
      if (result.payload.structuredData) { Object.assign(observed, { state: 'list', chars: result.payload.charCount }); continue; }

      // 상세 화면에 접근 불가/권한 안내 문구 등이 뜬 경우 즉시 실패 처리한다.
      if (result.payload.charCount < 300 && ACCESS_DENIED_PATTERN.test(result.payload.text)) {
        return {
          type: 'ERROR',
          error: {
            code: 'UNKNOWN',
            message: `문서 열람 불가: ${result.payload.text.trim().replace(/\s+/g, ' ')}`,
          },
        };
      }

      if (result.payload.charCount < 120) { Object.assign(observed, { state: 'short', chars: result.payload.charCount }); continue; }
      // 재사용된 창은 이전 문서가 남아 있을 수 있어 제목이 보일 때만 받아들인다.
      const preferred = popup === undefined ? result.payload.sourceFrameId === openFrameId : popup === created;
      const mentionsTitle = compactText(`${result.payload.title} ${result.payload.text}`).includes(compactText(title));
      if (!preferred && !mentionsTitle) { Object.assign(observed, { state: 'mismatch', chars: result.payload.charCount }); continue; }
      // 본문 iframe은 제목 프레임보다 늦게 채워진다. 글자 수가 잠시 변하지 않을 때까지 기다리되,
      // 시계·남은 시간처럼 계속 바뀌는 화면 때문에 끝없이 기다리지 않도록 일정 시간이 지나면 읽은 내용으로 진행한다.
      const now = Date.now();
      readable = { payload: result.payload, tabId: targetTabId };
      readableSince ||= now;
      if (stableChars !== result.payload.charCount) { stableChars = result.payload.charCount; stableSince = now; }
      if (now - stableSince < DETAIL_STABLE_MS && now - readableSince < DETAIL_SETTLE_LIMIT_MS) continue;
      return await finish(result.payload, targetTabId);
    }

    if (readable) return await finish(readable.payload, readable.tabId);

    keptWorkTabId = undefined;
    return { type: 'ERROR', error: readTimeoutError(stage, observed) };
  } catch (error) {
    keptWorkTabId = undefined;
    if (cancelled.has(control.id)) return { type: 'ERROR', error: { code: 'ABORTED', message: '문서 읽기를 중단했습니다.' } };
    if (error instanceof ReadFailure) return { type: 'ERROR', error: error.appError };
    // 마감이 루프 조건 검사와 프레임 추출 사이에 지나면 assertCurrent가 던진다.
    // 원문 그대로면 어느 단계에서 왜 멈췄는지 알 수 없으므로 단계별 시간 초과로 바꾼다.
    if (Date.now() >= taskControl.deadline) return { type: 'ERROR', error: readTimeoutError(stage, observed) };
    return { type: 'ERROR', error: { code: 'UNKNOWN', message: `문서 화면 읽기에 실패했습니다 (${STAGE_LABEL[stage]}). ${String(error)}`, hint: '복제한 탭에서 문서 목록과 상세 본문이 표시되는지 확인하세요.' } };
  } finally {
    // 원본 탭은 절대 닫히지 않도록 temporary에서 제외한다.
    temporary.delete(sourceTabId);
    for (const root of [...temporary]) for (const id of tabsSpawnedBy(root)) temporary.add(id);
    temporary.delete(sourceTabId);
    // 다음 문서에 재사용할 작업 탭은 남기고, 이 문서의 팝업만 닫는다.
    if (keptWorkTabId !== undefined && keptWorkTabId !== sourceTabId && !cancelled.has(control.id) && await chrome.tabs.get(keptWorkTabId).then(() => true, () => false)) {
      temporary.delete(keptWorkTabId);
      await saveKeptWorkTab(sourceTabId, keptWorkTabId, source.url);
    } else {
      await clearKeptWorkTab(sourceTabId);
    }
    if (temporary.size) {
      await chrome.tabs.remove([...temporary])
        .catch(() => Promise.all([...temporary].map(id => chrome.tabs.remove(id).catch(() => undefined))));
    }
    for (const id of temporary) forgetWorkTab(id);
  }
}

type DetailTarget = { tabId: number; payload: ExtractedPage; control: RequestControl };

/* ── 여러 문서 처리 중 작업 탭 재사용 ─────────────────────── */

// 문서 요약 사이에 CPU 생성이 몇 분씩 걸려 서비스 워커가 내려갈 수 있다. 메모리 대신 세션 저장소에 둔다.
const keptKey = (sourceTabId: number) => `saide.keptWorkTab.${sourceTabId}`;
type KeptWorkTab = { workTabId: number; origin: string };

function originOf(url: string | undefined): string {
  try { return new URL(url ?? '').origin; } catch { return ''; }
}

async function takeKeptWorkTab(sourceTabId: number, sourceUrl: string | undefined): Promise<number | undefined> {
  try {
    const key = keptKey(sourceTabId);
    const kept = (await chrome.storage.session.get(key))[key] as KeptWorkTab | undefined;
    if (!kept) return undefined;
    await chrome.storage.session.remove(key);
    const tab = await chrome.tabs.get(kept.workTabId).catch(() => null);
    if (!tab || kept.origin !== originOf(sourceUrl) || originOf(tab.url) !== kept.origin) {
      if (tab) await chrome.tabs.remove(kept.workTabId).catch(() => undefined);
      return undefined;
    }
    return kept.workTabId;
  } catch {
    return undefined;
  }
}

async function saveKeptWorkTab(sourceTabId: number, workTabId: number, sourceUrl: string | undefined): Promise<void> {
  try {
    await chrome.storage.session.set({ [keptKey(sourceTabId)]: { workTabId, origin: originOf(sourceUrl) } satisfies KeptWorkTab });
  } catch {
    // 저장할 수 없으면 재사용하지 않고 바로 닫는다.
    await chrome.tabs.remove(workTabId).catch(() => undefined);
    forgetWorkTab(workTabId);
  }
}

async function clearKeptWorkTab(sourceTabId: number): Promise<void> {
  try { await chrome.storage.session.remove(keptKey(sourceTabId)); } catch { /* 저장소 없음 */ }
}

/** 여러 문서 처리가 끝나면 남겨 둔 작업 탭을 닫는다. */
export async function releaseKeptWorkTab(sourceTabId: number): Promise<void> {
  const workTabId = await takeKeptWorkTab(sourceTabId, (await chrome.tabs.get(sourceTabId).catch(() => null))?.url);
  if (workTabId === undefined) return;
  await chrome.tabs.remove(workTabId).catch(() => undefined);
  forgetWorkTab(workTabId);
}

/* ── 공유/공람 목록 수집 (N1) ───────────────────────── */

/**
 * 목록 프레임을 찾을 때만 쓰는 예산.
 *
 * ★ 본문을 쓰려는 것이 아니라 "어느 프레임에 표가 있는가"만 가리므로 작게 둔다.
 *   구조화된 목록은 예산과 무관하게 행·열로 추출된다.
 */
const LOCATE_BUDGET_TOKENS = 1000;

/** `읽기처리`를 누른 뒤 목록이 결과를 보일 때까지 기다리는 한도. */
const MARK_READ_WAIT_MS = 12_000;
const MARK_READ_POLL_MS = 700;
/** 화면 목록이 스스로 다시 그려지지 않을 때, 서버 목록으로 결과를 다시 묻는 간격. */
const MARK_READ_SERVER_CHECK_MS = 3_000;

/**
 * 받은문서 목록에서 문서들을 체크하고 `읽기처리`를 눌러 열람으로 바꾼다.
 *
 * ★ 사용자가 보고 있는 목록 탭에서 그대로 한다. 온나라의 `읽기처리`는 목록 화면의 체크 상태를
 *   읽어 처리하므로, 복제 탭에 목록을 복원하는 위험을 질 이유가 없다.
 *
 * ★ **결과는 목록을 다시 읽어 코드가 확인한다.** 버튼을 눌렀다는 것만으로 열람이 됐다고 말하지
 *   않는다. 미열람 목록에서 행이 빠졌거나 열람 칸이 바뀐 문서만 `marked`에 넣는다.
 *
 * ★ 화면 목록만 보지 않는다. 온나라는 `읽기처리` 뒤 목록을 다시 그리지 않거나, 열람 칸 없이
 *   그리는 판본이 있어 화면만으로는 끝내 확인하지 못했다. 브리핑이 "미열람"이라고 읽은 바로 그
 *   **저장된 조회 요청**으로 서버 목록을 다시 받아 같은 기준으로 대조한다.
 *
 * ★ 페이지 스크립트를 부르는 모든 걸음에 제한 시간을 둔다. 페이지에 확인창이 떠 프레임이
 *   멈추면 `executeScript`가 돌아오지 않고, 그 한 건이 작업 잠금을 쥔 채 남는다.
 */
export async function markDocumentsRead(tabId: number, titles: string[], control: RequestControl, restored = false): Promise<SWToPanel> {
  const taskControl: RequestControl = { ...control, expectedUrl: undefined };
  const saved = await loadInboxLocation();
  const serverTab = saved ? (await findOnnaraTab(tabId, saved.origin))?.id : undefined;
  const readServerList = async () => saved && serverTab !== undefined
    ? readInboxList(serverTab, saved, taskControl).catch(() => null)
    : null;
  const found = await dispatchContent(tabId, { type: 'EXTRACT', budgetTokens: LOCATE_BUDGET_TOKENS, purpose: 'page', targetTitle: titles[0], control: taskControl });
  if (found.type === 'FAILED') return { type: 'ERROR', error: found.error };
  // 현재 화면에서 이미 열람(read) 상태인 문서는 온나라 버튼을 다시 누를 필요 없이 바로 완료로 본다.
  const pageRows = found.type === 'EXTRACTED' ? found.payload.structuredData?.rows : undefined;
  const alreadyRead: string[] = [];
  let remainingTitles = titles;
  if (pageRows) {
    for (const title of titles) {
      const row = pageRows.find(r => r.title && sameDocumentTitle(r.title, title));
      if (row && documentReadState(row) === 'read') alreadyRead.push(title);
    }
    if (alreadyRead.length === titles.length) {
      return { type: 'DOCUMENTS_MARKED_READ', marked: alreadyRead, unconfirmed: [], missing: [], dialogs: [] };
    }
    if (alreadyRead.length > 0) {
      remainingTitles = titles.filter(t => !alreadyRead.includes(t));
    }
  }

  // 브리핑은 서버 목록의 모든 페이지를 읽는다. 카드의 문서가 현재 화면 페이지에 없으면
  // 원본 화면을 바꾸지 않고 작업 탭에 해당 페이지를 복원해 같은 버튼을 누른다.
  if (!restored && remainingTitles.length === 1 && saved && serverTab !== undefined &&
      !(found.type === 'EXTRACTED' && found.payload.structuredData?.rows.some(row => row.title && sameDocumentTitle(row.title, remainingTitles[0]!)))) {
    return markOffPageDocument(serverTab, saved, remainingTitles[0]!, control);
  }
  if (found.type !== 'EXTRACTED' || !found.payload.structuredData) {
    return { type: 'ERROR', error: {
      code: 'UNKNOWN',
      message: '현재 화면에서 받은문서 목록을 찾지 못했습니다.',
      hint: '온나라 공유/공람 > 받은문서 목록이 화면에 보이는 탭에서 다시 시도하세요.',
    } };
  }
  const frameId = found.payload.sourceFrameId ?? 0;

  const prepared = await sendToFrame(tabId, frameId, { type: 'PREPARE_MARK_READ', titles: remainingTitles, control: taskControl });
  if (prepared.type === 'FAILED') return { type: 'ERROR', error: prepared.error };
  if (prepared.type !== 'MARK_READ_PREPARED') return { type: 'ERROR', error: { code: 'UNKNOWN', message: '읽기처리할 문서를 체크하지 못했습니다.' } };

  let buttonFrameId = frameId;
  if (!prepared.buttonMarked) {
    const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
    const byId = new Map(frames?.map(frame => [frame.frameId, frame]) ?? []);
    let parentId = byId.get(frameId)?.parentFrameId ?? -1;
    let buttonFound = false;
    while (parentId >= 0) {
      const response = await sendToFrame(tabId, parentId, { type: 'MARK_READ_BUTTON', control: taskControl });
      if (response.type === 'READ_BUTTON_MARKED' && response.marked) {
        buttonFrameId = parentId;
        buttonFound = true;
        break;
      }
      parentId = byId.get(parentId)?.parentFrameId ?? -1;
    }
    if (!buttonFound) return { type: 'ERROR', error: {
      code: 'UNKNOWN', message: "'읽기처리' 버튼을 찾지 못했습니다.",
      hint: '온나라 공유/공람 > 받은문서 목록과 우측 상단의 읽기처리 버튼이 보이는 상태에서 다시 시도하세요.',
    } };
  }

  let clicked = false;
  try {
    const [result] = await frameTimeout(chrome.scripting.executeScript({
      target: { tabId, frameIds: [buttonFrameId] }, world: 'MAIN',
      func: clickMarkedReadButton, args: [READ_BUTTON_MARK, READ_DIALOG_ATTR],
    }), taskControl);
    clicked = Boolean((result?.result as { clicked?: boolean } | undefined)?.clicked);
  } catch (error) {
    const appError = accessError(error);
    if (appError.code === 'HOST_PERMISSION_REQUIRED') return { type: 'ERROR', error: appError };
    // 버튼은 눌렸는데 페이지의 창이 프레임을 붙잡아 돌아오지 못한 경우다. 눌렸는지는 아래에서
    // 목록으로 확인한다 — 여기서 실패로 끝내면 실제로 처리된 문서를 미열람이라고 말하게 된다.
    clicked = true;
  }
  if (!clicked) return { type: 'ERROR', error: { code: 'UNKNOWN', message: "'읽기처리' 버튼을 누르지 못했습니다. 목록 화면이 바뀌었을 수 있습니다." } };

  const pending = new Set(prepared.checked);
  const marked: string[] = [];
  let dialogs: string[] = [];
  const serverStillUnread = new Set<string>();
  /** 판정할 수 없던 문서. 열람 칸이 없는 목록이면 행이 남아 있어도 열람인지 알 수 없다. */
  const settle = (rows: StructuredDocumentList['rows'], complete: boolean) => {
    for (const title of [...pending]) {
      const row = rows.find(item => item.title && sameDocumentTitle(item.title, title));
      if (complete && row && documentReadState(row) === 'unread') serverStillUnread.add(title);
      // 미열람 목록에서 빠졌거나, 열람 여부가 명시적으로 열람으로 바뀌었다.
      // 일반 처리 상태('담당확인' 등)는 documentReadState가 열람으로 보지 않는다.
      // 행이 없다는 것은 목록 전체를 읽었을 때만 근거가 된다 — 화면 목록은 한 페이지뿐이다.
      if (row ? documentReadState(row) === 'read' : complete) {
        pending.delete(title);
        marked.push(title);
      }
    }
  };
  const until = Math.min(Date.now() + MARK_READ_WAIT_MS, taskControl.deadline - 2000);
  let serverCheckedAt = Date.now();
  while (pending.size && Date.now() < until && !cancelled.has(control.id)) {
    await delay(MARK_READ_POLL_MS);
    dialogs = await frameDialogs(tabId, buttonFrameId, dialogs, taskControl);
    if (dialogs.some(message => READ_FAILURE_PATTERN.test(message))) break;
    const list = await dispatchContent(tabId, { type: 'EXTRACT', budgetTokens: LOCATE_BUDGET_TOKENS, purpose: 'page', control: taskControl });
    const rows = list.type === 'EXTRACTED' ? list.payload.structuredData?.rows : undefined;
    if (rows) settle(rows, false);
    if (pending.size && Date.now() - serverCheckedAt >= MARK_READ_SERVER_CHECK_MS) {
      serverCheckedAt = Date.now();
      const server = await readServerList();
      if (server) settle(server.rows, true);
    }
  }
  // 마지막으로 한 번 더 서버 목록에 묻는다. 버튼을 누른 뒤 서버가 늦게 처리하는 경우가 있다.
  if (pending.size && !cancelled.has(control.id) && Date.now() < taskControl.deadline - 1000) {
    const server = await readServerList();
    if (server) settle(server.rows, true);
  }
  // 목록이 스스로 다시 그려지지 않는 판본이 있다. 온나라가 완료를 알렸다면 그 말을 믿는다.
  if (pending.size && !dialogs.some(message => READ_FAILURE_PATTERN.test(message)) && dialogs.some(message => READ_SUCCESS_PATTERN.test(message))) {
    for (const title of [...pending]) {
      if (serverStillUnread.has(title)) continue;
      marked.push(title);
      pending.delete(title);
    }
  }
  return { type: 'DOCUMENTS_MARKED_READ', marked: [...alreadyRead, ...marked], unconfirmed: [...pending], missing: prepared.missing, dialogs };
}

async function frameDialogs(tabId: number, frameId: number, previous: string[], control: RequestControl): Promise<string[]> {
  try {
    const [result] = await frameTimeout(chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] }, world: 'MAIN', func: readMarkReadDialogs, args: [READ_DIALOG_ATTR],
    }), control);
    const messages = (result?.result as string[] | undefined) ?? [];
    // 목록 프레임이 다시 그려지면 기록이 사라진다. 앞서 모은 글을 잃지 않는다.
    return [...new Set([...previous, ...messages.filter(Boolean)])];
  } catch {
    return previous;
  }
}

/** 화면에 없는 카드 한 건은 저장된 조회 조건에서 해당 페이지를 찾아 작업 탭에 복원한다. */
async function markOffPageDocument(
  sourceTabId: number,
  saved: NonNullable<Awaited<ReturnType<typeof loadInboxLocation>>>,
  title: string,
  control: RequestControl,
): Promise<SWToPanel> {
  const taskControl: RequestControl = { ...control, expectedUrl: undefined };
  let workTabId: number | undefined;
  try {
    let location: DocumentListLocation | null = firstInboxPage(saved.location);
    const visited = new Set<string>();
    while (location) {
      assertCurrent(taskControl, '', cancelled.has(control.id));
      const key = JSON.stringify(location);
      if (visited.has(key)) throw new Error('목록 페이지가 반복되어 문서를 찾지 못했습니다.');
      visited.add(key);
      const response = await sendToFrame(sourceTabId, 0, { type: 'FETCH_INBOX_PAGE', location, control: taskControl });
      if (response.type === 'FAILED') throw new InboxPageError(response.error);
      if (response.type !== 'INBOX_PAGE') throw new Error('받은문서 목록을 다시 조회하지 못했습니다.');
      const row = response.list.rows.find(item => item.title && sameDocumentTitle(item.title, title));
      if (row) {
        if (documentReadState(row) === 'read') {
          return { type: 'DOCUMENTS_MARKED_READ', marked: [title], unconfirmed: [], missing: [], dialogs: [] };
        }
        const source = await chrome.tabs.get(sourceTabId);
        const work = await duplicateWorkTab(sourceTabId);
        workTabId = work.id;
        if (workTabId === undefined) throw new Error('받은문서 작업 탭을 만들지 못했습니다.');
        await keepBackground(workTabId, source);
        await waitForDocumentList(workTabId, documentTarget(title), LOCATE_BUDGET_TOKENS, taskControl, location);
        return await markDocumentsRead(workTabId, [title], control, true);
      }
      location = response.next;
    }
    // 저장된 받은문서 목록(미열람 목록) 전체를 확인했으나 해당 문서를 찾지 못한 경우:
    // 사용자가 온나라 메인 화면에서 직접 읽었거나 '읽기처리'를 눌러 이미 '열람' 상태가 됨으로써
    // 미열람 목록에서 제외된 것이다(settle 함수의 complete 판정과 동일).
    // 이미 읽기 처리가 완료된 것으로 보고 브리핑 리스트에서 정상적으로 정리(삭제)할 수 있게 한다.
    return { type: 'DOCUMENTS_MARKED_READ', marked: [title], unconfirmed: [], missing: [], dialogs: [] };
  } catch (error) {
    if (error instanceof InboxPageError) return { type: 'ERROR', error: error.appError };
    if (error instanceof ReadFailure) return { type: 'ERROR', error: error.appError };
    return { type: 'ERROR', error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } };
  } finally {
    if (workTabId !== undefined) {
      await chrome.tabs.remove(workTabId).catch(() => undefined);
      forgetWorkTab(workTabId);
    }
  }
}

/**
 * 저장해 둔 조회 요청으로 받은문서 목록을 첫 페이지부터 끝까지 받는다. 화면은 건드리지 않는다.
 *
 * ★ 브리핑([collectInbox])과 읽기처리 확인([markDocumentsRead])이 **같은 목록**을 본다.
 *   서로 다른 곳을 보면, 브리핑이 미열람이라 한 문서를 읽기처리 쪽은 끝내 확인하지 못한다.
 */
async function readInboxList(
  sourceTabId: number,
  saved: NonNullable<Awaited<ReturnType<typeof loadInboxLocation>>>,
  control: RequestControl,
): Promise<StructuredDocumentList> {
  let location: DocumentListLocation | null = firstInboxPage(saved.location);
  let list: StructuredDocumentList | undefined;
  const requests = new Set<string>();
  const pages = new Set<string>();
  while (location) {
    assertCurrent(control, '', cancelled.has(control.id));
    const key = JSON.stringify(location);
    if (requests.has(key)) throw new Error('같은 목록 페이지가 반복되어 전체 수집을 중단했습니다.');
    requests.add(key);
    const page: ContentToSW = await sendToFrame(sourceTabId, 0, { type: 'FETCH_INBOX_PAGE', location, control });
    if (page.type === 'FAILED') throw new InboxPageError(page.error);
    if (page.type !== 'INBOX_PAGE') throw new Error('공유/공람 목록 조회 응답을 확인할 수 없습니다.');
    const fingerprint = JSON.stringify(page.list.rows);
    if (page.list.rows.length && pages.has(fingerprint)) throw new Error('페이지를 바꿔도 같은 문서 목록이 반환되어 전체 수집을 중단했습니다.');
    pages.add(fingerprint);
    list ??= { ...page.list, listName: saved.listName, rows: [] };
    list.rows.push(...page.list.rows);
    location = page.next;
  }
  if (!list) throw new Error('공유/공람 목록을 읽지 못했습니다.');
  return list;
}

/** 목록 프레임이 돌려준 오류를 그대로 전한다(권한 안내 등 해결 버튼이 달린 오류다). */
class InboxPageError extends Error {
  constructor(readonly appError: AppError) { super(appError.message); }
}

/** 목록 대신 로그인 화면이 왔는가. 세션이 끊긴 것과 화면을 못 읽은 것은 사용자가 할 일이 다르다. */
export function looksLikeLogin(text: string): boolean {
  return /로그인|인증서|세션이\s*만료|다시\s*로그인|sign\s*in|gpki/i.test(text.slice(0, 2000));
}

/**
 * 지정해 둔 받은문서 목록을 읽어 온다.
 *
 * ★ **본문을 열지 않는다.** 목록 표만 읽는다 — 그것이 열람 상태를 미열람으로 두는 유일한 방법이다.
 * ★ 로그인된 출처에서 저장한 조회 요청을 재전송하므로 현재 화면과 프레임 구조에 의존하지 않는다.
 *   첫 페이지부터 마지막 페이지까지 읽고, 전부 성공했을 때만 브리핑에 넘긴다.
 */
export async function collectInbox(
  hintTabId: number | undefined,
  _budgetTokens: number,
  control: RequestControl,
): Promise<SWToPanel> {
  const saved = await loadInboxLocation();
  if (!saved) {
    return { type: 'ERROR', error: {
      code: 'UNKNOWN',
      message: '브리핑할 화면이 지정되지 않았습니다.',
      hint: '온나라 공유/공람 > 받은문서 목록을 연 뒤 공유/공람 탭에서 "이 화면을 브리핑 대상으로 지정"을 누르세요.',
    } };
  }

  const source = await findOnnaraTab(hintTabId, saved.origin);
  if (!source || typeof source.id !== 'number') {
    return { type: 'ERROR', error: {
      code: 'UNKNOWN',
      message: '온나라 탭이 열려 있지 않습니다.',
      hint: `${saved.origin} 에 로그인한 탭을 연 뒤 다시 확인하세요. 확장은 브라우저가 열려 있고 온나라 세션이 살아 있을 때만 목록을 읽을 수 있습니다.`,
    } };
  }

  const taskControl = { ...control, expectedUrl: undefined };
  try {
    const list = await readInboxList(source.id, saved, taskControl);
    // 열람 정책은 기존처럼 실제 목록을 보고 있는 경우에만 허용한다.
    // 이 확인이 실패해도 백그라운드 목록 수집 결과는 그대로 사용할 수 있다.
    if (hintTabId === source.id && (await loadSettings()).briefingReadPolicy === 'mark-read') {
      const current = await dispatchContent(source.id, { type: 'EXTRACT', budgetTokens: LOCATE_BUDGET_TOKENS, purpose: 'page', control: taskControl });
      if (current.type === 'EXTRACTED' && isReceivedDocumentList(current.payload.structuredData)) {
        return { type: 'INBOX_COLLECTED', list, via: 'active-tab' };
      }
    }
    return { type: 'INBOX_COLLECTED', list, via: 'background-request' };
  } catch (error) {
    if (error instanceof InboxPageError) return { type: 'ERROR', error: error.appError };
    return { type: 'ERROR', error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) } };
  }
}

/** 저장해 둔 출처와 같은 온나라 탭. 작업 탭은 제외한다 — 그 탭은 우리가 만든 것이다. */
async function findOnnaraTab(hintTabId: number | undefined, origin: string): Promise<chrome.tabs.Tab | null> {
  if (hintTabId !== undefined) {
    const hinted = await chrome.tabs.get(hintTabId).catch(() => null);
    if (hinted && typeof hinted.id === 'number' && !workTabs.has(hinted.id) && originOf(hinted.url) === origin) return hinted;
  }
  const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
  const matched = tabs.filter(tab => typeof tab.id === 'number' && !workTabs.has(tab.id) && originOf(tab.url) === origin);
  return matched.find(tab => tab.active) ?? matched[0] ?? null;
}

type ReadStage = 'source' | 'list' | 'open' | 'detail' | 'followUp';
type DetailObservation = {
  popup: boolean;
  frameChanged: boolean;
  state: 'none' | 'failed' | 'list' | 'short' | 'mismatch';
  chars: number;
  error?: string;
  /** 문서를 열려고 실제로 누른 요소. 반응이 없을 때 엉뚱한 요소를 눌렀는지 알 수 있다. */
  target?: string;
};

const DETAIL_WAIT_MS = 60_000;
const NO_REACTION_MS = 4_000;
const DETAIL_STABLE_MS = 1000;
const DETAIL_SETTLE_LIMIT_MS = 10_000;

const ACCESS_DENIED_PATTERN = /과제\s*미지정|열람\s*권한|열람하실\s*수\s*없습니다|접근\s*권한|권한이\s*없습니다|존재하지\s*않는\s*문서|삭제된\s*문서|처리\s*권한|오류가\s*발생/i;

async function injectDialogInterceptor(tabId: number, openFrameId = 0): Promise<void> {
  const frameIds = new Set<number>([0, openFrameId]);
  try {
    const all = await chrome.webNavigation.getAllFrames({ tabId });
    for (const f of all ?? []) {
      if (f.url && !f.url.startsWith('about:') && !f.url.startsWith('chrome:') && !f.url.startsWith('javascript:')) {
        frameIds.add(f.frameId);
      }
    }
  } catch {}

  for (const frameId of frameIds) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world: 'MAIN',
        injectImmediately: true,
        func: () => {
          const saveDialog = (msg: unknown) => {
            try {
              const text = String(msg ?? '').trim();
              if (!text) return;
              document.documentElement.setAttribute('data-saide-dialog', text);
              (window as unknown as { __saide_dialog_message?: string }).__saide_dialog_message = text;
              if (window.top && window.top !== window) {
                try {
                  window.top.document.documentElement.setAttribute('data-saide-dialog', text);
                  (window.top as unknown as { __saide_dialog_message?: string }).__saide_dialog_message = text;
                } catch {}
              }
              if (window.parent && window.parent !== window) {
                try {
                  window.parent.document.documentElement.setAttribute('data-saide-dialog', text);
                  (window.parent as unknown as { __saide_dialog_message?: string }).__saide_dialog_message = text;
                } catch {}
              }
            } catch {}
            console.warn('[sAIde] Intercepted alert in MAIN world:', msg);
          };

          const hook = (w: Window | null | undefined) => {
            try {
              if (!w) return;
              try { w.document.documentElement.removeAttribute('data-saide-dialog'); } catch {}
              (w as unknown as { __saide_dialog_message?: string | null }).__saide_dialog_message = null;
              if ((w as unknown as { __saide_dialog_hooked?: boolean }).__saide_dialog_hooked) return;
              (w as unknown as { __saide_dialog_hooked?: boolean }).__saide_dialog_hooked = true;

              w.alert = function (msg) { saveDialog(msg); };
              w.confirm = function (msg) { saveDialog(msg); return false; };
              w.prompt = function (msg) { saveDialog(msg); return null; };
            } catch {}
          };

          hook(window);
          try { hook(window.parent); } catch {}
          try { hook(window.top); } catch {}
          try {
            if (window.top) {
              for (let i = 0; i < window.top.frames.length; i++) {
                hook(window.top.frames[i]);
              }
            }
          } catch {}
        },
      });
    } catch {}
  }
}

async function checkDialogMessage(tabId: number, frameId: number, control: RequestControl): Promise<string | undefined> {
  for (const fId of new Set([frameId, 0])) {
    try {
      const res = await sendToFrame(tabId, fId, { type: 'CHECK_DIALOG', control });
      if (res.type === 'DIALOG_CHECKED' && res.message) return res.message;
    } catch {}
  }
  for (const fId of new Set([frameId, 0])) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [fId] },
        world: 'MAIN',
        func: () => {
          const domAttr = document.documentElement.getAttribute('data-saide-dialog');
          const winMsg = (window as unknown as { __saide_dialog_message?: string }).__saide_dialog_message;
          const topAttr = (() => {
            try { return window.top?.document.documentElement.getAttribute('data-saide-dialog'); } catch { return null; }
          })();
          const topMsg = (() => {
            try { return (window.top as unknown as { __saide_dialog_message?: string })?.__saide_dialog_message; } catch { return null; }
          })();
          return domAttr || winMsg || topAttr || topMsg || null;
        },
      });
      for (const r of results ?? []) {
        if (r?.result) return String(r.result);
      }
    } catch {}
  }
  return undefined;
}

/** 권한 없는 본문 프레임 주소를 사용자가 허용할 수 있는 형태로 알린다. */
export function blockedFramesError(urls: string[]): AppError {
  const origins = [...new Set(urls.flatMap(url => { try { return [new URL(url).origin]; } catch { return []; } }))];
  return {
    code: 'HOST_PERMISSION_REQUIRED',
    message: `문서 본문이 다른 주소(${origins.join(', ')})에 있어 읽을 권한이 없습니다.`,
    hint: '"권한 허용"을 눌러 이 주소를 허용한 뒤 다시 요청하세요.',
    origins,
  };
}

const STAGE_LABEL: Record<ReadStage, string> = {
  source: '원본 목록 확인 단계',
  list: '작업 탭 목록 준비 단계',
  open: '문서 열기 단계',
  detail: '상세 본문 읽기 단계',
  followUp: '첨부 다운로드 단계',
};

/** 마지막으로 관찰한 상세 화면 상태를 근거로 사용자가 확인할 지점을 알려 준다. */
export function readTimeoutError(stage: ReadStage, observed: DetailObservation): AppError {
  if (stage !== 'detail') {
    return {
      code: 'TIMEOUT',
      message: `문서 화면 읽기가 제한 시간을 초과했습니다 (${STAGE_LABEL[stage]}).`,
      hint: stage === 'source'
        ? '원본 온나라 화면이 응답하는지 확인한 뒤 다시 시도하세요.'
        : stage === 'followUp'
          ? '첨부 파일이 크거나 브라우저가 다운로드 확인을 기다리는지 다운로드 목록에서 확인하세요.'
          : '복제한 탭이 로그인 화면이나 첫 화면으로 열리지 않는지 확인하세요.',
    };
  }
  const where = observed.popup ? '새 창' : '작업 탭';
  const hint = !observed.popup && !observed.frameChanged && observed.state !== 'failed'
    ? `문서 제목을 눌렀지만 새 창도 화면 이동도 일어나지 않았습니다${observed.target ? `(누른 요소: ${observed.target})` : ''}. 브라우저 팝업 차단 설정에서 온나라 주소의 팝업을 허용했는지 확인하세요.`
    : observed.state === 'list'
      ? `${where}에 여전히 문서 목록만 표시됩니다. 문서가 레이어나 전용 뷰어로 열리는지 확인하세요.`
      : observed.state === 'short'
        ? `${where}의 상세 화면에서 읽은 글자가 ${observed.chars}자뿐입니다. 본문이 HWP·PDF 전용 뷰어로 표시되는지 확인하세요.`
        : observed.state === 'mismatch'
          ? `${where}에서 읽은 화면에 요청한 문서 제목이 보이지 않습니다.`
          : observed.state === 'failed'
            ? `${where}의 상세 화면에 접근하지 못했습니다: ${observed.error ?? '알 수 없는 오류'}`
            : '상세 화면을 한 번도 읽지 못했습니다. 온나라 화면의 응답이 매우 느린지 확인하세요.';
  return { code: 'TIMEOUT', message: '문서를 열었지만 제한 시간 안에 본문을 읽지 못했습니다.', hint };
}

/* ── 첨부 다운로드 ──────────────────────────────────────── */

const DOWNLOAD_START_TIMEOUT_MS = 15_000;
const ATTACHMENT_SCAN_MS = 5000;

/**
 * 상세 화면의 모든 프레임에서 첨부를 찾아 한 파일씩 받는다.
 * 일반 링크는 downloads API로, 온나라의 스크립트 첨부는 화면 요소를 눌러 브라우저가
 * 만든 다운로드를 감지한다. 동시 다운로드를 피하려고 앞 파일이 끝나야 다음을 시작한다.
 */
export async function downloadAttachmentsInTab(tabId: number, control: RequestControl, naming?: AttachmentNaming): Promise<SWToPanel> {
  const frameControl: RequestControl = { ...control, expectedUrl: undefined };
  let frames: Array<{ frameId: number }> = [{ frameId: 0 }];
  try {
    const discovered = await chrome.webNavigation.getAllFrames({ tabId });
    if (discovered?.length) frames = discovered;
  } catch {
    // 최상위 프레임만 확인한다.
  }
  const found: Array<{ frameId: number; index: number; name: string; url?: string }> = [];
  // 본문보다 첨부 목록이 늦게 그려지는 화면이 있어 잠시 다시 찾는다.
  const scanUntil = Math.min(frameControl.deadline, Date.now() + ATTACHMENT_SCAN_MS);
  do {
    const seen = new Set<string>();
    for (const frame of frames) {
      const reply = await sendToFrame(tabId, frame.frameId, { type: 'SCAN_ATTACHMENTS', control: frameControl });
      if (reply.type !== 'ATTACHMENTS_FOUND') continue;
      for (const item of reply.items) {
        const key = item.url ?? `name:${item.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ frameId: frame.frameId, ...item });
      }
    }
    if (found.length) break;
    await delay(500);
  } while (Date.now() < scanUntil && !cancelled.has(control.id));
  if (!found.length) {
    return {
      type: 'ATTACHMENTS_DOWNLOADED',
      results: [],
    };
  }

  const results: AttachmentDownloadResult[] = [];
  for (const item of found) {
    assertCurrent(frameControl, '', cancelled.has(control.id));
    let downloadId: number | undefined;
    try {
      // ★ 이름 예약은 두 경로(직접 URL·화면 클릭) 모두에서 onDeterminingFilename이 받아 간다.
      //   여기서 downloads.download에 filename을 직접 넘기면 같은 규칙이 두 번 적용된다.
      reserveDownloadName(item.name, naming ?? null);
      downloadId = item.url
        ? await chrome.downloads.download({ url: item.url, conflictAction: 'uniquify', saveAs: false })
        : await clickAndCatchDownload(tabId, item, frameControl);
      if (downloadId === undefined) {
        results.push({
          name: item.name, status: 'not_started',
          message: '첨부를 눌렀지만 다운로드가 시작되지 않았습니다. 브라우저가 여러 파일 다운로드 허용이나 팝업 허용을 묻고 있는지 확인하세요.',
        });
        continue;
      }
      const outcome = await waitForDownload(downloadId, frameControl, item.name);
      results.push({ name: item.name, ...outcome });
      if (outcome.status === 'in_progress') break;
    } catch (error) {
      if (cancelled.has(control.id)) {
        if (downloadId !== undefined) await chrome.downloads.cancel(downloadId).catch(() => undefined);
        throw error;
      }
      if (Date.now() >= control.deadline) {
        results.push({ name: item.name, status: 'in_progress', ...(downloadId !== undefined ? { downloadId } : {}), message: '제한 시간 안에 끝나지 않았습니다. 다운로드 목록에서 확인하세요.' });
        break;
      }
      results.push({ name: item.name, status: 'failed', message: String(error) });
    } finally {
      // 시작되지 않은 다운로드의 예약이 다음 파일에 잘못 붙지 않게 한다.
      clearDownloadName();
    }
  }
  return { type: 'ATTACHMENTS_DOWNLOADED', results };
}

/**
 * 상세 화면에서 본문(PDF 원본 또는 텍스트 기반 생성 PDF)을 한 파일로 내려받는다.
 */
export async function downloadBodyInTab(
  tabId: number,
  control: RequestControl,
  naming?: AttachmentNaming,
  existingPayload?: ExtractedPage,
): Promise<SWToPanel> {
  const frameControl: RequestControl = { ...control, expectedUrl: undefined };
  let frames: Array<{ frameId: number }> = [{ frameId: 0 }];
  try {
    const discovered = await chrome.webNavigation.getAllFrames({ tabId });
    if (discovered?.length) frames = discovered;
  } catch {
    // 최상위 프레임만 확인
  }

  // 1. 프레임들에서 본문 PDF 소스 탐색
  let pdfSource: { url?: string; base64?: string } | null = null;
  for (const frame of frames) {
    const reply = await sendToFrame(tabId, frame.frameId, { type: 'GET_BODY_PDF', control: frameControl });
    if (reply.type === 'BODY_PDF' && reply.pdf && (reply.pdf.base64 || reply.pdf.url)) {
      pdfSource = reply.pdf;
      break;
    }
  }

  const docTitle = (naming?.docTitle || existingPayload?.title || '공문서').trim();
  const defaultName = `${docTitle}_본문.pdf`;

  let downloadUrl: string | undefined;
  if (pdfSource?.base64) {
    downloadUrl = `data:application/pdf;base64,${pdfSource.base64}`;
  } else if (pdfSource?.url) {
    downloadUrl = pdfSource.url;
  } else {
    // 2. PDF 소스가 없으면 HTML/텍스트 본문으로 PDF 생성
    let text = existingPayload?.text;
    if (!text) {
      const extracted = await dispatchContent(tabId, {
        type: 'EXTRACT',
        budgetTokens: 4000,
        purpose: 'document-detail',
        control: frameControl,
      });
      if (extracted.type === 'EXTRACTED') text = extracted.payload.text;
    }
    try {
      const base64 = await generatePdfFromText({
        title: docTitle,
        text: text || '본문 내용이 없습니다.',
        ...(naming?.reportDate ? { reportDate: naming.reportDate } : {}),
      });
      downloadUrl = `data:application/pdf;base64,${base64}`;
    } catch (err) {
      return {
        type: 'ATTACHMENTS_DOWNLOADED',
        results: [{ name: defaultName, status: 'failed', message: `본문 PDF 생성 실패: ${String(err)}` }],
      };
    }
  }

  reserveDownloadName(defaultName, naming ?? null);
  let downloadId: number | undefined;
  try {
    downloadId = await chrome.downloads.download({ url: downloadUrl, conflictAction: 'uniquify', saveAs: false });
    if (downloadId === undefined) {
      return {
        type: 'ATTACHMENTS_DOWNLOADED',
        results: [{
          name: defaultName,
          status: 'not_started',
          message: '본문 PDF 다운로드가 시작되지 않았습니다. 브라우저 설정을 확인하세요.',
        }],
      };
    }
    const outcome = await waitForDownload(downloadId, frameControl, defaultName);
    return {
      type: 'ATTACHMENTS_DOWNLOADED',
      results: [{ name: defaultName, ...outcome }],
    };
  } catch (error) {
    if (cancelled.has(control.id)) {
      if (downloadId !== undefined) await chrome.downloads.cancel(downloadId).catch(() => undefined);
      throw error;
    }
    return {
      type: 'ATTACHMENTS_DOWNLOADED',
      results: [{ name: defaultName, status: 'failed', message: String(error) }],
    };
  } finally {
    clearDownloadName();
  }
}

async function clickAndCatchDownload(
  tabId: number,
  item: { frameId: number; index: number; name: string },
  control: RequestControl,
): Promise<number | undefined> {
  const created: number[] = [];
  const onCreated = (download: chrome.downloads.DownloadItem) => { created.push(download.id); };
  chrome.downloads.onCreated.addListener(onCreated);
  try {
    const reply = await sendToFrame(tabId, item.frameId, { type: 'CLICK_ATTACHMENT', index: item.index, name: item.name, control });
    if (reply.type === 'FAILED') throw new Error(reply.error.hint ?? reply.error.message);
    if (reply.type !== 'ATTACHMENT_CLICKED' || !reply.clicked) throw new Error('화면이 바뀌어 첨부 항목을 다시 찾지 못했습니다.');
    const until = Math.min(control.deadline, Date.now() + DOWNLOAD_START_TIMEOUT_MS);
    while (!created.length && Date.now() < until) {
      assertCurrent(control, '', cancelled.has(control.id));
      await delay(250);
    }
    return created[0];
  } finally {
    chrome.downloads.onCreated.removeListener(onCreated);
  }
}

async function waitForDownload(downloadId: number, control: RequestControl, name: string): Promise<Omit<AttachmentDownloadResult, 'name'>> {
  while (Date.now() < control.deadline) {
    assertCurrent(control, '', cancelled.has(control.id));
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item?.state === 'complete') {
      // 링크 첨부는 내용이 HTML인 게 정상이라 오류로 보지 않는다.
      return item.mime === 'text/html' && !isHtmlAttachmentName(name)
        ? { status: 'failed', message: '파일 대신 HTML 페이지가 내려왔습니다. 로그인 상태나 다운로드 주소를 확인하세요.' }
        : { status: 'complete', downloadId, ...(item.filename ? { path: item.filename } : {}) };
    }
    if (item?.state === 'interrupted') return { status: 'failed', message: item.error || '다운로드가 중단되었습니다.' };
    await delay(500);
  }
  return { status: 'in_progress', downloadId, message: '제한 시간 안에 끝나지 않았습니다. 다운로드 목록에서 확인하세요.' };
}

async function frameUrls(tabId: number): Promise<string> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return (frames ?? []).map(frame => `${frame.frameId}:${frame.url}`).sort().join('\n');
  } catch {
    return '';
  }
}

/**
 * 작업 탭에서 기다릴 목록.
 *
 * ★ 예전에는 "그 제목이 든 목록"만 기다렸다. 공유/공람 브리핑(N1)은 제목이 아니라
 *   **화면 자체**를 기다린다. 받아들이는 조건만 갈라 두고 복원·재시도 절차는 하나로 둔다 —
 *   목록 복원은 이 제품에서 가장 깨지기 쉬운 절차라, 두 벌로 갈라 두면 한쪽만 고쳐진다.
 */
interface ListTarget {
  /** 오류 문구에 쓸 이름. */
  label: string;
  /** 추출기에 함께 보낼 대상 제목(제목 칸을 고르는 데 쓴다). */
  title?: string;
  accepts(list: StructuredDocumentList | undefined): boolean;
}

function documentTarget(title: string): ListTarget {
  return {
    label: title,
    title,
    accepts: list => Boolean(list?.rows.some(row => row.title && sameDocumentTitle(row.title, title))),
  };
}

/**
 * 지정해 둔 공유/공람 목록.
 *
 * ★ `받은문서`라는 이름표를 요구하지 않는다. 온나라는 화면 제목을 목록과 **다른 프레임**에
 *   그리는 경우가 있어, 목록 프레임 안에서는 그 이름을 읽을 수 없다. 여기서 복원하는 것은
 *   **사용자가 직접 보고 지정한 그 화면**이므로, 그 자리에 표가 떴는지만 가린다.
 *   무엇을 지정했는지는 지정할 때 읽은 이름으로 화면에 계속 보여 준다.
 */
function inboxTarget(listName: string): ListTarget {
  return {
    label: listName || '받은문서',
    // 행이 없어도 목록이다. 받은문서가 0건인 날을 "읽지 못했다"로 기록하지 않는다.
    accepts: list => Boolean(list),
  };
}

async function waitForDocumentList(
  tabId: number,
  target: ListTarget,
  budgetTokens: number,
  control: RequestControl,
  location: DocumentListLocation,
): Promise<ExtractedPage> {
  const started = Date.now();
  const listDeadline = Math.min(control.deadline, started + LIST_WAIT_MS);
  let restores = 0;
  let lastRestore = 0;
  let accepted = false;
  let emptySince = 0;
  let seen = '화면을 한 번도 읽지 못함';
  while (Date.now() < listDeadline) {
    assertCurrent(control, '', cancelled.has(control.id));
    const result = await dispatchContent(tabId, { type: 'EXTRACT', budgetTokens, purpose: 'page', ...(target.title ? { targetTitle: target.title } : {}), control });
    if (result.type === 'EXTRACTED' && target.accepts(result.payload.structuredData)) {
      const found = result.payload.structuredData;
      /**
       * ★ 빈 목록은 조금 더 지켜본다.
       *
       *   머리글이 먼저 그려지고 행이 뒤따라 채워지는 화면이 있다. 그 순간을 그대로 받으면
       *   문서가 있는 날에도 "0건"으로 브리핑한다. 같은 화면이 잠시 그대로면 그때 받는다.
       */
      if (found && !found.rows.length) {
        emptySince ||= Date.now();
        if (Date.now() - emptySince < EMPTY_SETTLE_MS) { await delay(250); continue; }
      }
      return result.payload;
    }
    emptySince = 0;
    if (result.type === 'FAILED' && result.error.code === 'HOST_PERMISSION_REQUIRED') throw new ReadFailure(result.error);
    seen = result.type === 'EXTRACTED'
      ? result.payload.structuredData
        ? `${result.payload.structuredData.listName} 목록 ${result.payload.structuredData.rows.length}건에 요청 문서 없음`
        : `문서 목록 표 없음(${result.payload.charCount}자: "${result.payload.text.replace(/\s+/g, ' ').trim().slice(0, 80)}")`
      : result.type === 'FAILED' ? result.error.message : result.type;

    // 복제 탭은 스스로 이전 iframe 주소를 다시 불러온다. 그 이동이 끝나기 전에 조회 폼을
    // 보내면 뒤늦은 이동이 복원 결과를 덮어쓴다. 전송 성공만으로 복원을 끝내지 않고,
    // 목록이 끝내 나타나지 않으면 탭이 조용해진 뒤 다시 보낸다.
    const since = Date.now() - (lastRestore || started);
    const due = since >= (restores ? RESTORE_RETRY_MS : RESTORE_SETTLE_MS);
    if (due && restores < MAX_RESTORES) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.status !== 'loading' || since >= RESTORE_LOADING_LIMIT_MS) {
        restores++;
        lastRestore = Date.now();
        const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
        // 부모 경로가 맞는 프레임 하나만 실제로 전송한다. 느린 프레임이 다른 프레임을 막지 않게 동시에 묻는다.
        const replies = await Promise.all((frames?.length ? frames : [{ frameId: 0 }]).map(frame =>
          sendToFrame(tabId, frame.frameId, { type: 'RESTORE_DOCUMENT_LIST', location, control })));
        if (replies.some(reply => reply.type === 'DOCUMENT_LIST_RESTORED' && reply.restored)) accepted = true;
      }
    }
    // 최대 복원 횟수를 채우고 탭이 충분히 안정되었는데도 목록이 없으면 대기를 길게 끌지 않고 즉시 중단한다.
    if (restores >= MAX_RESTORES && since >= RESTORE_RETRY_MS) {
      break;
    }
    await delay(250);
  }
  assertCurrent(control, '', cancelled.has(control.id));
  throw new ReadFailure({
    code: 'UNKNOWN',
    message: `작업 탭에서 원본 문서 목록을 복원하지 못했습니다: ${target.label}`,
    hint: `복원 시도 ${restores}회(${accepted ? '목록 프레임에 조회 조건 전송' : '목록 프레임을 찾지 못함'}), 마지막 화면: ${seen}. `
      + '원본 목록을 새로 고쳐 문서가 그대로 있는지 확인한 뒤 다시 요청하거나, 원본에서 해당 문서를 직접 열고 요약을 요청하세요.',
  });
}

const LIST_WAIT_MS = 40_000;
/** 빈 목록을 "정말 비었다"로 받아들이기 전에 같은 화면을 지켜보는 시간. */
const EMPTY_SETTLE_MS = 1500;
const RESTORE_SETTLE_MS = 2000;
const RESTORE_RETRY_MS = 5000;
const RESTORE_LOADING_LIMIT_MS = 10_000;
const MAX_RESTORES = 3;

/** 사용자에게 그대로 보여 줄 수 있는 단계별 실패. 원문 Error 문자열로 감싸지 않는다. */
class ReadFailure extends Error {
  constructor(readonly appError: AppError) { super(appError.message); }
}

async function sendToFrame(tabId: number, frameId: number, msg: SWToContent): Promise<ContentToSW> {
  try {
    return await frameTimeout((async () => {
      assertCurrent(msg.control, msg.control.expectedUrl ?? '', cancelled.has(msg.control.id));
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: [INJECTED_SCRIPT] });
      assertCurrent(msg.control, msg.control.expectedUrl ?? '', cancelled.has(msg.control.id));
      return await chrome.tabs.sendMessage(tabId, msg, { frameId }) as ContentToSW;
    })(), msg.control);
  } catch (error) {
    return { type: 'FAILED', error: accessError(error) };
  }
}

async function keepBackground(tabId: number, source: chrome.tabs.Tab): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || typeof source.id !== 'number') return;
  // 새 창 팝업은 뒤로 보내지 않는다. 가려진 창은 문서가 hidden 상태가 되어
  // 화면에 보일 때만 본문을 그리는 뷰어가 끝내 내용을 채우지 않는다.
  if (tab.windowId !== source.windowId) return;
  if (tab.active && source.active) {
    await chrome.tabs.update(source.id, { active: true }).catch(() => undefined);
  }
}

/** 문서 열기 이후 최상위 이동이 확정된, 원본과 같은 출처의 기존 팝업 창. */
async function reusedPopup(
  tabs: Map<number, chrome.tabs.Tab>,
  before: Set<number>,
  sourceTabId: number,
  sourceUrl: string | undefined,
  openedAt: number,
): Promise<number | undefined> {
  for (const tab of tabs.values()) {
    if (!before.has(tab.id!) || tab.id === sourceTabId || !committedSince(tab.id!, openedAt) || !sameOrigin(tab.url, sourceUrl)) continue;
    const window = await chrome.windows?.get(tab.windowId).catch(() => null);
    if (window?.type === 'popup') return tab.id;
  }
  return undefined;
}

function sameOrigin(left: string | undefined, right: string | undefined): boolean {
  try { return new URL(left ?? '').origin === new URL(right ?? '').origin; } catch { return false; }
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const FRAME_TIMEOUT_MS = 8000;

/** 프레임 하나의 주입·응답 대기를 요청 마감과 프레임 한도 중 이른 쪽에서 끊는다. */
async function frameTimeout<T>(work: Promise<T>, control: RequestControl): Promise<T> {
  work.catch(() => undefined);
  const ms = Math.max(0, Math.min(FRAME_TIMEOUT_MS, control.deadline - Date.now()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('프레임이 제한 시간 안에 응답하지 않았습니다.')), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function accessError(error: unknown): AppError {
  const raw = String(error);
  return /must request permission|Cannot access contents/i.test(raw)
    ? {
        code: 'HOST_PERMISSION_REQUIRED',
        message: '이 사이트의 내용을 읽을 권한이 없습니다.',
        hint: '온나라 본문과 iframe 주소에 대한 사이트 접근 권한을 허용하세요.',
      }
    : { code: 'UNKNOWN', message: '페이지 프레임에 접근할 수 없습니다.', hint: raw };
}

/* ── 유틸 ──────────────────────────────────────────────── */

/**
 * 패널이 보고 있는 창의 활성 탭.
 *
 * ★ 워커에는 창이 없다. currentWindow는 "마지막으로 초점을 받은 창"이라,
 *   문서 팝업이 떠 있으면 패널이 있는 창이 아니라 그 팝업을 돌려준다.
 *   패널이 알려 준 창을 우선한다.
 */
async function activeTab(windowId?: number): Promise<chrome.tabs.Tab | undefined> {
  if (typeof windowId === 'number') {
    const [tab] = await chrome.tabs.query({ active: true, windowId }).catch(() => [] as chrome.tabs.Tab[]);
    if (tab) return tab;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function registerPanelSyncListeners(): void {
  chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
    notePanelSpawn({ sourceTabId: details.sourceTabId, tabId: details.tabId });
  });
}

/** 작업 탭(백그라운드 읽기)의 이동은 패널과 무관하다. 사용자가 보는 탭의 화면 변화만 알린다. */
export function notifyScreenChange(details: { tabId: number; frameId: number; url?: string }): void {
  if (workTabs.has(details.tabId) || !isReportedPanelTab(details.tabId)) return;
  pushToPanel({ type: 'SCREEN_CHANGED', tabId: details.tabId, frameId: details.frameId, url: details.url ?? '' });
}

export function toSummary(tab: chrome.tabs.Tab): TabSummary {
  return {
    tabId: tab.id ?? -1,
    url: tab.url ?? '',
    title: tab.title ?? '',
    active: tab.active ?? false,
    ...(typeof tab.windowId === 'number' ? { windowId: tab.windowId } : {}),
    ...(typeof (tab.openerTabId ?? panelOpener(tab.id)) === 'number'
      ? { openedFrom: tab.openerTabId ?? panelOpener(tab.id)! }
      : {}),
  };
}

/** 패널이 닫혀 있으면 수신자가 없어 예외가 난다. 정상 상황이므로 삼킨다. */
function pushToPanel(msg: SWToPanel) {
  if (msg.type === 'TAB_CHANGED') rememberPanelTab(msg.tab);
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}
