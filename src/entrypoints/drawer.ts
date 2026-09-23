/**
 * 온나라 공문서 작성기 전용 인페이지 사이드카 드로어 호스트 셸.
 *
 * Shadow DOM 기반 격리, 방탄(Bulletproof) 포인터 리사이즈,
 * '본문작성' 화면 감지 및 2단계 명시적 승인 트랜잭션 브리지를 제공한다.
 */

import { captureDraftContext } from '@/lib/onnara/draft-context';
import { resolveEditorAdapter, directInsertAtTarget } from '@/lib/onnara/draft-editor';
import { DraftTransactionController } from '@/lib/onnara/draft-controller';
import { findWriteBodyButton } from '@/lib/onnara/draft-route';

declare global {
  interface Window {
    __saideDrawerInjected?: () => boolean;
    __saideToggleDrawer?: () => void;
  }
}

export default defineUnlistedScript(() => {
  if (window.__saideDrawerInjected?.()) return;
  const runtime = chrome.runtime;
  window.__saideDrawerInjected = () => {
    try {
      return Boolean(runtime?.id);
    } catch {
      return false;
    }
  };

  let isOpen = false;
  let drawerWidth = 440;
  const controller = new DraftTransactionController();

  // 1. Shadow DOM 호스트 생성
  const host = document.createElement('saide-drawer-host');
  host.style.all = 'initial';
  const shadow = host.attachShadow({ mode: 'open' });

  // 2. 스타일 정의
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Malgun Gothic", Dotum, sans-serif;
    }

    /* 플로팅 런처 버튼 (제1 기본 조작 경로) */
    .saide-launcher {
      position: fixed;
      right: 0;
      top: 180px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
      color: #ffffff;
      padding: 10px 14px 10px 12px;
      border-radius: 12px 0 0 12px;
      box-shadow: -2px 4px 14px rgba(0, 0, 0, 0.22);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.2px;
      user-select: none;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
    }
    .saide-launcher:hover {
      transform: translateX(-4px);
      box-shadow: -4px 6px 18px rgba(30, 64, 175, 0.35);
      background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%);
    }
    .saide-launcher svg {
      width: 17px;
      height: 17px;
      fill: currentColor;
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
      box-shadow: -8px 0 28px rgba(0, 0, 0, 0.2);
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      transform: translateX(105%);
      transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      border-left: 1px solid #e2e8f0;
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

  // 3. 플로팅 런처 버튼 렌더링
  const launcher = document.createElement('div');
  launcher.className = 'saide-launcher';
  launcher.setAttribute('role', 'button');
  launcher.setAttribute('aria-label', '온나라 sAIde 기안 도우미 열기');
  launcher.title = '온나라 sAIde 공문서 기안 도우미 열기 (Ctrl+Alt+A)';
  launcher.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.38-1 1.72V7h2a5 5 0 0 1 5 5v1.28c.6.34 1 .98 1 1.72a2 2 0 1 1-4 0V12a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v3a2 2 0 1 1-4 0c0-.74.4-1.38 1-1.72V12a5 5 0 0 1 5-5h2V5.72A2 2 0 0 1 10 4a2 2 0 0 1 2-2zm-3 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/>
    </svg>
    <span>sAIde</span>
  `;
  shadow.appendChild(launcher);

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

  function setDrawerOpen(nextOpen: boolean) {
    isOpen = nextOpen;
    if (isOpen) {
      if (!iframe.src) {
        iframe.src = chrome.runtime.getURL('drawer-page.html');
      }
      drawer.classList.add('open');
      launcher.style.display = 'none';
      setTimeout(syncContextToIframe, 350);
    } else {
      drawer.classList.remove('open');
      launcher.style.display = 'flex';
      controller.invalidateAll();
      stopTargetPicker();
    }
  }

  function toggleDrawer() {
    setDrawerOpen(!isOpen);
  }

  window.__saideToggleDrawer = toggleDrawer;
  launcher.addEventListener('click', toggleDrawer);

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

    e.preventDefault();
    e.stopPropagation();

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

    try {
      targetEl.focus?.();
    } catch {
      // ignore
    }

    // 클릭한 위치에 100% 직접 삽입 실행 (WebHWP/DOM/Caret)
    const res = await directInsertAtTarget(targetEl, textToInsert, clickX, clickY, targetEl.ownerDocument || document);
    showToast(res.message, 3000);

    iframe.contentWindow?.postMessage(
      {
        type: 'SAIDE_TARGET_INSERT_RESULT',
        status: 'applied',
        message: res.message,
      },
      '*'
    );
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
    isPickingTarget = true;
    pendingInsertText = text;
    targetBanner.classList.add('active');

    // 기안기 문서들에 캡처 리스너 등록
    const docs = getAccessibleDocuments(document);
    for (const doc of docs) {
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
      sendResponse({ injected: true, isOpen });
      return true;
    }
    return false;
  });

  document.documentElement.appendChild(host);
});

