/**
 * 단위 환산. 서식 값은 한글 기준(pt·%)으로 저장한다.
 */

/** HWPUNIT: 1pt = 100, 1inch = 7200. */
export const HWPUNIT_PER_PT = 100;

/** ODT 길이('3.257cm', '12pt', '0.5in')를 pt로. 해석하지 못하면 undefined. */
export function lengthToPt(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*(cm|mm|in|pt|pc|px)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'cm': return n * 72 / 2.54;
    case 'mm': return n * 72 / 25.4;
    case 'in': return n * 72;
    case 'pc': return n * 12;
    case 'px': return n * 0.75;
    default: return n;
  }
}

export function ptToMm(pt: number): number {
  return pt * 25.4 / 72;
}

export function hwpunitToPt(value: number): number {
  return value / HWPUNIT_PER_PT;
}

export function percent(value: string | null | undefined): number | undefined {
  const m = value?.trim().match(/^(-?\d+(?:\.\d+)?)%$/);
  return m ? Number(m[1]) : undefined;
}

/**
 * ODT 줄간격(%) → 한글 줄간격(%).
 *
 * ★ 한컴 변환기가 내보낸 ODT는 한글 160%를 123%, 170%를 131%, 180%를 138%로 적는다
 *   (올려 준 실물 문서에서 관찰). 기준 높이가 달라 약 1.3배 차이가 난다.
 *   한글 사용자는 5% 단위로 고르므로 5% 단위로 반올림한다. 같은 문서를 두 형식으로 받아 확정해야 하는 추정값이다.
 */
export const ODT_LINE_HEIGHT_FACTOR = 1.3;

export function odtLineHeightToHwp(pct: number): number {
  return Math.round(pct * ODT_LINE_HEIGHT_FACTOR / 5) * 5;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
