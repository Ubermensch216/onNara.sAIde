export type DocumentListField =
  | 'reportDate'
  | 'title'
  | 'department'
  | 'sender'
  | 'reporter'
  | 'body'
  | 'attachment'
  | 'status'
  | 'separation';

export interface DocumentListColumn {
  key: DocumentListField;
  label: string;
  sourceIndex: number;
}

export interface StructuredDocumentList {
  kind: 'onnara-document-list';
  listName: string;
  columns: DocumentListColumn[];
  rows: Array<Partial<Record<DocumentListField, string>>>;
}

const CONTAINER_SELECTOR = 'table, [role="table"], [role="grid"]';
const CELL_SELECTOR = 'th, td, [role="columnheader"], [role="cell"], [role="gridcell"]';

function cleanText(value: string | null | undefined, max = 500): string {
  return (value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function elementText(element: Element): string {
  return cleanText((element as HTMLElement).innerText || element.textContent);
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[\s()（）/·:：↕▲▼△▽]/g, '');
}

function fieldForHeader(label: string): DocumentListField | null {
  const value = normalizedHeader(label);
  if (value.includes('보고일자') || value.includes('접수일자') || value.includes('시행일자')) return 'reportDate';
  if (value === '제목' || value.includes('문서제목')) return 'title';
  if (value === '부서' || value.includes('담당부서')) return 'department';
  if (value.includes('수발신자') || value === '발신자' || value === '수신자') return 'sender';
  if (value.includes('보고자') || value.includes('담당자')) return 'reporter';
  if (value === '본문') return 'body';
  if (value.includes('붙임') || value.includes('첨부')) return 'attachment';
  if (value === '상태' || value.includes('처리상태')) return 'status';
  if (value === '분리') return 'separation';
  return null;
}

function isAvailable(element: Element): boolean {
  if ((element as HTMLElement).hidden || element.getAttribute('aria-hidden') === 'true') return false;
  const style = (element as HTMLElement).style;
  if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  const view = element.ownerDocument.defaultView;
  const computed = view?.getComputedStyle(element as HTMLElement);
  return computed?.display !== 'none' && computed?.visibility !== 'hidden';
}

function rowsOf(container: Element): Element[] {
  if (container instanceof HTMLTableElement) return [...container.rows];
  return [...container.querySelectorAll('[role="row"]')]
    .filter(row => row.closest(CONTAINER_SELECTOR) === container);
}

function cellsOf(row: Element): Element[] {
  return [...row.querySelectorAll(CELL_SELECTOR)].filter(cell => {
    const ownerRow = cell.closest('tr, [role="row"]');
    return ownerRow === row;
  });
}

function listName(root: ParentNode, container: Element): string {
  const caption = container.querySelector('caption');
  const aria = container.getAttribute('aria-label');
  const headings = [...root.querySelectorAll('h1, h2, h3, h4, [role="heading"]')];
  const received = headings.map(elementText).find(text => normalizedHeader(text).includes('받은문서'));
  return cleanText(received || (caption ? elementText(caption) : '') || aria || '받은문서', 80);
}

/**
 * 온나라 버전에 종속된 class/id 대신 HTML table과 ARIA grid 의미 구조를 읽는다.
 * 제목 열과 한 개 이상의 업무 열이 있는 표만 문서 목록으로 인정한다.
 */
export function extractStructuredDocumentList(root: ParentNode = document): StructuredDocumentList | null {
  let best: StructuredDocumentList | null = null;

  for (const container of root.querySelectorAll(CONTAINER_SELECTOR)) {
    if (!isAvailable(container)) continue;
    const rows = rowsOf(container).filter(isAvailable);
    if (rows.length < 2) continue;

    let headerIndex = -1;
    let columns: DocumentListColumn[] = [];
    for (let index = 0; index < Math.min(rows.length, 5); index++) {
      const candidate = cellsOf(rows[index]!);
      const mapped = candidate.map((cell, sourceIndex) => {
        const label = elementText(cell);
        const key = fieldForHeader(label);
        return key ? { key, label, sourceIndex } : null;
      }).filter((column): column is DocumentListColumn => Boolean(column));
      if (mapped.some(column => column.key === 'title') && mapped.length >= 2) {
        headerIndex = index;
        columns = mapped;
        break;
      }
    }
    if (headerIndex < 0) continue;

    const data: StructuredDocumentList['rows'] = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const cells = cellsOf(row);
      const record: Partial<Record<DocumentListField, string>> = {};
      for (const column of columns) {
        const cell = cells[column.sourceIndex];
        if (cell) record[column.key] = elementText(cell);
      }
      if (record.title) data.push(record);
      if (data.length >= 500) break;
    }
    if (!data.length) continue;

    const result: StructuredDocumentList = {
      kind: 'onnara-document-list',
      listName: listName(root, container),
      columns,
      rows: data,
    };
    if (!best || result.rows.length > best.rows.length) best = result;
  }

  return best;
}

export function serializeDocumentList(list: StructuredDocumentList): string {
  const lines = [
    '<onnara_document_list>',
    `목록: ${list.listName}`,
    `현재 화면 표시 문서: ${list.rows.length}건`,
  ];
  list.rows.forEach((row, index) => {
    const fields = list.columns
      .map(column => row[column.key] ? `${column.label}=${row[column.key]}` : '')
      .filter(Boolean)
      .join(' | ');
    lines.push(`행 ${index + 1} | ${fields}`);
  });
  lines.push('</onnara_document_list>');
  return lines.join('\n');
}

export function isDocumentListTableRequest(prompt: string): boolean {
  const compact = prompt.toLowerCase().replace(/\s+/g, '');
  const wantsTable = compact.includes('테이블') || compact.includes('표로') || compact.includes('table');
  const namesDocuments = compact.includes('받은문서') || compact.includes('문서목록') || compact.includes('receiveddocument');
  const wantsTitles = compact.includes('제목') || compact.includes('리스트') || compact.includes('목록');
  return wantsTable && namesDocuments && wantsTitles;
}

function markdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

export function buildDocumentTitleTable(prompt: string, list: StructuredDocumentList | undefined): string | null {
  if (!list || !isDocumentListTableRequest(prompt) || !list.rows.length) return null;
  const lines = [
    `현재 화면의 **${markdownCell(list.listName)}** 목록에서 ${list.rows.length}건의 문서 제목을 확인했습니다.`,
    '',
    '| 번호 | 문서 제목 |',
    '|---:|---|',
  ];
  list.rows.forEach((row, index) => lines.push(`| ${index + 1} | ${markdownCell(row.title ?? '')} |`));
  lines.push('', '※ 현재 화면에 렌더링된 목록 기준입니다. 다른 페이지의 항목은 포함하지 않았습니다.');
  return lines.join('\n');
}
