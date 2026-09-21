import { assertCurrent, validAction, validControl } from '@/lib/browser/guards';
import { createApprovalRegistry } from '@/lib/browser/approval';
import { requiresApproval, type RequestControl } from '@/lib/messaging/protocol';
/**
 * 주입 스크립트 — 본문 추출과 DOM 조작. 계획서 §5 Phase 3-1 / 5
 *
 * 온디맨드로만 주입된다(background.ts의 executeScript). 상시 주입하지 않는 이유는
 * 성능·프라이버시·심사 셋 다 불리하기 때문이다. 계획서 §3 설계 결정 ②.
 *
 * ★ defineContentScript가 아니라 defineUnlistedScript다.
 *
 * defineContentScript는 `matches`를 manifest의 host_permissions로 승격시키는데,
 * `<all_urls>`가 박히면 설계 결정 ②(상시 주입 금지)가 무의미해지고 심사·프라이버시
 * 모두 불리해진다. unlisted script는 번들만 만들고 manifest에 등록하지 않으므로,
 * background가 허용된 사이트 권한으로 executeScript 할 때만 실제로 주입된다.
 */

import { Readability } from '@mozilla/readability';
import { clickAttachment, listAttachments, scanAttachments } from '@/lib/onnara/attachments';
import { captureDocumentListLocation, captureListLocation, restoreDocumentListLocation } from '@/lib/onnara/document-navigation';
import { fetchInboxPage } from '@/lib/onnara/inbox-pages';
import { fitToBudget } from '@/lib/extract/budget';
import { collectDocumentText } from '@/lib/extract/document-text';
import { findPdfUrls, readPdfSources } from '@/lib/extract/pdf-source';
import {
  extractStructuredDocumentList,
  describeOpenFailure,
  describeOpenTarget,
  findDocumentOpenTarget,
  openDocumentTarget,
  serializeDocumentList,
} from '@/lib/onnara/document-list';
import {
  extractYouTubeCaption,
  isYouTubeWatch,
  youTubeMeta,
} from '@/lib/extract/youtube';
import type {
  ActionResult,
  ContentToSW,
  ExtractedPage,
  ExtractMethod,
  PageAction,
  SWToContent,
} from '@/lib/messaging/protocol';

/** 재주입 가드용 전역 플래그. */
declare global {
  interface Window {
    __saideInjected?: () => boolean;
  }
}

const approvals = createApprovalRegistry(resolveTarget, describe);
const cancelled = new Map<string, number>();

