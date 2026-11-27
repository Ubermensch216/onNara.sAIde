/**
 * HWPX(한글 2014 이후 표준 OWPML 형식) 고도화 본문 추출.
 *
 * kordoc(MIT) 벤치마킹 반영 사항:
 *  - META-INF/manifest.xml 암호화(encryption-data) 감지 및 안내
 *  - Contents/content.hpf manifest 기반 섹션 순서 해석 + 손상 ZIP 복구
 *  - Contents/header.xml 파싱: 자동번호(numbering)·글머리표(bullet)·개요(outline)·스타일 제목
 *  - 변경추적 삭제 구간(deleteBegin~deleteEnd, 고아 마커 방어 포함) 제외
 *  - 숨은 설명(hiddenComment)·한글 개체/그림 대체텍스트 제거·hp:switch 단일 분기
 *  - 표 병합(cellAddr/cellSpan) 2-pass 그리드 복원·표 캡션(caption)·중첩표·글상자(drawText)
 *  - 수식(hp:equation)·글자 겹치기(hp:compose)·양식 버튼(checkBtn/radioBtn)·PUA 유니코드 복원
 */

import { attr, childElements, descendants, firstChild, isPathTraversal, isTag, parseXml, sortByNumber, unzipEntries } from './zip';
import { classifyLine, normalizeLine, tableRowText } from './blocks';
import { hwpEquationToText } from './equation';
import { composeText, formatHeadNumber, mapPuaText } from './pua';
import { buildTableGrid, type GridCellInput } from './table-grid';
import { FileExtractError, type Block } from './types';

const SKIP = new Set([
  'header', 'footer', 'secPr', 'colPr', 'pageNum', 'pageNumCtrl', 'pageHiding',
  'newNum', 'indexmark', 'bookmark', 'hiddenComment', 'linesegarray', 'lineseg',
  'parameters', 'stringParam', 'integerParam', 'boolParam', 'floatParam',
  'shapeComment', 'fieldBegin', 'fieldEnd',
]);

const ALT_TEXT_LINE = /^(?:모서리가 둥근 |둥근 )?(?:사각형|직사각형|정사각형|원|타원|삼각형|선|직선|곡선|화살표|오각형|육각형|팔각형|별|십자|구름|마름모|도넛|평행사변형|사다리꼴|개체|그리기\s?개체|묶음\s?개체|글상자|표|그림|OLE\s?개체)\s?입니다\.?$/;

// ── header.xml 스타일·자동번호 파싱 ──

interface ParaHeadDef {
  numFormat: string;
  text: string;
  start: number;
}

interface ParaHeadingRef {
  type: 'NUMBER' | 'BULLET' | 'OUTLINE';
  idRef: string;
  level: number;
}

interface HwpxHeaderInfo {
  numberings: Map<string, Map<number, ParaHeadDef>>;
  bullets: Map<string, string>;
  paraHeadings: Map<string, ParaHeadingRef>;
  styleHeadingLevel: Map<string, number>;
}

function parseHeaderInfo(xml: string | undefined): HwpxHeaderInfo {
  const info: HwpxHeaderInfo = {
    numberings: new Map(),
    bullets: new Map(),
    paraHeadings: new Map(),
    styleHeadingLevel: new Map(),
  };
  if (!xml) return info;
  let doc: Document;
  try {
    doc = parseXml(xml, 'header.xml');
  } catch {
    return info;
  }

  // numbering
  for (const numEl of descendants(doc, 'numbering')) {
    const id = attr(numEl, 'id');
    if (!id) continue;
    const heads = new Map<number, ParaHeadDef>();
    for (const head of descendants(numEl, 'paraHead')) {
      const level = Number(attr(head, 'level'));
      if (!Number.isFinite(level) || level < 1 || level > 10) continue;
      const startRaw = Number(attr(head, 'start'));
      heads.set(level, {
        numFormat: attr(head, 'numFormat') ?? 'DIGIT',
        text: (head.textContent ?? '').trim(),
        start: Number.isFinite(startRaw) ? startRaw : 1,
      });
    }
    if (heads.size) info.numberings.set(id, heads);
  }

  // bullet
  for (const bEl of descendants(doc, 'bullet')) {
    const id = attr(bEl, 'id');
    const ch = attr(bEl, 'char');
    if (id && ch) info.bullets.set(id, mapPuaText(ch));
  }

  // paraPr -> heading
  for (const pEl of descendants(doc, 'paraPr')) {
    const id = attr(pEl, 'id');
    if (!id) continue;
    const hEl = firstChild(pEl, 'heading') ?? descendants(pEl, 'heading')[0];
    if (!hEl) continue;
    const type = (attr(hEl, 'type') ?? '').toUpperCase();
    if (type !== 'NUMBER' && type !== 'BULLET' && type !== 'OUTLINE') continue;
    const idRef = attr(hEl, 'idRef') ?? '0';
    const level = Math.max(0, Number(attr(hEl, 'level') ?? 0) || 0);
    info.paraHeadings.set(id, { type, idRef, level });
  }

  // style -> 개요 1..6
  for (const st of descendants(doc, 'style')) {
    const id = attr(st, 'id');
    const name = attr(st, 'name') ?? '';
    const m = /^개요\s*([1-6])$/.exec(name);
    if (id && m) info.styleHeadingLevel.set(id, Number(m[1]));
  }

  return info;
}

