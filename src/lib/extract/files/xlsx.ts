/**
 * XLSX(엑셀) 고도화 추출 — 시트별 행을 `칸 | 칸` 글자로 만든다.
 *
 * kordoc(MIT) 벤치마킹 반영 사항:
 *  - xl/styles.xml + workbookPr@date1904 기반 날짜 일련번호 → ISO 날짜(YYYY-MM-DD / YYYY-MM-DDTHH:mm:ss) 변환
 *    (ECMA-376 표준 14~22·45~47 및 한국어판 동아시아 내장 서식 27~36·50~58 + 커스텀 numFmt 지원)
 *  - IEEE 754 부동소수점 오차 정리 (132.30000000000001 → 132.3)
 *  - 병합 셀(mergeCells) 반영 및 2-pass 그리드 정렬
 *  - 공유 문자열/인라인 문자열에서 후리가나(<rPh>) 제외
 *  - 캐시값이 없는 수식 셀(=SUM(...)) 폴백, r 속성 생략 행/셀 순차 유도, 초대형 희소 시트 빈 열 압축
 */

import { attr, childElements, descendants, firstChild, isTag, parseXml, unzipEntries } from './zip';
import { tableRowText } from './blocks';
import { buildTableGrid, type GridCellInput } from './table-grid';
import { FileExtractError, type Block } from './types';

export const XLSX_MAX_SHEETS = 15;
export const XLSX_MAX_ROWS = 500;
const MAX_SHEET_COLS = 16_384;
const MAX_SHEET_ROWS = 1_048_576;
/** 이 열 수를 넘는 희소 시트는 빈 열을 압축해 토큰 낭비를 막는다. */
const SPARSE_COMPRESS_THRESHOLD = 20;

export type DateKind = 'date' | 'datetime';

/** ECMA-376 표준(14~22, 45~47) + 한국어판 동아시아 내장 날짜 서식(27~36, 50~58). */
const BUILTIN_DATE_FMT: ReadonlyMap<number, DateKind> = new Map<number, DateKind>([
  [14, 'date'], [15, 'date'], [16, 'date'], [17, 'date'],
  [18, 'datetime'], [19, 'datetime'], [20, 'datetime'], [21, 'datetime'], [22, 'datetime'],
  [45, 'datetime'], [46, 'datetime'], [47, 'datetime'],
  ...[27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58].map(id => [id, 'date'] as [number, DateKind]),
  [32, 'datetime'], [33, 'datetime'],
]);

/** 커스텀 formatCode가 날짜/시각 서식인지 판별한다. */
export function classifyDateFormat(code: string): DateKind | null {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  if (!/[ymdh]/i.test(stripped)) return null;
  return /[hs]/i.test(stripped) ? 'datetime' : 'date';
}

export function dateKindOfFmt(fmtId: number, customFormats: Map<number, string>): DateKind | null {
  const builtin = BUILTIN_DATE_FMT.get(fmtId);
  if (builtin) return builtin;
  const code = customFormats.get(fmtId);
  return code !== undefined ? classifyDateFormat(code) : null;
}

/** Excel 날짜 시리얼 → ISO 문자열 (1900 윤년 버그 및 date1904 반영). */
export function dateSerialToIso(serial: number, date1904: boolean, kind: DateKind): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  let days = serial;
  if (date1904) days += 1462;
  else if (days < 60) days += 1;
  const ms = Math.round((days - 25569) * 86_400_000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() > 9999) return null;
  const iso = d.toISOString();
  return kind === 'datetime' ? iso.slice(0, 19) : iso.slice(0, 10);
}

/** 부동소수점 아티팩트 정리 (132.30000000000001 → 132.3). */
export function cleanNumericValue(raw: string): string {
  if (!/^-?\d+\.\d+$/.test(raw)) return raw;
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return raw;
  return parseFloat(num.toPrecision(15)).toString();
}

function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2]!, 10) - 1 };
}

function parseMergeRef(ref: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const parts = ref.split(':');
  if (parts.length !== 2) return null;
  const s = parseCellRef(parts[0]!);
  const e = parseCellRef(parts[1]!);
  if (!s || !e || e.row < s.row || e.col < s.col) return null;
  return { r1: s.row, c1: s.col, r2: e.row, c2: e.col };
}

/** si/is 하위 텍스트 수집 — 후리가나(`<rPh>`) 하위 `<t>`는 제외한다. */
function collectRichText(root: Element): string {
  let out = '';
  const walk = (node: Element) => {
    for (const child of childElements(node)) {
      if (child.localName === 'rPh') continue;
      if (child.localName === 't') out += child.textContent ?? '';
      else walk(child);
    }
  };
  walk(root);
  return out;
}

