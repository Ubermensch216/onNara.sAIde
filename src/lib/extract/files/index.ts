/**
 * 사용자가 올린 파일 및 온나라 첨부 → 구조를 살린 글자 (기안 코파일럿 · 내 참고자료 · 온나라 첨부).
 *
 * ★ 형식은 확장자만 믿지 않고 파일 머리(매직 바이트)와 내부 구조(ZIP 엔트리 · OLE2 스트림)로 확인한다.
 *   확장자가 없거나 잘못 붙은 파일(`.hwp`를 `.hwpx`로 이름만 바꾼 파일 등)도 자동 판별해 읽는다.
 *
 * ★ 지원 포맷(순수 브라우저 TS, 추가 외부 의존성 0):
 *   PDF · HWP(5.x 일반·배포용) · HWPX · HWPML · ODT · DOCX · XLSX · XLS(BIFF8) · PPTX · TXT/MD/CSV
 */

import { PDF_MAX_BYTES, PDF_MAX_PAGES, isPdfBytes, type PdfTextResult } from '../pdf-text';
import { blocksToText, linesToBlocks } from './blocks';
import { detectOle2Format } from './cfb';
import { extractDocx } from './docx';
import { extractHwp5 } from './hwp5';
import { extractHwpml, isHwpmlBytes } from './hwpml';
import { extractHwpxDetailed } from './hwpx';
import { extractOdtText } from './odt';
import { extractPptx } from './pptx';
import { extractXls } from './xls';
import { extractXlsx } from './xlsx';
import { detectZipFormat, isZipBytes } from './zip';
import { FileExtractError, type Block, type ExtractedFile, type FileFormat } from './types';

export * from './types';
export { blocksToText } from './blocks';

export const UPLOAD_MAX_BYTES = PDF_MAX_BYTES;
/** 이보다 긴 글자는 잘라서 보관한다. CPU 모델로 구간 분석을 돌릴 수 있는 현실적인 분량이다. */
export const UPLOAD_MAX_CHARS = 200_000;
/** 쪽당 평균 글자가 이보다 적으면 스캔 이미지 PDF로 본다. */
const SCANNED_CHARS_PER_PAGE = 30;

/** 파일 선택 창의 accept 값. */
export const UPLOAD_ACCEPT = '.pdf,.hwpx,.hwp,.hml,.odt,.docx,.xlsx,.xls,.pptx,.txt,.md,.csv';
export const UPLOAD_FORMATS_LABEL = 'PDF · HWP · HWPX · ODT · DOCX · XLSX · XLS · PPTX · TXT';

const HWP3_PREFIX = new TextEncoder().encode('HWP Document File V3.00');

export interface ExtractOptions {
  /** PDF 글자 추출기. 드로어는 백그라운드(오프스크린 pdf.js)에 맡긴다. */
  parsePdf?: (bytes: Uint8Array) => Promise<PdfTextResult>;
}

function extensionOf(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

function isOleMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

function isHwp3Bytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < HWP3_PREFIX.length) return false;
  for (let i = 0; i < HWP3_PREFIX.length; i++) {
    if (bytes[i] !== HWP3_PREFIX[i]) return false;
  }
  return true;
}

/** 형식을 정한다. 읽을 수 없는 형식이면 이유와 함께 던진다. */
export function detectFormat(name: string, bytes: Uint8Array): FileFormat {
  const ext = extensionOf(name);
  if (isPdfBytes(bytes)) return 'pdf';
  if (isHwp3Bytes(bytes)) {
    throw new FileExtractError('구형 한글 3.x(.hwp) 형식은 지원하지 않습니다. 한글에서 HWPX 또는 PDF로 저장해 올려 주세요.');
  }
  if (isHwpmlBytes(bytes)) return 'hwpml';

  if (isZipBytes(bytes)) {
    // 확장자보다 ZIP 내부 엔트리 구조를 우선 확인한다
    const zipKind = detectZipFormat(bytes);
    if (zipKind) return zipKind;
    if (ext === 'hwpx') return 'hwpx';
    if (ext === 'docx') return 'docx';
    if (ext === 'xlsx') return 'xlsx';
    if (ext === 'pptx') return 'pptx';
    if (ext === 'odt' || ext === 'ott') return 'odt';
    throw new FileExtractError(`'.${ext || '?'}' 압축 형식은 지원하지 않습니다. ${UPLOAD_FORMATS_LABEL} 파일을 올려 주세요.`);
  }

  if (isOleMagic(bytes)) {
    const oleKind = detectOle2Format(bytes);
    if (oleKind) return oleKind;
    if (ext === 'hwp') return 'hwp';
    if (ext === 'xls') return 'xls';
    throw new FileExtractError('구형 오피스 형식(.doc/.ppt)은 읽을 수 없습니다. DOCX·PPTX 또는 PDF로 저장해 올려 주세요.');
  }

  if (['txt', 'md', 'csv'].includes(ext)) return 'text';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'].includes(ext)) {
    throw new FileExtractError('이미지 파일의 글자는 읽을 수 없습니다(OCR 미지원). 글자가 들어 있는 PDF나 HWPX로 올려 주세요.');
  }
  throw new FileExtractError(`지원하지 않는 형식입니다. ${UPLOAD_FORMATS_LABEL} 파일을 올려 주세요.`);
}

