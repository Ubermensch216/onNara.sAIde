/**
 * HWPX·DOCX·XLSX는 모두 XML을 담은 ZIP이다. 필요한 항목만 풀어 XML 문서로 읽는다.
 *
 * ★ 풀린 크기를 먼저 본다. 작은 ZIP이 수 GB로 풀리는 파일(압축 폭탄)이 드로어를 멈추게 하지 않도록,
 *   항목 하나가 상한을 넘으면 풀기 전에 거절한다.
 */

import { strFromU8, unzipSync } from 'fflate';
import { FileExtractError } from './types';

/** 항목 하나의 풀린 크기 상한. 공문 본문 XML은 수 MB를 넘지 않는다. */
export const ZIP_ENTRY_MAX_BYTES = 40 * 1024 * 1024;

export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 이름이 조건에 맞는 항목만 푼다. */
export function unzipEntries(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, string> {
  let tooLarge = '';
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: file => {
        if (!wanted(file.name)) return false;
        if (file.originalSize > ZIP_ENTRY_MAX_BYTES) {
          tooLarge = file.name;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new FileExtractError('파일이 손상되었거나 압축 형식을 읽을 수 없습니다.');
  }
  if (tooLarge) throw new FileExtractError(`파일 안의 '${tooLarge}' 항목이 너무 커서 읽지 않았습니다.`);
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) out[name] = strFromU8(data);
  return out;
}

export function parseXml(xml: string, label: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
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

/** `section10.xml`이 `section2.xml`보다 뒤에 오도록 숫자로 정렬한다. */
export function sortByNumber(names: string[]): string[] {
  const num = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  return [...names].sort((a, b) => num(a) - num(b));
}
