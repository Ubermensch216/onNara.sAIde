/**
 * DOCX(워드) 고도화 본문 추출.
 *
 * kordoc(MIT) 벤치마킹 반영 사항:
 *  - word/styles.xml(basedOn 상속 체인 포함) + word/numbering.xml 자동번호/글머리표 복원
 *  - 표 병합(w:gridSpan, w:vMerge restart/continue, w:trPr/w:gridBefore) 2-pass 그리드 복원
 *  - 글상자(w:txbxContent) 추출(mc:Fallback 중복 제외)
 *  - 각주(word/footnotes.xml) · 미주(word/endnotes.xml) 추출
 *  - 변경추적 삽입(w:ins)·smartTag·sdt 투명 순회, 삭제(w:del) 제외
 *  - 필드 코드 상태 머신(PAGE/NUMPAGES 쪽번호 제외), OMML 수식(m:oMath), 심볼 폰트(w:sym)
 */

import { attr, childElements, descendants, firstChild, isTag, parseXml, unzipEntries } from './zip';
import { classifyLine, normalizeLine, tableRowText } from './blocks';
import { ommlToText } from './equation';
import { formatHeadNumber, wingdingsChar } from './pua';
import { buildTableGrid, type GridCellInput } from './table-grid';
import { FileExtractError, type Block } from './types';

const PAGE_FIELD_RE = /^\s*(?:PAGE|NUMPAGES|SECTIONPAGES)\b/i;

// ── 투명 래퍼(sdt/ins/smartTag/customXml/dir/bdo) 평탄화 ──

function effectiveChildren(parent: Element): Element[] {
  const out: Element[] = [];
  for (const child of childElements(parent)) {
    const name = child.localName;
    if (name === 'sdt') {
      const content = firstChild(child, 'sdtContent');
      if (content) out.push(...effectiveChildren(content));
    } else if (name === 'ins' || name === 'smartTag' || name === 'customXml' || name === 'dir' || name === 'bdo') {
      out.push(...effectiveChildren(child));
    } else {
      out.push(child);
    }
  }
  return out;
}

// ── styles.xml ──

interface StyleInfo {
  name: string;
  basedOn?: string;
  outlineLevel?: number;
  numId?: string;
  ilvl?: number;
}

function parseStyles(xml: string | undefined): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  if (!xml) return map;
  let doc: Document;
  try {
    doc = parseXml(xml, 'word/styles.xml');
  } catch {
    return map;
  }

  for (const st of descendants(doc, 'style')) {
    const id = attr(st, 'styleId');
    if (!id) continue;
    const name = attr(firstChild(st, 'name') ?? st, 'val') ?? '';
    const basedOnEl = firstChild(st, 'basedOn');
    const basedOn = basedOnEl ? (attr(basedOnEl, 'val') ?? undefined) : undefined;
    const pPr = firstChild(st, 'pPr');
    let outlineLevel: number | undefined;
    let numId: string | undefined;
    let ilvl: number | undefined;
    if (pPr) {
      const ol = firstChild(pPr, 'outlineLvl');
      if (ol) {
        const v = Number(attr(ol, 'val'));
        if (Number.isFinite(v)) outlineLevel = v;
      }
      const numPr = firstChild(pPr, 'numPr');
      if (numPr) {
        const nid = firstChild(numPr, 'numId');
        const lv = firstChild(numPr, 'ilvl');
        if (nid) numId = attr(nid, 'val') ?? undefined;
        if (lv) {
          const parsed = Number(attr(lv, 'val'));
          if (Number.isFinite(parsed)) ilvl = parsed;
        }
      }
    }
    if (outlineLevel === undefined) {
      const m = /^(?:heading|제목)\s*(\d+)$/i.exec(name.trim());
      if (m) outlineLevel = Number(m[1]) - 1;
      else if (/^title$/i.test(name.trim())) outlineLevel = 0;
    }
    map.set(id, { name, basedOn, outlineLevel, numId, ilvl });
  }

  // basedOn 상속 체인 해석
  for (const [id, info] of map) {
    const seen = new Set<string>([id]);
    let cur = info.basedOn;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const parent = map.get(cur);
      if (!parent) break;
      if (info.outlineLevel === undefined && parent.outlineLevel !== undefined) info.outlineLevel = parent.outlineLevel;
      if (info.numId === undefined && parent.numId !== undefined) {
        info.numId = parent.numId;
        info.ilvl ??= parent.ilvl;
      }
      cur = parent.basedOn;
    }
  }
  return map;
}

