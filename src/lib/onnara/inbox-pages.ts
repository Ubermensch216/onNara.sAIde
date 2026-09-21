import { extractStructuredDocumentList, type StructuredDocumentList } from './document-list';
import type { DocumentListLocation } from './document-navigation';

// 조회 조건과 문서 선택 필드는 구분한다. 페이지 번호만 바꾸고 검색 조건은 그대로 보낸다.
const PAGE_FIELD = /^(?:page(?:Index|No|Num|Number)?|currentPage(?:No|Index)?|nowPage)$/i;
const PAGER = '.paging, .pagination, .paginate, [class*="paging" i], [class*="pagination" i], [class*="paginate" i], [id*="paging" i], [id*="pagination" i], [aria-label*="페이지"], [aria-label*="pagination" i]';

export interface InboxPage {
  list: StructuredDocumentList;
  next: DocumentListLocation | null;
}

export function firstInboxPage(location: DocumentListLocation): DocumentListLocation {
  const url = new URL(location.url);
  for (const name of [...url.searchParams.keys()]) if (PAGE_FIELD.test(name)) url.searchParams.set(name, '1');
  return {
    ...location, url: url.href,
    ...(location.form ? { form: { ...location.form, fields: location.form.fields.map(([name, value]) =>
      [name, PAGE_FIELD.test(name) ? '1' : value] as [string, string]) } } : {}),
  };
}

function pageField(location: DocumentListLocation, doc: Document): string | undefined {
  return location.form?.fields.find(([name]) => PAGE_FIELD.test(name))?.[0]
    ?? [...new URL(location.url).searchParams.keys()].find(name => PAGE_FIELD.test(name))
    ?? [...doc.querySelectorAll<HTMLInputElement>('input[name]')].find(input => PAGE_FIELD.test(input.name))?.name;
}

function numberedLocation(location: DocumentListLocation, name: string, page: number): DocumentListLocation {
  const url = new URL(location.url);
  if (url.searchParams.has(name) || !location.form) url.searchParams.set(name, String(page));
  const fields = location.form?.fields.filter(([key]) => key !== name) ?? [];
  return { ...location, url: url.href, ...(location.form ? { form: { ...location.form, fields: [...fields, [name, String(page)] as [string, string]] } } : {}) };
}

function disabled(element: Element): boolean {
  return Boolean(element.closest('[disabled], [aria-disabled="true"], .disabled, [hidden]'));
}