// ── content.hpf manifest 섹션 순서 해석 ──

function normalizeSectionHref(href: string): string | null {
  const clean = href.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || isPathTraversal(clean)) return null;
  const full = /^[Ss]ection\d+\.xml$/.test(clean) ? `Contents/${clean}` : clean;
  return /(?:^|\/)[Ss]ection\d+\.xml$/i.test(full) ? full : null;
}

function resolveSectionPaths(entries: Record<string, string>): string[] {
  const entryByLower = new Map<string, string>();
  for (const name of Object.keys(entries)) entryByLower.set(name.toLowerCase(), name);

  const manifestKey = entryByLower.get('contents/content.hpf') ?? entryByLower.get('content.hpf');
  if (manifestKey) {
    try {
      const doc = parseXml(entries[manifestKey]!, manifestKey);
      const idToHref = new Map<string, string>();
      for (const item of descendants(doc, 'item')) {
        const id = attr(item, 'id');
        const href = normalizeSectionHref(attr(item, 'href') ?? '');
        if (id && href) {
          const actual = entryByLower.get(href.toLowerCase());
          if (actual) idToHref.set(id, actual);
        }
      }
      const ordered: string[] = [];
      for (const ref of descendants(doc, 'itemref')) {
        const target = idToHref.get(attr(ref, 'idref') ?? '');
        if (target && !ordered.includes(target)) ordered.push(target);
      }
      if (ordered.length) return ordered;
    } catch {
      // manifest 파싱 실패 시 파일명 정렬 폴백
    }
  }

  return sortByNumber(Object.keys(entries).filter(name => /(?:^|\/)section\d+\.xml$/i.test(name)));
}

// ── 변경추적 고아 deleteBegin 감지 ──

