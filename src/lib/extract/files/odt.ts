/**
 * ODT(온나라 2.0 내려받기 기본 형식) 본문 텍스트 추출.
 *
 * 구조: ZIP 안 `content.xml` → `office:body/office:text` → `text:h`/`text:p`/`table:table`/`draw:frame`.
 * 변경추적 삭제(`text:tracked-changes`)·선언부(`sequence-decls`/`variable-decls`)는 제외하고,
 * 표 병합(`number-columns-spanned`/`number-rows-spanned`)은 2-pass 그리드로 정렬한다.
 */

import { attr, childElements, firstChild, isTag, parseXml, unzipEntries } from './zip';
import { classifyLine, normalizeLine, tableRowText } from './blocks';
import { buildTableGrid, type GridCellInput } from './table-grid';
import { FileExtractError, type Block } from './types';

const SKIP_TAGS = new Set(['tracked-changes', 'sequence-decls', 'variable-decls', 'user-field-decls', 'annotation']);

function collectInlineText(el: Element, notes: string[], frames: Element[]): string {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      out += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    const name = child.localName;
    if (SKIP_TAGS.has(name)) continue;
    if (name === 's') {
      const count = Math.min(32, Math.max(1, Number(attr(child, 'c') ?? 1) || 1));
      out += ' '.repeat(count);
    } else if (name === 'tab' || name === 'line-break') {
      out += ' ';
    } else if (name === 'note') {
      const body = firstChild(child, 'note-body');
      const noteText = body ? normalizeLine(body.textContent ?? '') : '';
      if (noteText) notes.push(noteText);
    } else if (name === 'frame') {
      frames.push(child);
    } else {
      out += collectInlineText(child, notes, frames);
    }
  }
  return out;
}

function collectCellText(tc: Element): string {
  const parts: string[] = [];
  const walk = (el: Element) => {
    for (const child of childElements(el)) {
      const name = child.localName;
      if (SKIP_TAGS.has(name)) continue;
      if (name === 'p' || name === 'h') {
        const notes: string[] = [];
        const frames: Element[] = [];
        const t = normalizeLine(collectInlineText(child, notes, frames));
        if (t) parts.push(t);
        for (const f of frames) walk(f);
      } else if (name === 'table') {
        const nested = extractOdtTableGrid(child);
        const flat = nested.map(r => r.filter(Boolean).join(' / ')).filter(Boolean).join(' ; ');
        if (flat) parts.push(flat);
      } else {
        walk(child);
      }
    }
  };
  walk(tc);
  return normalizeLine(parts.join(' '));
}

function collectTableRows(el: Element, out: Element[]) {
  for (const child of childElements(el)) {
    const name = child.localName;
    if (name === 'table-row') out.push(child);
    else if (name === 'table-header-rows' || name === 'table-rows' || name === 'table-row-group') {
      collectTableRows(child, out);
    }
  }
}

function extractOdtTableGrid(tbl: Element): string[][] {
  const trs: Element[] = [];
  collectTableRows(tbl, trs);
  const rows: GridCellInput[][] = [];

  for (const tr of trs) {
    const rowRepeat = Math.min(20, Math.max(1, Number(attr(tr, 'number-rows-repeated') ?? 1) || 1));
    const row: GridCellInput[] = [];
    for (const child of childElements(tr)) {
      const name = child.localName;
      if (name === 'covered-table-cell') continue;
      if (name !== 'table-cell') continue;
      const colSpan = Math.max(1, Number(attr(child, 'number-columns-spanned') ?? 1) || 1);
      const rowSpan = Math.max(1, Number(attr(child, 'number-rows-spanned') ?? 1) || 1);
      const text = collectCellText(child);
      const colRepeat = text ? Math.min(20, Math.max(1, Number(attr(child, 'number-columns-repeated') ?? 1) || 1)) : 1;
      for (let k = 0; k < colRepeat; k++) {
        row.push({ text, colSpan, rowSpan });
      }
    }
    const repeat = row.some(c => c.text) ? rowRepeat : 1;
    for (let r = 0; r < repeat; r++) rows.push(row);
  }
  return buildTableGrid(rows);
}

export function extractOdtText(bytes: Uint8Array): Block[] {
  const entries = unzipEntries(bytes, name => name === 'content.xml');
  const xml = entries['content.xml'];
  if (!xml) throw new FileExtractError('ODT 본문(content.xml)을 찾지 못했습니다.');
  const doc = parseXml(xml, 'content.xml');
  const body = Array.from(doc.getElementsByTagName('*')).find(el => el.localName === 'text' && el.parentElement?.localName === 'body');
  if (!body) throw new FileExtractError('ODT 본문(office:text)을 찾지 못했습니다.');

  const blocks: Block[] = [];
  let tableCounter = 0;

  const walk = (el: Element) => {
    for (const child of childElements(el)) {
      const name = child.localName;
      if (SKIP_TAGS.has(name)) continue;
      if (name === 'p' || name === 'h') {
        const notes: string[] = [];
        const frames: Element[] = [];
        const text = normalizeLine(collectInlineText(child, notes, frames));
        if (text) {
          blocks.push(name === 'h' ? { kind: 'heading', text } : { ...classifyLine(text), text });
        }
        for (const note of notes) blocks.push({ kind: 'para', text: `(주석) ${note}` });
        for (const frame of frames) walk(frame);
      } else if (name === 'table') {
        const grid = extractOdtTableGrid(child);
        const nonEmpty = grid.filter(r => r.some(Boolean));
        if (nonEmpty.length) {
          tableCounter += 1;
          nonEmpty.forEach((cells, idx) => {
            blocks.push({ kind: 'table-row', text: tableRowText(cells), table: tableCounter, row: idx + 1 });
          });
        }
      } else if (isTag(child, 'list') || isTag(child, 'list-item') || isTag(child, 'section') || isTag(child, 'text-box') || isTag(child, 'frame')) {
        walk(child);
      }
    }
  };

  walk(body);
  return blocks;
}
