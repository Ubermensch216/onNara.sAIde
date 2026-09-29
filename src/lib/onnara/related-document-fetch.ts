/** 로그인된 온나라 페이지에서 원문을 요청한다. 응답은 DOM에 붙이거나 실행하지 않는다. */
import { extractFileBytes, decodeText, UPLOAD_MAX_CHARS } from '@/lib/extract/files';
import { bytesToBase64, isPdfBytes, PDF_MAX_BYTES, type PdfSource } from '@/lib/extract/pdf-text';
import type { RelatedDocInfo } from './related-info';
import type { CapturedOpenRequest } from './related-open-capture';
import { extractRelatedDocuments, parseReferenceDocument } from './related-info';

export type RelatedDocumentRequest = Pick<RelatedDocInfo, 'id' | 'title' | 'url'> & {
  /** 기안기 관련정보 링크의 열기 함수가 보내려던 요청(related-open-capture). 가장 먼저 시도한다. */
  open?: CapturedOpenRequest;
};
export interface RelatedDocumentSources {
  documentId?: string;
  texts: string[];
  pdf: PdfSource[];
  error?: string;
  /** 진단용 요청 기록(경로·상태·형식·크기). 본문·필드 값은 담지 않는다. */
  trace?: Array<{ method: string; path: string; status?: number; contentType?: string; bytes?: number; pdf?: boolean; error?: string }>;
}
type Request = { url: string; fields?: Array<[string, string]>; depth: number; captured?: boolean };
const MAX_REQUESTS = 8;
const MAX_DEPTH = 3;
// 발견한 링크 중 조회·본문 파일 경로만 따른다. 저장/삭제 등의 동작은 실행하지 않는다.
const READ_PATH = /\/(?:view[^/]*|select[^/]*|get[^/]*|download[^/]*|filedown[^/]*|[^/]*body[^/]*)\.do$/i;
const FILE_PATH = /\.(?:pdf|hwpx|docx|hwp)(?:$|[?#])/i;
const MUTATION_PATH = /(?:delete|remove|insert|update|save|add|modify|approve|sign|logout|markread)/i;
/** 문서 식별자 필드. 접수문서(ENF)는 enfdocid로 조회한다. */
const ID_FIELD = /^(?:docid|documentid|reportid|enfdocid)$/i;
const TOKEN_NAME = /^(?:_csrf|csrf(?:token)?|csrftoken|requestverificationtoken|__requestverificationtoken)$/i;

function allowedUrl(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin || url.username || url.password) return null;
    if (MUTATION_PATH.test(url.pathname)) return null;
    for (const key of ['action', 'method', 'cmd', 'mode']) {
      if (MUTATION_PATH.test(url.searchParams.get(key) ?? '')) return null;
    }
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function tokens(doc: Document): Array<[string, string]> {
  return [...doc.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')]
    .filter(input => TOKEN_NAME.test(input.name)).map(input => [input.name, input.value]);
}

/** 렌더링 없이 분리된 HTML의 줄바꿈과 표 셀을 보존한다. */
function plainText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('script, style, noscript, nav, button, input, select, iframe, object, embed, [hidden], [aria-hidden="true"]')
    .forEach(node => node.remove());
  clone.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  clone.querySelectorAll('td, th').forEach(node => node.append(' '));
  clone.querySelectorAll('p, div, tr, section, article, li, h1, h2, h3, pre').forEach(node => node.append('\n'));
  return (clone.textContent ?? '').replace(/\r/g, '').replace(/[\t ]+/g, ' ').trim();
}

/** 파일을 전부 메모리에 올리기 전에 크기 제한을 적용한다. */
async function readBytes(response: Response, remaining: number, signal: AbortSignal): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > remaining) throw new Error('원문 조회 크기 제한(15MB)을 초과했습니다.');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > remaining) throw new Error('원문 조회 크기 제한(15MB)을 초과했습니다.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function filename(response: Response, url: string): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  try {
    return encoded ? decodeURIComponent(encoded) : disposition.match(/filename\s*=\s*"?([^";]+)/i)?.[1]
      ?? decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch { return ''; }
}

function htmlDocument(bytes: Uint8Array, contentType: string): Document {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 4096));
  const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]
    ?? prefix.match(/charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1];
  const html = charset ? new TextDecoder(charset).decode(bytes) : decodeText(bytes);
  return new DOMParser().parseFromString(html, 'text/html');
}

