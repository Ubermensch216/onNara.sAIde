/**
 * 에디터 영역 텍스트 블록 선택(Selection) 감지 및 인라인 치환 매니저.
 */

import { isEditableElement, insertViaMainWorldHwp } from './draft-editor';
import { draftToHtml, createDomFragmentFromText, copyDraftToClipboard } from './draft-format';

export interface SelectionInfo {
  text: string;
  clientRect: DOMRect;
  targetElement: HTMLElement | null;
  ownerDoc: Document;
  isEditable: boolean;
  // textarea / input인 경우
  inputRange?: { start: number; end: number };
  // DOM Range인 경우
  domRange?: Range;
}

/** Convert a frame-local client rect to the top-level viewport used by the overlay. */
function toTopLevelClientRect(doc: Document, rect: DOMRect): DOMRect {
  let left = rect.left;
  let top = rect.top;
  let right = rect.right;
  let bottom = rect.bottom;
  let view = doc.defaultView;

  while (view && view !== view.top) {
    try {
      const frame = view.frameElement as HTMLElement | null;
      if (!frame) break;
      const frameRect = frame.getBoundingClientRect();
      left += frameRect.left + frame.clientLeft;
      right += frameRect.left + frame.clientLeft;
      top += frameRect.top + frame.clientTop;
      bottom += frameRect.top + frame.clientTop;
      view = frame.ownerDocument.defaultView;
    } catch {
      break;
    }
  }

  return {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** 현재 문서(또는 하위 iframe)의 텍스트 선택 정보 캡처 */
export function captureActiveSelection(doc: Document = document): SelectionInfo | null {
  const win = doc.defaultView || window;
  const activeEl = doc.activeElement as HTMLElement | null;

  // 1. Textarea 또는 Input 내부 블록 지정 감지
  if (
    activeEl &&
    ((win.HTMLTextAreaElement && activeEl instanceof win.HTMLTextAreaElement) ||
      (win.HTMLInputElement && activeEl instanceof win.HTMLInputElement && ['text', 'search', 'url', 'tel', 'email'].includes((activeEl as HTMLInputElement).type)))
  ) {
    const input = activeEl as HTMLTextAreaElement | HTMLInputElement;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;

    if (start !== end && end - start >= 2) {
      const selectedText = input.value.substring(start, end).trim();
      if (selectedText.length >= 2) {
        const rect = input.getBoundingClientRect();
        // 텍스트 필드 상단 중앙 근처로 툴바 위치 지정
        return {
          text: selectedText,
          clientRect: toTopLevelClientRect(doc, rect),
          targetElement: input,
          ownerDoc: doc,
          isEditable: !input.disabled && !input.readOnly,
          inputRange: { start, end },
        };
      }
    }
  }

  // 2. 일반 DOM Selection (contenteditable, 본문 영역) 감지
  const sel = win.getSelection();
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    const rawText = sel.toString();
    const text = rawText.trim();
    if (text.length >= 2) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // rect 너비/높이가 정상인 경우
      if (rect.width > 0 || rect.height > 0) {
        let el = range.commonAncestorContainer as HTMLElement;
        if (el && el.nodeType === Node.TEXT_NODE) {
          el = el.parentElement as HTMLElement;
        }

        const isEditable = isEditableElement(el);

        return {
          text,
          clientRect: toTopLevelClientRect(doc, rect),
          targetElement: el,
          ownerDoc: doc,
          isEditable,
          domRange: range.cloneRange(),
        };
      }
    }
  }

  return null;
}

/**
 * 선택된 블록 영역의 텍스트를 새로운 텍스트로 안전하게 교체(치환)합니다.
 */