function parseDateXfs(xml: string | undefined): Map<number, DateKind> {
  const dateXfs = new Map<number, DateKind>();
  if (!xml) return dateXfs;
  let doc: Document;
  try {
    doc = parseXml(xml, 'xl/styles.xml');
  } catch {
    return dateXfs;
  }
  const custom = new Map<number, string>();
  for (const nf of descendants(doc, 'numFmt')) {
    const id = Number(attr(nf, 'numFmtId'));
    if (Number.isFinite(id)) custom.set(id, attr(nf, 'formatCode') ?? '');
  }
  const cellXfs = descendants(doc, 'cellXfs')[0];
  if (!cellXfs) return dateXfs;
  const xfs = childElements(cellXfs).filter(el => isTag(el, 'xf'));
  xfs.forEach((xf, idx) => {
    const fmtId = Number(attr(xf, 'numFmtId'));
    if (!Number.isFinite(fmtId)) return;
    const kind = dateKindOfFmt(fmtId, custom);
    if (kind) dateXfs.set(idx, kind);
  });
  return dateXfs;
}

export interface SheetMerge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** XLSX · XLS 공용 시트 행/병합 → table-row 블록 변환. */
export function sheetRowsToBlocks(
  sheetName: string,
  sheetIndex: number,
  rowsMap: Map<number, string[]>,
  maxCol: number,
  merges: SheetMerge[],
  warnings: string[],
): Block[] {
  if (!rowsMap.size || maxCol < 0) return [];
  const rowNums = [...rowsMap.keys()].sort((a, b) => a - b);
  const nonEmptyRows = rowNums.filter(r => rowsMap.get(r)?.some(v => v?.trim()));
  if (!nonEmptyRows.length) return [];

  let keptRows = nonEmptyRows;
  if (keptRows.length > XLSX_MAX_ROWS) {
    warnings.push(`'${sheetName}' 시트는 앞 ${XLSX_MAX_ROWS}행만 읽었습니다.`);
    keptRows = keptRows.slice(0, XLSX_MAX_ROWS);
  }

  let keptCols: number[];
  if (maxCol < SPARSE_COMPRESS_THRESHOLD) {
    keptCols = Array.from({ length: maxCol + 1 }, (_, i) => i);
  } else {
    const used = new Set<number>();
    for (const r of keptRows) {
      rowsMap.get(r)!.forEach((v, c) => { if (v?.trim()) used.add(c); });
    }
    keptCols = [...used].sort((a, b) => a - b);
  }
  if (!keptCols.length) return [];

  const rowIdx = new Map(keptRows.map((r, i) => [r, i]));
  const colIdx = new Map(keptCols.map((c, i) => [c, i]));

  // 병합 범위 축소 매핑
  const mergeHead = new Map<string, { colSpan: number; rowSpan: number; text: string }>();
  const mergeCovered = new Set<string>();
  for (const m of merges) {
    const rr = keptRows.filter(r => r >= m.r1 && r <= m.r2);
    const cc = keptCols.filter(c => c >= m.c1 && c <= m.c2);
    if (!rr.length || !cc.length) continue;
    let text = rowsMap.get(m.r1)?.[m.c1] ?? '';
    for (let k = 0; !text && k < rr.length; k++) {
      for (const c of cc) { text = rowsMap.get(rr[k]!)?.[c] ?? ''; if (text) break; }
    }
    const r0 = rowIdx.get(rr[0]!)!;
    const c0 = colIdx.get(cc[0]!)!;
    mergeHead.set(`${r0},${c0}`, { colSpan: cc.length, rowSpan: rr.length, text });
    for (const r of rr) {
      for (const c of cc) {
        const ri = rowIdx.get(r)!;
        const ci = colIdx.get(c)!;
        if (ri !== r0 || ci !== c0) mergeCovered.add(`${ri},${ci}`);
      }
    }
  }

  const gridInput: GridCellInput[][] = keptRows.map((origR, ri) => {
    const src = rowsMap.get(origR)!;
    const row: GridCellInput[] = [];
    for (let ci = 0; ci < keptCols.length; ci++) {
      const key = `${ri},${ci}`;
      if (mergeCovered.has(key)) continue;
      const head = mergeHead.get(key);
      row.push({
        text: head ? head.text : (src[keptCols[ci]!] ?? ''),
        colSpan: head?.colSpan ?? 1,
        rowSpan: head?.rowSpan ?? 1,
        colAddr: ci,
        rowAddr: ri,
      });
    }
    return row;
  });

  const grid = buildTableGrid(gridInput, { maxRows: XLSX_MAX_ROWS, keepEmptyTrailingCols: false });
  const blocks: Block[] = [];
  let rowNo = 0;
  for (const cells of grid) {
    if (!cells.some(c => c.trim())) continue;
    rowNo += 1;
    blocks.push({ kind: 'table-row', text: tableRowText(cells), table: sheetIndex + 1, row: rowNo, sheet: sheetName });
  }
  return blocks;
}

