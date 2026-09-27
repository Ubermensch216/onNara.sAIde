/**
 * XLSX(엑셀) 추출 — 시트별 행을 `칸 | 칸` 글자로 만든다.
 *
 * ★ 제출 대상 기관 목록, 사업별 예산표처럼 표 자체가 참고자료인 경우를 위한 것이다.
 *   수식은 저장된 결과값만 읽는다. 날짜 서식은 풀지 않으므로 날짜 칸은 일련번호로 보일 수 있다.
 */

import { childElements, isTag, parseXml, unzipEntries } from './zip';
import { tableRowText } from './blocks';
import { FileExtractError, type Block } from './types';

export const XLSX_MAX_SHEETS = 10;
export const XLSX_MAX_ROWS = 500;

function byTag(doc: Document | Element, localName: string): Element[] {
  return Array.from(doc.getElementsByTagName('*')).filter(el => el.localName === localName);
}

/** `AB12` → 27(0부터). */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

export function extractXlsx(bytes: Uint8Array): { blocks: Block[]; warnings: string[] } {
  const entries = unzipEntries(bytes, name =>
    name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels' || name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!entries['xl/workbook.xml']) throw new FileExtractError('XLSX 통합문서(xl/workbook.xml)를 찾지 못했습니다.');

  const shared = entries['xl/sharedStrings.xml']
    ? byTag(parseXml(entries['xl/sharedStrings.xml'], 'sharedStrings'), 'si').map(si => byTag(si, 't').map(t => t.textContent ?? '').join(''))
    : [];

  const rels = new Map<string, string>();
  if (entries['xl/_rels/workbook.xml.rels']) {
    for (const rel of byTag(parseXml(entries['xl/_rels/workbook.xml.rels'], 'workbook rels'), 'Relationship')) {
      const target = (rel.getAttribute('Target') ?? '').replace(/^\/?xl\//, '');
      rels.set(rel.getAttribute('Id') ?? '', `xl/${target}`);
    }
  }
  const sheets = byTag(parseXml(entries['xl/workbook.xml'], 'workbook'), 'sheet').map((sheet, index) => ({
    name: sheet.getAttribute('name') ?? `시트${index + 1}`,
    path: rels.get(sheet.getAttribute('r:id') ?? '') ?? `xl/worksheets/sheet${index + 1}.xml`,
  }));

  const blocks: Block[] = [];
  const warnings: string[] = [];
  if (sheets.length > XLSX_MAX_SHEETS) warnings.push(`시트가 ${sheets.length}개라 앞 ${XLSX_MAX_SHEETS}개만 읽었습니다.`);
  for (const [index, sheet] of sheets.slice(0, XLSX_MAX_SHEETS).entries()) {
    const xml = entries[sheet.path];
    if (!xml) continue;
    const rows = byTag(parseXml(xml, sheet.path), 'row');
    let kept = 0;
    for (const row of rows) {
      const cells: string[] = [];
      for (const c of childElements(row).filter(el => isTag(el, 'c'))) {
        const type = c.getAttribute('t');
        const v = childElements(c).find(el => isTag(el, 'v'))?.textContent ?? '';
        let value = v;
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = byTag(c, 't').map(t => t.textContent ?? '').join('');
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        const col = c.getAttribute('r') ? columnIndex(c.getAttribute('r')!) : cells.length;
        while (cells.length < col) cells.push('');
        cells[col] = value;
      }
      if (!cells.some(cell => cell.trim())) continue;
      kept += 1;
      if (kept > XLSX_MAX_ROWS) {
        warnings.push(`'${sheet.name}' 시트는 앞 ${XLSX_MAX_ROWS}행만 읽었습니다.`);
        break;
      }
      blocks.push({ kind: 'table-row', text: tableRowText(cells), table: index + 1, row: kept, sheet: sheet.name });
    }
  }
  return { blocks, warnings };
}