export default defineUnlistedScript(() => {
  // background는 요청마다 executeScript를 호출한다(이미 주입됐는지 알 수 없으므로).
  // 가드가 없으면 리스너가 중첩되어 같은 요청에 여러 번 응답하게 된다.
  // 확장을 다시 불러와도 열려 있던 페이지에는 이전 인스턴스의 전역 값이 남는다.
  // 단순 true 플래그면 새 스크립트가 리스너를 등록하지 못해 페이지를 새로 고칠 때까지 모든 읽기가 실패한다.
  // 이전 인스턴스의 런타임이 아직 유효할 때만 재주입을 건너뛴다.
  if (window.__saideInjected?.()) return;
  const runtime = chrome.runtime;
  window.__saideInjected = () => { try { return Boolean(runtime?.id); } catch { return false; } };

  chrome.runtime.onMessage.addListener((msg: SWToContent, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || !validControl(msg.control)) return false;
    for (const [id, until] of cancelled) if (until <= Date.now()) cancelled.delete(id);
    if (msg.type === 'CANCEL') {
      if (cancelled.size >= 1000) cancelled.delete(cancelled.keys().next().value!);
      cancelled.set(msg.control.id, msg.control.deadline);
      sendResponse({ type: 'FAILED', error: { code: 'ABORTED', message: '작업이 취소되었습니다.' } } satisfies ContentToSW);
      return false;
    }
    // 자막 추출이 비동기라 handler 전체를 Promise로 감싼다.
    (async () => {
      try {
        assertCurrent(msg.control, location.href, cancelled.has(msg.control.id));
        if (msg.type === 'PREPARE' && validAction(msg.action)) {
          sendResponse({ type: 'PREPARED', ...approvals.prepare(msg.action, msg.control) } satisfies ContentToSW);
        } else if (msg.type === 'EXTRACT') {
          const payload = await extractPage(msg.budgetTokens, msg.purpose);
          // 본문이 PDF 뷰어로 떠 있으면 DOM에는 글자가 없다. 원본을 받아 서비스 워커가 글자로 바꾸게 한다.
          const pdfUrls = payload.structuredData ? [] : findPdfUrls();
          const pdf = pdfUrls.length ? await readPdfSources(pdfUrls) : [];
          sendResponse({ type: 'EXTRACTED', payload, ...(pdf.length ? { pdf } : {}) } satisfies ContentToSW);
        } else if (msg.type === 'LOCATE_DOCUMENT') {
          const location = captureDocumentListLocation(msg.title);
          sendResponse(location
            ? { type: 'DOCUMENT_LOCATED', location } satisfies ContentToSW
            : {
                type: 'FAILED',
                error: {
                  code: 'UNKNOWN',
                  message: `현재 목록에서 문서를 하나로 식별할 수 없습니다: ${msg.title}`,
                  hint: describeOpenFailure(msg.title),
                },
              } satisfies ContentToSW);
        } else if (msg.type === 'LOCATE_INBOX') {
          /**
           * ★ 이 프레임이 실제로 목록을 그리고 있을 때만 응답한다. 온나라 화면은 프레임이
           *   여럿이라, 아무 프레임이나 위치를 돌려주면 나중에 목록 없는 화면을 복원한다.
           *
           * ★ 이름이 `받은문서`인지는 여기서 따지지 않는다. 온나라는 화면 제목을 목록과
           *   **다른 프레임**에 그리는 경우가 있어, 목록 프레임 안에서는 그 이름이 보이지 않는다.
           *   무엇보다 이 요청은 사용자가 그 화면을 보면서 직접 누른 것이다 — 무엇을 지정했는지는
           *   읽어 낸 이름으로 화면에 되보여 주고, 아니면 다시 지정하게 한다.
           */
          const list = extractStructuredDocumentList();
          // 행이 없어도 목록이다. 받은문서가 0건인 날에도 그 화면을 지정할 수 있어야 한다.
          const inbox = list ? captureListLocation() : null;
          sendResponse(inbox
            ? { type: 'INBOX_LOCATED', location: inbox, listName: list!.listName } satisfies ContentToSW
            : {
                type: 'FAILED',
                error: {
                  code: 'UNKNOWN',
                  message: '현재 화면에서 문서 목록을 찾지 못했습니다.',
                  hint: '온나라 공유/공람 > 받은문서 목록이 화면에 보이는 상태에서 다시 지정하세요.',
                },
              } satisfies ContentToSW);
        } else if (msg.type === 'FETCH_INBOX_PAGE') {
          const page = await fetchInboxPage(msg.location, AbortSignal.timeout(Math.max(1, Math.min(7500, msg.control.deadline - Date.now()))));
          assertCurrent(msg.control, location.href, cancelled.has(msg.control.id));
          sendResponse({ type: 'INBOX_PAGE', ...page } satisfies ContentToSW);
        } else if (msg.type === 'SCAN_ATTACHMENTS') {
          sendResponse({ type: 'ATTACHMENTS_FOUND', items: listAttachments() } satisfies ContentToSW);
        } else if (msg.type === 'GET_BODY_PDF') {
          const pdfUrls = findPdfUrls();
          const pdf = pdfUrls.length ? await readPdfSources(pdfUrls) : [];
          sendResponse({ type: 'BODY_PDF', pdf: pdf[0] ?? null } satisfies ContentToSW);
        } else if (msg.type === 'CLICK_ATTACHMENT') {
          const found = listAttachments().some(item => item.index === msg.index && item.name === msg.name);
          sendResponse({ type: 'ATTACHMENT_CLICKED', clicked: found } satisfies ContentToSW);
          // 문서 열기와 같이 응답 포트를 먼저 닫아야 같은 프레임 이동·폼 전송에도 응답이 보존된다.
          if (found) setTimeout(() => {
            if (Date.now() < msg.control.deadline && !cancelled.has(msg.control.id)) clickAttachment(msg.index, msg.name);
          }, 0);
        } else if (msg.type === 'RESTORE_DOCUMENT_LIST') {
          sendResponse({ type: 'DOCUMENT_LIST_RESTORED', restored: restoreDocumentListLocation(msg.location) } satisfies ContentToSW);
        } else if (msg.type === 'CHECK_DIALOG') {
          let message = document.documentElement?.getAttribute('data-saide-dialog')
            || (window as unknown as { __saide_dialog_message?: string }).__saide_dialog_message
            || null;
          if (!message && window.top && window.top !== window) {
            try {
              message = window.top.document.documentElement?.getAttribute('data-saide-dialog')
                || (window.top as unknown as { __saide_dialog_message?: string }).__saide_dialog_message
                || null;
            } catch {}
          }
          sendResponse({ type: 'DIALOG_CHECKED', message: message || null } satisfies ContentToSW);
        } else if (msg.type === 'OPEN_DOCUMENT') {
          installDialogInterceptor();
          const target = findDocumentOpenTarget(msg.title);
          if (!target) {
            sendResponse({
              type: 'FAILED',
              error: { code: 'UNKNOWN', message: `목록에서 문서를 하나로 식별할 수 없습니다: ${msg.title}`, hint: describeOpenFailure(msg.title) },
            } satisfies ContentToSW);
          } else {
            sendResponse({ type: 'OPENING_DOCUMENT', title: msg.title, target: describeOpenTarget(target) } satisfies ContentToSW);
            // 응답 포트가 닫힌 뒤 실행해야 같은 프레임 이동에도 성공 응답이 보존된다.
            setTimeout(() => {
              if (Date.now() < msg.control.deadline && !cancelled.has(msg.control.id)) openDocumentTarget(target);
            }, 0);
          }
        } else if (msg.type === 'ACT' && validAction(msg.action)) {
          sendResponse({
            type: 'ACTED',
            result: await performAction(msg.action, msg.control),
          } satisfies ContentToSW);
        }
      } catch (e) {
        sendResponse({
          type: 'FAILED',
          error: { code: 'UNKNOWN', message: String(e) },
        } satisfies ContentToSW);
      }
    })();
    return true; // 비동기 응답을 쓰겠다는 신호
  });
});

