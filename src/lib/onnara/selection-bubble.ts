/**
 * 본 화면 에디터 영역의 블록 지정(Selection) 플로팅 에디팅 툴바 (Bubble Menu).
 *
 * Shadow DOM 기반으로 렌더링되어 온나라 시스템 기존 CSS와 충돌하지 않으며,
 * 맞춤법 검사, 문장 다듬기(6대 모드), 개인정보 마스킹, 번호 매기기, Diff 미리보기 및 즉시 치환을 제공합니다.
 */

import {
  captureActiveSelection,
  captureWebHwpSelection,
  replaceSelectedText,
  calculateBubblePosition,
  type SelectionInfo,
} from './selection-manager';
import {
  maskPrivacyInfo,
  autoNumberAdminDraft,
  transformTextWithAI,
  type PolishMode,
  type TransformAction,
} from './bubble-transform';
import { copyDraftToClipboard } from './draft-format';

export interface SelectionBubbleOptions {
  onSendToSidecar?: (text: string) => void;
  showToast?: (message: string) => void;
}

export interface SelectionBubbleController {
  element: HTMLElement;
  bindEvents(doc: Document): () => void;
  hide(): void;
  destroy(): void;
}

const MATERIAL_ICON_PATHS: Record<string, string> = {
  spellcheck: 'M12.45 16h2.09L9.43 3H7.57L2.46 16h2.09l1.12-3h5.64l1.14 3ZM6.41 11 8.5 5.43 10.59 11H6.41ZM21.59 5.58 16.5 10.67l-2.09-2.09L13 10l3.5 3.5L23 7l-1.41-1.42Z',
  auto_fix_high: 'm19 3 1.5 3.5L24 8l-3.5 1.5L19 13l-1.5-3.5L14 8l3.5-1.5L19 3ZM5 3l1.5 3.5L10 8l-3.5 1.5L5 13 3.5 9.5 0 8l3.5-1.5L5 3Zm12 11 1.5 3.5L22 19l-3.5 1.5L17 24l-1.5-3.5L12 19l3.5-1.5L17 14ZM3 17l6 6 9-9-6-6-9 9Zm6 3.17L5.83 17 12 10.83 15.17 14 9 20.17Z',
  lock: 'M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2ZM9 6a3 3 0 0 1 6 0v2H9V6Zm9 14H6V10h12v10Zm-6-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  format_list_numbered: 'M3 4h2v1H4v1h1v1H3v1h3V3H3v1Zm0 6h1v1H3v1h1v1H3v1h3v-4H3v1Zm2 5H3v1h2v1H3v1h2v1H3v1h3v-5H3v1h2v1Zm4-11h12v2H9V4Zm0 6h12v2H9v-2Zm0 6h12v2H9v-2Z',
  chat: 'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 14H5.17L4 17.17V4h16v12Z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z',
  content_cut: 'M6.5 3a3.5 3.5 0 1 0 2.45 6L12 12l-3.05 3.05a3.5 3.5 0 1 0 1.41 1.41L12 14.83l6.5 6.5 1.41-1.41L9.91 9.91A3.5 3.5 0 0 0 6.5 3Zm0 5A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8Zm0 13A1.5 1.5 0 1 1 8 19.5 1.5 1.5 0 0 1 6.5 21ZM12 12l2-2 6-6-1.41-1.41L12 9.17 10.83 10.3 12 12Z',
  article: 'M19 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 18H5V4h14v16ZM7 7h10v2H7V7Zm0 4h10v2H7v-2Zm0 4h7v2H7v-2Z',
  account_balance: 'M12 3 2 8v2h20V8L12 3ZM4 12h2v7H4v-7Zm7 0h2v7h-2v-7Zm7 0h2v7h-2v-7ZM2 21h20v-2H2v2Z',
  checklist: 'M3 5h2v2H3V5Zm4 0h14v2H7V5ZM3 11h2v2H3v-2Zm4 0h14v2H7v-2Zm-4 6h2v2H3v-2Zm4 0h14v2H7v-2Z',
  translate: 'M12.87 15.07 10.33 12.56l.03-.03a17.52 17.52 0 0 0 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17a15.58 15.58 0 0 1-3 5.02 15.62 15.62 0 0 1-2.18-3.02H5a17.57 17.57 0 0 0 2.82 4.42L2.69 18.2 4.1 19.6 8.5 15.2l2.73 2.73.64-2.86ZM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12Zm-2.13 7 1.13-3.02L18.63 17h-2.26Z',
};

