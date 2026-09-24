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
import { draftToHtml, createDomFragmentFromText, insertMultilineIntoHwp } from './draft-format';

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
    let applied = false;
    const html = draftToHtml(op.text);

    try {
      if (ownerDoc.queryCommandSupported && ownerDoc.queryCommandSupported('insertHTML')) {
        applied = ownerDoc.execCommand('insertHTML', false, html);
      }
    } catch {}

    if (!applied) {
      try {
        if (ownerDoc.queryCommandSupported && ownerDoc.queryCommandSupported('insertText')) {
          applied = ownerDoc.execCommand('insertText', false, op.text);
        }
      } catch {}
    }

    if (!applied) {
      el.appendChild(createDomFragmentFromText(ownerDoc, op.text));
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
  return isHwpElementOrContainer(el);
}

/** 요소 또는 상위/하위가 한컴 WebHWP 관련 요소인지 검사 */
export function isHwpElementOrContainer(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'OBJECT' || tag === 'EMBED' || tag === 'CANVAS') return true;
  const id = (el.id || '').toLowerCase();
  const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
  if (
    id.includes('hwp') ||
    id.includes('tbcontent') ||
    cls.includes('hwp') ||
    cls.includes('tbcontent') ||
    cls.includes('webhwp')
  ) {
    return true;
  }
  return false;
}

/**
 * 이전에 사용자의 클릭 등으로 외곽 레이아웃 div에 우발적으로 부여된 contenteditable 속성 복구
 */
export function cleanupAccidentalContentEditable(doc: Document = document): void {
  try {
    const editables = Array.from(doc.querySelectorAll<HTMLElement>('[contenteditable="true"]'));
    for (const el of editables) {
      const tag = el.tagName.toUpperCase();
      if (tag === 'DIV' || tag === 'TD' || tag === 'BODY' || tag === 'SPAN') {
        const id = (el.id || '').toLowerCase();
        const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
        if (!id.includes('editor') && !cls.includes('editor')) {
          el.removeAttribute('contenteditable');
        }
      }
    }
  } catch {
    // ignore
  }
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
  if (isHwpElementOrContainer(el)) {
    return '한글 기안기 본문';
  }
  return '본문 영역';
}

/**
 * 윈도우 및 모든 중첩 iframe에서 WebHWP(한글 기안기) 컨트롤 객체 탐색
 */
