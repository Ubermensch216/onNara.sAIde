/**
 * HTML/텍스트 본문을 A4 규격 PDF 바이너리로 변환한다.
 *
 * ★ 왜 캔버스 이미지 기반 PDF인가.
 *   한글 폰트 바이너리(TTF/OTF 수십 MB)를 확장에 싣지 않고도 OS 기본 한글 글꼴(맑은 고딕 등)을
 *   브라우저 캔버스가 그대로 그려 한글 깨짐 없이 깨끗한 A4 규격 PDF 문서를 만든다.
 *   모든 PDF 뷰어(Edge, Chrome, Acrobat 등)에서 100% 정상 열람된다.
 */

export interface TextPdfInput {
  title: string;
  text: string;
  reportDate?: string;
}

const PAGE_WIDTH = 1240; // 150 DPI A4 폭 (px)
const PAGE_HEIGHT = 1754; // 150 DPI A4 높이 (px)
const MARGIN_X = 80;
const MARGIN_TOP = 100;
const MARGIN_BOTTOM = 100;
const CONTENT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2);

/** 오프스크린 문서의 Canvas 2D를 이용해 텍스트를 A4 페이지들로 렌더링하고 PDF 바이너리(base64)를 만든다. */
export async function renderTextToPdfBase64(input: TextPdfInput): Promise<string> {
  const pages = renderPagesToJpeg(input);
  const pdfBytes = assemblePdf(pages);
  return uint8ArrayToBase64(pdfBytes);
}

interface PageJpeg {
  width: number;
  height: number;
  jpeg: Uint8Array;
}

