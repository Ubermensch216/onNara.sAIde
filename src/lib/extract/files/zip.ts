/**
 * HWPX·DOCX·XLSX·PPTX·ODT는 모두 XML을 담은 ZIP이다. 필요한 항목만 풀어 XML 문서로 읽는다.
 *
 * ★ 보안 가드 (kordoc 벤치마킹):
 *   1. 항목 개별 크기 + 누적 압축해제 크기 상한 + 엔트리 수 상한(압축 폭탄 방지).
 *   2. 경로 순회(`..`, 절대경로, 널바이트) 차단.
 *   3. XML `<!DOCTYPE ...>` / `<!ENTITY ...>` 제거(DTD 폭탄 방지).
 *   4. ZIP 내부 파일명으로 포맷 자동 판별(확장자 누락/오표기 대응).
 *   5. Central Directory가 손상된 ZIP은 Local File Header(PK\x03\x04) 스캔으로 복구.
 */

import { inflateSync, strFromU8, unzipSync } from 'fflate';
import { FileExtractError } from './types';

/** 항목 하나의 풀린 크기 상한. */
export const ZIP_ENTRY_MAX_BYTES = 40 * 1024 * 1024;
/** ZIP 전체 누적 압축해제 크기 상한. */
export const ZIP_TOTAL_MAX_BYTES = 100 * 1024 * 1024;
/** ZIP 최대 엔트리 수 상한(대형 PPTX 포함). */
export const ZIP_MAX_ENTRIES = 10_000;

export type ZipDocFormat = 'hwpx' | 'docx' | 'xlsx' | 'pptx' | 'odt';

export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 경로 순회 여부 검사. */
export function isPathTraversal(name: string): boolean {
  if (name.includes('\x00')) return true;
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return true;
  return normalized.split('/').some(seg => seg === '..');
}

/** DTD 선언 제거(Billion Laughs / XXE 방어). */
export function stripDtd(xml: string): string {
  return xml.replace(/<!DOCTYPE\b[^>]*(\[[\s\S]*?\])?\s*>/gi, '');
}

/**
 * 압축을 풀지 않고 ZIP 엔트리 이름만 훑어 문서 형식을 판별한다.
 * 확장자가 없거나 잘못 붙은 첨부파일도 내부 구조로 정확히 구분한다.
 */
export function detectZipFormat(bytes: Uint8Array): ZipDocFormat | null {
  const names: string[] = [];
  let entryCount = 0;
  try {
    unzipSync(bytes, {
      filter: file => {
        if (++entryCount <= ZIP_MAX_ENTRIES && !isPathTraversal(file.name)) {
          names.push(file.name);
        }
        return false; // 압축 해제 없이 이름만 수집
      },
    });
  } catch {
    // 손상 ZIP은 Local File Header에서 이름만 스캔
    names.push(...scanZipEntryNames(bytes));
  }
  const lower = new Set(names.map(n => n.toLowerCase().replace(/\\/g, '/')));
  if (lower.has('xl/workbook.xml')) return 'xlsx';
  if (lower.has('word/document.xml')) return 'docx';
  if (lower.has('ppt/presentation.xml')) return 'pptx';
  if (lower.has('contents/content.hpf') || lower.has('content.hpf') || names.some(n => /(?:^|\/)section\d+\.xml$/i.test(n))) {
    return 'hwpx';
  }
  if (lower.has('content.xml') && (lower.has('mimetype') || lower.has('styles.xml') || lower.has('meta-inf/manifest.xml'))) {
    return 'odt';
  }
  return null;
}

function scanZipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  let count = 0;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  while (pos < bytes.length - 30 && count < ZIP_MAX_ENTRIES) {
    if (bytes[pos] !== 0x50 || bytes[pos + 1] !== 0x4b || bytes[pos + 2] !== 0x03 || bytes[pos + 3] !== 0x04) {
      pos++;
      continue;
    }
    count++;
    const compSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    if (nameLen > 1024 || extraLen > 65535) { pos += 4; continue; }
    const start = pos + 30 + nameLen + extraLen;
    if (start > bytes.length) break;
    const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen));
    if (!isPathTraversal(name)) names.push(name);
    pos = compSize > 0 && start + compSize <= bytes.length ? start + compSize : start;
  }
  return names;
}

/**
 * Central Directory가 손상된 ZIP에서 Local File Header(PK\x03\x04)를 직접 스캔해 조건에 맞는 텍스트 항목을 복구한다.
 */