export function extractXlsx(bytes: Uint8Array): { blocks: Block[]; warnings: string[] } {
  const entries = unzipEntries(bytes, name =>
    name === 'xl/workbook.xml' ||
    name === 'xl/_rels/workbook.xml.rels' ||
    name === 'xl/sharedStrings.xml' ||
    name === 'xl/styles.xml' ||
    /^xl\/worksheets\/[^/]+\.xml$/i.test(name),
  );
  if (!entries['xl/workbook.xml']) throw new FileExtractError('XLSX 통합문서(xl/workbook.xml)를 찾지 못했습니다.');

  const shared = entries['xl/sharedStrings.xml']
    ? descendants(parseXml(entries['xl/sharedStrings.xml'], 'sharedStrings'), 'si').map(collectRichText)
    : [];
  const dateXfs = parseDateXfs(entries['xl/styles.xml']);

  const rels = new Map<string, string>();
  if (entries['xl/_rels/workbook.xml.rels']) {
    for (const rel of descendants(parseXml(entries['xl/_rels/workbook.xml.rels'], 'workbook rels'), 'Relationship')) {
      const id = attr(rel, 'Id') ?? '';
      let target = (attr(rel, 'Target') ?? '').replace(/\\/g, '/');
      if (target.startsWith('/')) target = target.slice(1);
      else if (!target.startsWith('xl/')) target = `xl/${target}`;
      if (id) rels.set(id, target);
    }
  }

  const wbDoc = parseXml(entries['xl/workbook.xml'], 'workbook');
  const wbPr = descendants(wbDoc, 'workbookPr')[0];
  const date1904 = wbPr ? /^(?:1|true)$/i.test(attr(wbPr, 'date1904') ?? '') : false;

  const sheets = descendants(wbDoc, 'sheet').map((sheet, index) => ({
    name: attr(sheet, 'name') ?? `시트${index + 1}`,
    path: rels.get(attr(sheet, 'id') ?? '') ?? `xl/worksheets/sheet${index + 1}.xml`,
  }));

  const blocks: Block[] = [];
  const warnings: string[] = [];
  if (sheets.length > XLSX_MAX_SHEETS) warnings.push(`시트가 ${sheets.length}개라 앞 ${XLSX_MAX_SHEETS}개만 읽었습니다.`);

  for (const [index, sheet] of sheets.slice(0, XLSX_MAX_SHEETS).entries()) {
    const xml = entries[sheet.path];
    if (!xml) continue;
    const sheetDoc = parseXml(xml, sheet.path);
    const rowsMap = new Map<number, string[]>();
    let maxCol = -1;
    let prevRow = -1;

    for (const rowEl of descendants(sheetDoc, 'row')) {
      const rAttr = attr(rowEl, 'r');
      const rowNum = rAttr !== null ? parseInt(rAttr, 10) - 1 : prevRow + 1;
      if (!Number.isFinite(rowNum) || rowNum < 0 || rowNum >= MAX_SHEET_ROWS) continue;
      prevRow = rowNum;

      let prevCol = -1;
      for (const c of childElements(rowEl).filter(el => isTag(el, 'c'))) {
        const ref = attr(c, 'r');
        const pos = ref ? parseCellRef(ref) : { col: prevCol + 1, row: rowNum };
        if (!pos || pos.col < 0 || pos.col >= MAX_SHEET_COLS || pos.row < 0 || pos.row >= MAX_SHEET_ROWS) continue;
        prevCol = pos.col;

        const type = attr(c, 't');
        const vEl = firstChild(c, 'v');
        const fEl = firstChild(c, 'f');
        let value = '';

        if (vEl) {
          const raw = (vEl.textContent ?? '').trim();
          if (type === 's') {
            value = shared[Number(raw)] ?? '';
          } else if (type === 'b') {
            value = raw === '1' ? 'TRUE' : 'FALSE';
          } else {
            value = cleanNumericValue(raw);
            if (!type || type === 'n') {
              const sAttr = attr(c, 's');
              const kind = sAttr !== null ? dateXfs.get(parseInt(sAttr, 10)) : undefined;
              if (kind) {
                const iso = dateSerialToIso(parseFloat(raw), date1904, kind);
                if (iso) value = iso;
              }
            }
          }
        } else if (type === 'inlineStr') {
          const isEl = firstChild(c, 'is');
          value = isEl ? collectRichText(isEl) : collectRichText(c);
        }

        if (!value && fEl?.textContent?.trim()) {
          value = `=${fEl.textContent.trim()}`;
        }

        if (value) {
          let rowArr = rowsMap.get(pos.row);
          if (!rowArr) rowsMap.set(pos.row, (rowArr = []));
          rowArr[pos.col] = value;
          if (pos.col > maxCol) maxCol = pos.col;
        }
      }
    }

    const merges: SheetMerge[] = [];
    for (const mc of descendants(sheetDoc, 'mergeCell')) {
      const m = parseMergeRef(attr(mc, 'ref') ?? '');
      if (m) merges.push(m);
    }

    blocks.push(...sheetRowsToBlocks(sheet.name, index, rowsMap, maxCol, merges, warnings));
  }

  return { blocks, warnings };
}