export function findHwpCtrlInAllWindows(startWin: Window): any {
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
      const candidates = [
        (w as any).HwpCtrl,
        (w as any).pHwpCtrl,
        (w as any).tbContentElement,
        (w as any).vHwpCtrl,
        (w as any).hwpCtrl,
        (w as any).hwp_ctrl,
        (w as any).hwpDoc,
        (w as any).WebHwpCtrl,
        (w as any).HwpObject,
        w.document?.getElementById('HwpCtrl'),
        w.document?.getElementById('hwpCtrl'),
        w.document?.getElementById('tbContentElement'),
      ];

      for (const h of candidates) {
        if (
          h &&
          (typeof h.PutFieldText === 'function' ||
            typeof h.InsertText === 'function' ||
            typeof h.Run === 'function' ||
            typeof h.CreateAction === 'function')
        ) {
          return h;
        }
      }

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
 * WebHWP 객체에 누름틀(Field) -> 커서 직접 입력 -> Action -> Paste 순서로 삽입 시도
 */
export function tryApplyHwpCtrl(
  hwp: any,
  text: string
): { success: boolean; method?: string; fieldName?: string } {
  if (!hwp) return { success: false };

  // 1. 현재 커서(클릭 위치) 직접 입력 (최우선: 줄바꿈/문단 보존 BreakPara 적용)
  if (typeof hwp.InsertText === 'function' || typeof hwp.CreateAction === 'function') {
    try {
      const ok = insertMultilineIntoHwp(hwp, text);
      if (ok) return { success: true, method: 'InsertText' };
    } catch {
      // 다음 방식 시도
    }
  }

  // 2. 누름틀(Field) 방식 시도: 기존 내용을 절대 대체하지 않고 필드 끝으로 이동(select=false)하여 추가 삽입
  const fieldCandidates = ['본문', 'body', 'BODY', 'content', '기안문본문', '기안문_본문', '내용', '본문내용'];
  for (const fn of fieldCandidates) {
    try {
      const exists = typeof hwp.FieldExist === 'function' ? Boolean(hwp.FieldExist(fn)) : false;
      if (exists && typeof hwp.MoveToField === 'function') {
        // start: false (끝 위치), select: false (기존 내용 선택/삭제 금지)
        hwp.MoveToField(fn, true, false, false);
        const ok = insertMultilineIntoHwp(hwp, text);
        if (ok) {
          return { success: true, method: 'MoveToFieldEnd+InsertText', fieldName: fn };
        }
        if (typeof hwp.Run === 'function') {
          hwp.Run('Paste');
          return { success: true, method: 'MoveToFieldEnd+RunPaste', fieldName: fn };
        }
      }
    } catch {
      // 다음 후보 시도
    }
  }

  // 3. Run("Paste") 방식 (현재 커서 위치)
  if (typeof hwp.Run === 'function') {
    try {
      hwp.Run('Paste');
      return { success: true, method: 'RunPaste' };
    } catch {
      // ignore
    }
  }

  return { success: false };
}

/**
 * 웹페이지 메인 월드(Main World) 컨텍스트에서 한컴 웹기안기(WebHWP) API를 탐색하여 초안을 삽입한다.
 */
export async function insertViaMainWorldHwp(
  text: string,
  doc: Document = document
): Promise<{ success: boolean; method?: string; fieldName?: string; error?: string }> {
  // 1. 서비스 워커(background.ts)를 통해 CSP를 우회하고 모든 프레임의 메인 월드에서 HwpCtrl 실행 (최우선)
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'DRAFT_MAIN_WORLD_HWP_INSERT',
        text,
      });
      if (resp && resp.success) {
        return resp;
      }
    } catch {
      // background 미응답 시 폴백
    }
  }

  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (!win) return { success: false, error: 'NO_WINDOW' };

  // 2. 현재 윈도우 스코프(또는 jsdom 테스트 환경)에서 이미 HwpCtrl 객체에 접근 가능한 경우
  try {
    const directHwp = findHwpCtrlInAllWindows(win);
    if (directHwp) {
      const res = tryApplyHwpCtrl(directHwp, text);
      if (res.success) return res;
    }
  } catch {
    // ignore
  }

  // 2. 브라우저 실제 환경: 메인 월드(Main World)에 스크립트를 주입하여 HwpCtrl 전역 객체 제어
  if (typeof doc.createElement !== 'function') {
    return { success: false, error: 'NO_DOM' };
  }

  return new Promise(resolve => {
    const eventId = 'SAIDE_HWP_INJECT_' + Math.random().toString(36).substring(2, 9);
    let resolved = false;

    const cleanup = () => {
      if (typeof win.removeEventListener === 'function') {
        win.removeEventListener(eventId, onResponse as any);
      }
    };

    const onResponse = (e: CustomEvent) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(e.detail || { success: false });
    };

    if (typeof win.addEventListener === 'function') {
      win.addEventListener(eventId, onResponse as any);
    }

    // 1.2초 타임아웃
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({ success: false, error: 'TIMEOUT' });
      }
    }, 1200);

    try {
      const script = doc.createElement('script');
      script.textContent = `
        (function() {
          var evtName = ${JSON.stringify(eventId)};
          var draft = ${JSON.stringify(text)};

          function send(data) {
            try {
              window.dispatchEvent(new CustomEvent(evtName, { detail: data }));
            } catch (e) {}
          }

          try {
            function findHwp() {
              var wins = [window];
              try {
                if (window.top && window.top !== window) wins.push(window.top);
                if (window.parent && window.parent !== window) wins.push(window.parent);
              } catch (e) {}

              try {
                var ifrs = document.querySelectorAll('iframe');
                for (var i = 0; i < ifrs.length; i++) {
                  try {
                    if (ifrs[i].contentWindow) wins.push(ifrs[i].contentWindow);
                  } catch (e) {}
                }
              } catch (e) {}

              for (var j = 0; j < wins.length; j++) {
                var w = wins[j];
                try {
                  var list = [
                    w.HwpCtrl,
                    w.pHwpCtrl,
                    w.tbContentElement,
                    w.vHwpCtrl,
                    w.hwpCtrl,
                    w.hwp_ctrl,
                    w.hwpDoc,
                    w.WebHwpCtrl,
                    w.HwpObject,
                    w.document && w.document.getElementById('HwpCtrl'),
                    w.document && w.document.getElementById('hwpCtrl'),
                    w.document && w.document.getElementById('tbContentElement')
                  ];
                  for (var k = 0; k < list.length; k++) {
                    var c = list[k];
                    if (c && (typeof c.PutFieldText === 'function' || typeof c.InsertText === 'function' || typeof c.Run === 'function' || typeof c.CreateAction === 'function')) {
                      return c;
                    }
                  }
                } catch (e) {}
              }
              return null;
            }

            var h = findHwp();
            if (!h) {
              send({ success: false, error: 'NO_HWP' });
              return;
            }

            // 동일 컨트롤에 대한 1.5초 내 중복 실행 차단
            var now = Date.now();
            if (h.__saide_last_inserted && now - h.__saide_last_inserted < 1500) {
              send({ success: true, method: 'Deduplicated' });
              return;
            }
            h.__saide_last_inserted = now;

            function insertLines(hwp, str) {
              var lines = str.split(/\r?\n/);
              if (lines.length <= 1) {
                if (typeof hwp.InsertText === 'function') {
                  hwp.InsertText(str);
                  return true;
                }
                if (typeof hwp.CreateAction === 'function') {
                  var act = hwp.CreateAction('InsertText');
                  if (act && typeof act.CreateSet === 'function') {
                    var st = act.CreateSet();
                    if (st && typeof st.SetItem === 'function') {
                      st.SetItem('Text', str);
                      act.Execute(st);
                      return true;
                    }
                  }
                }
                return false;
              }

              var any = false;
              for (var j = 0; j < lines.length; j++) {
                var l = lines[j];
                if (l.length > 0) {
                  if (typeof hwp.InsertText === 'function') {
                    hwp.InsertText(l);
                    any = true;
                  } else if (typeof hwp.CreateAction === 'function') {
                    var a = hwp.CreateAction('InsertText');
                    if (a && typeof a.CreateSet === 'function') {
                      var s = a.CreateSet();
                      if (s && typeof s.SetItem === 'function') {
                        s.SetItem('Text', l);
                        a.Execute(s);
                        any = true;
                      }
                    }
                  }
                }
                if (j < lines.length - 1) {
                  if (typeof hwp.Run === 'function') {
                    hwp.Run('BreakPara');
                    any = true;
                  } else if (hwp.HAction && typeof hwp.HAction.Run === 'function') {
                    hwp.HAction.Run('BreakPara');
                    any = true;
                  }
                }
              }
              return any;
            }

            // A. 현재 커서(클릭 위치) 직접 입력 (최우선: 문단 줄바꿈 보존 BreakPara 적용)
            if (typeof h.InsertText === 'function' || typeof h.CreateAction === 'function') {
              try {
                if (insertLines(h, draft)) {
                  send({ success: true, method: 'InsertLinesWithBreakPara' });
                  return;
                }
              } catch (e) {}
            }

            // B. 누름틀(Field) 방식 시도: 기존 내용을 절대 대체하지 않고 필드 끝으로 이동(select=false)하여 추가 삽입
            var fields = ['본문', 'body', 'BODY', 'content', '기안문본문', '기안문_본문', '내용', '본문내용'];
            for (var f = 0; f < fields.length; f++) {
              var fn = fields[f];
              try {
                var exist = typeof h.FieldExist === 'function' ? Boolean(h.FieldExist(fn)) : false;
                if (exist && typeof h.MoveToField === 'function') {
                  h.MoveToField(fn, true, false, false);
                  if (insertLines(h, draft)) {
                    send({ success: true, method: 'MoveToFieldEnd+InsertLines', fieldName: fn });
                    return;
                  }
                  if (typeof h.Run === 'function') {
                    h.Run('Paste');
                    send({ success: true, method: 'MoveToFieldEnd+RunPaste', fieldName: fn });
                    return;
                  }
                }
              } catch (e) {}
            }

            // C. Run('Paste') 방식 (현재 커서 위치)
            if (typeof h.Run === 'function') {
              try {
                h.Run('Paste');
                send({ success: true, method: 'RunPaste' });
                return;
              } catch (e) {}
            }

            send({ success: false, error: 'NO_VALID_HWP_METHOD' });
          } catch (err) {
            send({ success: false, error: String(err) });
          }
        })();
      `;
      const root = doc.head || doc.documentElement || doc.body;
      if (root) {
        root.appendChild(script);
        script.remove();
      } else {
        clearTimeout(timer);
        resolve({ success: false, error: 'NO_ROOT' });
      }
    } catch (e) {
      clearTimeout(timer);
      resolve({ success: false, error: String(e) });
    }
  });
}

