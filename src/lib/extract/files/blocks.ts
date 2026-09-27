/**
 * 덩어리 공통 처리 — 개조식 단계 판별, 덩어리 → 전체 글자.
 */

import type { Block } from './types';

/** 줄 머리의 공문 개조식 기호로 단계를 판별한다. 행정업무운영편람 순서(1. → 가. → (1) → 1) → 가) → (가)). */
const LEVEL_PATTERNS: Array<[RegExp, number]> = [
  [/^\d{1,2}\.\s/, 1],
  [/^[가-하]\.\s/, 2],
  [/^\(\d{1,2}\)\s?/, 3],
  [/^\d{1,2}\)\s/, 4],
  [/^[가-하]\)\s/, 5],
  [/^\([가-하]\)\s?/, 6],
];

/** 보고서형 문서의 큰 제목(□, Ⅰ., 제1장)과 글머리표. */
const HEADING_PATTERN = /^(?:[□■◆◇▣]\s*|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.．]\s*|제\s*\d+\s*[장절관]\s)/;
const BULLET_PATTERN = /^[-·•○◦▶▷※*]\s*/;

export function classifyLine(text: string): Pick<Block, 'kind' | 'level'> {
  const line = text.trim();
  for (const [pattern, level] of LEVEL_PATTERNS) {
    if (pattern.test(line)) return { kind: 'list', level };
  }
  if (HEADING_PATTERN.test(line) && line.length <= 60) return { kind: 'heading' };
  if (BULLET_PATTERN.test(line)) return { kind: 'list' };
  return { kind: 'para' };
}

export function normalizeLine(text: string): string {
  return text.normalize('NFC').replace(/[ 　\t ]+/g, ' ').trim();
}

/** 여러 줄 글자를 줄마다 덩어리로 나눈다. */
export function linesToBlocks(text: string, extra: Partial<Block> = {}): Block[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean)
    .map(line => ({ ...classifyLine(line), text: line, ...extra }));
}

/** 표 한 행. 빈 칸은 자리만 남겨 열 위치가 밀리지 않게 한다. */
export function tableRowText(cells: string[]): string {
  return cells.map(cell => normalizeLine(cell.replace(/\n+/g, ' '))).join(' | ');
}

/**
 * 덩어리를 이어 전체 글자를 만든다.
 * 표는 앞에 `[표 n]`을 붙이고, PDF는 쪽이 바뀔 때 `[n쪽]`을 붙인다. 근거 위치를 사람이 찾을 수 있게 한다.
 */
export function blocksToText(blocks: Block[]): string {
  const out: string[] = [];
  let page: number | undefined;
  let table: string | undefined;
  for (const block of blocks) {
    if (block.page !== undefined && block.page !== page) {
      page = block.page;
      out.push(`[${page}쪽]`);
    }
    const tableKey = block.kind === 'table-row' ? `${block.sheet ?? ''}#${block.table ?? ''}` : undefined;
    if (tableKey !== table) {
      table = tableKey;
      if (tableKey) out.push(block.sheet ? `[시트: ${block.sheet}]` : `[표 ${block.table}]`);
    }
    out.push(block.text);
  }
  return out.join('\n');
}