/* ── 추출 ──────────────────────────────────────────────── */

async function extractPage(budgetTokens: number, purpose: 'page' | 'document-detail' = 'page'): Promise<ExtractedPage> {
  let raw = '';
  let method: ExtractMethod = 'readability';
  const structuredData = extractStructuredDocumentList();

  // 온나라 목록은 일반 본문보다 먼저 구조화한다. innerText는 행·열 관계를 잃는다.
  if (structuredData) {
    raw = serializeDocumentList(structuredData);
    method = 'onnara-document-list';
  } else if (purpose === 'document-detail') {
    // 문서 상세는 리더 모드로 거르지 않고 보이는 본문 전체(같은 출처 하위 프레임 포함)를 읽는다.
    raw = collectDocumentText();
    method = 'innerText';
  }

  // ① 유튜브는 Readability로 아무것도 못 건진다. 자막을 먼저 시도한다.
  if (!raw && isYouTubeWatch(location.href)) {
    const caption = await extractYouTubeCaption();
    if (caption) {
      raw = `${youTubeMeta()}\n\n${caption}`;
      method = 'youtube-caption';
    }
  }

  // ② 리더 모드
  if (!raw) {
    try {
      // Readability는 문서를 파괴적으로 수정하므로 반드시 복제본에 돌린다.
      const clone = document.cloneNode(true) as Document;
      const article = new Readability(clone).parse();
      raw = article?.textContent?.trim() ?? '';
    } catch {
      raw = '';
    }
  }

  // ③ 폴백 — 리더 모드가 실패하는 페이지(SPA, 대시보드 등)가 흔하다.
  if (!structuredData && raw.length < 200) {
    raw = document.body?.innerText?.trim() ?? '';
    method = 'innerText';
  }

  const normalized = raw.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ');
  const budgeted = fitToBudget(normalized, budgetTokens);

  return {
    url: location.href,
    title: document.title,
    text: budgeted.text,
    charCount: normalized.length,
    truncated: budgeted.truncated,
    keptRatio: budgeted.keptRatio,
    estimatedTokens: budgeted.estimatedTokens,
    method,
    extractedAt: Date.now(),
    structuredData: structuredData ?? undefined,
    attachments: scanAttachments(),
  };
}