function materialIcon(name: keyof typeof MATERIAL_ICON_PATHS, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${MATERIAL_ICON_PATHS[name]}"/></svg>`;
}

export function createSelectionBubble(
  options: SelectionBubbleOptions = {}
): SelectionBubbleController {
  const wrapper = document.createElement('div');
  wrapper.className = 'saide-bubble-container';
  wrapper.style.display = 'none';

  let currentSelection: SelectionInfo | null = null;
  let isDropdownOpen = false;
  let isLoading = false;
  let pendingResult: { original: string; transformed: string; actionTitle: string } | null = null;
  let abortController: AbortController | null = null;

  // 1. 내부 마크업 생성
  wrapper.innerHTML = `
    <style>
      .saide-bubble-container { pointer-events: auto; }
      .saide-bubble-wrapper {
        position: fixed;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Malgun Gothic", sans-serif;
        font-size: 12px;
        line-height: 1.4;
        color: #1e293b;
        user-select: none;
        animation: saideBubbleFadeIn 0.15s ease-out;
      }

      /* 메인 툴바 바 */
      .saide-bubble-bar {
        display: flex;
        align-items: center;
        gap: 3px;
        background: #1e293b;
        color: #ffffff;
        padding: 5px 7px;
        border-radius: 9px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.35), 0 8px 10px -6px rgba(0, 0, 0, 0.25);
        border: 1px solid #334155;
      }

      .saide-bubble-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: transparent;
        color: #f1f5f9;
        border: none;
        padding: 5px 8px;
        border-radius: 6px;
        font-size: 11.5px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        white-space: nowrap;
      }
      .saide-bubble-btn svg, .saide-dropdown-item svg, .saide-action-btn svg { flex: none; }
      .saide-bubble-btn:hover {
        background: #334155;
        color: #ffffff;
      }
      .saide-bubble-btn.active {
        background: #2563eb;
        color: #ffffff;
      }
      .saide-bubble-btn.close-btn {
        padding: 5px 6px;
        color: #94a3b8;
      }
      .saide-bubble-btn.close-btn:hover {
        color: #ffffff;
        background: #ef4444;
      }

      .saide-bubble-divider {
        width: 1px;
        height: 14px;
        background: #475569;
        margin: 0 2px;
      }

      /* 문장 다듬기 드롭다운 서브메뉴 */
      .saide-bubble-dropdown {
        position: absolute;
        top: calc(100% + 5px);
        left: 80px;
        background: #ffffff;
        color: #1e293b;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.18);
        padding: 4px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 190px;
        z-index: 10;
        animation: saideBubbleFadeIn 0.12s ease-out;
      }
      .saide-dropdown-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 500;
        color: #334155;
        cursor: pointer;
        border: none;
        background: transparent;
        text-align: left;
        width: 100%;
      }
      .saide-dropdown-item:hover {
        background: #eff6ff;
        color: #1d4ed8;
      }
      .saide-dropdown-item .desc {
        font-size: 10px;
        color: #64748b;
      }

      /* 프리뷰 및 Diff 카드 */
      .saide-preview-card {
        margin-top: 6px;
        background: #ffffff;
        color: #1e293b;
        border: 1px solid #cbd5e1;
        border-radius: 9px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
        padding: 10px;
        width: 380px;
        max-width: 90vw;
        animation: saideBubbleFadeIn 0.15s ease-out;
      }
      .saide-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid #f1f5f9;
      }
      .saide-preview-badge {
        font-size: 10.5px;
        font-weight: 700;
        color: #2563eb;
        background: #eff6ff;
        padding: 2px 7px;
        border-radius: 4px;
        border: 1px solid #dbeafe;
      }
      .saide-preview-body {
        max-height: 140px;
        overflow-y: auto;
        font-size: 11.5px;
        line-height: 1.6;
        color: #1e293b;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 8px;
        white-space: pre-wrap;
        user-select: text;
      }
      .saide-preview-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 8px;
      }
      .saide-action-btn {
        padding: 5px 10px;
        border-radius: 5px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s;
      }
      .saide-action-btn.apply {
        background: #2563eb;
        color: #ffffff;
      }
      .saide-action-btn.apply:hover {
        background: #1d4ed8;
      }
      .saide-action-btn.copy {
        background: #ffffff;
        border-color: #cbd5e1;
        color: #334155;
      }
      .saide-action-btn.copy:hover {
        background: #f1f5f9;
      }
      .saide-action-btn.cancel {
        background: transparent;
        color: #64748b;
      }
      .saide-action-btn.cancel:hover {
        color: #0f172a;
      }

      /* 로딩 인디케이터 */
      .saide-loading-box {
        margin-top: 6px;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        padding: 10px 14px;
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.15);
        display: flex;
        align-items: center;
        gap: 10px;
        width: 320px;
      }
      .saide-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #e2e8f0;
        border-top-color: #2563eb;
        border-radius: 50%;
        animation: saideSpin 0.7s linear infinite;
      }

      @keyframes saideBubbleFadeIn {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes saideSpin {
        to { transform: rotate(360deg); }
      }
    </style>

    <div class="saide-bubble-wrapper" id="saideBubbleWrapper">
      <!-- 메인 툴바 -->
      <div class="saide-bubble-bar">
        <button type="button" class="saide-bubble-btn" id="btnSpellcheck" title="오탈자 및 띄어쓰기 교정">
          ${materialIcon('spellcheck')}
          <span>맞춤법 검사</span>
        </button>

        <button type="button" class="saide-bubble-btn" id="btnPolishMenu" title="공문서 어투, 개조식, 줄이기/늘리기 등">
          ${materialIcon('auto_fix_high')}
          <span>문장 다듬기 <span aria-hidden="true">▾</span></span>
        </button>

        <div class="saide-bubble-divider"></div>

        <button type="button" class="saide-bubble-btn" id="btnPrivacyMask" title="주민번호, 전화번호, 이메일 마스킹">
          ${materialIcon('lock')}
          <span>개인정보 마스킹</span>
        </button>

        <button type="button" class="saide-bubble-btn" id="btnAutoNumber" title="1. 가. (1) 계층별 번호 자동 부여">
          ${materialIcon('format_list_numbered')}
          <span>번호 매기기</span>
        </button>

        <button type="button" class="saide-bubble-btn" id="btnSendSidecar" title="sAIde 사이드카에 이 내용 질의">
          ${materialIcon('chat')}
          <span>sAIde 질의</span>
        </button>

        <button type="button" class="saide-bubble-btn close-btn" id="btnCloseBubble" title="닫기 (Esc)">
          ${materialIcon('close', 14)}
        </button>
      </div>

      <!-- 문장 다듬기 드롭다운 서브메뉴 -->
      <div class="saide-bubble-dropdown" id="dropdownPolish" style="display: none;">
        <button type="button" class="saide-dropdown-item" data-mode="shorten">
          <span>${materialIcon('content_cut', 14)} 간결하게</span>
          <span class="desc">내용 줄이기</span>
        </button>
        <button type="button" class="saide-dropdown-item" data-mode="expand">
          <span>${materialIcon('article', 14)} 풍부하게</span>
          <span class="desc">내용 늘리기</span>
        </button>
        <button type="button" class="saide-dropdown-item" data-mode="official">
          <span>${materialIcon('account_balance', 14)} 공문서 표준 어투</span>
          <span class="desc">~코자 함, ~바람</span>
        </button>
        <button type="button" class="saide-dropdown-item" data-mode="bullet">
          <span>${materialIcon('checklist', 14)} 개조식 변환</span>
          <span class="desc">- · 항목화</span>
        </button>
        <button type="button" class="saide-dropdown-item" data-mode="refine">
          <span>${materialIcon('translate', 14)} 쉬운 행정용어</span>
          <span class="desc">순화어 치환</span>
        </button>
        <button type="button" class="saide-dropdown-item" data-mode="courtesy">
          <span>${materialIcon('chat', 14)} 정중한 협조체</span>
          <span class="desc">대외 협조 공문</span>
        </button>
      </div>

      <!-- 로딩 인디케이터 -->
      <div class="saide-loading-box" id="bubbleLoading" style="display: none;">
        <div class="saide-spinner"></div>
        <div style="font-size: 11px; font-weight: 500; color: #334155;" id="bubbleLoadingText">
          AI가 내용을 분석하고 있습니다...
        </div>
      </div>

      <!-- 프리뷰 & Diff 카드 -->
      <div class="saide-preview-card" id="bubblePreview" style="display: none;">
        <div class="saide-preview-header">
          <span class="saide-preview-badge" id="previewBadge">맞춤법 검사 결과</span>
          <span style="font-size: 10px; color: #64748b;">Enter로 본문 적용</span>
        </div>
        <div class="saide-preview-body" id="previewContent"></div>
        <div class="saide-preview-actions">
          <button type="button" class="saide-action-btn cancel" id="btnPreviewCancel">취소</button>
          <button type="button" class="saide-action-btn copy" id="btnPreviewCopy">${materialIcon('article', 14)} 복사</button>
          <button type="button" class="saide-action-btn apply" id="btnPreviewApply">본문에 적용 (Enter)</button>
        </div>
      </div>
    </div>
  `;

  // 엘리먼트 참조
  const bubbleWrapper = wrapper.querySelector<HTMLElement>('#saideBubbleWrapper')!;
  const btnSpellcheck = wrapper.querySelector<HTMLButtonElement>('#btnSpellcheck')!;
  const btnPolishMenu = wrapper.querySelector<HTMLButtonElement>('#btnPolishMenu')!;
  const btnPrivacyMask = wrapper.querySelector<HTMLButtonElement>('#btnPrivacyMask')!;
  const btnAutoNumber = wrapper.querySelector<HTMLButtonElement>('#btnAutoNumber')!;
  const btnSendSidecar = wrapper.querySelector<HTMLButtonElement>('#btnSendSidecar')!;
  const btnCloseBubble = wrapper.querySelector<HTMLButtonElement>('#btnCloseBubble')!;

  const dropdownPolish = wrapper.querySelector<HTMLElement>('#dropdownPolish')!;
  const bubbleLoading = wrapper.querySelector<HTMLElement>('#bubbleLoading')!;
  const bubbleLoadingText = wrapper.querySelector<HTMLElement>('#bubbleLoadingText')!;
  const bubblePreview = wrapper.querySelector<HTMLElement>('#bubblePreview')!;
  const previewBadge = wrapper.querySelector<HTMLElement>('#previewBadge')!;
  const previewContent = wrapper.querySelector<HTMLElement>('#previewContent')!;
  const btnPreviewApply = wrapper.querySelector<HTMLButtonElement>('#btnPreviewApply')!;
  const btnPreviewCopy = wrapper.querySelector<HTMLButtonElement>('#btnPreviewCopy')!;
  const btnPreviewCancel = wrapper.querySelector<HTMLButtonElement>('#btnPreviewCancel')!;

  function setDropdownOpen(open: boolean) {
    isDropdownOpen = open;
    dropdownPolish.style.display = open ? 'flex' : 'none';
    if (open) {
      btnPolishMenu.classList.add('active');
    } else {
      btnPolishMenu.classList.remove('active');
    }
  }

  function hidePreviewAndLoading() {
    isLoading = false;
    pendingResult = null;
    bubbleLoading.style.display = 'none';
    bubblePreview.style.display = 'none';
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  function hide() {
    wrapper.style.display = 'none';
    setDropdownOpen(false);
    hidePreviewAndLoading();
    currentSelection = null;
  }

  function showAtSelection(selection: SelectionInfo) {
    currentSelection = selection;
    hidePreviewAndLoading();
    setDropdownOpen(false);

    const pos = calculateBubblePosition(selection.clientRect, 380, 42, 8);
    bubbleWrapper.style.top = `${pos.top}px`;
    bubbleWrapper.style.left = `${pos.left}px`;
    wrapper.style.display = 'block';
  }

  function showPreview(actionTitle: string, transformedText: string) {
    if (!currentSelection) return;
    isLoading = false;
    bubbleLoading.style.display = 'none';

    pendingResult = {
      original: currentSelection.text,
      transformed: transformedText,
      actionTitle,
    };

    previewBadge.textContent = actionTitle;
    previewContent.textContent = transformedText;
    bubblePreview.style.display = 'block';
  }

  async function applyPendingResult() {
    if (!currentSelection || !pendingResult) return;
    const textToInsert = pendingResult.transformed;
    const res = await replaceSelectedText(currentSelection, textToInsert);

    if (options.showToast) {
      options.showToast(res.message || '본문에 반영되었습니다.');
    }
    hide();
  }

  // 1. 맞춤법 검사 클릭
  btnSpellcheck.addEventListener('click', async (e) => {
    e.stopPropagation();
    setDropdownOpen(false);
    if (!currentSelection) return;

    isLoading = true;
    bubblePreview.style.display = 'none';
    bubbleLoadingText.textContent = 'AI가 맞춤법과 띄어쓰기를 교정 중입니다...';
    bubbleLoading.style.display = 'flex';

    abortController = new AbortController();
    try {
      const fixed = await transformTextWithAI('spellcheck', currentSelection.text, abortController.signal);
      showPreview('✓ 맞춤법 검사 결과', fixed);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      showPreview('오류 발생', `교정 실패: ${err.message}`);
    }
  });

  // 2. 문장 다듬기 메뉴 토글
  btnPolishMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    setDropdownOpen(!isDropdownOpen);
  });

  // 문장 다듬기 하위 모드 클릭
  dropdownPolish.querySelectorAll<HTMLButtonElement>('.saide-dropdown-item').forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      setDropdownOpen(false);
      if (!currentSelection) return;

      const mode = item.getAttribute('data-mode') as PolishMode;
      const titleMap: Record<PolishMode, string> = {
        shorten: '내용 줄이기 결과',
        expand: '내용 늘리기 결과',
        official: '공문서 표준 어투 결과',
        bullet: '개조식 변환 결과',
        refine: '행정용어 순화 결과',
        courtesy: '정중한 협조체 결과',
      };

      isLoading = true;
      bubblePreview.style.display = 'none';
      bubbleLoadingText.textContent = `AI가 [${item.querySelector('span')?.textContent}] 모드로 다듬는 중입니다...`;
      bubbleLoading.style.display = 'flex';

      abortController = new AbortController();
      try {
        const polished = await transformTextWithAI(mode, currentSelection.text, abortController.signal);
        showPreview(titleMap[mode] || '문장 다듬기 결과', polished);
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        showPreview('오류 발생', `다듬기 실패: ${err.message}`);
      }
    });
  });

  // 3. 개인정보 마스킹 클릭 (로컬 즉시 실행)
  btnPrivacyMask.addEventListener('click', (e) => {
    e.stopPropagation();
    setDropdownOpen(false);
    if (!currentSelection) return;

    const res = maskPrivacyInfo(currentSelection.text);
    if (res.count === 0) {
      if (options.showToast) {
        options.showToast('감지된 개인정보(주민번호/연락처/계좌/이메일)가 없습니다.');
      }
      return;
    }

    const typeStr = res.types.join(', ');
    showPreview(`개인정보 마스킹 (${res.count}건: ${typeStr})`, res.text);
  });

  // 4. 번호 매기기 클릭 (로컬 즉시 실행)
  btnAutoNumber.addEventListener('click', (e) => {
    e.stopPropagation();
    setDropdownOpen(false);
    if (!currentSelection) return;

    const numbered = autoNumberAdminDraft(currentSelection.text);
    showPreview('공문서 번호 매기기 결과', numbered);
  });

  // 5. sAIde 질의 클릭
  btnSendSidecar.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentSelection && options.onSendToSidecar) {
      options.onSendToSidecar(currentSelection.text);
      hide();
    }
  });

  // 6. 닫기 버튼
  btnCloseBubble.addEventListener('click', (e) => {
    e.stopPropagation();
    hide();
  });

  // 프리뷰 액션 버튼들
  btnPreviewApply.addEventListener('click', (e) => {
    e.stopPropagation();
    applyPendingResult();
  });

  btnPreviewCopy.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!pendingResult) return;
    const ok = await copyDraftToClipboard(pendingResult.transformed);
    if (ok) {
      if (options.showToast) options.showToast('클립보드에 복사되었습니다.');
    } else {
      if (options.showToast) options.showToast('복사에 실패했습니다.');
    }
  });

  btnPreviewCancel.addEventListener('click', (e) => {
    e.stopPropagation();
    hidePreviewAndLoading();
  });

  // 7. 문서 이벤트 바인딩 함수
  function bindEvents(doc: Document): () => void {
    let timer: any = null;

    const handleSelectionChange = (e?: Event) => {
      if (isLoading) return; // 로딩 중에는 선택 변경으로 닫히지 않음
      if (timer) clearTimeout(timer);

      timer = setTimeout(async () => {
        // 이미 툴바 내부를 조작 중이면 무시
        const shadowRoot = wrapper.getRootNode() as ShadowRoot;
        if (wrapper.contains(doc.activeElement) || shadowRoot.activeElement === wrapper || (shadowRoot.activeElement && wrapper.contains(shadowRoot.activeElement))) return;

        const targetEl = (e?.target as HTMLElement) || (doc.activeElement as HTMLElement | null);
        let sel = captureActiveSelection(doc, targetEl);

        // DOM 선택이 없고 본문작성 에디터(WebHWP) 환경이면 WebHWP 비동기 선택 조회
        if (!sel && e && (e.type === 'mouseup' || e.type === 'selectionchange')) {
          const mouseEvent = (e instanceof MouseEvent) ? e : undefined;
          sel = await captureWebHwpSelection(
            doc,
            mouseEvent ? { clientX: mouseEvent.clientX, clientY: mouseEvent.clientY } : undefined,
            targetEl
          );
        }

        if (sel) {
          showAtSelection(sel);
        } else {
          // 프리뷰가 열려있지 않은 상태면 닫기
          if (!pendingResult && !isLoading) {
            hide();
          }
        }
      }, 150);
    };

    const handlePointerDown = (e: MouseEvent) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const target = e.target as Node;
      if (wrapper.contains(target) || path.includes(wrapper) || path.some((item) => Boolean((item as Node)?.nodeType && wrapper.contains(item as Node)))) return;

      // 바깥 클릭 시 닫기
      if (wrapper.style.display !== 'none' && !isLoading) {
        hide();
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (wrapper.style.display === 'none') return;

      if (e.key === 'Escape') {
        hide();
      } else if (e.key === 'Enter' && pendingResult) {
        // 프리뷰 상태에서 Enter를 누르면 본문 적용
        e.preventDefault();
        applyPendingResult();
      }
    };

    doc.addEventListener('selectionchange', handleSelectionChange);
    doc.addEventListener('mouseup', handleSelectionChange);
    doc.addEventListener('keyup', handleSelectionChange);
    doc.addEventListener('mousedown', handlePointerDown);
    doc.addEventListener('keydown', handleKeydown);

    return () => {
      doc.removeEventListener('selectionchange', handleSelectionChange);
      doc.removeEventListener('mouseup', handleSelectionChange);
      doc.removeEventListener('keyup', handleSelectionChange);
      doc.removeEventListener('mousedown', handlePointerDown);
      doc.removeEventListener('keydown', handleKeydown);
    };
  }

  return {
    element: wrapper,
    bindEvents,
    hide,
    destroy: () => {
      hide();
      wrapper.remove();
    },
  };
}