/** 텍스트 파일은 UTF-8을 먼저 보고, 깨지면 EUC-KR(CP949)로 다시 읽는다. 옛 행정 자료에 흔하다. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

function pdfBlocks(result: PdfTextResult): Block[] {
  const pages = result.pageTexts ?? [result.text];
  const out: Block[] = [];
  let tableCounter = 0;

  pages.forEach((text, index) => {
    const page = result.pageTexts ? index + 1 : undefined;
    let inTable = false;
    let rowNo = 0;
    for (const block of linesToBlocks(text, page !== undefined ? { page } : {})) {
      if (block.text.includes(' | ')) {
        if (!inTable) {
          inTable = true;
          tableCounter += 1;
          rowNo = 0;
        }
        rowNo += 1;
        out.push({ kind: 'table-row', text: block.text, table: tableCounter, row: rowNo, ...(page !== undefined ? { page } : {}) });
      } else {
        inTable = false;
        out.push(block);
      }
    }
  });
  return out;
}

export async function extractFileBytes(name: string, bytes: Uint8Array, options: ExtractOptions = {}): Promise<ExtractedFile> {
  if (bytes.length > UPLOAD_MAX_BYTES) throw new FileExtractError(`파일이 ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB를 넘어 올릴 수 없습니다.`);
  if (!bytes.length) throw new FileExtractError('빈 파일입니다.');
  const format = detectFormat(name, bytes);
  const warnings: string[] = [];
  let blocks: Block[] = [];
  let pages: number | undefined;

  if (format === 'pdf') {
    if (!options.parsePdf) throw new FileExtractError('PDF 해석기를 사용할 수 없습니다.');
    const result = await options.parsePdf(bytes);
    if (result.error) throw new FileExtractError(`PDF를 읽지 못했습니다: ${result.error}`);
    pages = result.pages;
    blocks = pdfBlocks(result);
    const readPages = Math.max(1, Math.min(result.pages, PDF_MAX_PAGES));
    if (result.pages > PDF_MAX_PAGES) warnings.push(`전체 ${result.pages}쪽 중 앞 ${PDF_MAX_PAGES}쪽만 읽었습니다.`);
    if (result.qualityWarning) warnings.push(result.qualityWarning);
    if (result.text.replace(/\s/g, '').length / readPages < SCANNED_CHARS_PER_PAGE) {
      if (!result.text.trim()) throw new FileExtractError('PDF에서 글자를 찾지 못했습니다. 스캔한 이미지로 만든 PDF는 읽을 수 없습니다(OCR 미지원).');
      warnings.push('쪽마다 글자가 매우 적습니다. 스캔 이미지가 섞인 PDF라면 그 쪽의 내용은 빠졌습니다.');
    }
  } else if (format === 'hwpx') {
    const result = extractHwpxDetailed(bytes);
    blocks = result.blocks;
    warnings.push(...result.warnings);
  } else if (format === 'hwp') {
    const result = extractHwp5(bytes);
    blocks = result.blocks;
    warnings.push(...result.warnings);
  } else if (format === 'hwpml') {
    blocks = extractHwpml(bytes);
  } else if (format === 'docx') {
    blocks = extractDocx(bytes);
  } else if (format === 'xlsx') {
    const result = extractXlsx(bytes);
    blocks = result.blocks;
    warnings.push(...result.warnings);
  } else if (format === 'xls') {
    const result = extractXls(bytes);
    blocks = result.blocks;
    warnings.push(...result.warnings);
  } else if (format === 'pptx') {
    const result = extractPptx(bytes);
    blocks = result.blocks;
    pages = result.pages;
    warnings.push(...result.warnings);
  } else if (format === 'odt') {
    blocks = extractOdtText(bytes);
  } else {
    blocks = linesToBlocks(decodeText(bytes));
  }

  if (!blocks.length) throw new FileExtractError('파일에서 읽을 수 있는 글자를 찾지 못했습니다.');

  let text = blocksToText(blocks);
  if (text.length > UPLOAD_MAX_CHARS) {
    // 덩어리 단위로 잘라 문장 중간이 끊기지 않게 한다.
    let total = 0;
    const kept: Block[] = [];
    for (const block of blocks) {
      total += block.text.length + 1;
      if (total > UPLOAD_MAX_CHARS) break;
      kept.push(block);
    }
    warnings.push(`글자가 ${text.length.toLocaleString()}자로 길어 앞 ${UPLOAD_MAX_CHARS.toLocaleString()}자 분량만 보관합니다.`);
    blocks = kept;
    text = blocksToText(blocks);
  }
  return { format, text, blocks, pages, warnings };
}

export async function extractUploadedFile(file: File, options: ExtractOptions = {}): Promise<ExtractedFile> {
  if (file.size > UPLOAD_MAX_BYTES) throw new FileExtractError(`파일이 ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB를 넘어 올릴 수 없습니다.`);
  return extractFileBytes(file.name, new Uint8Array(await file.arrayBuffer()), options);
}

/** 같은 파일을 두 번 올렸는지 가리는 지문. */
export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
