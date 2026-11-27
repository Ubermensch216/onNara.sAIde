/**
 * PDF 좌표 기반 레이아웃 복원 및 한국 공문서 텍스트 정제.
 *
 * kordoc(MIT) src/pdf/{text-line,xy-cut,text-clean,line-wrap,quality}.ts 벤치마킹:
 *  - pdf.js TextItem(transform·width·height) 기반 줄 그룹핑 + 숨긴 텍스트 필터링 + 가짜 볼드 중복 제거
 *  - XY-Cut 기반 2단 편집 읽기 순서 복원 (전폭 제목 → 좌단 → 우단 → 전폭 하단)
 *  - 좌표 정렬 기반 표 행(`칸 | 칸`) 감지
 *  - 한컴 PDF 특유 텍스트 정제: 아래아(U+119E→ㆍ), 홀로 선 초성(U+1100~1112→호환 자모),
 *    U+F000/제어문자 제거, 균등배분 복원("홍 보 담 당 관"→"홍보담당관")
 *  - 한글 어절 중간 자동 줄바꿈 병합 (조사/어미 + 문서 내 어휘 증거 WrapLexicon)
 *  - 다쪽 반복 머리글·바닥글 및 쪽번호(- 2 -, 1 / 5) 제거
 *  - 페이지별 텍스트 품질 진단 (스캔·ToUnicode 깨짐 감지)
 */

import { mapPuaText, stripControlChars } from './files/pua';

export interface PdfRawTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
}

interface NormItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  seq: number;
}

export interface PdfQualitySummary {
  totalChars: number;
  garbledRatio: number;
  suspectedGarbled: boolean;
}

// ── 1. 한컴 PDF 문자 정제 ──

const CHOSEONG_COMPAT = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** 한컴 PDF가 가운뎃점(ㆍ U+318D)을 조합형 아래아(U+119E)로 내는 현상 복원. */
export function normalizeAraea(text: string): string {
  return text.replace(/(?<![\u1100-\u115f])\u119e/g, '\u318d');
}

/** 홀로 선 조합형 초성(U+1100~1112, 뒤에 중성 없음)을 호환 자모(ㄱ~ㅎ)로 복원. */
export function normalizeLoneChoseong(text: string): string {
  if (!/[\u1100-\u1112]/.test(text)) return text;
  return text.replace(/[\u1100-\u1112](?![\u1160-\u11a7\ud7b0-\ud7c6])/g, ch => CHOSEONG_COMPAT[ch.charCodeAt(0) - 0x1100]!);
}

/** 균등배분 텍스트("홍 보 담 당 관" → "홍보담당관") 복원. 2글자 정상 단어와 날짜 빈칸은 보호한다. */
export function collapseEvenSpacing(text: string): string {
  // 한글 1글자가 3개 이상 연속 띄어 쓰인 구간만 붙인다 (앞뒤가 공백/줄끝 경계)
  return text.replace(/(?<![^\s])[가-힣](?: [가-힣]){2,}(?![^\s])/g, match => {
    const compact = match.replace(/ /g, '');
    // "년 월 일" 같은 날짜 빈칸 양식은 유지
    if (/^(?:년월일|시분초)$/.test(compact)) return match;
    return compact;
  });
}

export function cleanPdfChars(text: string): string {
  return normalizeLoneChoseong(normalizeAraea(stripControlChars(mapPuaText(text))));
}

/** 페이지 원시 문자열의 ToUnicode 깨짐·PUA 오염 비율을 계산한다. */
export function assessPdfQuality(rawTexts: string[]): PdfQualitySummary {
  let total = 0;
  let garbled = 0;
  for (const raw of rawTexts) {
    for (const ch of raw) {
      if (/\s/.test(ch)) continue;
      total++;
      const cp = ch.codePointAt(0)!;
      if (
        cp === 0xfffd ||
        cp === 0xf000 ||
        (cp >= 0xe000 && cp <= 0xf8ff) ||
        cp >= 0xf0000 ||
        (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d)
      ) {
        garbled++;
      }
    }
  }
  const garbledRatio = total > 0 ? garbled / total : 0;
  return { totalChars: total, garbledRatio, suspectedGarbled: total >= 20 && garbledRatio >= 0.25 };
}

// ── 2. 좌표 정규화 · 줄 그룹핑 · XY-Cut ──

