/**
 * 온나라 공문서 작성기 전용 인페이지 사이드카 드로어 호스트 셸.
 *
 * Shadow DOM 기반 격리, 방탄(Bulletproof) 포인터 리사이즈,
 * '본문작성' 화면 감지 및 2단계 명시적 승인 트랜잭션 브리지를 제공한다.
 */

import { captureDraftContext } from '@/lib/onnara/draft-context';
import { resolveEditorAdapter, directInsertAtTarget, cleanupAccidentalContentEditable } from '@/lib/onnara/draft-editor';
import { DraftTransactionController } from '@/lib/onnara/draft-controller';
import { findWriteBodyButton, isExactDraftPath } from '@/lib/onnara/draft-route';
import { DRAWER_GAP_PX, applyPageLayoutShift } from '@/lib/onnara/drawer-layout';
import { createSelectionBubble } from '@/lib/onnara/selection-bubble';
import { applyDraftTitleToDom } from '@/lib/onnara/draft-title';

const SELECTION_BRIDGE_REQUEST = 'SAIDE_SELECTION_BUBBLE_REQUEST';
const SELECTION_BRIDGE_READY = 'SAIDE_SELECTION_BUBBLE_READY';
const SELECTION_BRIDGE_SEND = 'SAIDE_SELECTION_BUBBLE_SEND';

function mountFrameSelectionBubble(doc: Document) {
  if ((doc as any).__saideBubbleMounted) return;
  (doc as any).__saideBubbleMounted = true;

  const host = doc.createElement('saide-selection-bubble-host');
  host.style.cssText =
    'all:initial!important;display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const bubble = createSelectionBubble({
    showToast: (message) => {
      let toast = shadow.querySelector<HTMLElement>('.saide-frame-bubble-toast');
      if (!toast) {
        toast = doc.createElement('div');
        toast.className = 'saide-frame-bubble-toast';
        toast.style.cssText = 'position:fixed;right:20px;bottom:20px;padding:10px 14px;background:#1e293b;color:#fff;border-radius:8px;font:13px sans-serif;z-index:2147483647;';
        shadow.appendChild(toast);
      }
      toast.textContent = message;
      toast.style.display = 'block';
      setTimeout(() => { if (toast) toast.style.display = 'none'; }, 3000);
    },
    onSendToSidecar: (text) => {
      try {
        window.top?.postMessage({ type: SELECTION_BRIDGE_SEND, text }, '*');
      } catch {
        // top-level sidecar may have navigated away
      }
    },
  });
  shadow.appendChild(bubble.element);

  const attach = () => {
    const root = doc.documentElement || doc.body;
    if (root && !host.isConnected) root.appendChild(host);
  };
  attach();
  doc.addEventListener('DOMContentLoaded', attach, { once: true });
  const unbind = bubble.bindEvents(doc);
  window.addEventListener('pagehide', () => {
    unbind();
    bubble.destroy();
    host.remove();
  }, { once: true });
}

declare global {
  interface Window {
    __saideDrawerInjected?: () => boolean;
    __saideToggleDrawer?: () => void;
  }
}

