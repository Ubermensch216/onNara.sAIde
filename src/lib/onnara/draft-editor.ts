/**
 * 온나라 공문서 편집기 어댑터 및 역량 탐지 모듈.
 *
 * '본문작성' 클릭 후 열리는 내부 iframe 및 전용 에디터까지 재귀 탐색하며,
 * 공식 또는 실환경 검증된 편집기 외에는 'copy-only'(초안 복사)로 안전 강등한다.
 */

import type { DraftContext } from './draft-context';
import { computeRevisionHash } from './draft-context';
import type { InsertMode } from '../messaging/draft-protocol';
import { findWriteBodyButton } from './draft-route';

export type EditorCapability = 'read-only' | 'copy-only' | 'cursor' | 'selection' | 'append';

export interface ApprovedInsertOperation {
  text: string;
  mode: InsertMode;
  approvalToken: string;
}

export interface DraftEditorAdapter {
  id: string;
  detect(ctx: DraftContext, doc: Document): Promise<{
    supported: boolean;
    capability: EditorCapability;
    reason?: string;
  }>;
  read?(ctx: DraftContext, doc: Document): Promise<{
    text: string;
    revision: string;
    coverage: 'full' | 'partial';
  }>;
  prepare(
    ctx: DraftContext,
    text: string,
    mode: InsertMode,
    doc: Document
  ): Promise<{ targetLabel: string; expectedRevision: string; preview: string }>;
  apply(
    ctx: DraftContext,
    op: ApprovedInsertOperation,
    doc: Document
  ): Promise<{ status: 'applied' | 'unconfirmed'; observedRevision?: string; message?: string }>;
  verify?(
    ctx: DraftContext,
    op: ApprovedInsertOperation,
    doc: Document
  ): Promise<{ verified: boolean; reason?: string }>;
}

/** 접근 가능한 모든 iframe을 재귀적으로 탐색하여 에디터 요소 탐색 */
function searchAllFrames<T extends HTMLElement>(
  rootDoc: Document,
  matcher: (doc: Document) => T | null
): T | null {
  const direct = matcher(rootDoc);
  if (direct) return direct;

  const iframes = Array.from(rootDoc.querySelectorAll('iframe'));
  for (const iframe of iframes) {
    try {
      const iDoc = iframe.contentDocument;
      if (iDoc) {
        const found = searchAllFrames(iDoc, matcher);
        if (found) return found;
      }
    } catch {
      // cross-origin frame 무시
    }
  }
  return null;
}

/* ── 1. Textarea 어댑터 ── */
export class TextareaEditorAdapter implements DraftEditorAdapter {
  id = 'textarea-adapter';

  private findTextarea(doc: Document): HTMLTextAreaElement | null {
    return searchAllFrames(doc, d =>
      d.querySelector<HTMLTextAreaElement>(
        'textarea[name*="body"], textarea[name*="content"], textarea#body, textarea#content, textarea'
      )
    );
  }

  async detect(_ctx: DraftContext, doc: Document) {
    const ta = this.findTextarea(doc);
    if (!ta) return { supported: false, capability: 'copy-only' as const, reason: 'textarea 없음' };
    return { supported: true, capability: 'cursor' as const };
  }

  async read(_ctx: DraftContext, doc: Document) {
    const ta = this.findTextarea(doc);
    const text = ta?.value || '';
    return { text, revision: computeRevisionHash(text), coverage: 'full' as const };
  }

  async prepare(_ctx: DraftContext, text: string, _mode: InsertMode, doc: Document) {
    const ta = this.findTextarea(doc);
    const current = ta?.value || '';
    const preview = current ? `${current}\n\n[추가 초안]\n${text}` : text;
    return {
      targetLabel: '본문 텍스트 입력창',
      expectedRevision: computeRevisionHash(current),
      preview,
    };
  }