function findOrphanDeleteBegins(root: Element): Set<Element> {
  const stack: Element[] = [];
  const walk = (el: Element) => {
    for (const child of childElements(el)) {
      const name = child.localName;
      if (name === 'deleteBegin') stack.push(child);
      else if (name === 'deleteEnd') {
        if (stack.length) stack.pop();
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return new Set(stack);
}

// ── 본문 순회 상태 ──

interface WalkState {
  blocks: Block[];
  table: number;
  header: HwpxHeaderInfo;
  outlineNumId: string;
  numCounters: Map<string, number[]>;
  deleteDepth: number;
  orphanDeleteBegins: Set<Element>;
}

function resolveParaHeading(p: Element, state: WalkState): { prefix?: string; isOutlineHeading?: boolean } {
  const styleId = attr(p, 'styleIDRef');
  const styleHeading = styleId && styleId !== '0' ? state.header.styleHeadingLevel.get(styleId) : undefined;
  const prId = attr(p, 'paraPrIDRef');
  const ref = prId ? state.header.paraHeadings.get(prId) : undefined;
  if (!ref) return styleHeading ? { isOutlineHeading: true } : {};

  if (ref.type === 'BULLET') {
    const ch = state.header.bullets.get(ref.idRef);
    return ch ? { prefix: ch } : {};
  }

  const numId = ref.type === 'OUTLINE' ? (state.outlineNumId || '1') : ref.idRef;
  const level = Math.min(ref.level + 1, 10);
  const isOutlineHeading = ref.type === 'OUTLINE' || Boolean(styleHeading);
  const heads = state.header.numberings.get(numId);
  if (!heads) return isOutlineHeading ? { isOutlineHeading } : {};

  let counters = state.numCounters.get(numId);
  if (!counters) {
    counters = new Array(11).fill(-1);
    state.numCounters.set(numId, counters);
  }
  const head = heads.get(level);
  counters[level] = counters[level]! < 0 ? (head?.start ?? 1) : counters[level]! + 1;
  for (let l = level + 1; l <= 10; l++) counters[l] = -1;

  const fmt = head ? head.text.trim() : `^${level}.`;
  if (!fmt) return isOutlineHeading ? { isOutlineHeading } : {};
  const prefix = fmt
    .replace(/\^(10|[1-9])/g, (_, d: string) => {
      const lv = Number(d);
      const refHead = heads.get(lv);
      const val = counters![lv]! >= 0 ? counters![lv]! : (refHead?.start ?? 1);
      return formatHeadNumber(val, refHead?.numFormat ?? 'DIGIT');
    })
    .replace(/\^(?![\p{L}\p{N}])/gu, '')
    .trim();

  return { prefix: prefix || undefined, isOutlineHeading };
}

function cleanHwpxText(raw: string): string {
  let t = normalizeLine(raw);
  if (!t) return '';
  if (/^그림입니다\.?\s*원본\s*그림의\s*(이름|크기)/.test(t)) return '';
  t = t.replace(/그림입니다\.?\s*원본\s*그림의\s*(이름|크기)[^\n]*/g, '').trim();
  if (ALT_TEXT_LINE.test(t)) return '';
  return t;
}

/** `hp:t` 안의 글자. CDATA·탭·줄바꿈·고정폭 공백을 처리한다. */
function runText(t: Element): string {
  let out = '';
  for (const node of Array.from(t.childNodes)) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      out += node.nodeValue ?? '';
    } else if (node.nodeType === 1) {
      const name = (node as Element).localName;
      if (name === 'lineBreak' || (name === 'br' && (attr(node as Element, 'type') ?? 'line') === 'line')) out += '\n';
      else out += ' ';
    }
  }
  return out;
}

function formButtonText(el: Element, isRadio: boolean): string {
  const checked = /^(?:1|true|checked)$/i.test(attr(el, 'value') ?? attr(el, 'checked') ?? '');
  const mark = isRadio ? (checked ? '◉' : '○') : (checked ? '☑' : '☐');
  const caption = attr(el, 'captionText') ?? attr(el, 'text') ?? '';
  return caption ? `${mark} ${caption}` : mark;
}

function equationText(eq: Element): string {
  const script = firstChild(eq, 'script') ?? descendants(eq, 'script')[0];
  return script ? hwpEquationToText(script.textContent ?? '') : '';
}

/** 독립 이야기(표 칸·캡션·각주·글상자) 안에서는 바깥 삭제 깊이를 잠시 0으로 격리한다. */
function withIsolatedDeletion<T>(state: WalkState, fn: () => T): T {
  const saved = state.deleteDepth;
  state.deleteDepth = 0;
  try {
    return fn();
  } finally {
    state.deleteDepth = saved;
  }
}

/** 표 칸·각주·캡션 안의 텍스트를 모은다(중첩 표·수식·삭제 구간 반영). */
function flatText(el: Element, state: WalkState): string {
  return withIsolatedDeletion(state, () => {
    const parts: string[] = [];
    const walk = (node: Element) => {
      for (const child of childElements(node)) {
        const name = child.localName;
        if (name === 'deleteBegin') {
          if (!state.orphanDeleteBegins.has(child)) state.deleteDepth++;
          continue;
        }
        if (name === 'deleteEnd') {
          if (state.deleteDepth > 0) state.deleteDepth--;
          continue;
        }
        if (SKIP.has(name)) continue;
        if (name === 'switch') {
          const branch = firstChild(child, 'case') ?? firstChild(child, 'default');
          if (branch) walk(branch);
          continue;
        }
        if (name === 'run' || name === 'r' || name === 'ctrl') {
          walk(child);
          continue;
        }
        if (state.deleteDepth > 0) continue;

        if (name === 't') parts.push(runText(child));
        else if (name === 'compose') {
          parts.push(composeText(attr(child, 'composeText') ?? '', (attr(child, 'circleType') ?? 'CHAR') !== 'CHAR'));
        } else if (name === 'checkBtn' || name === 'radioBtn') {
          parts.push(formButtonText(child, name === 'radioBtn'));
        } else if (name === 'equation') {
          const eq = equationText(child);
          if (eq) parts.push(` ${eq} `);
        } else if (name === 'tbl') {
          const nested = extractTableRows(child, state);
          const nestedText = nested.map(r => r.filter(Boolean).join(' / ')).filter(Boolean).join(' ; ');
          if (nestedText) parts.push(parts.length ? ` ${nestedText}` : nestedText);
        } else {
          if (name === 'p' && parts.length) parts.push(' ');
          walk(child);
        }
      }
    };
    walk(el);
    return cleanHwpxText(parts.join(''));
  });
}

function extractTableRows(tbl: Element, state: WalkState): string[][] {
  const rows: GridCellInput[][] = [];
  for (const tr of childElements(tbl).filter(el => isTag(el, 'tr'))) {
    const row: GridCellInput[] = [];
    for (const tc of childElements(tr).filter(el => isTag(el, 'tc'))) {
      const addrEl = firstChild(tc, 'cellAddr');
      const spanEl = firstChild(tc, 'cellSpan');
      const colAddrRaw = addrEl ? Number(attr(addrEl, 'colAddr')) : NaN;
      const rowAddrRaw = addrEl ? Number(attr(addrEl, 'rowAddr')) : NaN;
      const colSpanRaw = spanEl ? Number(attr(spanEl, 'colSpan')) : 1;
      const rowSpanRaw = spanEl ? Number(attr(spanEl, 'rowSpan')) : 1;
      const sub = firstChild(tc, 'subList') ?? tc;
      row.push({
        text: flatText(sub, state),
        colSpan: Number.isFinite(colSpanRaw) && colSpanRaw > 0 ? colSpanRaw : 1,
        rowSpan: Number.isFinite(rowSpanRaw) && rowSpanRaw > 0 ? rowSpanRaw : 1,
        ...(Number.isFinite(colAddrRaw) ? { colAddr: colAddrRaw } : {}),
        ...(Number.isFinite(rowAddrRaw) ? { rowAddr: rowAddrRaw } : {}),
      });
    }
    rows.push(row);
  }
  return buildTableGrid(rows);
}

function emitTable(tbl: Element, state: WalkState) {
  const captionEl = firstChild(tbl, 'caption');
  const captionText = captionEl ? flatText(captionEl, state) : '';
  const captionBelow = captionEl ? (attr(captionEl, 'side') ?? '').toUpperCase() === 'BOTTOM' : false;

  if (captionText && !captionBelow) {
    state.blocks.push({ ...classifyLine(captionText), text: captionText });
  }

  const grid = extractTableRows(tbl, state);
  const nonEmpty = grid.filter(cells => cells.some(Boolean));
  if (nonEmpty.length) {
    state.table += 1;
    const table = state.table;
    nonEmpty.forEach((cells, idx) => {
      state.blocks.push({ kind: 'table-row', text: tableRowText(cells), table, row: idx + 1 });
    });
  }

  if (captionText && captionBelow) {
    state.blocks.push({ ...classifyLine(captionText), text: captionText });
  }
}

function emitParagraph(p: Element, state: WalkState) {
  // 빈 문단이라도 자동번호 카운터를 소비한다 (카운터 드리프트 방지)
  const heading = resolveParaHeading(p, state);
  let prefixApplied = false;
  let text = '';

  const flush = () => {
    const cleaned = cleanHwpxText(text);
    text = '';
    if (!cleaned) return;
    const full = !prefixApplied && heading.prefix ? `${heading.prefix} ${cleaned}` : cleaned;
    prefixApplied = true;
    for (const part of full.split('\n').map(cleanHwpxText).filter(Boolean)) {
      const classified = classifyLine(part);
      state.blocks.push(
        heading.isOutlineHeading && classified.kind === 'para'
          ? { kind: 'heading', text: part }
          : { ...classified, text: part },
      );
    }
  };

  const visit = (el: Element) => {
    for (const child of childElements(el)) {
      const name = child.localName;
      if (name === 'deleteBegin') {
        if (!state.orphanDeleteBegins.has(child)) state.deleteDepth++;
        continue;
      }
      if (name === 'deleteEnd') {
        if (state.deleteDepth > 0) state.deleteDepth--;
        continue;
      }
      if (SKIP.has(name)) continue;
      if (name === 'switch') {
        const branch = firstChild(child, 'case') ?? firstChild(child, 'default');
        if (branch) visit(branch);
        continue;
      }
      if (name === 'run' || name === 'r' || name === 'ctrl') {
        visit(child);
        continue;
      }
      if (state.deleteDepth > 0) continue;

      if (name === 't') {
        text += runText(child);
      } else if (name === 'compose') {
        text += composeText(attr(child, 'composeText') ?? '', (attr(child, 'circleType') ?? 'CHAR') !== 'CHAR');
      } else if (name === 'checkBtn' || name === 'radioBtn') {
        text += formButtonText(child, name === 'radioBtn');
      } else if (name === 'equation') {
        const eq = equationText(child);
        if (eq) text += ` ${eq} `;
      } else if (name === 'tbl') {
        flush();
        emitTable(child, state);
      } else if (name === 'footNote' || name === 'endNote') {
        const note = flatText(child, state);
        if (note) {
          flush();
          state.blocks.push({ kind: 'para', text: `(주석) ${note}` });
        }
      } else if (name === 'caption') {
        const cap = flatText(child, state);
        if (cap) {
          flush();
          state.blocks.push({ ...classifyLine(cap), text: cap });
        }
      } else if (name === 'drawText') {
        flush();
        withIsolatedDeletion(state, () => {
          const sub = firstChild(child, 'subList') ?? child;
          for (const inner of childElements(sub).filter(item => isTag(item, 'p'))) emitParagraph(inner, state);
        });
      } else if (name === 'subList') {
        flush();
        withIsolatedDeletion(state, () => {
          for (const inner of childElements(child).filter(item => isTag(item, 'p'))) emitParagraph(inner, state);
        });
      } else {
        visit(child);
      }
    }
  };

  visit(p);
  flush();
}

export interface HwpxExtractResult {
  blocks: Block[];
  warnings: string[];
}

export function extractHwpxDetailed(bytes: Uint8Array): HwpxExtractResult {
  const warnings: string[] = [];
  let recovered = false;
  let entries: Record<string, string>;
  try {
    entries = unzipEntries(bytes, name =>
      /^META-INF\/manifest\.xml$/i.test(name) ||
      /^(?:Contents\/)?content\.hpf$/i.test(name) ||
      /^(?:Contents\/)?head(?:er)?\.xml$/i.test(name) ||
      /(?:^|\/)section\d+\.xml$/i.test(name),
    );
  } catch (err) {
    // Central Directory 손상 시 Local File Header 스캔 복구 시도
    entries = unzipEntries(
      bytes,
      name =>
        /^META-INF\/manifest\.xml$/i.test(name) ||
        /^(?:Contents\/)?content\.hpf$/i.test(name) ||
        /^(?:Contents\/)?head(?:er)?\.xml$/i.test(name) ||
        /(?:^|\/)section\d+\.xml$/i.test(name),
      { allowBrokenRecovery: true },
    );
    if (!Object.keys(entries).length) throw err;
    recovered = true;
    warnings.push('손상된 HWPX 압축 구조를 복구하여 본문을 읽었습니다.');
  }

  // 암호화 HWPX 감지
  const manifestKey = Object.keys(entries).find(k => /^META-INF\/manifest\.xml$/i.test(k));
  if (manifestKey && /encryption-data/i.test(entries[manifestKey]!)) {
    throw new FileExtractError('암호로 보호된 HWPX 파일입니다. 한글에서 암호를 해제한 뒤 다시 올려 주세요.');
  }

  const sections = resolveSectionPaths(entries);
  if (!sections.length) {
    throw new FileExtractError('HWPX 본문(Contents/section*.xml)을 찾지 못했습니다. 한글에서 HWPX 형식으로 다시 저장해 주세요.');
  }

  const headerKey = Object.keys(entries).find(k => /^(?:Contents\/)?head(?:er)?\.xml$/i.test(k));
  const header = parseHeaderInfo(headerKey ? entries[headerKey] : undefined);

  const state: WalkState = {
    blocks: [],
    table: 0,
    header,
    outlineNumId: '1',
    numCounters: new Map(),
    deleteDepth: 0,
    orphanDeleteBegins: new Set(),
  };

  for (const name of sections) {
    try {
      const doc = parseXml(entries[name]!, name);
      state.deleteDepth = 0;
      state.orphanDeleteBegins = findOrphanDeleteBegins(doc.documentElement);
      const secPr = descendants(doc.documentElement, 'secPr')[0];
      const outlineId = secPr ? attr(secPr, 'outlineShapeIDRef') : null;
      if (outlineId) state.outlineNumId = outlineId;

      for (const p of childElements(doc.documentElement).filter(el => isTag(el, 'p'))) {
        emitParagraph(p, state);
      }
    } catch (err) {
      if (sections.length === 1 && !recovered) throw err;
      warnings.push(`'${name}' 구역 일부를 읽지 못해 건너뛰었습니다.`);
    }
  }

  return { blocks: state.blocks, warnings };
}

export function extractHwpx(bytes: Uint8Array): Block[] {
  return extractHwpxDetailed(bytes).blocks;
}
