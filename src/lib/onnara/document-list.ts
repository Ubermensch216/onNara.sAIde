export type DocumentListField =
  | 'reportDate'
  | 'title'
  | 'department'
  | 'sender'
  | 'reporter'
  | 'body'
  | 'attachment'
  | 'status'
  | 'readState'
  | 'separation';

export interface DocumentListColumn {
  key: DocumentListField;
  label: string;
  sourceIndex: number;
}

export interface StructuredDocumentList {
  kind: 'onnara-document-list';
  listName: string;
  /** 화면이 스스로 `받은문서`라고 밝혔는가. 공유/공람 브리핑(N1)의 판정 근거다. */
  received?: boolean;
  columns: DocumentListColumn[];
  rows: Array<Partial<Record<DocumentListField, string>>>;
  selectedTitles?: string[];
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
  // ★ 열람 열을 상태 열보다 먼저 가린다. '열람상태'처럼 두 낱말이 붙은 머리글이 있어,
  //   순서를 바꾸면 열람 여부가 처리 상태로 읽혀 브리핑의 미열람 검증이 통째로 무너진다.
  if (value.includes('열람') || value.includes('읽음') || value.includes('수신확인')) return 'readState';
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

/**
 * 표에서 문서 목록으로 볼 수 있는 행.
 *
 * ★ 목록 추출과 "문서 열기" 대상 찾기가 **같은 함수**로 행과 머리글을 봐야 한다.
 *   한쪽만 숨은 행을 걸러내면 열 번호가 어긋나, 목록에는 있는 문서를 열지 못한다.
 */
function listRows(container: Element): Element[] {
  return rowsOf(container).filter(isAvailable);
}

/** 제목 열이 있는 머리글 행을 찾는다. 위쪽 몇 줄에 검색 조건 행이 있는 목록이 있어 앞부분을 훑는다. */
function findHeader(rows: Element[]): { index: number; columns: DocumentListColumn[] } | null {
  for (let index = 0; index < Math.min(rows.length, 5); index++) {
    const columns = cellsOf(rows[index]!).map((cell, sourceIndex) => {
      const label = elementText(cell);
      const key = fieldForHeader(label);
      return key ? { key, label, sourceIndex } : null;
    }).filter((column): column is DocumentListColumn => Boolean(column));
    if (columns.some(column => column.key === 'title') && columns.length >= 2) return { index, columns };
  }
  return null;
}

/**
 * 목록 이름과 "이 화면이 받은문서인가".
 *
 * ★ 이름만으로는 가릴 수 없다. 이름을 찾지 못한 목록의 기본 표시가 `받은문서`이기 때문이다.
 *   그래서 **화면이 실제로 그 이름을 밝혔는지**를 따로 돌려준다. 공유/공람 브리핑(N1)은
 *   이 판정 위에 서 있어, 기본값을 근거로 삼으면 엉뚱한 목록을 브리핑 대상으로 등록하게 된다.
 */
function listName(root: ParentNode, container: Element): { name: string; received: boolean } {
  const caption = container.querySelector('caption');
  const aria = container.getAttribute('aria-label');
  const headings = [...root.querySelectorAll('h1, h2, h3, h4, [role="heading"]')];
  const heading = headings.map(elementText).find(text => normalizedHeader(text).includes('받은문서'));
  const declared = heading || (caption ? elementText(caption) : '') || aria || '';
  return { name: cleanText(declared || '받은문서', 80), received: normalizedHeader(declared).includes('받은문서') };
}

/**
 * 빈 목록으로 인정할 머리글의 최소 열 수.
 *
 * ★ 행이 하나도 없는 표를 문서 목록으로 받아들이려면 머리글이 그만큼 확실해야 한다.
 *   제목 열 하나만 있는 표는 화면 어디에나 있다. 온나라 문서함 머리글은
 *   `보고일자·제목·부서·수(발)신자·보고자·본문·붙임·상태`처럼 여러 열을 갖는다.
 */
const EMPTY_LIST_MIN_COLUMNS = 3;

/**
 * 온나라 버전에 종속된 class/id 대신 HTML table과 ARIA grid 의미 구조를 읽는다.
 * 제목 열과 한 개 이상의 업무 열이 있는 표만 문서 목록으로 인정한다.
 *
 * ★ **행이 없는 목록도 목록이다.** 받은문서가 0건인 날(`해당 문서가 없습니다`)에도
 *   머리글은 그대로 있다. 예전에는 데이터 행이 없으면 표째 버려서, "목록이 없는 화면"과
 *   "비어 있는 목록"을 호출부가 구분할 수 없었다 — 문서가 0건인 날 브리핑 대상 지정이
 *   "화면에서 목록을 찾지 못했습니다"로 막혔다. 대신 머리글 조건을 높여 오인을 막는다.
 */
export function extractStructuredDocumentList(root: ParentNode = document, maxRows = 500): StructuredDocumentList | null {
  let best: StructuredDocumentList | null = null;

  for (const container of root.querySelectorAll(CONTAINER_SELECTOR)) {
    if (!isAvailable(container)) continue;
    const rows = listRows(container);
    if (!rows.length) continue;

    const header = findHeader(rows);
    if (!header) continue;
    const { index: headerIndex, columns } = header;

    const data: StructuredDocumentList['rows'] = [];
    const selectedTitles: string[] = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const cells = cellsOf(row);
      const record: Partial<Record<DocumentListField, string>> = {};
      for (const column of columns) {
        const cell = cells[column.sourceIndex];
        if (cell) record[column.key] = elementText(cell);
      }
      // 구형 온나라 목록은 화면 제목을 줄여 그리면서 원문을 hidden input에 둔다.
      const nativeTitle = row.querySelector<HTMLInputElement>('input[name="chkDocTitle"]')?.value;
      if (cleanText(nativeTitle)) record.title = cleanText(nativeTitle);
      if (record.title) data.push(record);
      if (record.title && row.querySelector('input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]')) selectedTitles.push(record.title);
      if (data.length >= maxRows) break;
    }
    if (!data.length && columns.length < EMPTY_LIST_MIN_COLUMNS) continue;

    const named = listName(root, container);
    const result: StructuredDocumentList = {
      kind: 'onnara-document-list',
      listName: named.name,
      ...(named.received ? { received: true } : {}),
      columns,
      rows: data,
      selectedTitles,
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

/* ── 받은문서(공유/공람) 판정 ──────────────────────────── */

/**
 * 이 목록이 `공유/공람 > 받은문서` 화면인가.
 *
 * ★ URL이나 메뉴 코드로 가리지 않는다. 온나라 판본마다 다르고, SPA는 목록을 바꿔도
 *   주소가 그대로다. 화면이 스스로 밝힌 이름(제목·caption·aria-label)만 근거로 삼는다.
 */
export function isReceivedDocumentList(list: StructuredDocumentList | null | undefined): boolean {
  return list?.received === true;
}

/** 열람 여부. 목록이 알려 주지 않으면 `unknown`이다 — 모르면 모른다고 한다. */
export type DocumentReadState = 'unread' | 'read' | 'unknown';

const UNREAD_WORDS = ['미열람', '안읽음', '읽지않음', '미확인', '미수신확인', '신규'];
const READ_WORDS = ['열람', '읽음', '확인'];

/**
 * 목록 행의 열람 여부.
 *
 * ★ 전용 열이 없는 판본이 있어 상태 칸도 함께 본다. 다만 상태 칸은 '접수'·'배부' 같은
 *   처리 단계를 담는 자리라, 열람과 무관한 글자를 열람으로 읽지 않도록 낱말을 못 박는다.
 *
 * ★ '미열람'이 '열람'을 포함하므로 **부정 낱말을 먼저** 가린다. 순서가 바뀌면
 *   모든 미열람 문서가 열람으로 집계되어, 브리핑이 "상태를 바꾸지 않았다"고 거짓말하게 된다.
 */
export function documentReadState(row: Partial<Record<DocumentListField, string>>): DocumentReadState {
  const value = normalizedHeader(`${row.readState ?? ''} ${row.status ?? ''}`);
  if (!value) return 'unknown';
  if (UNREAD_WORDS.some(word => value.includes(word))) return 'unread';
  if (READ_WORDS.some(word => value.includes(word))) return 'read';
  return 'unknown';
}

/**
 * 대조용 정규화. 공백·괄호·구두점 표기가 화면마다 달라 글자 그대로 비교하면 같은 말이 갈린다.
 *
 * ★ 한곳에 둔다. 제목 대조(이 파일)와 브리핑 키워드 대조(lib/inbox/scope.ts)가 서로 다른
 *   규칙을 쓰면, `예산 편성`으로 등록한 키워드가 `예산편성` 공문에 걸리지 않는 날이 온다.
 */
export function normalizeForMatch(value: string): string {
  return cleanText(value, Number.MAX_SAFE_INTEGER).normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

function searchable(value: string): string {
  return normalizeForMatch(value);
}

export function sameDocumentTitle(left: string, right: string): boolean {
  const normLeft = cleanText(left).normalize('NFC');
  const normRight = cleanText(right).normalize('NFC');
  if (normLeft === normRight) return true;
  const sLeft = searchable(normLeft);
  const sRight = searchable(normRight);
  if (!sLeft || !sRight) return false;
  if (sLeft === sRight) return true;
  if (sLeft.length >= 6 && sRight.length >= 6 && (sLeft.includes(sRight) || sRight.includes(sLeft))) {
    return true;
  }
  return false;
}

interface OpenCandidate {
  target: HTMLElement;
  /** 그 문서의 행. 읽기처리 체크박스를 찾을 때 쓴다. */
  row: Element;
  /** 그 행이 실제로 가리키는 문서 제목. 후보가 여럿일 때 같은 문서인지 가리는 기준이다. */
  rowTitle: string;
  /** 제목이 정확히 일치했는가(줄임·꼬리표 때문에 부분만 겹친 경우와 구분). */
  exact: boolean;
  checked: boolean;
}

/** 제목이 들어 있는 표 셀에서 실제 열기 동작을 가진 요소를 모은다. */
export function findDocumentOpenCandidates(title: string, root: ParentNode = document): OpenCandidate[] {
  const wanted = searchable(title);
  if (!wanted) return [];
  const candidates: OpenCandidate[] = [];
  for (const container of root.querySelectorAll(CONTAINER_SELECTOR)) {
    if (!isAvailable(container)) continue;
    const rows = listRows(container);
    const titleIndex = findHeader(rows)?.columns.find(column => column.key === 'title')?.sourceIndex;
    for (const row of rows) {
      const cells = cellsOf(row);
      const nativeTitle = row.querySelector<HTMLInputElement>('input[name="chkDocTitle"]');
      const nativeMatched = Boolean(nativeTitle && searchable(nativeTitle.value) === wanted);
      const exactCell = cells.find(cell => searchable(elementText(cell)) === wanted) ??
        (nativeMatched && titleIndex !== undefined ? cells[titleIndex] : undefined);
      // 화면이 긴 제목을 줄이거나 [긴급]·첨부 표시를 덧붙이면 칸 글자가 제목과 정확히 같지 않다.
      const partialCell = exactCell ? undefined : overlappingCell(cells, titleIndex, wanted);
      const titleCell = exactCell ?? partialCell;
      if (!titleCell) continue;
      const links = [...titleCell.querySelectorAll<HTMLElement>('a, button, [role="link"], [onclick], [ondblclick]')].filter(isAvailable);
      const interactive = pickOpenLink(links, wanted, nativeMatched);
      // 제목 칸에 누를 요소가 없으면 행 전체에 열기 동작을 거는 목록이 있다.
      const rowAction = !interactive && row.matches('[onclick], [ondblclick]') ? row as HTMLElement : undefined;
      const target = interactive ?? rowAction ?? (titleCell as HTMLElement);
      if (!isAvailable(target)) continue;
      candidates.push({
        target,
        row,
        rowTitle: cleanText(nativeTitle?.value) || elementText(titleCell),
        exact: Boolean(exactCell),
        checked: Boolean(row.querySelector('input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"]')),
      });
    }
  }
  return candidates;
}

/**
 * 제목 칸 후보 중 하나를 고른다.
 *
 * ★ 예전에는 후보가 둘 이상이면 무조건 포기했다. 그런데 온나라 목록은 머리글 표와 본문 표를
 *   따로 그리거나 같은 문서를 두 번 접수해 같은 제목이 여러 행에 나오는 일이 있다.
 *   가리키는 문서가 같으면 사용자가 체크한 행을, 없으면 첫 행을 연다.
 *   제목이 서로 다른 문서에 걸쳤을 때만 임의로 열지 않는다.
 */
function chooseOpenCandidate(candidates: OpenCandidate[]): OpenCandidate | null {
  const exact = candidates.filter(candidate => candidate.exact);
  const pool = exact.length ? exact : candidates;
  if (!pool.length) return null;
  if (new Set(pool.map(candidate => searchable(candidate.rowTitle))).size > 1) return null;
  return pool.find(candidate => candidate.checked) ?? pool[0]!;
}

export function findDocumentOpenTarget(title: string, root: ParentNode = document): HTMLElement | null {
  return chooseOpenCandidate(findDocumentOpenCandidates(title, root))?.target ?? null;
}

/** 제목으로 목록의 행 하나를 고른다. 여는 대상과 같은 규칙이라 다른 문서의 행을 집지 않는다. */
export function findDocumentRow(title: string, root: ParentNode = document): Element | null {
  return chooseOpenCandidate(findDocumentOpenCandidates(title, root))?.row ?? null;
}

/** 열 문서를 하나로 고르지 못한 이유. 오류 안내에 붙여 어디를 확인할지 알려 준다. */
export function describeOpenFailure(title: string, root: ParentNode = document): string {
  const candidates = findDocumentOpenCandidates(title, root);
  if (candidates.length > 1) {
    const titles = [...new Set(candidates.map(candidate => candidate.rowTitle))].slice(0, 3).join(' / ');
    return `제목이 겹치는 행이 ${candidates.length}건입니다: ${titles}`;
  }
  const list = extractStructuredDocumentList(root);
  if (!list?.rows.length) return '현재 화면에서 문서 목록 표를 찾지 못했습니다. 목록 화면에서 다시 요청하세요.';
  const samples = list.rows.slice(0, 3).flatMap(row => row.title ? [row.title] : []).join(' / ');
  return `목록 ${list.rows.length}건 중 제목이 일치하는 행이 없습니다. 현재 목록 제목 예: ${samples}`;
}

/** 제목 칸이 제목의 일부만 담고 있을 때 쓰는 느슨한 대조. 다른 문서까지 걸리지 않도록 길이를 제한한다. */
function overlappingCell(cells: Element[], titleIndex: number | undefined, wanted: string): Element | undefined {
  const overlaps = (value: string) => value.length >= 6 && wanted.length >= 6 &&
    value.length <= wanted.length * 3 && (value.includes(wanted) || wanted.includes(value));
  const byColumn = titleIndex !== undefined ? cells[titleIndex] : undefined;
  if (byColumn && overlaps(searchable(elementText(byColumn)))) return byColumn;
  return cells.find(cell => overlaps(searchable(elementText(cell))));
}

/**
 * 제목 칸 안에서 문서를 여는 링크를 고른다.
 *
 * ★ 온나라 목록은 제목 앞뒤에 [auto]·[긴급] 같은 표시를 링크 밖(또는 별도 링크)에 붙이고,
 *   긴 제목은 링크 글자를 말줄임한다. 그래서 링크 글자가 제목 전체를 담지 않는 경우가 흔하다.
 *   전체 제목을 담은 링크가 없으면, 제목의 일부를 담은 링크 중 가장 긴 것을 고른다.
 *   "[auto]"처럼 짧은 표시 링크를 제목 링크로 오인하지 않도록 최소 길이를 둔다.
 */
function pickOpenLink(candidates: HTMLElement[], wanted: string, nativeTitleMatched: boolean): HTMLElement | undefined {
  const scored = candidates.map(element => ({ element, text: searchable(elementText(element)) })).filter(item => item.text);
  const full = scored.find(item => item.text === wanted || item.text.includes(wanted));
  if (full) return full.element;
  const minLength = Math.max(4, Math.ceil(wanted.length * 0.3));
  const partial = scored
    .filter(item => item.text.length >= minLength && wanted.includes(item.text))
    .sort((left, right) => right.text.length - left.text.length)[0];
  if (partial) return partial.element;
  return nativeTitleMatched && candidates.length === 1 ? candidates[0] : undefined;
}

/** 오류 안내에 쓸, 실제로 누른 요소의 짧은 설명. */
export function describeOpenTarget(target: HTMLElement): string {
  const text = cleanText(target.innerText || target.textContent, 40);
  return `<${target.tagName.toLowerCase()}>${text ? ` "${text}"` : ''}`;
}

export function openDocumentTarget(target: HTMLElement): void {
  target.scrollIntoView({ block: 'center' });
  const usesDoubleClick = target.hasAttribute('ondblclick') ||
    !target.matches('a, button, [role="link"], [onclick]');
  if (usesDoubleClick) {
    // 링크가 아닌 칸·행은 목록 스크립트가 click이나 dblclick 중 무엇을 듣는지 알 수 없다.
    // 사용자가 실제로 두 번 누를 때와 같은 순서로 이벤트를 보낸다.
    const view = target.ownerDocument.defaultView;
    const EventCtor = view?.MouseEvent ?? MouseEvent;
    const fire = (type: string, detail: number) => target.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, detail }));
    for (const detail of [1, 2]) { fire('mousedown', detail); fire('mouseup', detail); fire('click', detail); }
    fire('dblclick', 2);
  } else {
    target.click();
  }
}