/** 제한된 정적 경로만 수집한다. onclick, window.open, form.submit, 원격 스크립트는 실행하지 않는다. */
function children(doc: Document, request: Request): Request[] {
  const found: Request[] = [];
  const add = (raw: string | null, fields?: Array<[string, string]>) => {
    if (!raw) return;
    const url = allowedUrl(raw, request.url);
    if (url) found.push({ url, fields, depth: request.depth + 1 });
  };
  for (const element of doc.querySelectorAll('iframe[src], frame[src], embed[src], object[data]')) {
    const raw = element.getAttribute('src') ?? element.getAttribute('data');
    if (!raw) continue;
    // PDF.js 등의 뷰어 주소는 파일 매개변수를 먼저 해석한다.
    try {
      const viewer = new URL(raw, request.url);
      for (const key of ['file', 'pdf', 'url']) {
        const file = viewer.searchParams.get(key);
        if (file) add(new URL(file, viewer).href);
      }
    } catch { /* 잘못된 주소 */ }
    add(raw);
  }
  // 첨부 목록 전체를 원문으로 오인하지 않도록 본문 영역 안의 링크만 읽는다.
  for (const link of doc.querySelectorAll('a[data-body-url], #reportBody a[href], #div_report_body a[href], .reportBody a[href], #divBodyContent a[href]')) {
    const raw = link.getAttribute('data-body-url') ?? link.getAttribute('href');
    if (raw && (READ_PATH.test(raw.split('?')[0]!) || FILE_PATH.test(raw))) add(raw);
  }
  for (const form of doc.querySelectorAll<HTMLFormElement>('form[action]')) {
    const action = allowedUrl(form.getAttribute('action')!, request.url);
    if (!action || !READ_PATH.test(new URL(action).pathname)) continue;
    const fields: Array<[string, string]> = [...form.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')]
      .filter(input => !input.disabled).map(input => [input.name, input.value]);
    if (!fields.some(([name]) => ID_FIELD.test(name))) continue;
    if (form.method.toLowerCase() === 'post') add(action, fields);
    else {
      const url = new URL(action);
      for (const [name, value] of fields) url.searchParams.append(name, value);
      add(url.href);
    }
  }
  // 본문 URL이 상수로 들어 있는 경우만 지원한다. 문자열 결합/함수 호출을 평가하지 않는다.
  for (const script of doc.querySelectorAll('script:not([src])')) {
    // 접수문서 카드는 변환된 본문 PDF(/bms/dctenf/Document.pdf?sFileName=…_docconv.pdf) 주소를 문자열로 넣는다.
    for (const match of (script.textContent ?? '').matchAll(/["']((?:\/|https?:\/\/)[^"'\s<>]*\.pdf\?[^"'\s<>]*[^"'\s<>=&?])["']/gi)) add(match[1]!);
    for (const match of (script.textContent ?? '').matchAll(/\b(?:pdfUrl|bodyUrl|documentUrl|fileUrl|src|url)\s*[:=]\s*["']((?:\/|https?:\/\/)[^"'\s<>]+)["']/gi)) {
      const raw = match[1]!;
      if (FILE_PATH.test(raw) || /\/bms\/dct\/viewreportbodyview\.do\?[^"']*docid=/i.test(raw)) add(raw);
    }
  }
  // 접수문서 카드가 PDF 주소를 문자열 결합으로 만드는 경우: 서버가 넣어 둔 변환 파일명으로 같은 뷰어 주소를 만든다.
  //   실제 카드: encodeURI(httpBaseURL + "/bms/dctenf/Document.pdf?sFileName=" + sfilename + "&docTitle=" + strFileName + "&transFlag=N")
  //   파일명은 new objf("파일ID", "…_docconv.pdf", "표시 이름.pdf", "savebody", …)에, 제목은 var strFileName = "….pdf"에 있다.
  if (/\/bms\/dctenf\//i.test(new URL(request.url).pathname)) {
    const html = doc.documentElement?.innerHTML ?? '';
    const strFileName = html.match(/\bstrFileName\s*=\s*"([^"]+)"/)?.[1];
    const files = new Map<string, string>();
    for (const match of html.matchAll(/new\s+objf\(\s*"[^"]*"\s*,\s*"([0-9A-F]{32}_docconv\.pdf)"\s*,\s*"([^"]*)"/gi)) files.set(match[1]!, match[2]!);
    for (const name of html.match(/\b[0-9A-F]{32}_docconv\.pdf\b/gi) ?? []) if (!files.has(name)) files.set(name, '');
    for (const [name, display] of [...files].slice(0, 2)) {
      const docTitle = strFileName || display;
      // 화면과 똑같이 encodeURI로 만든다(서블릿이 docTitle을 받는다). 제목 없는 주소는 예비로 둔다.
      if (docTitle) add(encodeURI(`/bms/dctenf/Document.pdf?sFileName=${name}&docTitle=${docTitle}&transFlag=N`));
      add(`/bms/dctenf/Document.pdf?sFileName=${name}&transFlag=N`);
    }
  }
  return found;
}

export async function fetchRelatedDocument(info: RelatedDocumentRequest, signal: AbortSignal): Promise<RelatedDocumentSources> {
  // 드로어가 열린 뒤 관련정보가 갱신됐거나 제목만 전달된 경우 현재 DOM에서 보완한다.
  const compact = (value: string) => value.replace(/[^0-9a-z가-힣]/gi, '').toLowerCase();
  if (!info.id || !info.url) {
    const matches = extractRelatedDocuments(document).filter(doc => compact(doc.title) === compact(info.title) && (!info.id || !doc.id || doc.id === info.id));
    if (matches.length === 1) info = { ...info, id: info.id || matches[0]!.id, url: info.url || matches[0]!.url };
  }
  const result: RelatedDocumentSources = { texts: [], pdf: [], trace: [], ...(info.id ? { documentId: info.id } : {}) };
  const queue: Request[] = [];
  if (info.open) {
    // 기안기가 실제로 보내려던 조회 요청이므로 주소 이름 규칙(READ_PATH)은 보지 않되, 출처·변경 동작은 똑같이 막는다.
    const url = allowedUrl(info.open.url, location.href);
    if (url) queue.push(info.open.method === 'POST'
      ? { url, fields: [...tokens(document), ...info.open.fields.filter(([name]) => !TOKEN_NAME.test(name))], depth: 0, captured: true }
      : { url, depth: 0, captured: true });
  }
  if (info.url) {
    const url = allowedUrl(info.url, location.href);
    if (url) queue.push({ url, depth: 0 });
    else result.error = '원문 링크가 현재 온나라 출처의 조회 주소가 아닙니다.';
  }
  if (/^ENF[A-F0-9]{32}$/i.test(info.id ?? '')) {
    // 접수문서(ENF)는 온나라 목록의 openDocWindow와 같은 주소·필드로 조회한다(viewreport.do는 생산문서 DCT 전용).
    queue.push({
      url: new URL('/bms/dctenf/BmsDctEnfReceiptCardDetail.do', location.origin).href,
      fields: [...tokens(document), ['enfdocid', info.id!], ['paperdocflag', 'N'], ['popupflag', 'Y']], depth: 0,
    });
  }
  if (/^DCT[A-F0-9]{32}$/i.test(info.id ?? '')) {
    const url = new URL('/bms/dct/viewreport.do', location.origin).href;
    queue.push({ url, fields: [...tokens(document), ['docid', info.id!]], depth: 0 });
    queue.push({ url: `${url}?${new URLSearchParams({ docid: info.id! })}`, depth: 0 });
  }
  if (!queue.length) return { ...result, error: result.error ?? '문서 ID 또는 원문 링크가 없어 직접 조회할 수 없습니다. 관련정보를 다시 선택해 주세요.' };
  const seen = new Set<string>();
  let received = 0;
  while (queue.length && seen.size < MAX_REQUESTS) {
    signal.throwIfAborted();
    const request = queue.shift()!;
    const key = `${request.url}|${request.fields ? new URLSearchParams(request.fields) : ''}`;
    if (seen.has(key) || request.depth > MAX_DEPTH) continue;
    if (request.fields?.some(([name, value]) => /^(?:action|method|cmd|mode)$/i.test(name) && MUTATION_PATH.test(value))) continue;
    const requestIds = [...new URL(request.url).searchParams, ...(request.fields ?? [])]
      .filter(([name]) => ID_FIELD.test(name)).map(([, value]) => value);
    // 기안기 열기 함수가 만든 요청은 원 생산문서 ID 등 다른 ID 필드를 함께 보낼 수 있어, 선택한 ID가 들어 있는지만 본다.
    if (info.id && (request.captured
      ? !requestIds.includes(info.id) && !request.url.includes(info.id)
      : requestIds.some(value => value && value !== info.id))) {
      result.error = '원문 조회 주소의 문서 ID가 선택한 참고문서와 다릅니다.';
      continue;
    }
    seen.add(key);
    try {
      const response = await fetch(request.url, {
        method: request.fields ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        redirect: 'error', signal, ...(request.fields ? { body: new URLSearchParams(request.fields) } : {}),
      });
      const step: NonNullable<RelatedDocumentSources['trace']>[number] = {
        method: request.fields ? 'POST' : 'GET', path: new URL(request.url).pathname.slice(0, 120),
        status: response.status, contentType: response.headers.get('content-type') ?? '',
      };
      result.trace!.push(step);
      if (!response.ok) throw new Error(`원문 조회 실패 (HTTP ${response.status}). 로그인 상태와 문서 열람 권한을 확인해 주세요.`);
      const bytes = await readBytes(response, PDF_MAX_BYTES - received, signal);
      received += bytes.length;
      step.bytes = bytes.length;
      step.pdf = isPdfBytes(bytes);
      if (isPdfBytes(bytes)) {
        result.pdf.push({ url: request.url, base64: bytesToBase64(bytes), bytes: bytes.length });
        break; // 원본을 확보하면 추가 조회 대신 오프스크린 검증으로 넘긴다.
      }
      const name = filename(response, request.url);
      const contentType = response.headers.get('content-type') ?? '';
      const prefix = decodeText(bytes.subarray(0, 512));
      const isHtml = /text\/html|application\/xhtml/i.test(contentType) || /^\s*<(?:!doctype|!--|[a-z][a-z0-9-]*(?:\s|>))/i.test(prefix);
      if (!isHtml) {
        const file = await extractFileBytes(name, bytes);
        if (file.warnings.length) throw new Error(`원문 전체를 확인할 수 없습니다: ${file.warnings.join(' ')}`);
        if (parseReferenceDocument(file.text, info.title)) { result.texts.push(file.text); break; }
        continue;
      }
      const doc = htmlDocument(bytes, contentType);
      if (doc.querySelector('input[type="password"]')) throw new Error('온나라 로그인이 만료되었습니다. 다시 로그인한 뒤 재시도해 주세요.');
      // 카드에는 원 생산문서 등 다른 ID가 함께 있을 수 있어, 선택한 ID가 하나라도 있으면 같은 문서로 본다.
      const returnedIds = [...doc.querySelectorAll<HTMLInputElement>('input[name="enfdocid"], input[name="docid"], input[name="docId"]')]
        .map(input => input.value).filter(Boolean);
      if (info.id && returnedIds.length && !returnedIds.includes(info.id)) throw new Error('응답 문서 ID가 선택한 참고문서와 다릅니다.');
      const next = children(doc, request);
      queue.unshift(...next);
      const body = doc.querySelector('#reportBody, #div_report_body, .reportBody, #divBodyContent, .doc_body, article');
      // 카드의 제목·결재자·첨부 목록을 본문으로 오인하지 않는다. 본문 영역이 있어야 한다.
      if (body && !next.length) {
        let text = plainText(body);
        // 서버가 제목과 본문을 별도 영역으로 반환하는 경우에도 서버에서 읽은 제목만 사용한다.
        if (!parseReferenceDocument(text, info.title)) {
          const titleInput = doc.querySelector<HTMLInputElement>('input[name="doctitle"], input[name="docTitle"], input[name="reportTitle"]');
          const titleElement = doc.querySelector('#docTitle, #reportTitle');
          const titleLabel = [...doc.querySelectorAll('th, td')].find(node => /^제\s*목$/.test(node.textContent?.trim() ?? ''));
          const actualTitle = titleInput?.value || titleElement?.textContent || titleLabel?.nextElementSibling?.textContent;
          if (actualTitle?.trim()) text = '제목 ' + actualTitle.trim() + '\n' + text;
        }
        if (text.length > UPLOAD_MAX_CHARS) throw new Error('원문이 길어 전체 본문을 확인할 수 없습니다.');
        if (parseReferenceDocument(text, info.title)) result.texts.push(text);
      }
    } catch (error) {
      signal.throwIfAborted();
      result.error = error instanceof Error ? error.message : String(error);
      const last = result.trace!.at(-1);
      if (last && !last.error && last.path === new URL(request.url).pathname.slice(0, 120)) last.error = result.error;
      else result.trace!.push({ method: request.fields ? 'POST' : 'GET', path: new URL(request.url).pathname.slice(0, 120), error: result.error });
    }
    if (result.texts.length) break;
  }
  if (!result.texts.length && !result.pdf.length && !result.error) {
    result.error = '직접 조회 응답에서 본문을 찾지 못했습니다. 동적 뷰어의 원본 조회 경로 확인이 필요합니다.';
  }
  return result;
}