export default defineUnlistedScript(() => {
  if (window.self !== window.top) {
    // 하위 프레임(본문 에디터 iframe 등)에서는 독립 버블 메뉴를 항상 마운트하여
    // 상위 프레임의 경로 일치 여부나 프레임 중첩 구조에 구애받지 않고 블럭 메뉴가 즉각 작동하도록 보장한다.
    mountFrameSelectionBubble(document);
    return;
  }

  // 기안기 URL 검사 (기안기 화면이 아니면 즉각 종료)
  if (!isExactDraftPath(window.location.href)) {
    return;
  }

  // 하위 프레임의 선택 버블 초기화 요청을 승인하고, 질의 텍스트를 사이드카로 전달한다.
  window.addEventListener('message', (event: MessageEvent) => {
    if (!event.data || typeof event.data !== 'object' || !event.source) return;
    const msg = event.data;
    if (msg.type === SELECTION_BRIDGE_REQUEST) {
      (event.source as Window).postMessage({ type: SELECTION_BRIDGE_READY }, '*');
    } else if (msg.type === SELECTION_BRIDGE_SEND && typeof msg.text === 'string') {
      setDrawerOpen(true);
      setTimeout(() => {
        iframe.contentWindow?.postMessage({
          type: 'SAIDE_FILL_PROMPT',
          text: `다음 문서 내용을 분석 또는 보완해줘:\n\n${msg.text}`,
        }, '*');
      }, 350);
    }
  });

  console.info(
    '%c[sAIde] 온나라 기안기 감지 완료! 슬라이딩 런처 버튼 마운트 시작 (URL: ' + window.location.href + ')',
    'background: #2563eb; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: bold;'
  );

  const existingHost = document.querySelector('saide-drawer-host');
  if (existingHost && window.__saideDrawerInjected?.()) {
    return;
  }
  if (existingHost) {
    try {
      existingHost.remove();
    } catch {}
  }

  const runtime = chrome.runtime;
  window.__saideDrawerInjected = () => {
    try {
      return Boolean(runtime?.id && document.querySelector('saide-drawer-host'));
    } catch {
      return false;
    }
  };

  let isOpen = false;
  let drawerWidth = 440;
  const controller = new DraftTransactionController();

  // 1. Shadow DOM 호스트 생성 및 즉시 DOM 최상위 마운트 (슬라이딩 버튼 표시 100% 보장)
  const host = document.createElement('saide-drawer-host');
  host.style.cssText =
    'all: initial !important; display: block !important; position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; overflow: visible !important; pointer-events: none !important; z-index: 2147483647 !important;';
  const shadow = host.attachShadow({ mode: 'open' });

  function attachHostToDOM() {
    if (!document.contains(host)) {
      // document.documentElement(<html>)에 직접 붙여서 body 리셋/CSS 간섭 완벽 격리
      const root = document.documentElement || document.body;
      if (root) {
        root.appendChild(host);
        console.info(
          '%c[sAIde] 슬라이딩 버튼 호스트 부착 완료 (parent: ' + root.tagName + ')',
          'color: #16a34a; font-weight: bold;'
        );
      }
    }
  }
  attachHostToDOM();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachHostToDOM);
    window.addEventListener('load', attachHostToDOM);
  }
  setTimeout(attachHostToDOM, 50);
  setTimeout(attachHostToDOM, 250);
  setTimeout(attachHostToDOM, 800);
  setTimeout(attachHostToDOM, 2000);

  // Liveness 감시: 혹시 온나라 스크립트에 의해 호스트가 DOM에서 떨어져 나가면 즉각 재부착
  setInterval(() => {
    if (!document.contains(host)) {
      attachHostToDOM();
    }
  }, 1500);

  // 2. 스타일 정의
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Malgun Gothic", Dotum, sans-serif;
    }

    /* 플로팅 런처 버튼 (제1 기본 조작 경로: 클릭 시 도우미 열기, 상하 드래그로 위치 이동) */
    .saide-launcher {
      position: fixed !important;
      right: 0 !important;
      top: 180px;
      z-index: 2147483647 !important;
      background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%) !important;
      color: #ffffff !important;
      padding: 9px 13px 9px 9px !important;
      border-radius: 12px 0 0 12px !important;
      box-shadow: -2px 4px 14px rgba(0, 0, 0, 0.35) !important;
      cursor: grab !important;
      touch-action: none !important;
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      letter-spacing: -0.2px !important;
      user-select: none !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease !important;
      white-space: nowrap !important;
      box-sizing: border-box !important;
    }
    .saide-launcher:hover {
      transform: translateX(-4px) !important;
      box-shadow: -4px 6px 18px rgba(30, 64, 175, 0.45) !important;
      background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%) !important;
    }
    .saide-launcher:active,
    .saide-launcher.dragging {
      cursor: grabbing !important;
    }
    .saide-launcher.dragging {
      transition: none !important;
      transform: translateX(-2px) !important;
      box-shadow: -4px 8px 22px rgba(30, 64, 175, 0.55) !important;
      filter: brightness(1.06) !important;
    }
    .saide-launcher svg.saide-icon {
      display: block !important;
      width: 17px !important;
      height: 17px !important;
      min-width: 17px !important;
      fill: #ffffff !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .saide-launcher svg.saide-drag-gripper {
      display: block !important;
      width: 7px !important;
      height: 13px !important;
      min-width: 7px !important;
      fill: #ffffff !important;
      opacity: 0.65 !important;
      flex-shrink: 0 !important;
      pointer-events: none !important;
      visibility: visible !important;
    }
    .saide-launcher span {
      display: inline-block !important;
      color: #ffffff !important;
      font: 700 13px/18px -apple-system, BlinkMacSystemFont, "Pretendard", "Malgun Gothic", Dotum, sans-serif !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .saide-launcher:hover svg.saide-drag-gripper {
      opacity: 0.9;
    }

    /* 슬라이딩 드로어 컨테이너 */
    .saide-drawer {
      position: fixed;
      top: 0;
      right: 0;
      height: 100vh;
      width: ${drawerWidth}px;
      max-width: 90vw;
      min-width: 340px;
      background: #ffffff;
      box-shadow: -4px 0 16px rgba(0, 0, 0, 0.12), -1px 0 4px rgba(0, 0, 0, 0.06);
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      transform: translateX(105%);
      transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      border-left: 1px solid #cbd5e1;
      pointer-events: auto;
    }
    .saide-drawer.open {
      transform: translateX(0);
    }

    /* 리사이즈 핸들 */
    .saide-resize-handle {
      position: absolute;
      left: -6px;
      top: 0;
      bottom: 0;
      width: 12px;
      cursor: col-resize;
      z-index: 10;
      touch-action: none;
    }
    .saide-resize-handle:hover,
    .saide-resize-handle.active {
      background: rgba(37, 99, 235, 0.25);
    }

    /* iframe */
    .saide-iframe {
      flex: 1;
      width: 100%;
      height: 100%;
      border: none;
      background: #ffffff;
    }

    /* 상단 타깃 피커 안내 배너 */
    .saide-target-banner {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #0f172a;
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 9999px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      display: none;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 500;
      border: 1px solid #334155;
      animation: saideSlideDown 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .saide-target-banner.active {
      display: flex;
    }
    .saide-target-banner .saide-esc-hint {
      background: #334155;
      color: #cbd5e1;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 11px;
      font-family: monospace;
      cursor: pointer;
    }
    .saide-target-banner .saide-esc-hint:hover {
      background: #475569;
      color: #ffffff;
    }

    /* 결과 안내 토스트 */
    .saide-toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #1e293b;
      color: #f8fafc;
      padding: 10px 20px;
      border-radius: 8px;
      box-shadow: 0 10px 20px rgba(0,0,0,0.25);
      font-size: 13px;
      font-weight: 600;
      display: none;
      animation: saideFadeIn 0.2s ease;
    }
    .saide-toast.active {
      display: block;
    }

    .saide-bubble-container {
      pointer-events: auto !important;
    }

    @keyframes saideSlideDown {
      from { transform: translate(-50%, -10px); opacity: 0; }
      to { transform: translate(-50%, 0); opacity: 1; }
    }
    @keyframes saideFadeIn {
      from { opacity: 0; transform: translate(-50%, 10px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
  `;
  shadow.appendChild(style);

  // 3. 플로팅 런처 버튼 렌더링 (사이드 탭 버튼)
  const launcher = document.createElement('div');
  launcher.className = 'saide-launcher';
  launcher.setAttribute('role', 'button');
  launcher.setAttribute('aria-label', '온나라 sAIde 기안 도우미 열기 (끌어서 상하 이동 가능)');
  launcher.title = '온나라 sAIde 기안 도우미 열기 (클릭: 열기 / 드래그: 상하 이동, Ctrl+Alt+A)';
  launcher.innerHTML = `
    <svg class="saide-drag-gripper" viewBox="0 0 8 14" aria-hidden="true">
      <circle cx="2" cy="2" r="1.2"/>
      <circle cx="6" cy="2" r="1.2"/>
      <circle cx="2" cy="7" r="1.2"/>
      <circle cx="6" cy="7" r="1.2"/>
      <circle cx="2" cy="12" r="1.2"/>
      <circle cx="6" cy="12" r="1.2"/>
    </svg>
    <svg class="saide-icon" viewBox="0 0 24 24">
      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.38-1 1.72V7h2a5 5 0 0 1 5 5v1.28c.6.34 1 .98 1 1.72a2 2 0 1 1-4 0V12a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v3a2 2 0 1 1-4 0c0-.74.4-1.38 1-1.72V12a5 5 0 0 1 5-5h2V5.72A2 2 0 0 1 10 4a2 2 0 0 1 2-2zm-3 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
    </svg>
    <span>sAIde</span>
  `;
  shadow.appendChild(launcher);
  launcher.style.display = 'flex';
  launcher.style.visibility = 'visible';
  launcher.style.opacity = '1';

  /* ── 플로팅 런처 상하 위치 관리 및 지속성 ── */
  const STORAGE_KEY_LAUNCHER_TOP = 'saide_launcher_top';
  const DEFAULT_LAUNCHER_TOP = 180;
  let launcherTop = DEFAULT_LAUNCHER_TOP;

  try {
    const saved = localStorage.getItem(STORAGE_KEY_LAUNCHER_TOP);
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        launcherTop = parsed;
      }
    }
  } catch {
    // localStorage 예외 대비
  }

  function clampLauncherTop(top: number): number {
    const height = launcher.offsetHeight || 42;
    const winHeight = window.innerHeight > 100 ? window.innerHeight : 800;
    const maxTop = Math.max(10, winHeight - height - 10);
    return Math.min(Math.max(10, top), maxTop);
  }

  function setLauncherPosition(top: number) {
    const clamped = clampLauncherTop(top);
    launcherTop = clamped;
    launcher.style.top = `${clamped}px`;
  }

  function saveLauncherPosition(top: number) {
    const clamped = clampLauncherTop(top);
    try {
      localStorage.setItem(STORAGE_KEY_LAUNCHER_TOP, String(Math.round(clamped)));
    } catch {
      // ignore
    }
    try {
      chrome.storage?.local?.set({ [STORAGE_KEY_LAUNCHER_TOP]: Math.round(clamped) });
    } catch {
      // ignore
    }
  }

  setLauncherPosition(launcherTop);

  try {
    chrome.storage?.local?.get([STORAGE_KEY_LAUNCHER_TOP], (res) => {
      if (res && typeof res[STORAGE_KEY_LAUNCHER_TOP] === 'number') {
        setLauncherPosition(res[STORAGE_KEY_LAUNCHER_TOP]);
      }
    });
  } catch {
    // ignore
  }

  window.addEventListener('resize', () => {
    setLauncherPosition(launcherTop);
  });

  // 4. 드로어 컨테이너 렌더링
  const drawer = document.createElement('div');
  drawer.className = 'saide-drawer';
  drawer.innerHTML = `
    <div class="saide-resize-handle" title="드래그하여 너비 조절"></div>
    <iframe class="saide-iframe" allow="clipboard-write"></iframe>
  `;
  shadow.appendChild(drawer);

  // 5. 상단 타깃 피커 안내 바
  const targetBanner = document.createElement('div');
  targetBanner.className = 'saide-target-banner';
  targetBanner.innerHTML = `
    <span>🎯 <strong>초안 삽입 위치 지정</strong>: 본문이나 입력창을 클릭하세요.</span>
    <span class="saide-esc-hint" title="취소하려면 누르세요">Esc 취소</span>
  `;
  shadow.appendChild(targetBanner);

  // 6. 결과 알림 토스트
  const toast = document.createElement('div');
  toast.className = 'saide-toast';
  shadow.appendChild(toast);

  let toastTimer: any = null;
  function showToast(message: string, duration = 3000) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('active');
    toastTimer = setTimeout(() => {
      toast.classList.remove('active');
    }, duration);
  }

  const iframe = drawer.querySelector<HTMLIFrameElement>('.saide-iframe')!;
  const resizeHandle = drawer.querySelector<HTMLDivElement>('.saide-resize-handle')!;

  // 7. 에디터 블록 지정 플로팅 버블 툴바 생성 및 Shadow DOM 등록 (오류 격리)
  try {
    const selectionBubble = createSelectionBubble({
      showToast,
      onSendToSidecar: (text) => {
        setDrawerOpen(true);
        setTimeout(() => {
          iframe.contentWindow?.postMessage(
            {
              type: 'SAIDE_FILL_PROMPT',
              text: `다음 문서 내용을 분석 또는 보완해줘:\n\n${text}`,
            },
            '*'
          );
        }, 350);
      },
    });
    shadow.appendChild(selectionBubble.element);

    // 최상위 문서는 최상위 오버레이가 처리한다.
    selectionBubble.bindEvents(document);

    // 하위 프레임(본문 에디터 iframe 등)도 최상위 오버레이에서 감지하여
    // iframe 잘림(overflow: hidden 등) 없이 최상위 뷰포트에 완벽하게 플로팅 표시
    const boundChildFrames = new WeakSet<Document>();
    function observeAndBindFrames() {
      const iframes = Array.from(document.querySelectorAll('iframe, frame'));
      for (const ifr of iframes) {
        try {
          const fDoc = (ifr as HTMLIFrameElement).contentDocument;
          if (fDoc && !boundChildFrames.has(fDoc)) {
            if ((fDoc as any).__saideBubbleMounted) continue;
            boundChildFrames.add(fDoc);
            selectionBubble.bindEvents(fDoc);
          }
        } catch {
          // cross-origin
        }
      }
    }
    observeAndBindFrames();
    const frameObserver = new MutationObserver(observeAndBindFrames);
    const rootEl = document.body || document.documentElement;
    if (rootEl) {
      frameObserver.observe(rootEl, { childList: true, subtree: true });
    }
    setInterval(observeAndBindFrames, 1000);
  } catch (err) {
    console.warn('[sAIde] selectionBubble initialization failed:', err);
  }

  function setDrawerOpen(nextOpen: boolean) {
    isOpen = nextOpen;
    if (isOpen) {
      if (!iframe.src) {
        iframe.src = chrome.runtime.getURL('drawer-page.html');
      }
      drawer.classList.add('open');
      launcher.style.display = 'none';

      // 1. 본 화면 레이아웃 우측 여백 확보 (36px 안전 Gap 포함으로 본 화면 가림 100% 방지)
      applyPageLayoutShift(true, drawerWidth, DRAWER_GAP_PX);

      // 2. 브라우저 창 자체를 우측으로 확장 요청 (사이드카 폭 + 36px 여유 공간)
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'EXPAND_WINDOW_FOR_DRAWER',
          drawerWidth,
          drawerGap: DRAWER_GAP_PX,
          screenAvailWidth: window.screen.availWidth,
          screenAvailLeft: (window.screen as any).availLeft ?? 0,
        });
      }

      setTimeout(syncContextToIframe, 350);
    } else {
      drawer.classList.remove('open');
      launcher.style.display = 'flex';
      setLauncherPosition(launcherTop);

      // 1. 본 화면 레이아웃 복원
      applyPageLayoutShift(false, drawerWidth);

      // 2. 브라우저 창 크기 원상복구 요청
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'RESTORE_WINDOW_FOR_DRAWER',
        });
      }

      controller.invalidateAll();
      stopTargetPicker();
    }
  }

  window.addEventListener('beforeunload', () => {
    if (isOpen) {
      applyPageLayoutShift(false, drawerWidth);
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'RESTORE_WINDOW_FOR_DRAWER' });
      }
    }
  });

  function toggleDrawer() {
    setDrawerOpen(!isOpen);
  }

  window.__saideToggleDrawer = toggleDrawer;

  /* ── 플로팅 런처 상하 드래그 이벤트 ── */
  let isDraggingLauncher = false;
  let hasMovedLauncher = false;
  let activeLauncherPointerId = -1;
  let startLauncherPointerY = 0;
  let startLauncherTop = 0;
  let justFinishedDrag = false;

  const stopLauncherDrag = () => {
    if (!isDraggingLauncher) return;
    isDraggingLauncher = false;
    launcher.classList.remove('dragging');
    document.body.style.userSelect = '';

    try {
      if (
        activeLauncherPointerId >= 0 &&
        launcher.hasPointerCapture &&
        launcher.hasPointerCapture(activeLauncherPointerId)
      ) {
        launcher.releasePointerCapture(activeLauncherPointerId);
      }
    } catch {
      // ignore
    }
    activeLauncherPointerId = -1;

    if (hasMovedLauncher) {
      saveLauncherPosition(launcherTop);
      justFinishedDrag = true;
      setTimeout(() => {
        justFinishedDrag = false;
      }, 120);
    }
  };

  launcher.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return; // 좌클릭만 반응
    isDraggingLauncher = true;
    hasMovedLauncher = false;
    activeLauncherPointerId = e.pointerId;
    startLauncherPointerY = e.clientY;
    startLauncherTop = launcherTop;

    try {
      launcher.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  });

  launcher.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isDraggingLauncher) return;
    const deltaY = e.clientY - startLauncherPointerY;

    if (!hasMovedLauncher && Math.abs(deltaY) > 4) {
      hasMovedLauncher = true;
      launcher.classList.add('dragging');
      document.body.style.userSelect = 'none';
    }

    if (hasMovedLauncher) {
      setLauncherPosition(startLauncherTop + deltaY);
    }
  });

  launcher.addEventListener('pointerup', stopLauncherDrag);
  launcher.addEventListener('pointercancel', stopLauncherDrag);

  launcher.addEventListener('click', (e: MouseEvent) => {
    if (hasMovedLauncher || justFinishedDrag) {
      e.preventDefault();
      e.stopPropagation();
      hasMovedLauncher = false;
      justFinishedDrag = false;
      return;
    }
    toggleDrawer();
  });

  /* ── 방탄 포인터 리사이즈 ── */
  let isResizing = false;
  let activePointerId = -1;

  const stopResize = () => {
    if (!isResizing) return;
    isResizing = false;
    resizeHandle.classList.remove('active');
    document.body.style.userSelect = '';
    iframe.style.pointerEvents = 'auto';
    try {
      if (activePointerId >= 0 && resizeHandle.hasPointerCapture && resizeHandle.hasPointerCapture(activePointerId)) {
        resizeHandle.releasePointerCapture(activePointerId);
      }
    } catch {
      // ignore
    }
    activePointerId = -1;
  };

  resizeHandle.addEventListener('pointerdown', (e: PointerEvent) => {
    isResizing = true;
    activePointerId = e.pointerId;
    resizeHandle.classList.add('active');
    document.body.style.userSelect = 'none';
    iframe.style.pointerEvents = 'none';
    try {
      resizeHandle.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    e.preventDefault();
  });

  resizeHandle.addEventListener('pointermove', (e: PointerEvent) => {
    if (!isResizing) return;
    const newWidth = Math.max(340, Math.min(window.innerWidth - 60, window.innerWidth - e.clientX));
    drawerWidth = newWidth;
    drawer.style.width = `${newWidth}px`;
    applyPageLayoutShift(true, newWidth);
  });

  resizeHandle.addEventListener('pointerup', stopResize);
  resizeHandle.addEventListener('pointercancel', stopResize);
  window.addEventListener('pointerup', stopResize);
  window.addEventListener('blur', stopResize);

  /* ── 접근 가능한 모든 Document 수집 ── */
  function getAccessibleDocuments(rootDoc: Document = document): Document[] {
    const docs: Document[] = [rootDoc];
    const iframes = Array.from(rootDoc.querySelectorAll('iframe'));
    for (const ifr of iframes) {
      try {
        if (ifr.contentDocument) {
          docs.push(...getAccessibleDocuments(ifr.contentDocument));
        }
      } catch {
        // cross-origin frame 무시
      }
    }
    return docs;
  }

  /* ── 🎯 Click-to-Insert 타깃 피커 모드 ── */
  let isPickingTarget = false;
  let pendingInsertText = '';
  let hoveredElement: HTMLElement | null = null;
  let originalOutline = '';

  function clearHoverOutline() {
    if (hoveredElement) {
      hoveredElement.style.outline = originalOutline;
      hoveredElement = null;
      originalOutline = '';
    }
  }

  function handlePickerPointerMove(e: PointerEvent) {
    if (!isPickingTarget) return;
    const target = e.target as HTMLElement | null;
    if (!target || host.contains(target)) {
      clearHoverOutline();
      return;
    }

    if (target !== hoveredElement) {
      clearHoverOutline();
      hoveredElement = target;
      originalOutline = target.style.outline;
      target.style.outline = '2px solid #2563eb';
    }
  }

  async function handlePickerClick(e: MouseEvent) {
    if (!isPickingTarget) return;
    const target = e.target as HTMLElement | null;
    if (!target || host.contains(target)) return;

    // e.preventDefault()와 e.stopPropagation()을 호출하지 않음!
    // 사용자가 클릭한 위치로 한컴 기안기가 정상적으로 마우스 포커스를 잡고 캐럿을 깜빡이도록 둔다.

    let targetEl: HTMLElement = target;
    const nested =
      targetEl.querySelector<HTMLElement>('textarea, input, [contenteditable="true"], [contenteditable=""], [contenteditable], iframe, object, embed') ||
      targetEl.closest<HTMLElement>('textarea, input, [contenteditable="true"], [contenteditable=""], [contenteditable], iframe, object, embed');
    if (nested && !host.contains(nested)) {
      targetEl = nested;
    }

    const textToInsert = pendingInsertText;
    const clickX = e.clientX;
    const clickY = e.clientY;
    stopTargetPicker();

    // 한컴 기안기 컨트롤이 마우스 클릭을 받아 포커스와 캐럿을 잡을 수 있도록 브라우저 틱(30ms) 양보 후 삽입
    setTimeout(async () => {
      // 1. WebHWP 메인 월드 API (HwpCtrl.PutFieldText("본문", ...) / InsertText / RunPaste) 및 DOM 삽입
      const res = await directInsertAtTarget(targetEl, textToInsert, clickX, clickY, targetEl.ownerDocument || document);

      // 2. 포커스된 요소에 클립보드 붙여넣기(Paste) 이벤트 자동 트리거
      // ★ 중요: directInsertAtTarget에서 이미 'applied'로 직접 삽입된 경우 중복 붙여넣기를 절대 수행하지 않는다!
      if (res.status !== 'applied') {
        try {
          const ownerDoc = targetEl.ownerDocument || document;
          const active = ownerDoc.activeElement as HTMLElement | null;
          const pasteTarget = active || targetEl;

          // ClipboardEvent ('paste') 발송 (DataTransfer 포함)
          try {
            const dt = new DataTransfer();
            dt.setData('text/plain', textToInsert);
            const pasteEvt = new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              clipboardData: dt,
            });
            pasteTarget.dispatchEvent(pasteEvt);
          } catch {
            // ignore
          }

          // document.execCommand('paste')
          try {
            ownerDoc.execCommand('paste');
          } catch {
            // ignore
          }
        } catch {
          // ignore
        }
      }

      // 성공 메시지 안내
      const msg = res.status === 'applied' ? res.message : '한글 기안기 본문에 초안이 삽입되었습니다.';
      showToast(msg, 3500);

      iframe.contentWindow?.postMessage(
        {
          type: 'SAIDE_TARGET_INSERT_RESULT',
          status: 'applied',
          message: msg,
        },
        '*'
      );
    }, 30);
  }

  function handlePickerKeydown(e: KeyboardEvent) {
    if (isPickingTarget && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopTargetPicker();
      showToast('위치 지정이 취소되었습니다.', 2000);
      iframe.contentWindow?.postMessage(
        {
          type: 'SAIDE_TARGET_INSERT_RESULT',
          status: 'cancelled',
          message: '위치 지정이 취소되었습니다.',
        },
        '*'
      );
    }
  }

  function startTargetPicker(text: string) {
    // 이전에 우발적으로 레이아웃 div에 걸렸을 수 있는 contenteditable 정리
    cleanupAccidentalContentEditable(document);

    isPickingTarget = true;
    pendingInsertText = text;
    targetBanner.classList.add('active');

    // 기안기 문서들에 캡처 리스너 등록
    const docs = getAccessibleDocuments(document);
    for (const doc of docs) {
      cleanupAccidentalContentEditable(doc);
      doc.addEventListener('pointermove', handlePickerPointerMove as any, true);
      doc.addEventListener('click', handlePickerClick, true);
      doc.addEventListener('keydown', handlePickerKeydown, true);
    }
  }

  function stopTargetPicker() {
    if (!isPickingTarget) return;
    isPickingTarget = false;
    pendingInsertText = '';
    clearHoverOutline();
    targetBanner.classList.remove('active');

    const docs = getAccessibleDocuments(document);
    for (const doc of docs) {
      doc.removeEventListener('pointermove', handlePickerPointerMove as any, true);
      doc.removeEventListener('click', handlePickerClick, true);
      doc.removeEventListener('keydown', handlePickerKeydown, true);
    }
  }

  targetBanner.querySelector('.saide-esc-hint')?.addEventListener('click', () => {
    stopTargetPicker();
    iframe.contentWindow?.postMessage(
      {
        type: 'SAIDE_TARGET_INSERT_RESULT',
        status: 'cancelled',
        message: '위치 지정이 취소되었습니다.',
      },
      '*'
    );
  });

  // 단축키 (보조 수단)
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (isOpen && e.key === 'Escape' && !isPickingTarget) {
        setDrawerOpen(false);
        return;
      }
      const isKeyA = e.key === 'a' || e.key === 'A' || e.code === 'KeyA';
      if ((e.ctrlKey && e.altKey && isKeyA) || (e.altKey && e.shiftKey && isKeyA)) {
        e.preventDefault();
        e.stopPropagation();
        toggleDrawer();
      }
    },
    true
  );

  // 맥락 정보 동기화 ('본문작성' 버튼 유무 및 필요 여부 포함)
  async function syncContextToIframe() {
    try {
      const tabInfo = {
        tabId: 0,
        frameId: 0,
        origin: location.origin,
      };
      const ctx = captureDraftContext(document, tabInfo);
      const { capability, needsOpenBody, reason } = await resolveEditorAdapter(ctx, document);
      const hasWriteBodyBtn = Boolean(findWriteBodyButton(document));

      iframe.contentWindow?.postMessage(
        {
          type: 'DRAFT_CONTEXT_RESPONSE',
          title: ctx.title.value || '',
          documentKey: ctx.documentKey || '',
          editorRevision: ctx.editorRevision,
          capability,
          needsOpenBody: Boolean(needsOpenBody),
          hasWriteBodyBtn,
          reason,
          relatedDocs: ctx.relatedDocs || [],
        },
        '*'
      );
    } catch {
      // ignore
    }
  }

  // 메시지 수신 핸들러 (2단계 승인 트랜잭션 브리지 및 본문작성 열기, 클릭 타깃팅 연동)
  window.addEventListener('message', async (event: MessageEvent) => {
    if (!event.data || typeof event.data !== 'object') return;
    const msg = event.data;

    const tabInfo = { tabId: 0, frameId: 0, origin: location.origin };
    const ctx = captureDraftContext(document, tabInfo);

    if (msg.type === 'SAIDE_CLOSE_DRAWER') {
      setDrawerOpen(false);
    } else if (msg.type === 'DRAFT_GET_CONTEXT') {
      await syncContextToIframe();
    } else if (msg.type === 'SAIDE_CLICK_OPEN_BODY') {
      const btn = findWriteBodyButton(document);
      if (btn) {
        btn.click();
        setTimeout(syncContextToIframe, 1000);
      }
    } else if (msg.type === 'SAIDE_START_CLICK_TARGET' && msg.text) {
      // 🎯 클릭 지정 삽입 모드 시작
      startTargetPicker(msg.text);
    } else if (msg.type === 'SAIDE_CANCEL_CLICK_TARGET') {
      stopTargetPicker();
    } else if (msg.type === 'DRAFT_FETCH_RELATED_DOC' && msg.doc) {
      // 1. 문서요지(summary) 등 DOM에 존재하는 본문/요약 텍스트 우선 탐색
      let foundContent = '';
      try {
        const summaryEl = document.querySelector<HTMLTextAreaElement | HTMLElement>(
          'textarea[name*="summary"], textarea[name*="docSummary"], textarea#summary, textarea#docSummary, #txtSummary'
        );
        if (summaryEl && (summaryEl as HTMLTextAreaElement).value?.trim()) {
          foundContent = (summaryEl as HTMLTextAreaElement).value.trim();
        }
      } catch {
        // ignore
      }

      // 2. background script에 열린 탭 또는 문서 조회 요청
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: 'DRAFT_FETCH_RELATED_DOC',
            doc: msg.doc,
          },
          (response) => {
            const content = response?.content || foundContent;

            // 탭에서 못 찾았으나 현재 화면 DOM에 이 문서를 여는 링크/버튼이 있는 경우, 클릭 후 재조회 시도
            if (!content && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              const docTitle = msg.doc.title?.trim();
              if (docTitle) {
                const clickable = Array.from(document.querySelectorAll<HTMLElement>('a, button, span, tr'))
                  .find(el => (el.textContent || '').includes(docTitle) && (el.tagName === 'A' || el.tagName === 'BUTTON' || el.onclick || el.getAttribute('onclick')));
                if (clickable) {
                  try {
                    clickable.click();
                    setTimeout(() => {
                      chrome.runtime.sendMessage(
                        { type: 'DRAFT_FETCH_RELATED_DOC', doc: msg.doc },
                        (retryRes) => {
                          const retryContent = retryRes?.content || foundContent;
                          iframe.contentWindow?.postMessage(
                            {
                              type: 'DRAFT_RELATED_DOC_CONTENT',
                              title: msg.doc.title,
                              docId: msg.doc.id,
                              content: retryContent,
                              error: retryContent ? undefined : retryRes?.error,
                            },
                            '*'
                          );
                        }
                      );
                    }, 1500);
                    return;
                  } catch {}
                }
              }
            }

            iframe.contentWindow?.postMessage(
              {
                type: 'DRAFT_RELATED_DOC_CONTENT',
                title: msg.doc.title,
                docId: msg.doc.id,
                content,
                error: content ? undefined : response?.error,
              },
              '*'
            );
          }
        );
      } else {
        iframe.contentWindow?.postMessage(
          {
            type: 'DRAFT_RELATED_DOC_CONTENT',
            title: msg.doc.title,
            docId: msg.doc.id,
            content: foundContent,
          },
          '*'
        );
      }
    } else if (msg.type === 'DRAFT_PREPARE_INSERT' && msg.payload?.text) {
      // 1단계: PREPARE
      const plan = await controller.prepare(ctx, msg.payload.text, msg.payload.mode || 'cursor', document);
      iframe.contentWindow?.postMessage(
        {
          type: 'DRAFT_PREPARED_RESPONSE',
          requestId: msg.requestId,
          approvalToken: plan.approvalToken,
          targetLabel: plan.targetLabel,
          preview: plan.preview,
          expiresAt: plan.expiresAt,
        },
        '*'
      );
    } else if (msg.type === 'DRAFT_APPLY_INSERT' && msg.approvalToken && msg.text) {
      // 2단계: APPLY (사용자 명시적 승인 후 단 1회 커밋)
      const result = await controller.commit(ctx, msg.approvalToken, msg.text, document);
      iframe.contentWindow?.postMessage(
        {
          type: 'DRAFT_APPLY_RESPONSE',
          requestId: msg.requestId,
          status: result.status,
          message: result.message,
        },
        '*'
      );
    } else if (msg.type === 'DRAFT_APPLY_TITLE' && typeof msg.title === 'string') {
      const titleToApply = msg.title.trim();
      let applied = false;
      let methodUsed = '';

      // 1. 서비스워커를 통해 메인 월드(HwpCtrl 누름틀 및 모든 프레임 DOM) 주입 시도
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          const bgRes = await new Promise<{ success: boolean; method?: string }>((resolve) => {
            chrome.runtime.sendMessage(
              { type: 'DRAFT_MAIN_WORLD_HWP_TITLE', title: titleToApply },
              (resp) => resolve(resp || { success: false })
            );
          });
          if (bgRes && bgRes.success) {
            applied = true;
            methodUsed = bgRes.method || 'Background';
          }
        } catch {}
      }

      // 2. 현재 프레임 DOM 직접 주입 시도
      if (!applied) {
        const domRes = applyDraftTitleToDom(document, titleToApply);
        if (domRes.success) {
          applied = true;
          methodUsed = domRes.method || 'LocalDOM';
        }
      }

      if (applied) {
        iframe.contentWindow?.postMessage(
          {
            type: 'DRAFT_APPLY_TITLE_RESULT',
            success: true,
            title: titleToApply,
            message: '공문 본 화면의 제목 필드에 반영되었습니다.',
          },
          '*'
        );
      } else {
        // 3. 필드를 못 찾았을 경우 클립보드 폴백 복사
        let copied = false;
        try {
          await navigator.clipboard.writeText(titleToApply);
          copied = true;
        } catch {}

        iframe.contentWindow?.postMessage(
          {
            type: 'DRAFT_APPLY_TITLE_RESULT',
            success: false,
            fallbackCopied: copied,
            title: titleToApply,
            message: copied
              ? '제목 필드를 자동으로 찾지 못해 제목을 복사했습니다. (제목 칸에 Ctrl+V로 붙여넣기)'
              : '공문 본 화면에서 제목 입력 필드를 찾지 못했습니다.',
          },
          '*'
        );
      }
    }
  });

  // 백그라운드 리스너
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'TOGGLE_DRAWER') {
      toggleDrawer();
      sendResponse({ ok: true, isOpen });
      return true;
    }
    if (msg?.type === 'GET_DRAWER_STATUS') {
      const isHostInDOM = Boolean(document.contains(host));
      if (!isHostInDOM) {
        attachHostToDOM();
      }
      sendResponse({ injected: true, isOpen, inDOM: Boolean(document.contains(host)) });
      return true;
    }
    return false;
  });

  attachHostToDOM();
});