/**
 * 사용자가 클릭한 위치(요소)에 100% 안전하게 텍스트를 삽입하는 엔진.
 * WebHWP/에디터/텍스트필드에 정확히 주입하며, 일반 layout div는 오염시키지 않고 안전한 클립보드 안내로 폴백한다.
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

  // 1. 온나라 WebHWP (한글 기안기 컨트롤) 직접 주입 (메인 월드 브리지 + 로컬 스코프)
  const isHwpCandidate =
    isHwpElementOrContainer(activeEl) ||
    Boolean(win && findHwpCtrlInAllWindows(win)) ||
    (typeof location !== 'undefined' && /addoreportbodyview\.do|addhwpbody\.do|hwpctrl\.do/i.test(location.href));

  if (isHwpCandidate) {
    try {
      const hwpRes = await insertViaMainWorldHwp(text, ownerDoc);
      if (hwpRes.success) {
        const label = hwpRes.fieldName ? `한글 기안기 본문(${hwpRes.fieldName})` : '한글 기안기 본문';
        return {
          status: 'applied',
          targetLabel: label,
          message: `${label}에 초안이 삽입되었습니다.`,
        };
      }
    } catch (e) {
      console.warn('[sAIde] WebHWP 메인 월드 삽입 실패', e);
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

  // 5. 원래부터 편집 가능한 실제 contenteditable 또는 designMode 에디터
  const isEditable =
    insertEl.isContentEditable ||
    insertEl.getAttribute('contenteditable') === 'true' ||
    insertEl.getAttribute('contenteditable') === '' ||
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

    const html = draftToHtml(text);
    try {
      if (ownerDoc.queryCommandSupported && ownerDoc.queryCommandSupported('insertHTML')) {
        applied = ownerDoc.execCommand('insertHTML', false, html);
      }
    } catch {
      applied = false;
    }

    if (!applied) {
      try {
        if (ownerDoc.queryCommandSupported && ownerDoc.queryCommandSupported('insertText')) {
          applied = ownerDoc.execCommand('insertText', false, text);
        }
      } catch {
        applied = false;
      }
    }

    if (!applied) {
      try {
        const sel = ownerDoc.getSelection();
        if (sel && sel.rangeCount > 0 && insertEl.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          if (!range.collapsed) {
            range.collapse(false);
          }
          const frag = createDomFragmentFromText(ownerDoc, text);
          range.insertNode(frag);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
          applied = true;
        } else {
          insertEl.appendChild(createDomFragmentFromText(ownerDoc, text));
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

  // 6. 안전 폴백: 일반 요소(div, td, body 등)에 절대 contenteditable을 부여하지 않는다!
  // 클립보드에 이미 초안이 사전 복사되어 있으므로, 포커스 및 붙여넣기를 시도하고 친절한 안내를 제공한다.
  try {
    insertEl.focus?.();
    if (ownerDoc.queryCommandSupported && ownerDoc.queryCommandSupported('paste')) {
      ownerDoc.execCommand('paste');
    }
  } catch {
    // ignore
  }

  const isWebHwpEnv = isHwpCandidate || (typeof location !== 'undefined' && location.href.includes('bms'));
  const fallbackMsg = isWebHwpEnv
    ? '초안이 클립보드에 복사되었습니다. 한글 본문(「본문을 입력하십시오」)에서 Ctrl+V를 누르세요.'
    : `'${targetLabel}'에 복사되었습니다. 원하는 위치에서 Ctrl+V를 누르세요.`;

  return {
    status: 'clipboard-fallback',
    targetLabel,
    message: fallbackMsg,
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
