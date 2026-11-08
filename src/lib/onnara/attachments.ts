import { decodeText, extractFileBytes } from '@/lib/extract/files';
import { estimateTokens, fitToBudget } from '@/lib/extract/budget';
import { bytesToBase64, isPdfBytes, PDF_MAX_BYTES, type PdfSource } from '@/lib/extract/pdf-text';
import type { ExtractedPage } from '@/lib/messaging/protocol';
import type { CapturedOpenRequest } from './related-open-capture';

export interface AttachmentLink { name: string; url: string }
export interface AttachmentScan { links: AttachmentLink[]; unsupported: number }
/** 프레임 안에서 찾은 첨부 항목. url이 없으면 화면의 스크립트를 눌러야 받을 수 있다. */
export interface AttachmentItem { index: number; name: string; url?: string }
export interface ExtractedAttachmentText { name: string; text: string; warning?: string }

export const ATTACHMENT_MARK_ATTR = 'data-saide-attachment-target';

const CANDIDATE_SELECTOR = 'a, button, [onclick], [role="button"], [role="link"]';
const REGION_SELECTOR = [
  '[id*="attach" i]', '[class*="attach" i]', '[id*="atch" i]', '[class*="atch" i]',
  '[id*="apnd" i]', '[class*="apnd" i]', '[id*="fileList" i]', '[class*="fileList" i]',
  '[aria-label*="첨부"]', '[aria-label*="붙임"]',
].join(', ');
const FILE_NAME = /\.(hwp|hwpx|pdf|docx?|xlsx?|pptx?|zip|txt|csv|png|jpe?g|gif|odt|ods|odp)(?=$|[\s(\[])/i;
/**
 * 온나라 링크 첨부는 "처리결과(수영구, 20260916)hwpx(link).html"처럼 원본 확장자가 점 없이 이름에 붙고
 * 실제로는 .html 파일로 등록된다. 확장자만 보면 첨부가 아닌 것처럼 보이므로 따로 알아본다.
 */
const LINK_FILE_NAME = /\((?:link|링크)\)\.html?(?=$|[\s(\[])/i;

/** 첨부 목록에 쓰이는 파일 이름인지. 일반 첨부와 링크 첨부를 모두 받아들인다. */
export function isAttachmentFileName(name: string): boolean {
  return FILE_NAME.test(name) || LINK_FILE_NAME.test(name);
}

/** 링크 첨부처럼 내용이 HTML인 파일인지. 다운로드된 HTML을 오류로 볼지 가르는 데 쓴다. */
export function isHtmlAttachmentName(name: string): boolean {
  return /\.html?(?=$|[\s(\[])/i.test(name);
}

/**
 * 첨부 영역(또는 "첨부/붙임" 표지 근처)에서 파일 이름이 보이는 누를 수 있는 요소만 고른다.
 * 온나라 첨부는 대부분 href 없이 onclick 스크립트로 내려받으므로 스크립트 항목도 포함한다.
 */
export function findAttachmentElements(root: Document = document): Array<{ element: HTMLElement; name: string; url?: string }> {
  const found: Array<{ element: HTMLElement; name: string; url?: string }> = [];
  for (const element of root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)) {
    if (element.closest('[hidden], [aria-hidden="true"]')) continue;
    const name = (element.textContent || element.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    const explicit = element.hasAttribute('download');
    if (!explicit && !(isAttachmentFileName(name) && (element.closest(REGION_SELECTOR) || nearAttachmentLabel(element)))) continue;
    found.push({ element, name: name || element.getAttribute('download') || '첨부파일', url: directUrl(element, root) });
  }
  // <td onclick><a>파일.hwp</a></td>처럼 겹친 경우 실제로 누를 가장 안쪽 요소만 남긴다.
  return found.filter(item => !found.some(other => other !== item && item.element.contains(other.element)));
}

export function listAttachments(root: Document = document): AttachmentItem[] {
  const seen = new Set<string>();
  const items: AttachmentItem[] = [];
  findAttachmentElements(root).forEach((item, index) => {
    const key = item.url ?? `name:${item.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ index, name: item.name, ...(item.url ? { url: item.url } : {}) });
  });
  return items;
}

/** 목록 스캔 뒤 화면이 바뀌었을 수 있으므로 순번과 이름이 모두 맞을 때만 누른다. */
export function clickAttachment(index: number, name: string, root: Document = document): boolean {
  const item = findAttachmentElements(root)[index];
  if (!item || item.name !== name) return false;
  item.element.scrollIntoView?.({ block: 'center' });
  item.element.click();
  return true;
}

/** MAIN 월드에서 클릭 요청을 가로챌 첨부 요소에 표지를 남긴다. */
export function markAttachment(index: number, name: string, root: Document = document): boolean {
  for (const el of root.querySelectorAll(`[${ATTACHMENT_MARK_ATTR}]`)) el.removeAttribute(ATTACHMENT_MARK_ATTR);
  const item = findAttachmentElements(root)[index];
  if (!item || item.name !== name) return false;
  item.element.setAttribute(ATTACHMENT_MARK_ATTR, '1');
  return true;
}

/**
 * 첨부 표시 이름 뒤에 붙은 용량 표기(`(23KB)`, `[3K]` 등)를 떼어 실제 파일 이름을 남긴다.
 */
export function cleanAttachmentFileName(raw: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  const match = /^(.+?\.(?:hwpx|hwp|pdf|docx?|xlsx?|pptx?|zip|txt|csv|md|png|jpe?g|gif|odt|ods|odp|html?))(?=$|[\s(\[])/i.exec(trimmed);
  if (match?.[1]) return match[1].trim();
  return trimmed.replace(/\s*(?:\([\d.,]+\s*[KMGT]?B?\)|\[[\d.,]+\s*[KMGT]?B?\])+\s*$/i, '').trim() || '첨부파일';
}

/**
 * MAIN 월드에서 표지된 첨부 요소를 눌러 창을 열거나 화면을 이동하지 않고 다운로드 요청(GET/POST)만 가로챈다.
 * executeScript(MAIN)에 직접 전달되므로 외부 모듈 참조 없이 동작한다.
 */
export async function captureMarkedAttachmentRequest(attr: string): Promise<CapturedOpenRequest | null> {
  const target = document.querySelector<HTMLElement>(`[${attr}="1"]`);
  if (!target) return null;
  target.removeAttribute(attr);

  let captured: CapturedOpenRequest | null = null;
  const fields = (form: HTMLFormElement): Array<[string, string]> =>
    [...new FormData(form)].filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  const fakeWindow = { closed: false, name: '', focus() {}, blur() {}, close() {}, opener: window, location: { href: 'about:blank' } };
  const original = {
    open: window.open,
    submit: HTMLFormElement.prototype.submit,
    requestSubmit: HTMLFormElement.prototype.requestSubmit,
    anchorClick: HTMLAnchorElement.prototype.click,
    alert: window.alert,
    confirm: window.confirm,
  };
  window.open = ((url?: string | URL, name?: string) => {
    fakeWindow.name = name ?? '';
    const href = url ? new URL(String(url), location.href).href : '';
    if (href && href !== 'about:blank' && !captured) captured = { method: 'GET', url: href, fields: [] };
    return fakeWindow as unknown as Window;
  }) as typeof window.open;
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    if (!captured) {
      captured = {
        method: (this.getAttribute('method') || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
        url: new URL(this.getAttribute('action') || location.href, location.href).href,
        fields: fields(this),
      };
    }
  };
  HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement) {
    HTMLFormElement.prototype.submit.call(this);
  };
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this !== target) {
      const rawHref = this.getAttribute('href');
      if (rawHref && !/^(?:javascript:|#)/i.test(rawHref) && !captured) {
        try {
          const href = new URL(rawHref, location.href).href;
          if (/^https?:/.test(href)) {
            captured = { method: 'GET', url: href, fields: [] };
            return;
          }
        } catch {}
      }
    }
    return original.anchorClick.call(this);
  };
  window.alert = () => undefined;
  window.confirm = () => true;

  const onClickCapture = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const rawHref = anchor.getAttribute('href') ?? '';
    if (rawHref && !/^(?:javascript:|#)/i.test(rawHref)) {
      event.preventDefault();
      if (!captured) {
        try {
          const href = new URL(rawHref, location.href).href;
          if (/^https?:/.test(href)) captured = { method: 'GET', url: href, fields: [] };
        } catch {}
      }
    }
  };
  target.addEventListener('click', onClickCapture);
  try {
    target.click();
    for (let waited = 0; !captured && waited < 400; waited += 50) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch {
    // 무시
  } finally {
    target.removeEventListener('click', onClickCapture);
    window.open = original.open;
    HTMLFormElement.prototype.submit = original.submit;
    HTMLFormElement.prototype.requestSubmit = original.requestSubmit;
    HTMLAnchorElement.prototype.click = original.anchorClick;
    window.alert = original.alert;
    window.confirm = original.confirm;
  }
  const result = captured as CapturedOpenRequest | null;
  if (!result) return null;
  try {
    const parsed = new URL(result.url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * 첨부 파일의 바이트를 페이지 세션으로 받아 텍스트(또는 오프스크린 해석용 PDF 원본)로 바꾼다.
 */
export async function readAttachmentContent(
  params: { name: string; url?: string; request?: CapturedOpenRequest },
  signal?: AbortSignal,
): Promise<{ name: string; text: string; pdf?: PdfSource; warning?: string }> {
  const cleanName = cleanAttachmentFileName(params.name);
  const req: CapturedOpenRequest | null = params.request
    ?? (params.url ? { method: 'GET', url: params.url, fields: [] } : null);
  if (!req) {
    return { name: cleanName, text: '', warning: '첨부 파일 다운로드 주소를 확인하지 못했습니다.' };
  }
  let targetUrl: string;
  try {
    const parsed = new URL(req.url, location.href);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { name: cleanName, text: '', warning: '지원하지 않는 첨부 주소 형식입니다.' };
    }
    if (req.method === 'GET' && req.fields.length) {
      for (const [key, value] of req.fields) parsed.searchParams.append(key, value);
    }
    targetUrl = parsed.href;
  } catch {
    return { name: cleanName, text: '', warning: '첨부 파일 주소가 올바르지 않습니다.' };
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      credentials: 'include',
      cache: 'no-store',
      signal,
      ...(req.method === 'POST' ? { body: new URLSearchParams(req.fields) } : {}),
    });
    if (!response.ok) {
      return { name: cleanName, text: '', warning: `첨부 파일 조회 실패 (HTTP ${response.status})` };
    }
    const contentLength = Number(response.headers.get('content-length') || '0');
    if (contentLength > PDF_MAX_BYTES) {
      return { name: cleanName, text: '', warning: '첨부 파일이 크기 제한(15MB)을 초과하여 건너뛰었습니다.' };
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > PDF_MAX_BYTES) {
      return { name: cleanName, text: '', warning: '첨부 파일이 크기 제한(15MB)을 초과하여 건너뛰었습니다.' };
    }
    const bytes = new Uint8Array(buffer);
    const disposition = response.headers.get('content-disposition') ?? '';
    const encodedName = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
    const headerName = (() => {
      try {
        return encodedName
          ? decodeURIComponent(encodedName)
          : disposition.match(/filename\s*=\s*"?([^";]+)/i)?.[1]?.trim() ?? '';
      } catch {
        return '';
      }
    })();
    const effectiveName = cleanAttachmentFileName(headerName || cleanName);
    const contentType = response.headers.get('content-type') ?? '';

    if (isPdfBytes(bytes) || /\.pdf$/i.test(effectiveName)) {
      return {
        name: cleanName,
        text: '',
        pdf: { url: targetUrl, base64: bytesToBase64(bytes), bytes: bytes.length },
      };
    }

    if (isHtmlAttachmentName(effectiveName) || isHtmlAttachmentName(cleanName)) {
      const htmlText = decodeText(bytes);
      const doc = new DOMParser().parseFromString(htmlText, 'text/html');
      doc.querySelectorAll('script, style, noscript').forEach(node => node.remove());
      const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')]
        .map(a => `${(a.textContent ?? '').trim()} (${a.getAttribute('href') ?? ''})`.trim())
        .filter(Boolean);
      const bodyText = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const combined = [bodyText, ...(links.length ? [`링크: ${links.join(', ')}`] : [])].filter(Boolean).join('\n');
      return {
        name: cleanName,
        text: combined,
        ...(combined ? {} : { warning: '링크 첨부 문서에서 텍스트를 찾지 못했습니다.' }),
      };
    }

    if (/text\/html|application\/xhtml/i.test(contentType) && !/\.(?:txt|md|csv|html?)$/i.test(effectiveName)) {
      return { name: cleanName, text: '', warning: '파일 대신 HTML 페이지가 반환되어 첨부 내용을 읽지 못했습니다.' };
    }

    const extracted = await extractFileBytes(effectiveName, bytes);
    return {
      name: cleanName,
      text: extracted.text,
      ...(extracted.warnings.length ? { warning: extracted.warnings.join(' ') } : {}),
    };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      name: cleanName,
      text: '',
      warning: `첨부 파일 읽기 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 추출한 첨부 문서 텍스트를 문서 본문 뒤에 합친다.
 * 본문이 잘리지 않도록 첨부 문서 영역에 별도 토큰 예산을 배정하여 합친다.
 */
export function withAttachedFileTexts(
  page: ExtractedPage,
  attachments: ExtractedAttachmentText[],
  budgetTokens: number,
): ExtractedPage {
  if (!attachments.length) return page;
  const sections = attachments
    .map(att => {
      const body = att.text.trim();
      if (body) {
        return `[첨부문서: ${att.name}]\n${body}${att.warning ? `\n(참고: ${att.warning})` : ''}`;
      }
      if (att.warning) {
        return `[첨부문서: ${att.name}]\n(읽기 제한: ${att.warning})`;
      }
      return '';
    })
    .filter(Boolean);
  if (!sections.length) return page;

  const rawAttachments = sections.join('\n\n');
  const fittedAttachments = fitToBudget(rawAttachments, Math.max(500, budgetTokens));
  const combinedText = [page.text.trim(), fittedAttachments.text].filter(Boolean).join('\n\n');
  const totalCharCount = page.charCount + rawAttachments.length;
  const truncated = page.truncated || fittedAttachments.truncated;
  return {
    ...page,
    text: combinedText,
    charCount: totalCharCount,
    truncated,
    keptRatio: truncated ? Math.min(1, combinedText.length / Math.max(1, totalCharCount)) : 1,
    estimatedTokens: estimateTokens(combinedText),
  };
}

/** 요약 페이로드용 요약본: 직접 받을 수 있는 링크와 스크립트 방식 항목 수. */
export function scanAttachments(root: Document = document): AttachmentScan {
  const items = listAttachments(root);
  return {
    links: items.flatMap(item => item.url ? [{ name: item.name, url: item.url }] : []),
    unsupported: items.filter(item => !item.url).length,
  };
}

function directUrl(element: HTMLElement, root: Document): string | undefined {
  const href = element.getAttribute('href');
  if (!href || /^(javascript:|#)/i.test(href) || element.hasAttribute('onclick')) return undefined;
  try {
    const url = new URL(href, root.baseURI);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function nearAttachmentLabel(element: HTMLElement): boolean {
  let current = element.parentElement;
  for (let depth = 0; current && depth < 4; depth++, current = current.parentElement) {
    if (current === current.ownerDocument.body || current === current.ownerDocument.documentElement) return false;
    const text = current.textContent ?? '';
    if (text.length <= 2000 && /첨부|붙임/.test(text)) return true;
  }
  return false;
}