/* ── 액션 (Phase 5) ────────────────────────────────────── */

/**
 * ★ 여기서는 문장을 만들지 않는다. 무슨 일이 있었는지(code)와 그에 딸린
 *   값(vars)만 돌려준다. 문구는 패널이 로케일에 맞춰 만든다.
 */
export async function performAction(action: PageAction, control: RequestControl): Promise<ActionResult> {
  assertCurrent(control, location.href);
  if (requiresApproval(action)) approvals.consume(action, control);
  switch (action.kind) {
    case 'read_page': {
      const p = await extractPage(2000);
      return { ok: true, code: 'read', text: p.text };
    }

    case 'find_element': {
      const el = findByText(action.query);
      return el
        ? { ok: true, code: 'found', vars: { target: describe(el) } }
        : { ok: false, code: 'notFound', vars: { query: action.query } };
    }

    /**
     * 승인 카드에 보여줄 대상 요소를 미리 확인한다. 부작용 없음.
     * 클릭·입력을 승인받기 **전에** 무엇을 건드리는지 알아야 하므로 필요하다.
     */
    case 'describe_target': {
      const el = resolveTarget(action.selector);
      return el
        ? { ok: true, code: 'described', vars: { target: describe(el) } }
        : { ok: false, code: 'noElement', vars: { selector: action.selector } };
    }

    case 'scroll': {
      const amount = action.amount ?? window.innerHeight * 0.8;
      if (action.direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (action.direction === 'bottom')
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      else
        window.scrollBy({
          top: action.direction === 'down' ? amount : -amount,
          behavior: 'smooth',
        });
      return { ok: true, code: 'scrolled', vars: { direction: action.direction } };
    }

    case 'click': {
      const el = resolveTarget(action.selector);
      if (!el) return { ok: false, code: 'noElement', vars: { selector: action.selector } };
      el.click();
      return { ok: true, code: 'clicked', vars: { target: describe(el) } };
    }

    case 'type_text': {
      const found = resolveTarget(action.selector);
      if (!found) return { ok: false, code: 'noElement', vars: { selector: action.selector } };
      if (!isTextInput(found)) {
        // 어디에 썼는지 모르는 상태로 성공을 보고하지 않는다.
        return { ok: false, code: 'notTextInput', vars: { target: describe(found) } };
      }
      const el = found;
      el.focus();
      const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, action.text);
      // React 등 프레임워크가 상태를 갱신하도록 실제 이벤트를 발생시킨다.
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, code: 'typed', vars: { target: describe(el) } };
    }

    case 'navigate':
      if (!['http:', 'https:'].includes(new URL(action.url).protocol)) throw new Error('허용되지 않은 주소입니다.');
      location.assign(action.url);
      return { ok: true, code: 'navigated', vars: { url: action.url } };
  }
}

/**
 * 선택자 문자열을 실제 요소로 해석한다.
 *
 * ★ 2.3B 모델은 CSS 선택자를 제대로 못 만든다. `selector` 자리에 "로그인 버튼"
 *   같은 사람 말이 들어오는 것이 정상 경로에 가깝다. 그래서 ① CSS로 먼저 찾고
 *   ② 실패하면 화면에 보이는 글자로 찾는다. 툴 스키마의 설명도 그렇게 써 두었다.
 *
 * ★ 승인 카드(describe_target)와 실제 실행(click/type_text)이 **반드시 같은
 *   함수**를 써야 한다. 다르게 찾으면 사용자가 승인한 것과 실행되는 것이
 *   달라진다 — 승인 게이트가 있으나 마나 해진다.
 */
function resolveTarget(selector: string): HTMLElement | null {
  try {
    const matches = [...document.querySelectorAll<HTMLElement>(selector)].filter(isUsable);
    if (matches.length > 0) return matches.length === 1 ? matches[0]! : null;
  } catch {
    // 선택자로 성립하지 않는 문자열이다. 사람 말로 보고 아래에서 다시 찾는다.
  }
  return findByText(selector);
}

function isUsable(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return el.isConnected && !el.closest('[inert]') && !el.matches(':disabled, [aria-disabled="true"]') && style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
}

function isTextInput(el: HTMLElement): el is HTMLInputElement | HTMLTextAreaElement {
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && (el.readOnly || el.disabled)) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag !== 'input') return false;
  // 체크박스·라디오·파일 입력에 value를 밀어 넣으면 조용히 이상해진다.
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'file', 'submit', 'button', 'image', 'range', 'color'].includes(type);
}