function normalizeItems(items: PdfRawTextItem[], pageWidth?: number, pageHeight?: number): NormItem[] {
  const out: NormItem[] = [];
  const margin = Math.max(pageWidth ?? 0, pageHeight ?? 0) * 0.1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const raw = item.str ?? '';
    if (!raw || !raw.trim()) continue;
    const t = item.transform;
    if (!t || t.length < 6) continue;
    const fontSize = Math.max(Math.hypot(t[0]!, t[1]!), Math.hypot(t[2]!, t[3]!), item.height ?? 0);
    if (fontSize < 0.5) continue; // 0pt 숨긴 텍스트 제외

    const x = t[4]!;
    const y = t[5]!;
    const w = item.width && item.width > 0 ? item.width : Math.max(fontSize * 0.5 * raw.length, 1);
    const h = item.height && item.height > 0 ? item.height : fontSize;

    // 페이지 영역 밖 숨긴 텍스트 제외
    if (pageWidth && pageHeight) {
      if (x + w < -margin || x > pageWidth + margin || y < -margin || y > pageHeight + margin) continue;
    }

    // 가짜 볼드(동일 문자열을 0.5pt 내로 덧찍은 중복) 제거
    const prev = out[out.length - 1];
    if (prev && prev.text === raw && Math.abs(prev.x - x) < 1 && Math.abs(prev.y - y) < 1) continue;

    out.push({ text: raw, x, y, w, h, fontSize, seq: i });
  }
  return out;
}

interface TextLine {
  y: number;
  x1: number;
  x2: number;
  fontSize: number;
  items: NormItem[];
  text: string;
}

function groupByY(items: NormItem[]): TextLine[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: NormItem[][] = [];

  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last) {
      const refY = last[0]!.y;
      const tol = Math.max(2, Math.min(last[0]!.fontSize, item.fontSize) * 0.45);
      if (Math.abs(item.y - refY) <= tol) {
        last.push(item);
        continue;
      }
    }
    groups.push([item]);
  }

  return groups.map(row => {
    // x 정렬 (1pt 이내 근접 겹침은 스트림 순서 보존)
    row.sort((a, b) => (Math.abs(a.x - b.x) <= 1 ? a.seq - b.seq : a.x - b.x));
    const fontSize = row.reduce((s, it) => s + it.fontSize, 0) / row.length;
    const text = joinRowItems(row, fontSize);
    const x1 = Math.min(...row.map(it => it.x));
    const x2 = Math.max(...row.map(it => it.x + it.w));
    return { y: row[0]!.y, x1, x2, fontSize, items: row, text };
  });
}

function joinRowItems(row: NormItem[], avgFont: number): string {
  if (!row.length) return '';
  let out = row[0]!.text;
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1]!;
    const cur = row[i]!;
    const gap = cur.x - (prev.x + prev.w);
    const fs = Math.min(prev.fontSize, cur.fontSize) || avgFont;
    // 공백 판단: 글자 크기의 18% 이상 틈이 있으면 띄어쓰기 (단, 이미 앞뒤 공백이 있으면 중복 생략)
    if (gap > fs * 0.18 && !out.endsWith(' ') && !cur.text.startsWith(' ')) {
      out += ' ';
    }
    out += cur.text;
  }
  return out;
}

/** XY-Cut 기반 2단/다영역 읽기 순서 정렬. 단일 단 공문서는 위→아래 순서를 그대로 보존한다. */
function xyCutOrder(items: NormItem[], depth = 0): NormItem[][] {
  if (items.length <= 4 || depth >= 16) return [items];

  const medianFs = median(items.map(i => i.fontSize)) || 10;
  const minX = Math.min(...items.map(i => i.x));
  const maxX = Math.max(...items.map(i => i.x + i.w));
  const spanW = maxX - minX;

  // 1. 수평 컷(큰 문단/섹션 단절) 먼저 탐색
  const lines = groupByY(items);
  let bestHGap = 0;
  let bestHY = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    const gap = lines[i]!.y - lines[i + 1]!.y - lines[i]!.fontSize;
    if (gap > bestHGap) {
      bestHGap = gap;
      bestHY = (lines[i]!.y + lines[i + 1]!.y) / 2;
    }
  }

  // 2. 수직 컷(2단 거터) 탐색 — 전체 폭이 충분히 넓고(>= 200pt) 좌우 모두 여러 줄 산문이 있을 때만
  let bestVGap = 0;
  let bestVX = 0;
  if (spanW >= 200 && lines.length >= 3) {
    // 좁은 아웃라이어 제외 없이 전체 아이템 X 구간 투영
    const intervals = items.map(it => [it.x, it.x + it.w] as [number, number]).sort((a, b) => a[0] - b[0]);
    let curEnd = intervals[0]![1];
    for (let i = 1; i < intervals.length; i++) {
      const [s, e] = intervals[i]!;
      if (s > curEnd) {
        const gap = s - curEnd;
        const mid = (curEnd + s) / 2;
        // 중앙 25%~75% 대역에 있는 거터만 다단 후보로 인정
        const rel = (mid - minX) / spanW;
        if (rel >= 0.25 && rel <= 0.75 && gap > bestVGap) {
          bestVGap = gap;
          bestVX = mid;
        }
      }
      if (e > curEnd) curEnd = e;
    }
  }

  const hValid = bestHGap >= Math.max(14, medianFs * 1.4);
  const vValid = bestVGap >= Math.max(12, medianFs * 1.2) && isTwoColumnProse(items, bestVX);

  // 수직 컷이 수평 컷보다 뚜렷하게 크고 2단 본문이면 좌→우 단 분리
  if (vValid && (!hValid || bestVGap > bestHGap * 1.2)) {
    const left = items.filter(i => i.x + i.w / 2 < bestVX);
    const right = items.filter(i => i.x + i.w / 2 >= bestVX);
    if (left.length && right.length && left.length < items.length) {
      return [...xyCutOrder(left, depth + 1), ...xyCutOrder(right, depth + 1)];
    }
  }

  if (hValid) {
    const upper = items.filter(i => i.y > bestHY);
    const lower = items.filter(i => i.y <= bestHY);
    if (upper.length && lower.length && upper.length < items.length) {
      return [...xyCutOrder(upper, depth + 1), ...xyCutOrder(lower, depth + 1)];
    }
  }

  return [items];
}