/** 서버가 그린 페이지 링크만 해석한다. 내려온 스크립트나 문서 열기 링크는 실행하지 않는다. */
export function parseInboxPage(html: string, location: DocumentListLocation): InboxPage {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const list = extractStructuredDocumentList(doc, Infinity);
  if (!list) {
    const text = doc.body.textContent ?? '';
    if (/로그인|인증서|세션이\s*만료|sign\s*in|gpki/i.test(text.slice(0, 2000))) {
      throw new Error('온나라 세션이 만료되었습니다. 다시 로그인한 뒤 확인하세요.');
    }
    throw new Error('저장된 조회 요청에서 공유/공람 목록을 찾지 못했습니다. 받은문서 목록에서 브리핑 대상을 다시 지정하세요.');
  }

  const field = pageField(location, doc);
  const current = Number(location.form?.fields.find(([name]) => name === field)?.[1]
    ?? (field ? new URL(location.url).searchParams.get(field) : null) ?? 1);
  const candidates: Array<{ page: number; url?: URL }> = [];
  let unrecognizedNext = false;
  const controls = [...doc.querySelectorAll<HTMLElement>('a, button, input[type="button"], input[type="image"]')];
  for (const element of controls) {
    if (disabled(element)) continue;
    const code = `${element.getAttribute('onclick') ?? ''} ${element.getAttribute('href') ?? ''}`;
    const inPager = Boolean(element.closest(PAGER)) || element.getAttribute('rel') === 'next' || /(?:link|go|move|select|search|fn_?)[\w.]*page|page[\w.]*\s*\(/i.test(code);
    if (!inPager) continue;
    const label = `${element.textContent ?? ''} ${element.getAttribute('title') ?? ''} ${element.getAttribute('aria-label') ?? ''} ${element.querySelector('img')?.alt ?? ''} ${element.getAttribute('alt') ?? ''} ${element.getAttribute('value') ?? ''} ${element.getAttribute('rel') ?? ''}`.trim();
    const href = element.getAttribute('href');
    let found = false;
    if (href && !/^(?:javascript:|#)/i.test(href)) {
      const url = new URL(href, location.url);
      if (url.origin !== new URL(location.url).origin || url.pathname !== new URL(location.url).pathname) {
        if (/다음|next|마지막|last/i.test(label)) unrecognizedNext = true;
        continue;
      }
      for (const [name, value] of url.searchParams) {
        if (PAGE_FIELD.test(name) && /^\d+$/.test(value)) {
          candidates.push({ page: Number(value), url });
          found = true;
        }
      }
    }
    const call = code.match(/(?:[\w.]*page[\w.]*|linkPage)\s*\(\s*['"]?(\d+)['"]?\s*\)/i);
    const numericLabel = element.textContent?.trim().match(/^\d+$/)?.[0];
    if (call || numericLabel) {
      candidates.push({ page: Number(call?.[1] ?? numericLabel) });
      found = true;
    }
    if (!found && /다음|next|마지막|last/i.test(label)) unrecognizedNext = true;
  }

  const later = candidates.filter(candidate => candidate.page > current).sort((a, b) => a.page - b.page);
  if (later.length) {
    if (field) return { list, next: numberedLocation(location, field, current + 1) };
    const next = later.find(candidate => candidate.page === current + 1 && candidate.url);
    if (next?.url) {
      // GET 링크에서도 저장한 키워드/기간 조건이 빠지지 않도록 기존 쿼리를 합친다.
      const url = new URL(location.url);
      for (const [name, value] of next.url.searchParams) url.searchParams.set(name, value);
      return { list, next: { ...location, url: url.href } };
    }
    throw new Error('다음 목록 페이지의 조회 필드를 확인할 수 없어 전체 수집을 중단했습니다.');
  }
  const value = (pattern: RegExp) => Number([...doc.querySelectorAll<HTMLInputElement>('input[name]')].find(input => pattern.test(input.name))?.value);
  const total = value(/^(?:totalRecordCount|totalCount|totalCnt)$/i);
  const size = value(/^(?:recordCountPerPage|pageSize|pageUnit)$/i);
  if (total > 0 && size > 0 && current * size < total) {
    if (!field) throw new Error('다음 목록 페이지의 조회 필드를 확인할 수 없어 전체 수집을 중단했습니다.');
    return { list, next: numberedLocation(location, field, current + 1) };
  }
  if (unrecognizedNext) throw new Error('다음 목록 페이지를 확인할 수 없어 전체 수집을 중단했습니다.');
  return { list, next: null };
}

/** 로그인된 출처에서 목록 조회만 재전송한다. DOM 삽입이나 문서 본문 열기는 하지 않는다. */
export async function fetchInboxPage(location: DocumentListLocation, signal: AbortSignal): Promise<InboxPage> {
  const url = new URL(location.url);
  if (url.origin !== window.location.origin) throw new Error('브리핑 대상과 로그인 탭의 출처가 다릅니다.');
  const method = location.form?.method ?? 'get';
  const fields = new URLSearchParams(location.form?.fields ?? []);
  if (method === 'get') {
    for (const name of new Set(fields.keys())) url.searchParams.delete(name);
    for (const [name, value] of fields) url.searchParams.append(name, value);
  }
  const response = await fetch(url, {
    method: method.toUpperCase(), credentials: 'same-origin', cache: 'no-store', signal,
    ...(method === 'post' ? { body: fields } : {}),
  });
  if (!response.ok) throw new Error(`공유/공람 목록 조회 실패 (${response.status})`);
  if (new URL(response.url || url.href).origin !== url.origin) throw new Error('온나라 로그인 상태를 확인하세요.');
  const bytes = await response.arrayBuffer();
  const prefix = new TextDecoder().decode(bytes.slice(0, 4096));
  const charset = response.headers.get('content-type')?.match(/charset\s*=\s*([^;\s]+)/i)?.[1]
    ?? prefix.match(/charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1] ?? 'utf-8';
  return parseInboxPage(new TextDecoder(charset.replace(/["']/g, '')).decode(bytes), location);
}