export async function replaceSelectedText(
  selection: SelectionInfo,
  newText: string
): Promise<{ success: boolean; message?: string }> {
  const { targetElement, ownerDoc, inputRange, domRange } = selection;

  // 1. Textarea / Input 치환
  if (
    targetElement &&
    (targetElement instanceof HTMLTextAreaElement || targetElement instanceof HTMLInputElement) &&
    inputRange
  ) {
    try {
      const input = targetElement as HTMLTextAreaElement | HTMLInputElement;
      input.focus();
      if (typeof input.setRangeText === 'function') {
        input.setRangeText(newText, inputRange.start, inputRange.end, 'end');
      } else {
        const val = input.value;
        input.value = val.substring(0, inputRange.start) + newText + val.substring(inputRange.end);
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, message: '본문 텍스트가 교체되었습니다.' };
    } catch (e: any) {
      return { success: false, message: e.message || '입력 필드 치환 실패' };
    }
  }

  // 2. Contenteditable / 일반 DOM Range 치환
  if (domRange) {
    try {
      const win = ownerDoc.defaultView || window;
      const sel = win.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(domRange);
      }

      let applied = false;
      const html = draftToHtml(newText);

      // document.execCommand('insertHTML') 우선 시도 (줄바꿈/서식 보존)
      if (ownerDoc.queryCommandSupported && ownerDoc.queryCommandSupported('insertHTML')) {
        try {
          applied = ownerDoc.execCommand('insertHTML', false, html);
        } catch {}
      }

      // document.execCommand('insertText') 차선 시도 (Undo 히스토리 지원)
      if (!applied && ownerDoc.queryCommandSupported && ownerDoc.queryCommandSupported('insertText')) {
        try {
          applied = ownerDoc.execCommand('insertText', false, newText);
        } catch {}
      }

      if (!applied) {
        domRange.deleteContents();
        const frag = createDomFragmentFromText(ownerDoc, newText);
        domRange.insertNode(frag);
        domRange.collapse(false);
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(domRange);
        }
      }

      if (targetElement) {
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return { success: true, message: '본문이 수정되었습니다.' };
    } catch {
      // 계속 아래 WebHWP 또는 클립보드로 폴백
    }
  }

  // 3. WebHWP(한글 기안기) 삽입 시도
  try {
    const hwpRes = await insertViaMainWorldHwp(newText, ownerDoc);
    if (hwpRes.success) {
      return { success: true, message: '한글 기안기 본문이 교체되었습니다.' };
    }
  } catch {
    // ignore
  }

  // 4. 안전한 클립보드 복사 폴백
  try {
    const ok = await copyDraftToClipboard(newText);
    if (ok) {
      return { success: true, message: '교체할 텍스트가 클립보드에 복사되었습니다. (Ctrl+V로 붙여넣기)' };
    }
  } catch {
    // ignore
  }

  return { success: false, message: '텍스트를 적용하지 못했습니다.' };
}

/** 툴바의 최적 표시 좌표(Top, Left)를 뷰포트 경계에 맞춰 계산 */
export function calculateBubblePosition(
  rect: DOMRect,
  bubbleWidth: number = 380,
  bubbleHeight: number = 44,
  offsetY: number = 8
): { top: number; left: number; placement: 'top' | 'bottom' } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // 수평 중앙 정렬
  let left = rect.left + rect.width / 2 - bubbleWidth / 2;
  // 좌우 여백 12px 보장
  left = Math.max(12, Math.min(left, viewportWidth - bubbleWidth - 12));

  // 기본은 선택 영역 상단
  let top = rect.top - bubbleHeight - offsetY;
  let placement: 'top' | 'bottom' = 'top';

  // 상단 공간이 부족하면 선택 영역 하단으로 이동
  if (top < 10) {
    top = rect.bottom + offsetY;
    placement = 'bottom';
    // 하단 공간도 부족하면 뷰포트 내부로 강제 클램프
    if (top + bubbleHeight > viewportHeight - 10) {
      top = Math.max(10, viewportHeight - bubbleHeight - 10);
    }
  }

  return {
    top: Math.round(top),
    left: Math.round(left),
    placement,
  };
}