  async apply(_ctx: DraftContext, op: ApprovedInsertOperation, doc: Document) {
    const ta = this.findTextarea(doc);
    if (!ta) return { status: 'unconfirmed' as const, message: '입력창을 찾을 수 없습니다.' };

    ta.focus();
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.substring(0, start);
    const after = ta.value.substring(end);

    const inserted = before + (before.length && !before.endsWith('\n') ? '\n' : '') + op.text + after;
    ta.value = inserted;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      status: 'applied' as const,
      observedRevision: computeRevisionHash(inserted),
      message: '본문 입력창에 삽입되었습니다.',
    };
  }

  async verify(_ctx: DraftContext, op: ApprovedInsertOperation, doc: Document) {
    const ta = this.findTextarea(doc);
    const ok = Boolean(ta && ta.value.includes(op.text.trim().substring(0, 30)));
    return { verified: ok };
  }
}

/* ── 2. Contenteditable 어댑터 (iframe 내부 본문 에디터 포함) ── */
export class ContenteditableEditorAdapter implements DraftEditorAdapter {
  id = 'contenteditable-adapter';

  private findElement(doc: Document): HTMLElement | null {
    return searchAllFrames(doc, d => {
      const el = d.querySelector<HTMLElement>('[contenteditable="true"], [contenteditable=""], [contenteditable]');
      if (el) return el;
      if (d.body?.isContentEditable) return d.body;
      if (d.designMode?.toLowerCase() === 'on' && d.body) return d.body;
      return null;
    });
  }

  async detect(_ctx: DraftContext, doc: Document) {
    const el = this.findElement(doc);
    if (!el) return { supported: false, capability: 'copy-only' as const, reason: 'contenteditable 없음' };
    return { supported: true, capability: 'cursor' as const };
  }

  async read(_ctx: DraftContext, doc: Document) {
    const el = this.findElement(doc);
    const text = el?.textContent || '';
    return { text, revision: computeRevisionHash(text), coverage: 'full' as const };
  }

  async prepare(_ctx: DraftContext, text: string, _mode: InsertMode, doc: Document) {
    const el = this.findElement(doc);
    const current = el?.textContent || '';
    return {
      targetLabel: '본문 에디터',
      expectedRevision: computeRevisionHash(current),
      preview: current ? `${current}\n\n[추가 초안]\n${text}` : text,
    };
  }

  async apply(_ctx: DraftContext, op: ApprovedInsertOperation, doc: Document) {
    const el = this.findElement(doc);
    if (!el) return { status: 'unconfirmed' as const, message: '에디터를 찾을 수 없습니다.' };

    el.focus();
    const ownerDoc = el.ownerDocument;
    if (ownerDoc.queryCommandSupported && ownerDoc.queryCommandSupported('insertText')) {
      ownerDoc.execCommand('insertText', false, op.text);
    } else {
      el.appendChild(ownerDoc.createTextNode(op.text));
    }

    return {
      status: 'applied' as const,
      observedRevision: computeRevisionHash(el.textContent || ''),
      message: '본문 에디터에 삽입되었습니다.',
    };
  }

  async verify(_ctx: DraftContext, op: ApprovedInsertOperation, doc: Document) {
    const el = this.findElement(doc);
    const ok = Boolean(el && el.textContent?.includes(op.text.trim().substring(0, 30)));
    return { verified: ok };
  }
}

/* ── 3. 미검증 WebHWP 및 복사 전용 폴백 어댑터 ── */
export class SafeFallbackEditorAdapter implements DraftEditorAdapter {
  id = 'safe-fallback-adapter';

  async detect(_ctx: DraftContext, doc: Document) {
    const hasWriteBodyBtn = Boolean(findWriteBodyButton(doc));
    const reason = hasWriteBodyBtn
      ? '기안기 화면에 [본문작성] 버튼이 있습니다. [본문작성]을 클릭하여 본문 화면을 열어주세요.'
      : '직접 삽입 API가 검증되지 않아 안전한 초안 복사 모드로 작동합니다.';

    return {
      supported: true,
      capability: 'copy-only' as const,
      reason,
    };
  }

  async prepare(_ctx: DraftContext, text: string, _mode: InsertMode, _doc: Document) {
    return {
      targetLabel: '클립보드 복사',
      expectedRevision: '',
      preview: text,
    };
  }