export function recoverBrokenZipEntries(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let pos = 0;
  let totalDecompressed = 0;
  let entryCount = 0;

  while (pos < bytes.length - 30) {
    if (bytes[pos] !== 0x50 || bytes[pos + 1] !== 0x4b || bytes[pos + 2] !== 0x03 || bytes[pos + 3] !== 0x04) {
      pos++;
      continue;
    }
    if (++entryCount > ZIP_MAX_ENTRIES) break;
    const method = view.getUint16(pos + 8, true);
    const compSize = view.getUint32(pos + 18, true);
    const uncompSize = view.getUint32(pos + 22, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    if (nameLen > 1024 || extraLen > 65535) { pos += 4; continue; }

    const fileStart = pos + 30 + nameLen + extraLen;
    if (fileStart + compSize > bytes.length) break;
    if (compSize === 0 && method !== 0) { pos = fileStart; continue; }

    const name = decoder.decode(bytes.subarray(pos + 30, pos + 30 + nameLen)).replace(/\\/g, '/');
    const fileData = bytes.subarray(fileStart, fileStart + compSize);
    pos = fileStart + compSize;

    if (isPathTraversal(name) || !wanted(name)) continue;
    if (uncompSize > ZIP_ENTRY_MAX_BYTES) continue;

    try {
      let raw: Uint8Array;
      if (method === 0) raw = fileData;
      else if (method === 8) raw = inflateSync(fileData);
      else continue;
      if (raw.byteLength > ZIP_ENTRY_MAX_BYTES) continue;
      totalDecompressed += raw.byteLength;
      if (totalDecompressed > ZIP_TOTAL_MAX_BYTES) {
        throw new FileExtractError('압축 파일의 전체 해제 크기가 상한을 넘어 읽지 않았습니다.');
      }
      out[name] = strFromU8(raw);
    } catch (err) {
      if (err instanceof FileExtractError) throw err;
    }
  }
  return out;
}

/** 이름이 조건에 맞는 항목만 푼다. 누적 크기·엔트리 수·경로 순회를 검사한다. */
export function unzipEntries(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
  options: { allowBrokenRecovery?: boolean } = {},
): Record<string, string> {
  let tooLarge = '';
  let tooManyEntries = false;
  let totalDeclared = 0;
  let entryCount = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: file => {
        if (++entryCount > ZIP_MAX_ENTRIES) {
          tooManyEntries = true;
          return false;
        }
        const normalized = file.name.replace(/\\/g, '/');
        if (isPathTraversal(normalized)) return false;
        if (!wanted(normalized)) return false;
        if (file.originalSize > ZIP_ENTRY_MAX_BYTES) {
          tooLarge = normalized;
          return false;
        }
        totalDeclared += file.originalSize;
        if (totalDeclared > ZIP_TOTAL_MAX_BYTES) {
          tooLarge = normalized;
          return false;
        }
        return true;
      },
    });
  } catch {
    if (options.allowBrokenRecovery) {
      const recovered = recoverBrokenZipEntries(bytes, wanted);
      if (Object.keys(recovered).length > 0) return recovered;
    }
    throw new FileExtractError('파일이 손상되었거나 압축 형식을 읽을 수 없습니다.');
  }
  if (tooManyEntries) throw new FileExtractError('압축 파일의 항목 수가 너무 많아 읽지 않았습니다.');
  if (tooLarge) throw new FileExtractError(`파일 안의 '${tooLarge}' 항목이 너무 커서 읽지 않았습니다.`);

  let totalActual = 0;
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    const normalized = name.replace(/\\/g, '/');
    if (data.byteLength > ZIP_ENTRY_MAX_BYTES) {
      throw new FileExtractError(`파일 안의 '${normalized}' 항목이 너무 커서 읽지 않았습니다.`);
    }
    totalActual += data.byteLength;
    if (totalActual > ZIP_TOTAL_MAX_BYTES) {
      throw new FileExtractError('압축 파일의 전체 해제 크기가 상한을 넘어 읽지 않았습니다.');
    }
    out[normalized] = strFromU8(data);
  }
  return out;
}

export function parseXml(xml: string, label: string): Document {
  const cleaned = stripDtd(xml.replace(/^\uFEFF/, ''));
  const doc = new DOMParser().parseFromString(cleaned, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new FileExtractError(`${label}의 XML을 해석하지 못했습니다.`);
  return doc;
}

/** 접두사(hp:, w: 등)와 무관하게 요소 이름을 본다. */
export function isTag(node: Node, localName: string): node is Element {
  return node.nodeType === 1 && (node as Element).localName === localName;
}

export function childElements(el: Element): Element[] {
  return Array.from(el.childNodes).filter((node): node is Element => node.nodeType === 1);
}

export function firstChild(el: Element, localName: string): Element | undefined {
  return childElements(el).find(c => c.localName === localName);
}

export function descendants(el: Element | Document, localName: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter(e => e.localName === localName);
}

/** 접두사와 무관하게 속성 값을 읽는다. */
export function attr(el: Element, localName: string): string | null {
  for (const a of Array.from(el.attributes)) {
    if (a.localName === localName || a.name === localName) return a.value;
  }
  return null;
}

/** `section10.xml`이 `section2.xml`보다 뒤에 오도록 숫자로 정렬한다. */
export function sortByNumber(names: string[]): string[] {
  const num = (name: string) => Number(name.match(/(\d+)\.xml$/i)?.[1] ?? 0);
  return [...names].sort((a, b) => num(a) - num(b) || a.localeCompare(b));
}
