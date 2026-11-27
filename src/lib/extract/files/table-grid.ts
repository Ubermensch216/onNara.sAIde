/**
 * 2-pass 병합 표 그리드 빌더 (HWPX · HWP5 · DOCX · XLSX · XLS · PPTX · ODT 공용).
 *
 * colSpan / rowSpan 및 절대 좌표(colAddr / rowAddr)를 정규 2차원 격자로 배치하여
 * 세로 병합(rowSpan)으로 다음 행 열이 밀리는 문제를 막고, 후행 빈 열을 정리한다.
 *
 * 출처·벤치마킹: chrisryugj/kordoc (MIT) src/table/builder.ts
 */

export const MAX_TABLE_COLS = 200;
export const MAX_TABLE_ROWS = 10_000;

export interface GridCellInput {
  text: string;
  colSpan?: number;
  rowSpan?: number;
  colAddr?: number;
  rowAddr?: number;
}

export interface BuildGridOptions {
  maxRows?: number;
  maxCols?: number;
  /** 병합으로 덮인 빈 행·열을 정리하지 않고 유지할지 여부(기본 false). */
  keepEmptyTrailingCols?: boolean;
}

function clampSpan(value: number | undefined, cap: number): number {
  if (!value || !Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), cap);
}

/**
 * 셀 목록을 열 정렬이 보장된 2차원 문자열 배열로 변환한다.
 * - `colAddr`/`rowAddr`가 있으면 절대 좌표 직접 배치(충돌 시 앞 셀에 이어 붙여 텍스트 손실 방지).
 * - 없으면 2-pass occupied 매트릭스로 `rowSpan`/`colSpan` 자리를 건너뛰어 배치.
 */
export function buildTableGrid(rows: GridCellInput[][], options: BuildGridOptions = {}): string[][] {
  const maxRows = options.maxRows ?? MAX_TABLE_ROWS;
  const maxCols = options.maxCols ?? MAX_TABLE_COLS;
  const limited = rows.length > maxRows ? rows.slice(0, maxRows) : rows;
  if (!limited.length) return [];

  const hasAddr = limited.some(row => row.some(c => c.colAddr !== undefined && c.rowAddr !== undefined));
  const grid = hasAddr
    ? buildDirect(limited, maxRows, maxCols)
    : buildSequential(limited, maxCols);

  if (!grid.length) return [];
  return trimTrailingEmptyCols(grid, options.keepEmptyTrailingCols ?? false);
}

function buildDirect(rows: GridCellInput[][], maxRows: number, maxCols: number): string[][] {
  let numRows = rows.length;
  let numCols = 0;
  const rowCap = Math.min(maxRows, numRows + rows.reduce((sum, r) => sum + r.length, 0) + 1);

  for (const row of rows) {
    for (const cell of row) {
      const cs = clampSpan(cell.colSpan, maxCols);
      const endCol = (cell.colAddr ?? 0) + cs;
      if (endCol > numCols) numCols = endCol;
      if (cell.rowAddr !== undefined && cell.rowAddr >= numRows) {
        numRows = Math.min(cell.rowAddr + 1, rowCap);
      }
    }
  }
  numCols = Math.min(numCols, maxCols);
  if (numRows === 0 || numCols === 0) return [];

  const grid: string[][] = Array.from({ length: numRows }, () => Array<string>(numCols).fill(''));
  const owner: (Array<{ r: number; c: number } | undefined>)[] = Array.from({ length: numRows }, () => new Array(numCols));

  for (let ri = 0; ri < rows.length; ri++) {
    for (const cell of rows[ri]!) {
      const text = cell.text.trim();
      const r = Math.min(cell.rowAddr ?? ri, numRows - 1);
      let c = cell.colAddr ?? 0;
      if (r < 0 || c < 0) continue;
      if (cell.colAddr === undefined) {
        while (c < numCols - 1 && owner[r]![c]) c++;
      }
      if (c >= numCols) c = numCols - 1;

      const existing = owner[r]![c];
      if (existing) {
        if (text) {
          const prev = grid[existing.r]![existing.c]!;
          grid[existing.r]![existing.c] = prev ? `${prev} ${text}` : text;
        }
        continue;
      }

      let cs = Math.min(clampSpan(cell.colSpan, numCols), numCols - c);
      for (let dc = 1; dc < cs; dc++) {
        if (owner[r]![c + dc]) { cs = dc; break; }
      }
      let rs = Math.min(clampSpan(cell.rowSpan, numRows), numRows - r);
      for (let dr = 1; dr < rs; dr++) {
        if (owner[r + dr]!.slice(c, c + cs).some(Boolean)) { rs = dr; break; }
      }

      grid[r]![c] = text;
      const anchor = { r, c };
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          owner[r + dr]![c + dc] = anchor;
        }
      }
    }
  }
  return grid;
}

function buildSequential(rows: GridCellInput[][], maxCols: number): string[][] {
  const numRows = rows.length;
  let numCols = 0;
  const tempOcc: boolean[][] = Array.from({ length: numRows }, () => []);

  // Pass 1: 실제 열 폭 계산
  for (let r = 0; r < numRows; r++) {
    let c = 0;
    for (const cell of rows[r]!) {
      while (c < maxCols && tempOcc[r]![c]) c++;
      if (c >= maxCols) break;
      const cs = clampSpan(cell.colSpan, maxCols - c);
      const rs = clampSpan(cell.rowSpan, numRows - r);
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) tempOcc[r + dr]![c + dc] = true;
      }
      c += cs;
      if (c > numCols) numCols = c;
    }
  }
  if (numCols === 0) return [];

  // Pass 2: 격자 배치
  const grid: string[][] = Array.from({ length: numRows }, () => Array<string>(numCols).fill(''));
  const occ: boolean[][] = Array.from({ length: numRows }, () => Array<boolean>(numCols).fill(false));

  for (let r = 0; r < numRows; r++) {
    let c = 0;
    for (const cell of rows[r]!) {
      while (c < numCols && occ[r]![c]) c++;
      if (c >= numCols) break;
      const cs = clampSpan(cell.colSpan, numCols - c);
      const rs = clampSpan(cell.rowSpan, numRows - r);
      grid[r]![c] = cell.text.trim();
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) occ[r + dr]![c + dc] = true;
      }
      c += cs;
    }
  }
  return grid;
}

function trimTrailingEmptyCols(grid: string[][], keepEmpty: boolean): string[][] {
  if (keepEmpty || !grid.length) return grid;
  let cols = grid[0]!.length;
  while (cols > 1 && grid.every(row => !row[cols - 1]?.trim())) cols--;
  if (cols === grid[0]!.length) return grid;
  return grid.map(row => row.slice(0, cols));
}