/** 수직 컷이 표나 균등배분 라벨이 아니라 실제 2단 산문 거터인지 검증한다. */
function isTwoColumnProse(items: NormItem[], cutX: number): boolean {
  const left = items.filter(i => i.x + i.w / 2 < cutX);
  const right = items.filter(i => i.x + i.w / 2 >= cutX);
  const leftLines = groupByY(left);
  const rightLines = groupByY(right);
  if (leftLines.length < 3 || rightLines.length < 3) return false;
  // 양쪽 모두 평균 길이가 충분한 문장/구절(평균 6자 이상)이어야 2단 본문 (짧은 표 칸은 표 감지에 맡긴다)
  const avgLen = (ls: TextLine[]) => ls.reduce((s, l) => s + l.text.trim().length, 0) / ls.length;
  return avgLen(leftLines) >= 8 && avgLen(rightLines) >= 8;
}

// ── 3. 좌표 기반 표 행 감지 ──

/** 줄 안 아이템들을 큰 X 간격 기준으로 열 세그먼트로 분리한다. */
function splitLineSegments(line: TextLine): Array<{ x1: number; x2: number; text: string }> {
  const gapThresh = Math.max(14, line.fontSize * 1.6);
  const segs: NormItem[][] = [];
  for (const item of line.items) {
    const cur = segs[segs.length - 1];
    if (cur) {
      const prev = cur[cur.length - 1]!;
      if (item.x - (prev.x + prev.w) <= gapThresh) {
        cur.push(item);
        continue;
      }
    }
    segs.push([item]);
  }
  return segs.map(group => ({
    x1: group[0]!.x,
    x2: group[group.length - 1]!.x + group[group.length - 1]!.w,
    text: joinRowItems(group, line.fontSize).trim(),
  }));
}

/** 연속된 2행 이상이 일정한 열 정렬을 이루면 표 행(`칸 | 칸`)으로 포맷한다. */
function renderLinesWithTables(lines: TextLine[]): string[] {
  const segRows = lines.map(splitLineSegments);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (segRows[i]!.length >= 2) {
      // 연속 다열 구간 수집
      let j = i;
      while (j < lines.length && segRows[j]!.length >= 2) {
        if (j > i && Math.abs(lines[j - 1]!.y - lines[j]!.y) > lines[j]!.fontSize * 3.5) break;
        j++;
      }
      if (j - i >= 2 && areColumnsAligned(segRows.slice(i, j))) {
        const blockRows = segRows.slice(i, j);
        // 열 경계 클러스터링
        const colCenters = clusterColumnStarts(blockRows);
        if (colCenters.length >= 2) {
          for (const segs of blockRows) {
            const cells = Array<string>(colCenters.length).fill('');
            for (const seg of segs) {
              let bestCol = 0;
              let bestDist = Infinity;
              for (let c = 0; c < colCenters.length; c++) {
                const dist = Math.abs(seg.x1 - colCenters[c]!);
                if (dist < bestDist) { bestDist = dist; bestCol = c; }
              }
              cells[bestCol] = cells[bestCol] ? `${cells[bestCol]} ${seg.text}` : seg.text;
            }
            out.push(cells.map(c => collapseEvenSpacing(cleanPdfChars(c))).join(' | '));
          }
          i = j;
          continue;
        }
      }
    }
    out.push(collapseEvenSpacing(cleanPdfChars(lines[i]!.text)));
    i++;
  }
  return out;
}