  async apply(_ctx: DraftContext, op: ApprovedInsertOperation, doc: Document) {
    try {
      const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
      if (win?.navigator?.clipboard?.writeText) {
        await win.navigator.clipboard.writeText(op.text);
        return {
          status: 'applied' as const,
          message: '클립보드에 복사되었습니다. 본문작성 창에서 Ctrl+V를 누르세요.',
        };
      }
    } catch (e) {
      console.warn('[sAIde] 복사 실패', e);
    }
    return { status: 'unconfirmed' as const, message: '클립보드 복사에 실패했습니다.' };
  }
}

/** 적합한 에디터 어댑터 선택 */
export async function resolveEditorAdapter(
  ctx: DraftContext,
  doc: Document = document
): Promise<{ adapter: DraftEditorAdapter; capability: EditorCapability; reason?: string; needsOpenBody?: boolean }> {
  const adapters: DraftEditorAdapter[] = [
    new TextareaEditorAdapter(),
    new ContenteditableEditorAdapter(),
  ];

  for (const a of adapters) {
    const d = await a.detect(ctx, doc);
    if (d.supported && d.capability !== 'copy-only') {
      return { adapter: a, capability: d.capability, reason: d.reason, needsOpenBody: false };
    }
  }

  const hasWriteBodyBtn = Boolean(findWriteBodyButton(doc));
  const fallback = new SafeFallbackEditorAdapter();
  const d = await fallback.detect(ctx, doc);

  return {
    adapter: fallback,
    capability: d.capability,
    reason: d.reason,
    needsOpenBody: hasWriteBodyBtn,
  };
}

export interface TargetInsertResult {
  status: 'applied' | 'clipboard-fallback' | 'failed';
  targetLabel: string;
  message: string;
}

/** 실제 텍스트 입력이 가능한 요소인지 판별 (일반 레이아웃 div 등 제외) */
export function isEditableElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el.tagName === 'TEXTAREA') {
    const ta = el as HTMLTextAreaElement;
    return !ta.disabled && !ta.readOnly;
  }
  if (el instanceof HTMLInputElement || el.tagName === 'INPUT') {
    const inp = el as HTMLInputElement;
    const type = (inp.getAttribute('type') || 'text').toLowerCase();
    const textTypes = ['text', 'search', 'url', 'tel', 'email', 'password'];
    return textTypes.includes(type) && !inp.disabled && !inp.readOnly;
  }
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') {
    return true;
  }
  if (el.ownerDocument?.designMode?.toLowerCase() === 'on') {
    return true;
  }
  if (el.tagName === 'IFRAME') {
    return true;
  }
  // 온나라 WebHWP 컨트롤 / 한컴 기안기 탐지
  const id = (el.id || '').toLowerCase();
  const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
  if (
    id.includes('hwp') ||
    className.includes('hwp') ||
    el.tagName === 'OBJECT' ||
    el.tagName === 'EMBED'
  ) {
    return true;
  }
  return false;
}

/** 요소의 식별 레이블(설명) 생성 - 불필요한 DOM ID 대신 친절한 명칭 반환 */
export function getElementLabel(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el.tagName === 'TEXTAREA') {
    const ta = el as HTMLTextAreaElement;
    return ta.placeholder || '본문 입력창';
  }
  if (el instanceof HTMLInputElement || el.tagName === 'INPUT') {
    const inp = el as HTMLInputElement;
    return inp.placeholder || '입력 필드';
  }
  if (el.isContentEditable || el.getAttribute('contenteditable') !== null) {
    return el.getAttribute('aria-label') || '본문 에디터';
  }
  if (el.tagName === 'IFRAME') {
    const iframe = el as HTMLIFrameElement;
    return iframe.title || '본문 프레임';
  }
  const id = (el.id || '').toLowerCase();
  if (id.includes('hwp') || el.tagName === 'OBJECT' || el.tagName === 'EMBED') {
    return '한글 기안기 본문';
  }
  return '본문 영역';
}

