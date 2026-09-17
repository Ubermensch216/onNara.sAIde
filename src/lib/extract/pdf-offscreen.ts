/**
 * 서비스 워커에서 PDF 글자 추출을 오프스크린 문서에 맡긴다.
 *
 * ★ 상세 화면을 읽는 동안 같은 PDF가 여러 번 들어온다(본문이 다 뜰 때까지 반복 추출).
 *   같은 주소·크기의 결과는 기억해 두고 다시 해석하지 않는다.
 */

import { fitToBudget } from './budget';
import { PDF_MAX_BYTES, bytesToBase64, formatPdfSection, isPdfBytes, type PdfSource, type PdfTextResult } from './pdf-text';
import type { ExtractedPage } from '@/lib/messaging/protocol';

export const OFFSCREEN_PATH = 'offscreen.html';
export const OFFSCREEN_TARGET = 'saide-offscreen';

export interface ParsePdfRequest { target: typeof OFFSCREEN_TARGET; type: 'PARSE_PDF'; base64: string }

export function isParsePdfRequest(msg: unknown): msg is ParsePdfRequest {
  const value = msg as Partial<ParsePdfRequest> | null;
  return value?.target === OFFSCREEN_TARGET && value.type === 'PARSE_PDF' && typeof value.base64 === 'string';
}

const IDLE_CLOSE_MS = 60_000;
const CACHE_LIMIT = 8;
const results = new Map<string, Promise<PdfTextResult>>();
let creating: Promise<void> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (contexts.length) return;
  creating ??= chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: '문서 본문 PDF에서 글자를 추출합니다.',
  }).finally(() => { creating = null; });
  await creating;
}

async function parse(base64: string): Promise<PdfTextResult> {
  clearTimeout(closeTimer);
  try {
    await ensureOffscreen();
    const reply = await chrome.runtime.sendMessage({ target: OFFSCREEN_TARGET, type: 'PARSE_PDF', base64 } satisfies ParsePdfRequest) as PdfTextResult | undefined;
    return reply ?? { text: '', pages: 0, error: 'PDF 해석기가 응답하지 않았습니다' };
  } catch (error) {
    return { text: '', pages: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    closeTimer = setTimeout(() => { void chrome.offscreen.closeDocument().catch(() => undefined); }, IDLE_CLOSE_MS);
  }
}

/** 주입 스크립트가 받지 못한 PDF(다른 출처 embed 등)는 사이트 권한으로 한 번 더 받아 본다. */
async function fetchFallback(source: PdfSource): Promise<PdfSource> {
  if (source.base64 || !/^https?:/i.test(source.url)) return source;
  try {
    const response = await fetch(source.url, { credentials: 'include' });
    if (!response.ok) return source;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > PDF_MAX_BYTES || !isPdfBytes(bytes)) return source;
    return { url: source.url, base64: bytesToBase64(bytes), bytes: bytes.length };
  } catch {
    return source;
  }
}

export async function pdfText(source: PdfSource): Promise<PdfTextResult> {
  const resolved = await fetchFallback(source);
  if (!resolved.base64) return { text: '', pages: 0, error: resolved.error ?? 'PDF 원본을 받지 못했습니다' };
  const key = `${resolved.url}#${resolved.bytes ?? resolved.base64.length}`;
  let result = results.get(key);
  if (!result) {
    result = parse(resolved.base64);
    results.set(key, result);
    if (results.size > CACHE_LIMIT) results.delete(results.keys().next().value!);
    // 해석기 자체가 실패했으면 다음 추출에서 다시 시도한다.
    void result.then(value => { if (value.error && !value.pages) results.delete(key); });
  }
  return result;
}

/**
 * 프레임에서 뽑은 PDF 본문을 그 프레임의 추출 결과 앞에 붙인다.
 * 이미 예산에 맞춰 잘린 화면 글자 뒤에 붙이면 본문이 잘려 나가므로 본문을 앞에 둔다.
 */
export function withPdfSections(page: ExtractedPage, results: PdfTextResult[], budgetTokens: number): ExtractedPage {
  const sections = results.map(formatPdfSection);
  if (!sections.length) return page;
  const combined = [...sections, page.text.trim()].filter(Boolean).join('\n\n');
  const fitted = fitToBudget(combined, budgetTokens);
  const charCount = sections.reduce((sum, section) => sum + section.length, 0) + page.charCount;
  return {
    ...page,
    text: fitted.text,
    charCount,
    truncated: fitted.truncated || page.truncated,
    keptRatio: fitted.truncated || page.truncated ? Math.min(1, fitted.text.length / Math.max(1, charCount)) : 1,
    estimatedTokens: fitted.estimatedTokens,
    method: results.some(result => result.text) ? 'pdf' : page.method,
  };
}