function areColumnsAligned(rows: Array<Array<{ x1: number; x2: number; text: string }>>): boolean {
  // 첫 행 외 다른 행에서도 열 시작 x가 18pt 이내로 일치하는 비율이 절반 이상이면 표로 본다
  const firstStarts = rows[0]!.map(s => s.x1);
  let alignedRows = 0;
  for (let r = 1; r < rows.length; r++) {
    const matches = rows[r]!.filter(seg => firstStarts.some(fx => Math.abs(seg.x1 - fx) <= 18)).length;
    if (matches >= 2 || matches / rows[r]!.length >= 0.5) alignedRows++;
  }
  return alignedRows >= Math.max(1, Math.floor((rows.length - 1) * 0.5));
}

function clusterColumnStarts(rows: Array<Array<{ x1: number }>>): number[] {
  const xs = rows.flatMap(r => r.map(s => s.x1)).sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && x - last[last.length - 1]! <= 18) last.push(x);
    else clusters.push([x]);
  }
  return clusters.map(c => c.reduce((s, v) => s + v, 0) / c.length);
}

// ── 4. 한글 줄 꺾임 병합 (WrapLexicon + 조사/어미 규칙) ──

const MARKER_START_RE = /^(?:[가-하]\.\s|\d{1,2}\.\s|\(\d{1,2}\)|\([가-하]\)|\d{1,2}\)\s|[가-하]\)\s|[□■◆◇▣○❍●◎▪▸►▶▷※·•*-]\s|제\s*\d+\s*[조항호장절관]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.．]\s|붙\s*임)/;
const SENTENCE_END_RE = /(?:[.?!。…]|다\.?|요\.?|함\.?|음\.?|임\.?|됨\.?)$/;
const PARTICLE_HEAD_RE = /^(?:은|는|이|가|을|를|의|에|에서|에게|으로|로|와|과|도|만|까지|부터|보다|처럼|같이|마다|조차|마저|이나|나|이며|며|이고|고|이다|다|라|라고|하는|하고|하여|하며|한다|했다|된다|되는|되어|있다|있는|없다|없는)(?=$|[\s,.)」』’”])/;

class WrapLexicon {
  private joined = new Set<string>();
  private spaced = new Set<string>();

  addLine(line: string) {
    const tokens = line.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      for (let k = 0; k + 1 < t.length; k++) {
        this.joined.add(t.slice(k, k + 2));
      }
      if (i + 1 < tokens.length) {
        const next = tokens[i + 1]!;
        this.spaced.add(t.slice(-1) + next.slice(0, 1));
      }
    }
  }

  shouldJoinTight(prevTail: string, nextHead: string): boolean {
    if (!prevTail || !nextHead) return false;
    if (PARTICLE_HEAD_RE.test(nextHead)) return true;
    const pair = prevTail.slice(-1) + nextHead.slice(0, 1);
    return this.joined.has(pair) && !this.spaced.has(pair);
  }
}

/** 한컴 PDF 자동 줄 꺾임으로 끊긴 한글 문장을 원문 어절대로 이어 붙인다. */
export function mergeKoreanWrappedLines(lines: string[], lexicon?: WrapLexicon): string[] {
  if (lines.length <= 1) return lines;
  const lex = lexicon ?? new WrapLexicon();
  if (!lexicon) for (const l of lines) lex.addLine(l);

  const out: string[] = [];
  for (const raw of lines) {
    const curr = raw.trim();
    if (!curr) continue;
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(curr);
      continue;
    }
    // 표 행, 항목 마커 시작, 종결 문장, 매우 짧은 제목 줄은 병합하지 않음
    if (
      prev.includes(' | ') ||
      curr.includes(' | ') ||
      MARKER_START_RE.test(curr) ||
      SENTENCE_END_RE.test(prev) ||
      prev.length < 18
    ) {
      out.push(curr);
      continue;
    }
    // 앞 줄 끝과 다음 줄 첫 글자가 한글 어절의 연속이면 병합
    const prevLastWord = prev.match(/[가-힣A-Za-z0-9]+$/)?.[0] ?? '';
    const nextFirstWord = curr.match(/^[가-힣A-Za-z0-9]+/)?.[0] ?? '';
    const endsHangul = /[가-힣]$/.test(prev);
    const startsHangul = /^[가-힣]/.test(curr);
    if (endsHangul && startsHangul) {
      const tight = lex.shouldJoinTight(prevLastWord, nextFirstWord);
      out[out.length - 1] = tight ? `${prev}${curr}` : `${prev} ${curr}`;
      continue;
    }
    out.push(curr);
  }
  return out;
}

