export interface AttachmentLink { name: string; url: string }
export interface AttachmentScan { links: AttachmentLink[]; unsupported: number }
/** 프레임 안에서 찾은 첨부 항목. url이 없으면 화면의 스크립트를 눌러야 받을 수 있다. */
export interface AttachmentItem { index: number; name: string; url?: string }

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
