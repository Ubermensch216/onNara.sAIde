/**
 * 받은문서의 정체성 키.
 *
 * ★ 온나라 문서 ID를 읽을 수 있게 되면(계획서 P0-5) **이 파일만** 고친다.
 *   lib/cache/doc-results.ts가 같은 이유로 같은 구조를 쓴다.
 *
 * ★ 제목만으로는 안 된다. 같은 제목의 공문을 해마다, 기관마다 받는다.
 *   보고일자와 수발신자를 함께 묶어야 "그 문서"가 하나로 정해진다.
 *
 * ★ 제목은 화면 폭에 따라 줄여 그려진다(document-list.ts의 주석 참조). 그래서 제목을
 *   키에 넣되, 찾을 때는 **보고일자·수발신자 묶음(group) 안에서 제목을 견주는** 길을
 *   함께 둔다. 키가 어긋나도 같은 문서를 두 번 브리핑하지 않기 위해서다.
 */

import { normalizeForMatch } from '@/lib/onnara/document-list';
import type { InboxRow } from './types';

/** 줄임표를 떼어낸 제목. `…`·`...`은 화면이 붙인 것이지 공문의 일부가 아니다. */
export function trimEllipsis(title: string): string {
  return String(title ?? '').replace(/[.…]+$/u, '').trim();
}

/** 보고일자 표기를 `YYYY-MM-DD`로 맞춘다. `2026.09.18`·`2026-09-18`·`2026. 9. 18.`이 모두 같은 날이다. */
export function normalizeReportDate(value: string | undefined): string {
  const digits = /(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})/.exec(String(value ?? ''));
  if (!digits) return '';
  const pad = (part: string) => part.padStart(2, '0');
  return `${digits[1]}-${pad(digits[2]!)}-${pad(digits[3]!)}`;
}

/** 32비트 두 번을 이어 붙인 64비트 해시. 암호학적 용도가 아니라 같은 문서인지만 가린다. */
function hash(text: string): string {
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01000193)}`;
}

function fnv1a(text: string, basis: number): string {
  let value = basis >>> 0;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36).padStart(7, '0');
}

/** 보고일자·수발신자 묶음. 제목이 줄여 그려졌을 때 같은 문서를 찾는 범위다. */
export function inboxGroupKey(row: Pick<InboxRow, 'reportDate' | 'sender'>): string {
  return hash(`${normalizeReportDate(row.reportDate)}|${normalizeForMatch(row.sender)}`);
}

/** 문서 정체성. 같은 문서면 몇 번을 다시 읽어도 같은 값이다. */
export function inboxDocKey(row: Pick<InboxRow, 'title' | 'reportDate' | 'sender'>): string {
  return hash(`${inboxGroupKey(row)}|${normalizeForMatch(trimEllipsis(row.title))}`);
}
