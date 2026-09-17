import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { base64ToBytes, bytesToBase64, extractPdfText, formatPdfSection, isPdfBytes, type GetPdfDocument } from './pdf-text';

const CMAPS = `${resolve('node_modules/pdfjs-dist/cmaps')}/`;

/** UCS-2 빅엔디언 16진 문자열. UniKS-UCS2-H 인코딩 글꼴에 그대로 쓴다. */
function ucs2(text: string): string {
  return [...text].map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
}

/**
 * HWP에서 변환한 공문 PDF처럼 한글 글꼴을 넣지 않고 표준 한글 CMap만 가리키는 파일을 만든다.
 * 이런 파일은 CMap 없이는 글자를 하나도 뽑지 못한다.
 */
function koreanPdf(lines: string[]): Uint8Array {
  const content = [
    'BT /F1 12 Tf 72 760 Td',
    ...lines.map((line, index) => `${index ? '0 -20 Td ' : ''}<${ucs2(line)}> Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /FontDescriptor 7 0 R /DW 1000 >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /FontDescriptor /FontName /HYGoThic-Medium /Flags 6 /FontBBox [0 -148 1001 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const read = getDocument as unknown as GetPdfDocument;

it('글꼴을 넣지 않은 한글 공문 PDF에서 한국어 CMap으로 본문 글자를 뽑는다', async () => {
  const bytes = koreanPdf(['제목 감사원 감사자료 제출 요구', '제출기한: 2026. 9. 18.(금)']);
  expect(isPdfBytes(bytes)).toBe(true);
  const result = await extractPdfText(read, bytes, { cMapUrl: CMAPS });
  expect(result.error).toBeUndefined();
  expect(result.pages).toBe(1);
  expect(result.text).toContain('감사원 감사자료 제출 요구');
  expect(result.text).toContain('2026. 9. 18.(금)');
  expect(formatPdfSection(result)).toMatch(/^\[본문 PDF · 1쪽\]\n제목 감사원/);
});

it('PDF가 아니거나 글자가 없으면 이유를 남겨 모델이 내용을 지어내지 않게 한다', async () => {
  const html = new TextEncoder().encode('<html>로그인이 필요합니다</html>');
  expect(isPdfBytes(html)).toBe(false);
  const broken = await extractPdfText(read, html, { cMapUrl: CMAPS });
  expect(formatPdfSection(broken)).toContain('본문 PDF를 읽지 못했습니다');
  expect(formatPdfSection({ text: '', pages: 2 })).toContain('2쪽에서 글자를 찾지 못했습니다');
});

it('메시지 전송용 base64 변환은 큰 파일도 바이트를 그대로 되돌린다', () => {
  const bytes = new Uint8Array(200_000).map((_, index) => index % 256);
  expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
});