// ── numbering.xml ──

interface NumLevel {
  numFmt: string;
  lvlText: string;
  start: number;
  pStyle?: string;
}

type NumberingMap = Map<string, Map<number, NumLevel>>;

function parseNumbering(xml: string | undefined): NumberingMap {
  const result: NumberingMap = new Map();
  if (!xml) return result;
  let doc: Document;
  try {
    doc = parseXml(xml, 'word/numbering.xml');
  } catch {
    return result;
  }

  const abstracts = new Map<string, Map<number, NumLevel>>();
  for (const abs of descendants(doc, 'abstractNum')) {
    const absId = attr(abs, 'abstractNumId');
    if (!absId) continue;
    const levels = new Map<number, NumLevel>();
    for (const lvl of childElements(abs).filter(e => isTag(e, 'lvl'))) {
      const ilvl = Number(attr(lvl, 'ilvl') ?? 0) || 0;
      const numFmt = attr(firstChild(lvl, 'numFmt') ?? lvl, 'val') ?? 'bullet';
      const lvlTextEl = firstChild(lvl, 'lvlText');
      const startEl = firstChild(lvl, 'start');
      const pStyleEl = firstChild(lvl, 'pStyle');
      levels.set(ilvl, {
        numFmt,
        lvlText: lvlTextEl ? (attr(lvlTextEl, 'val') ?? '') : `%${ilvl + 1}.`,
        start: startEl ? (Number(attr(startEl, 'val') ?? 1) || 0) : 1,
        pStyle: pStyleEl ? (attr(pStyleEl, 'val') ?? undefined) : undefined,
      });
    }
    abstracts.set(absId, levels);
  }

  for (const num of descendants(doc, 'num')) {
    const numId = attr(num, 'numId');
    const refEl = firstChild(num, 'abstractNumId');
    const refId = refEl ? attr(refEl, 'val') : null;
    if (!numId || !refId || !abstracts.has(refId)) continue;
    const levels = new Map(abstracts.get(refId)!);
    for (const ov of childElements(num).filter(e => isTag(e, 'lvlOverride'))) {
      const ilvl = Number(attr(ov, 'ilvl') ?? 0) || 0;
      const so = firstChild(ov, 'startOverride');
      const base = levels.get(ilvl);
      if (so && base) {
        levels.set(ilvl, { ...base, start: Number(attr(so, 'val') ?? 1) || 0 });
      }
    }
    result.set(numId, levels);
  }
  return result;
}

class ListCounter {
  private counters = new Map<string, number[]>();

  next(numId: string, ilvl: number, levels: Map<number, NumLevel>): string {
    const def = levels.get(ilvl);
    if (!def || def.numFmt === 'none') return '';
    if (def.numFmt === 'bullet') {
      const bullet = normalizeLine(def.lvlText);
      return bullet && !/^%\d+$/.test(bullet) ? bullet : '·';
    }
    let arr = this.counters.get(numId);
    if (!arr) {
      arr = new Array(10).fill(-1);
      this.counters.set(numId, arr);
    }
    arr[ilvl] = arr[ilvl]! < 0 ? def.start : arr[ilvl]! + 1;
    for (let i = ilvl + 1; i < arr.length; i++) arr[i] = -1;

    return def.lvlText
      .replace(/%(\d+)/g, (_, d: string) => {
        const lv = Number(d) - 1;
        const lvDef = levels.get(lv);
        const val = arr![lv]! >= 0 ? arr![lv]! : (lvDef?.start ?? 1);
        return formatHeadNumber(val, lvDef?.numFmt ?? 'decimal');
      })
      .trim();
  }
}

// ── footnotes.xml / endnotes.xml ──

function parseNotes(xml: string | undefined, tagName: 'footnote' | 'endnote'): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  let doc: Document;
  try {
    doc = parseXml(xml, `word/${tagName}s.xml`);
  } catch {
    return map;
  }

  for (const note of descendants(doc, tagName)) {
    const id = attr(note, 'id');
    const type = attr(note, 'type');
    if (!id || type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') continue;
    const text = descendants(note, 't').map(t => t.textContent ?? '').join('');
    const cleaned = normalizeLine(text);
    if (cleaned) map.set(id, cleaned);
  }
  return map;
}

