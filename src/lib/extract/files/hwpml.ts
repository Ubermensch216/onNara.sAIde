/**
 * HWPML 2.x(XML 기반 한글 문서, .hml 또는 XML 형식 .hwp) 순수 브라우저 파서.
 *
 * kordoc(MIT) src/hwpml/parser.ts 벤치마킹:
 *  - HEAD/MAPPINGTABLE/PARASHAPELIST의 Outline 헤딩 판정
 *  - BODY/SECTION/P/TEXT/CHAR 본문 추출 (TAB/LINEBREAK/NBSPACE/FWSPACE 처리)
 *  - TABLE/ROW/CELL 병합(ColAddr/RowAddr/ColSpan/RowSpan) 2-pass 그리드 복원
 *  - FOOTNOTE/ENDNOTE 주석 및 EQUATION/SCRIPT 수식 추출, HEADER/FOOTER/HIDDENCOMMENT 제외
 */

import { attr, childElements, descendants, firstChild, parseXml } from './zip';
import { classifyLine, normalizeLine, tableRowText } from './blocks';
import { hwpEquationToText } from './equation';
import { buildTableGrid, type GridCellInput } from './table-grid';
import { FileExtractError, type Block } from './types';

const SKIP = new Set(['HEADER', 'FOOTER', 'HIDDENCOMMENT', 'PAGENUM', 'PAGEHIDING', 'SECDEF', 'COLDEF', 'PICTURE']);

/** 앞부분 512바이트에 `<?xml` + `<HWPML`이 있으면 HWPML로 판별한다. */
export function isHwpmlBytes(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(512, bytes.byteLength)))
    .replace(/^\uFEFF/, '')
    .trimStart();
  return head.startsWith('<?xml') && head.includes('<HWPML');
}

function collectCharText(el: Element): string {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      out += node.nodeValue ?? '';
    } else if (node.nodeType === 1) {
      const tag = (node as Element).localName.toUpperCase();
      if (tag === 'LINEBREAK') out += '\n';
      else if (tag === 'TAB' || tag === 'FWSPACE' || tag === 'NBSPACE') out += ' ';
      else out += collectCharText(node as Element);
    }
  }
  return out;
}

function extractHwpmlTable(tbl: Element): string[][] {
  const rows: GridCellInput[][] = [];
  for (const rowEl of childElements(tbl).filter(e => e.localName.toUpperCase() === 'ROW')) {
    const row: GridCellInput[] = [];
    for (const cellEl of childElements(rowEl).filter(e => e.localName.toUpperCase() === 'CELL')) {
      const colAddr = Number(attr(cellEl, 'ColAddr'));
      const rowAddr = Number(attr(cellEl, 'RowAddr'));
      const colSpan = Math.max(1, Number(attr(cellEl, 'ColSpan') ?? 1) || 1);
      const rowSpan = Math.max(1, Number(attr(cellEl, 'RowSpan') ?? 1) || 1);
      const parts: string[] = [];
      for (const p of descendants(cellEl, 'P').concat(descendants(cellEl, 'p'))) {
        const t = normalizeLine(extractParaPlain(p));
        if (t) parts.push(t);
      }
      row.push({
        text: parts.join(' '),
        colSpan,
        rowSpan,
        ...(Number.isFinite(colAddr) ? { colAddr } : {}),
        ...(Number.isFinite(rowAddr) ? { rowAddr } : {}),
      });
    }
    rows.push(row);
  }
  return buildTableGrid(rows);
}

function extractParaPlain(p: Element): string {
  let out = '';
  const walk = (el: Element) => {
    for (const child of childElements(el)) {
      const tag = child.localName.toUpperCase();
      if (SKIP.has(tag) || tag === 'TABLE') continue;
      if (tag === 'CHAR') out += collectCharText(child);
      else if (tag === 'EQUATION') {
        const script = childElements(child).find(c => c.localName.toUpperCase() === 'SCRIPT');
        if (script) {
          const eq = hwpEquationToText(script.textContent ?? '');
          if (eq) out += ` ${eq} `;
        }
      } else {
        walk(child);
      }
    }
  };
  walk(p);
  return out;
}

export function extractHwpml(bytes: Uint8Array): Block[] {
  const raw = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes)
    .replace(/^\uFEFF/, '')
    .replace(/&nbsp;/g, '&#160;');
  const doc = parseXml(raw, 'HWPML');
  const root = doc.documentElement;
  if (!root || root.localName.toUpperCase() !== 'HWPML') {
    throw new FileExtractError('올바른 HWPML 문서가 아닙니다.');
  }

  // HEAD → Outline ParaShape 수집
  const outlineShapes = new Set<string>();
  for (const ps of Array.from(doc.getElementsByTagName('*')).filter(e => e.localName.toUpperCase() === 'PARASHAPE')) {
    if ((attr(ps, 'HeadingType') ?? '').toUpperCase() === 'OUTLINE') {
      const id = attr(ps, 'Id');
      if (id) outlineShapes.add(id);
    }
  }

  const body = childElements(root).find(e => e.localName.toUpperCase() === 'BODY');
  if (!body) throw new FileExtractError('HWPML 본문(BODY)을 찾지 못했습니다.');

  const blocks: Block[] = [];
  let tableCounter = 0;

  const emitPara = (p: Element) => {
    const isOutline = outlineShapes.has(attr(p, 'ParaShape') ?? '');
    let text = '';
    const flush = () => {
      for (const line of text.split('\n').map(normalizeLine).filter(Boolean)) {
        const classified = classifyLine(line);
        blocks.push(isOutline && classified.kind === 'para' ? { kind: 'heading', text: line } : { ...classified, text: line });
      }
      text = '';
    };

    const visit = (el: Element) => {
      for (const child of childElements(el)) {
        const tag = child.localName.toUpperCase();
        if (SKIP.has(tag)) continue;
        if (tag === 'CHAR') {
          text += collectCharText(child);
        } else if (tag === 'EQUATION') {
          const script = childElements(child).find(c => c.localName.toUpperCase() === 'SCRIPT');
          if (script) {
            const eq = hwpEquationToText(script.textContent ?? '');
            if (eq) text += ` ${eq} `;
          }
        } else if (tag === 'TABLE') {
          flush();
          const grid = extractHwpmlTable(child);
          const nonEmpty = grid.filter(r => r.some(Boolean));
          if (nonEmpty.length) {
            tableCounter += 1;
            nonEmpty.forEach((cells, idx) => {
              blocks.push({ kind: 'table-row', text: tableRowText(cells), table: tableCounter, row: idx + 1 });
            });
          }
        } else if (tag === 'FOOTNOTE' || tag === 'ENDNOTE') {
          const noteLines: string[] = [];
          const sub = firstChild(child, 'PARALIST') ?? child;
          for (const np of childElements(sub).filter(e => e.localName.toUpperCase() === 'P')) {
            const t = normalizeLine(extractParaPlain(np));
            if (t) noteLines.push(t);
          }
          if (noteLines.length) {
            flush();
            blocks.push({ kind: 'para', text: `(주석) ${noteLines.join(' ')}` });
          }
        } else if (tag === 'DRAWTEXT' || tag === 'PARALIST') {
          flush();
          for (const inner of childElements(child).filter(e => e.localName.toUpperCase() === 'P')) emitPara(inner);
        } else {
          visit(child);
        }
      }
    };
    visit(p);
    flush();
  };

  for (const sec of childElements(body).filter(e => e.localName.toUpperCase() === 'SECTION')) {
    for (const p of childElements(sec).filter(e => e.localName.toUpperCase() === 'P')) emitPara(p);
  }

  return blocks;
}