// ── 5. 쪽번호 및 다쪽 반복 머리글·바닥글 제거 ──

const PAGE_NUM_LINE_RE = /^\s*(?:[-–—]\s*\d{1,4}\s*[-–—]|\d{1,4}\s*\/\s*\d{1,4}|제?\s*\d{1,4}\s*쪽)\s*$/;

function stripPageNumberLines(lines: string[]): string[] {
  return lines.filter((line, idx) => {
    const t = line.trim();
    if (!t) return false;
    if (PAGE_NUM_LINE_RE.test(t)) return false;
    // 페이지 첫 줄이나 마지막 줄에 단독 숫자(1~999)만 있으면 쪽번호로 제거
    if ((idx === 0 || idx === lines.length - 1) && /^\d{1,3}$/.test(t)) return false;
    return true;
  });
}

/** 3쪽 이상 문서에서 첫 줄·끝 줄에 반복 등장하는 머리글/바닥글을 제거한다. */
export function removeRepeatedHeadersFooters(pageLines: string[][]): string[][] {
  if (pageLines.length < 3) return pageLines;
  const normKey = (s: string) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  const topCounts = new Map<string, number>();
  const botCounts = new Map<string, number>();

  for (const lines of pageLines) {
    if (!lines.length) continue;
    const first = lines[0]!;
    if (first.length <= 60 && !first.includes(' | ')) {
      const k = normKey(first);
      topCounts.set(k, (topCounts.get(k) ?? 0) + 1);
    }
    if (lines.length >= 2) {
      const last = lines[lines.length - 1]!;
      if (last.length <= 60 && !last.includes(' | ')) {
        const k = normKey(last);
        botCounts.set(k, (botCounts.get(k) ?? 0) + 1);
      }
    }
  }

  const threshold = Math.max(3, Math.ceil(pageLines.length * 0.6));
  const repeatedTop = new Set([...topCounts.entries()].filter(([, n]) => n >= threshold).map(([k]) => k));
  const repeatedBot = new Set([...botCounts.entries()].filter(([, n]) => n >= threshold).map(([k]) => k));
  if (!repeatedTop.size && !repeatedBot.size) return pageLines;

  return pageLines.map(lines => {
    let start = 0;
    let end = lines.length;
    if (start < end && repeatedTop.has(normKey(lines[start]!))) start++;
    if (start < end && repeatedBot.has(normKey(lines[end - 1]!))) end--;
    return lines.slice(start, end);
  });
}

// ── 6. 페이지 진입점 ──

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
}

/** 한 페이지의 TextItem 목록을 좌표·XY-Cut·표 감지·정제를 거쳐 줄 배열로 변환한다. */
export function extractPageLines(items: PdfRawTextItem[], pageWidth?: number, pageHeight?: number): string[] {
  const hasCoords = items.some(it => Array.isArray(it.transform) && it.transform.length >= 6);
  if (!hasCoords) {
    // 좌표가 없는 단순 모의 테스트 입력은 hasEOL 폴백
    const raw = items.map(it => `${it.str ?? ''}${it.hasEOL ? '\n' : ''}`).join('');
    return stripPageNumberLines(
      raw.split('\n').map(l => collapseEvenSpacing(cleanPdfChars(l)).replace(/\s+/g, ' ').trim()).filter(Boolean),
    );
  }

  const norm = normalizeItems(items, pageWidth, pageHeight);
  if (!norm.length) return [];

  const regions = xyCutOrder(norm);
  const rawLines: string[] = [];
  for (const region of regions) {
    const lines = groupByY(region);
    rawLines.push(...renderLinesWithTables(lines));
  }
  return stripPageNumberLines(rawLines);
}

/** 전체 페이지 줄 목록에 반복 머리글/바닥글 제거 + 문서 어휘 기반 한글 줄 병합을 적용한다. */
export function finalizePdfPages(pageLines: string[][]): string[] {
  const cleaned = removeRepeatedHeadersFooters(pageLines);
  const lexicon = new WrapLexicon();
  for (const lines of cleaned) {
    for (const line of lines) lexicon.addLine(line);
  }
  return cleaned.map(lines => mergeKoreanWrappedLines(lines, lexicon).join('\n').trim());
}