function renderPagesToJpeg(input: TextPdfInput): PageJpeg[] {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D Canvas 컨텍스트를 생성할 수 없습니다.');

  // 폰트 설정
  const titleFont = 'bold 32px "Malgun Gothic", "맑은 고딕", -apple-system, sans-serif';
  const metaFont = '18px "Malgun Gothic", "맑은 고딕", -apple-system, sans-serif';
  const bodyFont = '20px "Malgun Gothic", "맑은 고딕", -apple-system, sans-serif';
  const lineHeight = 32;

  // 본문 텍스트를 폭에 맞게 단어/문장 줄바꿈
  ctx.font = bodyFont;
  const paragraphs = input.text.split('\n');
  const wrappedLines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      wrappedLines.push('');
      continue;
    }
    let currentLine = '';
    for (const char of para) {
      const candidate = currentLine + char;
      if (ctx.measureText(candidate).width > CONTENT_WIDTH && currentLine) {
        wrappedLines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine) wrappedLines.push(currentLine);
  }

  const pages: PageJpeg[] = [];
  let lineIndex = 0;
  let pageNum = 1;

  while (lineIndex < wrappedLines.length || pageNum === 1) {
    // 배경 흰색
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

    let currentY = MARGIN_TOP;

    // 첫 페이지에만 제목과 메타정보, 구분선 표시
    if (pageNum === 1) {
      ctx.fillStyle = '#111827';
      ctx.font = titleFont;
      // 제목이 길면 줄바꿈
      const titleLines = wrapText(ctx, input.title || '공문서 본문', CONTENT_WIDTH);
      for (const tLine of titleLines) {
        ctx.fillText(tLine, MARGIN_X, currentY);
        currentY += 42;
      }
      currentY += 10;

      if (input.reportDate) {
        ctx.fillStyle = '#4b5563';
        ctx.font = metaFont;
        ctx.fillText(`보고일자: ${input.reportDate}`, MARGIN_X, currentY);
        currentY += 28;
      }

      // 구분선
      ctx.strokeStyle = '#d1d5db';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, currentY);
      ctx.lineTo(PAGE_WIDTH - MARGIN_X, currentY);
      ctx.stroke();
      currentY += 36;
    }

    // 본문 그리기
    ctx.fillStyle = '#1f2937';
    ctx.font = bodyFont;

    while (lineIndex < wrappedLines.length && currentY + lineHeight <= PAGE_HEIGHT - MARGIN_BOTTOM) {
      const line = wrappedLines[lineIndex]!;
      if (line) {
        ctx.fillText(line, MARGIN_X, currentY);
      }
      currentY += lineHeight;
      lineIndex++;
    }

    // 페이지 하단 쪽번호
    ctx.fillStyle = '#9ca3af';
    ctx.font = metaFont;
    const pageStr = `- ${pageNum} -`;
    const pageStrWidth = ctx.measureText(pageStr).width;
    ctx.fillText(pageStr, (PAGE_WIDTH - pageStrWidth) / 2, PAGE_HEIGHT - 45);

    // Canvas -> JPEG 바이너리 추출
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    const jpegBytes = base64ToUint8Array(base64);
    pages.push({ width: PAGE_WIDTH, height: PAGE_HEIGHT, jpeg: jpegBytes });

    pageNum++;
    if (lineIndex >= wrappedLines.length) break;
  }

  return pages;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const char of text) {
    const candidate = current + char;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * JPEG 페이지 이미지들을 표준 PDF 1.4 바이너리로 패키징한다.
 * A4 표준 포인트 규격: 595.28 x 841.89 pt
 */
export function assemblePdf(pages: PageJpeg[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // obj 0은 미사용

  let currentOffset = 0;
  const append = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    currentOffset += bytes.length;
  };

  append('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const pageCount = pages.length;
  // 객체 번호 할당:
  // 1: Catalog
  // 2: Pages
  // 각 페이지마다 3개 객체 사용:
  // Page 객체: 3 + i*3
  // Image XObject: 4 + i*3
  // Contents 스트림: 5 + i*3
  const catalogObj = 1;
  const pagesObj = 2;

  // 1 0 obj: Catalog
  offsets[catalogObj] = currentOffset;
  append(`${catalogObj} 0 obj\n<< /Type /Catalog /Pages ${pagesObj} 0 R >>\nendobj\n`);

  // 2 0 obj: Pages
  offsets[pagesObj] = currentOffset;
  const pageRefs = Array.from({ length: pageCount }, (_, i) => `${3 + i * 3} 0 R`).join(' ');
  append(`${pagesObj} 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${pageCount} >>\nendobj\n`);

  for (let i = 0; i < pageCount; i++) {
    const pageNum = 3 + i * 3;
    const imgNum = 4 + i * 3;
    const contentsNum = 5 + i * 3;
    const page = pages[i]!;

    // Page 객체
    offsets[pageNum] = currentOffset;
    append(
      `${pageNum} 0 obj\n<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595.28 841.89] ` +
      `/Resources << /XObject << /Im${i + 1} ${imgNum} 0 R >> >> /Contents ${contentsNum} 0 R >>\nendobj\n`
    );

    // Image XObject
    offsets[imgNum] = currentOffset;
    const imgHeader =
      `${imgNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`;
    append(imgHeader);
    append(page.jpeg);
    append('\nendstream\nendobj\n');

    // Contents 스트림: 이미지를 A4 페이지 전체에 맞추어 그린다
    offsets[contentsNum] = currentOffset;
    const streamContent = `q 595.28 0 0 841.89 0 0 cm /Im${i + 1} Do Q\n`;
    append(`${contentsNum} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream\nendobj\n`);
  }

  // Cross-reference table
  const startXref = currentOffset;
  const totalObjs = 3 + pageCount * 3;
  append(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
  for (let i = 1; i < totalObjs; i++) {
    const off = String(offsets[i] ?? 0).padStart(10, '0');
    append(`${off} 00000 n \n`);
  }

  append(`trailer\n<< /Size ${totalObjs} /Root ${catalogObj} 0 R >>\nstartxref\n${startXref}\n%%EOF\n`);

  // 병합
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of chunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}
