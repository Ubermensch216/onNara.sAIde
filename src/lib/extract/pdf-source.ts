/**
 * 화면에 떠 있는 PDF 본문을 찾아 원본 바이트를 받는다(주입 스크립트에서 실행).
 *
 * ★ 원본은 서비스 워커가 아니라 이 프레임에서 받는다. 페이지와 같은 출처로 요청해야
 *   온나라 로그인 쿠키가 그대로 실려 권한 있는 PDF를 받을 수 있다.
 *
 * ★ 문서를 읽는 동안 서비스 워커가 같은 프레임을 여러 번 추출한다. 매번 내려받지 않도록
 *   주소별로 잠시 기억한다.
 */

import { PDF_MAX_BYTES, bytesToBase64, isPdfBytes, type PdfSource } from './pdf-text';

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; source: Promise<PdfSource> }>();

/** 이 프레임이 보여 주는 PDF 주소. 프레임 자체가 PDF 문서이거나, embed·object로 PDF를 띄운 경우다. */
export function findPdfUrls(doc: Document = document): string[] {
  // 브라우저가 PDF 파일을 직접 연 프레임. 내부 뷰어용 embed의 src는 about:blank라 주소는 문서 주소를 쓴다.
  if (doc.contentType === 'application/pdf') return [doc.location.href];
  const urls = [...doc.querySelectorAll<HTMLEmbedElement | HTMLObjectElement>('embed, object')].flatMap(element => {
    const raw = element instanceof HTMLObjectElement ? element.getAttribute('data') : element.getAttribute('src');
    const type = element.getAttribute('type') ?? '';
    if (!raw || /^about:/i.test(raw)) return [];
    if (!/pdf/i.test(type) && !/\.pdf($|[?#])/i.test(raw)) return [];
    try { return [new URL(raw, doc.baseURI).href]; } catch { return []; }
  });
  return [...new Set(urls)];
}

export function readPdfSources(urls: string[], fetcher: typeof fetch = fetch, now = Date.now()): Promise<PdfSource[]> {
  for (const [url, entry] of cache) if (now - entry.at > CACHE_MS) cache.delete(url);
  return Promise.all(urls.map(url => {
    const cached = cache.get(url);
    if (cached) return cached.source;
    const source = download(url, fetcher);
    cache.set(url, { at: now, source });
    // 실패는 기억하지 않는다. 뷰어가 아직 파일을 준비하는 중일 수 있다.
    void source.then(result => { if (result.error) cache.delete(url); });
    return source;
  }));
}

async function download(url: string, fetcher: typeof fetch): Promise<PdfSource> {
  try {
    const response = await fetcher(url, { credentials: 'include' });
    if (!response.ok) return { url, error: `HTTP ${response.status}` };
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > PDF_MAX_BYTES) return { url, error: '파일이 너무 큽니다' };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > PDF_MAX_BYTES) return { url, error: '파일이 너무 큽니다' };
    if (!isPdfBytes(bytes)) return { url, error: 'PDF가 아닌 응답을 받았습니다' };
    return { url, base64: bytesToBase64(bytes), bytes: bytes.length };
  } catch (error) {
    return { url, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 테스트용. */
export function clearPdfSourceCache(): void {
  cache.clear();
}