// ── 본문 파싱 ──

interface DocxCtx {
  styles: Map<string, StyleInfo>;
  numbering: NumberingMap;
  counter: ListCounter;
  footnotes: Map<string, string>;
  endnotes: Map<string, string>;
}

function extractRunText(run: Element, ctx: DocxCtx, notes: string[]): string {
  let out = '';
  for (const child of effectiveChildren(run)) {
    const name = child.localName;
    if (name === 't') out += child.textContent ?? '';
    else if (name === 'tab' || name === 'br' || name === 'cr') out += ' ';
    else if (name === 'sym') {
      const charHex = attr(child, 'char');
      const code = charHex ? parseInt(charHex, 16) : NaN;
      if (Number.isFinite(code)) {
        const mapped = wingdingsChar(code & 0xff);
        if (mapped) out += mapped;
      }
    } else if (name === 'footnoteReference') {
      const id = attr(child, 'id');
      const note = id ? ctx.footnotes.get(id) : undefined;
      if (note) notes.push(note);
    } else if (name === 'endnoteReference') {
      const id = attr(child, 'id');
      const note = id ? ctx.endnotes.get(id) : undefined;
      if (note) notes.push(note);
    } else if (name === 'rPr' || name === 'delText' || name === 'instrText' || name === 'fldChar' || name === 'drawing' || name === 'pict') {
      continue;
    }
  }
  return out;
}

function paragraphContent(p: Element, ctx: DocxCtx): { text: string; notes: string[] } {
  const parts: string[] = [];
  const notes: string[] = [];

  let fieldActive = false;
  let fieldStage: 'instr' | 'display' = 'instr';
  let fieldInstr = '';
  let fieldDisplay = '';
  const flushField = () => {
    if (!fieldActive) return;
    if (fieldDisplay && !PAGE_FIELD_RE.test(fieldInstr)) parts.push(fieldDisplay);
    fieldActive = false;
    fieldStage = 'instr';
    fieldInstr = '';
    fieldDisplay = '';
  };

  for (const child of effectiveChildren(p)) {
    const name = child.localName;
    if (name === 'pPr' || name === 'del' || name === 'Fallback') continue;
    if (name === 'oMath' || name === 'oMathPara') {
      const math = ommlToText(child);
      if (math) {
        if (fieldActive && fieldStage === 'display') fieldDisplay += ` ${math} `;
        else parts.push(` ${math} `);
      }
      continue;
    }
    if (name === 'hyperlink') {
      const linkText = effectiveChildren(child)
        .filter(c => isTag(c, 'r'))
        .map(r => extractRunText(r, ctx, notes))
        .join('');
      if (fieldActive && fieldStage === 'display') fieldDisplay += linkText;
      else parts.push(linkText);
      continue;
    }
    if (name === 'fldSimple') {
      if (PAGE_FIELD_RE.test(attr(child, 'instr') ?? '')) continue;
      const fldText = effectiveChildren(child)
        .filter(c => isTag(c, 'r'))
        .map(r => extractRunText(r, ctx, notes))
        .join('');
      parts.push(fldText);
      continue;
    }
    if (name === 'r') {
      for (const fc of effectiveChildren(child).filter(c => isTag(c, 'fldChar'))) {
        const ty = attr(fc, 'fldCharType');
        if (ty === 'begin') { flushField(); fieldActive = true; fieldStage = 'instr'; }
        else if (ty === 'separate' && fieldActive) fieldStage = 'display';
        else if (ty === 'end') flushField();
      }
      if (fieldActive && fieldStage === 'instr') {
        for (const it of effectiveChildren(child).filter(c => isTag(c, 'instrText'))) {
          fieldInstr += it.textContent ?? '';
        }
      }
      const runStr = extractRunText(child, ctx, notes);
      if (runStr) {
        if (fieldActive && fieldStage === 'display') fieldDisplay += runStr;
        else if (!fieldActive) parts.push(runStr);
      }
    }
  }
  flushField();

  return { text: normalizeLine(parts.join('')), notes };
}