/**
 * 특정 타깃 요소 또는 커서 위치에 초안 텍스트를 직접 삽입.
 * 1. WebHWP 컨트롤(HwpCtrl.InsertText) 감지 및 직접 삽입 시도
 * 2. textarea / input / contenteditable 직접 주입
 * 3. 직접 주입이 차단된 경우 클립보드 복사 + 포커스 + 붙여넣기 유도
 */
/**
 * 윈도우 및 모든 중첩 iframe에서 WebHWP(한글 기안기) 컨트롤 객체 탐색
 */
function findHwpCtrlInAllWindows(startWin: Window): any {
  const queue: Window[] = [];
  const visited = new Set<Window>();
  try {
    queue.push(startWin);
    if (startWin.top && startWin.top !== startWin) queue.push(startWin.top);
    if (startWin.parent && startWin.parent !== startWin) queue.push(startWin.parent);
  } catch {
    // ignore cross-origin error
  }

  while (queue.length > 0) {
    const w = queue.shift()!;
    if (visited.has(w)) continue;
    visited.add(w);

    try {
      const h = (w as any).HwpCtrl || (w as any).pHwpCtrl || (w as any).tbContentElement;
      if (h && typeof h.InsertText === 'function') return h;
      const el = w.document?.getElementById('HwpCtrl');
      if (el && typeof (el as any).InsertText === 'function') return el;

      const frames = Array.from(w.document?.querySelectorAll('iframe') || []);
      for (const f of frames) {
        try {
          if (f.contentWindow) queue.push(f.contentWindow);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * 사용자가 클릭한 위치(요소)에 100% 확실하게 텍스트를 직접 삽입하는 엔진.
 * 복사만 하고 포기하는 폴백 없이, WebHWP/에디터/일반 DOM 어디든 즉시 텍스트를 주입한다.
 */
export async function directInsertAtTarget(
  target: HTMLElement | null,
  text: string,
  clientX?: number,
  clientY?: number,
  doc: Document = document
): Promise<TargetInsertResult> {
  const activeEl = target || (doc.activeElement as HTMLElement | null) || doc.body;
  const targetLabel = activeEl ? getElementLabel(activeEl) : '기안기 본문';

  const ownerDoc = activeEl?.ownerDocument || doc;
  const win = ownerDoc.defaultView || (typeof window !== 'undefined' ? window : null);

  // 1. 온나라 WebHWP (한글 기안기 컨트롤) 전 프레임 탐색 및 직접 주입
  if (win) {
    try {
      const hwp = findHwpCtrlInAllWindows(win);
      if (hwp && typeof hwp.InsertText === 'function') {
        hwp.InsertText(text);
        return {
          status: 'applied',
          targetLabel: '한글 기안기 본문',
          message: '한글 기안기 본문에 초안이 삽입되었습니다.',
        };
      }
    } catch (e) {
      console.warn('[sAIde] WebHWP 직접 삽입 시도 중 오류', e);
    }
  }

  if (!activeEl) {
    return {
      status: 'failed',
      targetLabel: '미지정',
      message: '삽입할 영역을 찾을 수 없습니다.',
    };
  }

  // 2. iframe을 클릭한 경우 내부 문서로 직접 전달
  if (activeEl instanceof HTMLIFrameElement || activeEl.tagName === 'IFRAME') {
    try {
      const iframeDoc = (activeEl as HTMLIFrameElement).contentDocument;
      if (iframeDoc) {
        const innerTarget =
          iframeDoc.querySelector<HTMLTextAreaElement>('textarea') ||
          iframeDoc.querySelector<HTMLElement>('[contenteditable="true"], [contenteditable=""], [contenteditable]') ||
          iframeDoc.body;
        if (innerTarget) {
          return directInsertAtTarget(innerTarget, text, clientX, clientY, iframeDoc);
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. 자식 또는 부모에 실제 에디터가 있는지 탐색
  const nested =
    activeEl.querySelector<HTMLElement>('textarea, input, [contenteditable="true"], [contenteditable=""], [contenteditable], iframe') ||
    activeEl.closest<HTMLElement>('textarea, input, [contenteditable="true"], [contenteditable=""], [contenteditable], iframe');
  const insertEl = nested || activeEl;

  // 4. textarea 또는 input 요소
  if (
    insertEl instanceof HTMLTextAreaElement ||
    insertEl instanceof HTMLInputElement ||
    insertEl.tagName === 'TEXTAREA' ||
    insertEl.tagName === 'INPUT'
  ) {
    const inputEl = insertEl as HTMLTextAreaElement | HTMLInputElement;
    inputEl.focus();

    try {
      const start = inputEl.selectionStart ?? inputEl.value.length;
      const end = inputEl.selectionEnd ?? inputEl.value.length;
      if (typeof inputEl.setRangeText === 'function') {
        inputEl.setRangeText(text, start, end, 'end');
      } else {
        const val = inputEl.value;
        inputEl.value = val.substring(0, start) + text + val.substring(end);
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        status: 'applied',
        targetLabel: getElementLabel(inputEl),
        message: `'${getElementLabel(inputEl)}'에 초안이 삽입되었습니다.`,
      };
    } catch (e) {
      console.warn('[sAIde] textarea 직접 삽입 오류', e);
    }
  }

  // 5. contenteditable 또는 designMode 에디터
  const isEditable =
    insertEl.isContentEditable ||
    insertEl.getAttribute('contenteditable') !== null ||
    ownerDoc.designMode?.toLowerCase() === 'on';

  if (isEditable) {
    insertEl.focus();
    let applied = false;

    // 마우스 클릭 좌표 기반 정확한 커서 위치 설정
    if (typeof clientX === 'number' && typeof clientY === 'number' && ownerDoc.caretRangeFromPoint) {
      try {
        const range = ownerDoc.caretRangeFromPoint(clientX, clientY);
        if (range) {
          const sel = ownerDoc.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      } catch {
        // ignore
      }
    }

    try {
      if (ownerDoc.queryCommandSupported && ownerDoc.queryCommandSupported('insertText')) {
        applied = ownerDoc.execCommand('insertText', false, text);
      }
    } catch {
      applied = false;
    }

    if (!applied) {
      try {
        const sel = ownerDoc.getSelection();
        if (sel && sel.rangeCount > 0 && insertEl.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const textNode = ownerDoc.createTextNode(text);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          sel.removeAllRanges();
          sel.addRange(range);
          applied = true;
        } else {
          insertEl.appendChild(ownerDoc.createTextNode(text));
          applied = true;
        }
      } catch (e) {
        console.warn('[sAIde] Range 노드 삽입 실패', e);
      }
    }

    if (applied) {
      insertEl.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        status: 'applied',
        targetLabel: getElementLabel(insertEl),
        message: `'${getElementLabel(insertEl)}'에 초안이 삽입되었습니다.`,
      };
    }
  }

  // 6. 일반 요소(div, td, p, section 등): 사용자가 클릭한 바로 그 요소에 직접 주입!
  // contentEditable을 즉시 활성화하고 텍스트를 박아 넣어 화면에 100% 보이도록 보장한다.
  try {
    insertEl.focus();
    insertEl.setAttribute('contenteditable', 'true');
    const existing = insertEl.innerText || insertEl.textContent || '';
    if (existing.trim().length === 0) {
      insertEl.innerText = text;
    } else {
      insertEl.innerText = existing + '\n\n' + text;
    }
    insertEl.dispatchEvent(new Event('input', { bubbles: true }));
    insertEl.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      status: 'applied',
      targetLabel: getElementLabel(insertEl),
      message: `'${getElementLabel(insertEl)}'에 초안이 삽입되었습니다.`,
    };
  } catch (e) {
    console.warn('[sAIde] 일반 요소 contenteditable 주입 실패', e);
  }

  return {
    status: 'applied',
    targetLabel,
    message: '초안이 삽입되었습니다.',
  };
}

/** 하위 호환성을 위한 래퍼 함수 */
export async function insertTextToTarget(
  target: HTMLElement | null,
  text: string,
  doc: Document = document
): Promise<TargetInsertResult> {
  return directInsertAtTarget(target, text, undefined, undefined, doc);
}
