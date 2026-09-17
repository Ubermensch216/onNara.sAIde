/**
 * PDF 본문 텍스트 추출.
 *
 * ★ 온나라 상세 화면은 공문 본문을 브라우저 PDF 뷰어(iframe·embed)로 보여 주는 경우가 있다.
 *   뷰어 안의 글자는 DOM에 없어 innerText로는 한 글자도 읽히지 않고, 바깥 화면의
 *   첨부 목록만 남는다. 그러면 모델은 "파일 목록만 확인된다"고 답한다.
 *   그래서 뷰어가 띄운 PDF 원본을 받아 pdf.js로 글자를 직접 뽑는다.
 *
 * ★ pdf.js는 서비스 워커가 아니라 오프스크린 문서에서 돌린다(entrypoints/offscreen).
 *   워커 번들에 넣으면 PDF가 없는 요청에도 매번 1MB가 넘는 코드를 읽어야 한다.
 *
 * ★ 한글 PDF 중에는 글꼴을 넣지 않고 표준 한글 CMap(UniKS-UCS2-H 등)만 가리키는 파일이 있다.
 *   CMap이 없으면 그런 파일에서는 글자를 하나도 못 뽑으므로 한국어 CMap을 함께 배포한다(wxt.config.ts).
 */

/** 이 크기를 넘는 PDF는 받지 않는다. 메시지로 넘길 때 base64로 1.34배가 된다. */
export const PDF_MAX_BYTES = 15 * 1024 * 1024;
/** 공문 본문은 몇 쪽이다. 책 한 권 분량을 CPU 모델에 넣을 수는 없으므로 앞쪽만 읽는다. */
export const PDF_MAX_PAGES = 30;

export interface PdfSource {
  url: string;
  base64?: string;
  bytes?: number;
  error?: string;
}

export interface PdfTextResult {
  text: string;
  pages: number;
  error?: string;
}

interface TextItemLike { str?: string; hasEOL?: boolean }
interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: TextItemLike[] }>; cleanup(): unknown }>;
}
/** pdf.js의 getDocument. 오프스크린 문서는 브라우저 빌드를, 테스트는 Node에서 같은 함수를 넘긴다. */
export type GetPdfDocument = (params: Record<string, unknown>) => { promise: Promise<PdfDocumentLike>; destroy(): Promise<void> };

export function isPdfBytes(bytes: Uint8Array): boolean {
  // 파일 앞부분 1KB 안에 머리표가 있으면 PDF로 본다(앞에 공백·BOM이 붙은 파일이 있다).
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export async function extractPdfText(getDocument: GetPdfDocument, data: Uint8Array, options: { cMapUrl?: string } = {}): Promise<PdfTextResult> {
  const task = getDocument({
    data,
    ...(options.cMapUrl ? { cMapUrl: options.cMapUrl, cMapPacked: true } : {}),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, PDF_MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(joinTextItems(content.items));
      page.cleanup();
    }
    return { text: pages.map(normalizeText).filter(Boolean).join('\n\n'), pages: doc.numPages };
  } catch (error) {
    return { text: '', pages: 0, error: describePdfError(error) };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

function joinTextItems(items: TextItemLike[]): string {
  return items.map(item => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`).join('');
}

function normalizeText(text: string): string {
  return text.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function describePdfError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'PasswordException') return '암호로 보호된 PDF입니다';
  if (name === 'InvalidPDFException') return '올바른 PDF 파일이 아닙니다';
  return error instanceof Error ? error.message : String(error);
}

/**
 * 모델에 넘길 PDF 본문 한 덩어리.
 * 읽지 못했을 때도 이유를 남긴다. 비워 두면 모델이 첨부 목록만 보고 "내용이 없다"고 지어낸다.
 */
export function formatPdfSection(result: PdfTextResult): string {
  if (result.error) return `[본문 PDF를 읽지 못했습니다: ${result.error}]`;
  if (!result.text) return `[본문 PDF ${result.pages}쪽에서 글자를 찾지 못했습니다. 스캔한 이미지로 만든 PDF일 수 있습니다.]`;
  const more = result.pages > PDF_MAX_PAGES ? ` · 앞 ${PDF_MAX_PAGES}쪽만 읽음` : '';
  return `[본문 PDF · ${result.pages}쪽${more}]\n${result.text}`;
}

/* ── 메시지 전송용 base64 ── */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