function resolveParagraphMeta(p: Element, ctx: DocxCtx): { isHeading: boolean; prefix: string } {
  const pPr = firstChild(p, 'pPr');
  let styleId = '';
  let numId = '';
  let ilvl = 0;
  let directOutline = false;

  if (pPr) {
    const pStyle = firstChild(pPr, 'pStyle');
    if (pStyle) styleId = attr(pStyle, 'val') ?? '';
    if (firstChild(pPr, 'outlineLvl')) directOutline = true;
    const numPr = firstChild(pPr, 'numPr');
    if (numPr) {
      numId = attr(firstChild(numPr, 'numId') ?? numPr, 'val') ?? '';
      ilvl = Number(attr(firstChild(numPr, 'ilvl') ?? numPr, 'val') ?? 0) || 0;
    }
  }

  const style = styleId ? ctx.styles.get(styleId) : undefined;
  if (!numId && style?.numId) {
    numId = style.numId;
    const levels = ctx.numbering.get(numId);
    ilvl = style.ilvl ?? (levels ? [...levels.entries()].find(([, lv]) => lv.pStyle === styleId)?.[0] : undefined) ?? 0;
  }

  const levels = numId && numId !== '0' ? ctx.numbering.get(numId) : undefined;
  const prefix = levels ? ctx.counter.next(numId, ilvl, levels) : '';
  const isHeading = directOutline
    || (style?.outlineLevel !== undefined && style.outlineLevel >= 0 && style.outlineLevel <= 5)
    || /heading|title|제목/i.test(styleId);

  return { isHeading, prefix };
}

/** mc:Fallback을 제외하고 문단 안 글상자(w:txbxContent)의 p/tbl 요소를 수집한다. */
function collectTextboxElements(node: Element, inTxbx = false, out: Element[] = [], depth = 0): Element[] {
  if (depth > 40) return out;
  for (const child of effectiveChildren(node)) {
    if (child.localName === 'Fallback') continue;
    if (child.localName === 'txbxContent') {
      for (const item of effectiveChildren(child)) {
        if (isTag(item, 'p') || isTag(item, 'tbl')) out.push(item);
      }
      continue;
    }
    if (!inTxbx) collectTextboxElements(child, false, out, depth + 1);
  }
  return out;
}

interface RawDocxCell {
  col: number;
  colSpan: number;
  vMerge: 'restart' | 'continue' | null;
  text: string;
}

function collectCellText(tc: Element, ctx: DocxCtx, depth = 0): string {
  if (depth > 16) return '';
  const parts: string[] = [];
  for (const child of effectiveChildren(tc)) {
    if (isTag(child, 'p')) {
      const meta = resolveParagraphMeta(child, ctx);
      const { text } = paragraphContent(child, ctx);
      if (text) parts.push(meta.prefix ? `${meta.prefix} ${text}` : text);
      for (const tbEl of collectTextboxElements(child)) {
        if (isTag(tbEl, 'p')) {
          const tbMeta = resolveParagraphMeta(tbEl, ctx);
          const tb = paragraphContent(tbEl, ctx);
          if (tb.text) parts.push(tbMeta.prefix ? `${tbMeta.prefix} ${tb.text}` : tb.text);
        }
      }
    } else if (isTag(child, 'tbl')) {
      const nestedGrid = extractDocxTableGrid(child, ctx, depth + 1);
      const flat = nestedGrid.map(row => row.filter(Boolean).join(' / ')).filter(Boolean).join(' ; ');
      if (flat) parts.push(flat);
    }
  }
  return normalizeLine(parts.join(' '));
}