/** 사람이 쓰는 말로 요소를 찾는다. 소형 모델이 CSS 선택자를 잘 못 만들기 때문. */
function findByText(query: string): HTMLElement | null {
  const q = query.trim().toLowerCase();
  const candidates = document.querySelectorAll<HTMLElement>(
    'button, a, input, textarea, select, [role="button"], [role="link"]',
  );
  const matches: HTMLElement[] = [];
  for (const el of candidates) {
    if (!isUsable(el)) continue;
    const label = (
      el.innerText ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      ''
    )
      .trim()
      .toLowerCase();
    if (label && label.includes(q)) matches.push(el);
  }
  return matches.length === 1 ? matches[0]! : null;
}

/** 승인 카드에 보여줄 사람이 읽는 요소 설명. */
function describe(el: HTMLElement): string {
  const label = (
    el.innerText ||
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('name') ||
    ''
  ).trim();
  const tag = el.tagName.toLowerCase();
  return label ? `<${tag}> "${label.slice(0, 60)}"` : `<${tag}>`;
}

/** 온나라 스크립트의 alert/confirm/prompt 팝업을 가로채 브라우저 멈춤을 방지하고 메시지를 기록한다. */
function installDialogInterceptor(): void {
  if (typeof document === 'undefined') return;
  try {
    document.documentElement.removeAttribute('data-saide-dialog');
    (window as unknown as { __saide_dialog_message?: string | null }).__saide_dialog_message = null;
    if (window.top && window.top !== window) {
      try {
        window.top.document.documentElement.removeAttribute('data-saide-dialog');
        (window.top as unknown as { __saide_dialog_message?: string | null }).__saide_dialog_message = null;
      } catch {}
    }
  } catch {}

  const hookTarget = (w: Window | null | undefined) => {
    try {
      if (!w) return;
      w.alert = function (msg: unknown) {
        try {
          const text = String(msg ?? '').trim();
          document.documentElement.setAttribute('data-saide-dialog', text);
          (window as unknown as { __saide_dialog_message?: string }).__saide_dialog_message = text;
        } catch {}
        console.warn('[sAIde] Intercepted alert:', msg);
      };
      w.confirm = function (msg: unknown) {
        try {
          const text = String(msg ?? '').trim();
          document.documentElement.setAttribute('data-saide-dialog', text);
          (window as unknown as { __saide_dialog_message?: string }).__saide_dialog_message = text;
        } catch {}
        return false;
      };
      w.prompt = function (msg: unknown) {
        try {
          const text = String(msg ?? '').trim();
          document.documentElement.setAttribute('data-saide-dialog', text);
          (window as unknown as { __saide_dialog_message?: string }).__saide_dialog_message = text;
        } catch {}
        return null;
      };
    } catch {}
  };

  hookTarget(window);
  try { hookTarget(window.parent); } catch {}
  try { hookTarget(window.top); } catch {}

  if (document.getElementById('__saide_dialog_interceptor__')) return;
  try {
    const script = document.createElement('script');
    script.id = '__saide_dialog_interceptor__';
    script.textContent = `(() => {
      const record = (msg) => {
        try {
          const text = String(msg ?? '').trim();
          if (!text) return;
          document.documentElement.setAttribute('data-saide-dialog', text);
          window.__saide_dialog_message = text;
          if (window.top && window.top !== window) {
            try { window.top.document.documentElement.setAttribute('data-saide-dialog', text); window.top.__saide_dialog_message = text; } catch {}
          }
          if (window.parent && window.parent !== window) {
            try { window.parent.document.documentElement.setAttribute('data-saide-dialog', text); window.parent.__saide_dialog_message = text; } catch {}
          }
        } catch {}
      };
      const hook = (w) => {
        try {
          if (!w) return;
          w.alert = function (msg) { record(msg); };
          w.confirm = function (msg) { record(msg); return false; };
          w.prompt = function (msg) { record(msg); return null; };
        } catch {}
      };
      hook(window);
      try { hook(window.parent); } catch {}
      try { hook(window.top); } catch {}
    })();`;
    (document.head || document.documentElement).appendChild(script);
  } catch {}
}
