/**
 * 형식별 해석기(ODT·HWPX)가 공통으로 내놓는 중간 결과.
 * 문단마다 글자·서식과 "어디에 있는 문단인지(본문/표)"를 담는다.
 */

import type { CharStyle, PageSetup, ParaStyle } from './types';

/**
 * approval = 결재란·등록번호 등 문서 틀(분석 제외)
 * title = 제목 상자, summary = 요약 상자, chapter = Ⅰ 대제목 막대, data = 일반 자료 표(분석 제외)
 */
export type TableKind = 'approval' | 'title' | 'summary' | 'chapter' | 'data';

export interface RawPara {
  /** 앞 공백을 포함한 문단 글자. */
  text: string;
  char: CharStyle;
  para: ParaStyle;
  /** 표 안 문단이면 표 번호·칸 번호. */
  table?: { id: number; cell: number };
}

export interface RawTable {
  id: number;
  kind: TableKind;
}

/**
 * 온나라 문서 틀 필드인지. 온나라 칸 필드는 `CellField번호¡이름¡…` 꼴이다.
 * ★ 업무보고의 제목 표에도 `CellField¡제목` 필드가 있다(실물 확인). 제목 필드만 있는 표는 문서 틀이 아니라 제목 상자다.
 */
export function isFrameField(name: string | null | undefined): boolean {
  if (!name || !/^CellField/.test(name)) return false;
  const label = name.split('¡')[1] ?? '';
  return label.replace(/\s+/g, '') !== '제목';
}

export interface RawDoc {
  paras: RawPara[];
  tables: RawTable[];
  page?: PageSetup;
  /** 본문 누름틀(온나라 '본문')로 범위를 좁혔는지. */
  bodyFieldUsed: boolean;
  notes: string[];
}

/**
 * 문단의 대표 글자 서식: 글자 수가 가장 많은 서식.
 * ★ 스타일 이름이 아니라 실제 값으로 센다. 한 문단이 같은 서식의 묶음 여러 개로 쪼개져 있으면
 *   이름으로 셀 때 '행 사 명' 같은 짧은 강조 묶음이 대표로 뽑힌다(실물 확인).
 */
export function dominantChar(segments: { text: string; char: CharStyle }[]): CharStyle {
  const weight = new Map<string, { char: CharStyle; n: number }>();
  for (const s of segments) {
    const key = JSON.stringify(s.char);
    const hit = weight.get(key) ?? { char: s.char, n: 0 };
    hit.n += s.text.replace(/\s/g, '').length;
    weight.set(key, hit);
  }
  return [...weight.values()].sort((a, b) => b.n - a.n)[0]?.char ?? segments[0]!.char;
}

const APPROVAL_WORDS = /^(?:등록번호|등록일자|결재일자|공개구분|기안자|검토자|결재권자|협조자|시행|접수|수신자?|경유|참조|주무관|팀장|과장|국장)$/;
const ROMAN = /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.．]?$|^[IVX]{1,4}[.．]?$/;

/**
 * 표 모양과 글자로 표의 쓰임을 정한다.
 * @param cells 칸별 글자(행 구분 없이 순서대로)
 * @param rows 행 수
 * @param protectedOrField 온나라 문서 틀 표시(ODT의 CellField 북마크·보호 칸)가 있는지
 */
export function classifyTable(cells: string[], rows: number, protectedOrField: boolean, nested = false): TableKind {
  if (protectedOrField) return 'approval';
  // 표 안의 표는 자료 표의 일부다. 상자 요소로 보지 않는다.
  if (nested) return 'data';
  const filled = cells.map(c => c.trim()).filter(Boolean);
  if (filled.filter(c => APPROVAL_WORDS.test(c.replace(/\s+/g, ''))).length >= 2) return 'approval';
  if (filled.length && /^제\s*목\s*[:：]?$/.test(filled[0]!)) return 'title';
  if (rows === 1 && filled.length === 2 && ROMAN.test(filled[0]!)) return 'chapter';
  if (rows === 1 && filled.length <= 1) return 'summary';
  return 'data';
}