function extractDocxTableGrid(tbl: Element, ctx: DocxCtx, depth = 0): string[][] {
  const trs = effectiveChildren(tbl).filter(el => isTag(el, 'tr'));
  if (!trs.length) return [];

  const rawRows: RawDocxCell[][] = [];
  for (const tr of trs) {
    let col = 0;
    const trPr = firstChild(tr, 'trPr');
    const gridBefore = trPr ? firstChild(trPr, 'gridBefore') : undefined;
    if (gridBefore) col = Math.max(0, Number(attr(gridBefore, 'val') ?? 0) || 0);

    const row: RawDocxCell[] = [];
    for (const tc of effectiveChildren(tr).filter(el => isTag(el, 'tc'))) {
      let colSpan = 1;
      let vMerge: RawDocxCell['vMerge'] = null;
      const tcPr = firstChild(tc, 'tcPr');
      if (tcPr) {
        const gs = firstChild(tcPr, 'gridSpan');
        if (gs) colSpan = Math.max(1, Number(attr(gs, 'val') ?? 1) || 1);
        const vm = firstChild(tcPr, 'vMerge');
        if (vm) vMerge = attr(vm, 'val') === 'restart' ? 'restart' : 'continue';
      }
      row.push({ col, colSpan, vMerge, text: collectCellText(tc, ctx, depth) });
      col += colSpan;
    }
    rawRows.push(row);
  }

  // 내용 있는 continue 셀 텍스트를 위쪽 시작 셀에 합류(데이터 소실 방지)
  for (let r = 0; r < rawRows.length; r++) {
    for (const cell of rawRows[r]!) {
      if (cell.vMerge !== 'continue' || !cell.text) continue;
      let start: RawDocxCell | undefined;
      for (let pr = r - 1; pr >= 0 && !start; pr--) {
        start = rawRows[pr]!.find(pc => pc.col === cell.col && pc.vMerge !== 'continue');
      }
      if (start) {
        start.text = start.text ? `${start.text} ${cell.text}` : cell.text;
        cell.text = '';
      } else {
        cell.vMerge = null;
      }
    }
  }

  // vMerge restart → rowSpan 계산 후 2-pass 그리드 구성
  const gridInput: GridCellInput[][] = rawRows.map((row, r) =>
    row
      .filter(cell => cell.vMerge !== 'continue')
      .map(cell => {
        let rowSpan = 1;
        if (cell.vMerge === 'restart') {
          for (let nr = r + 1; nr < rawRows.length; nr++) {
            if (!rawRows[nr]!.some(nc => nc.col === cell.col && nc.vMerge === 'continue')) break;
            rowSpan++;
          }
        }
        return { text: cell.text, colSpan: cell.colSpan, rowSpan, colAddr: cell.col, rowAddr: r };
      }),
  );

  return buildTableGrid(gridInput);
}

export function extractDocx(bytes: Uint8Array): Block[] {
  const entries = unzipEntries(bytes, name =>
    name === 'word/document.xml' ||
    name === 'word/styles.xml' ||
    name === 'word/numbering.xml' ||
    name === 'word/footnotes.xml' ||
    name === 'word/endnotes.xml',
  );
  const xml = entries['word/document.xml'];
  if (!xml) throw new FileExtractError('DOCX 본문(word/document.xml)을 찾지 못했습니다.');
  const doc = parseXml(xml, 'word/document.xml');
  const body = Array.from(doc.getElementsByTagName('*')).find(el => el.localName === 'body');
  if (!body) throw new FileExtractError('DOCX 본문을 찾지 못했습니다.');

  const ctx: DocxCtx = {
    styles: parseStyles(entries['word/styles.xml']),
    numbering: parseNumbering(entries['word/numbering.xml']),
    counter: new ListCounter(),
    footnotes: parseNotes(entries['word/footnotes.xml'], 'footnote'),
    endnotes: parseNotes(entries['word/endnotes.xml'], 'endnote'),
  };

  const blocks: Block[] = [];
  let table = 0;

  const emitElement = (el: Element) => {
    if (isTag(el, 'p')) {
      const meta = resolveParagraphMeta(el, ctx);
      const { text, notes } = paragraphContent(el, ctx);
      if (text) {
        const full = meta.prefix ? `${meta.prefix} ${text}` : text;
        blocks.push(meta.isHeading ? { kind: 'heading', text: full } : { ...classifyLine(full), text: full });
      }
      for (const note of notes) blocks.push({ kind: 'para', text: `(주석) ${note}` });
      for (const tbEl of collectTextboxElements(el)) emitElement(tbEl);
    } else if (isTag(el, 'tbl')) {
      const grid = extractDocxTableGrid(el, ctx);
      const nonEmpty = grid.filter(cells => cells.some(Boolean));
      if (nonEmpty.length) {
        table += 1;
        nonEmpty.forEach((cells, idx) => {
          blocks.push({ kind: 'table-row', text: tableRowText(cells), table, row: idx + 1 });
        });
      }
    }
  };

  for (const el of effectiveChildren(body)) emitElement(el);
  return blocks;
}
