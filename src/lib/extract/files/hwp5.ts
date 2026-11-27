/**
 * 구형 한글(.hwp, HWP 5.x OLE2 바이너리) 순수 브라우저 TypeScript 파서.
 *
 * kordoc(MIT) src/hwp5/{parser,record,body,numbering}.ts & rhwp(MIT) 벤치마킹:
 *  - OLE2/CFB 컨테이너 직접 파싱(손상 파일 lenient 복구 포함)
 *  - 일반 문서(BodyText/Section*) 및 배포용 문서(ViewText/Section*, LCG+XOR+AES-128 ECB) 지원
 *  - DocInfo 파싱: 문단번호(7수준 카운터 상태기계 + ^N 치환)·글머리표·개요 수준
 *  - 21종 UTF-16LE 제어문자 처리 + 한컴 PUA-A 접힘 해제(U+A000~A48C → U+F0000대)
 *  - 표(colAddr/rowAddr/colSpan/rowSpan 2-pass 그리드 + 캡션 + 중첩표), 글상자(gso),
 *    각주/미주(fn/en), 수식(eqed), 글자 겹침(tcps), 미기입 누름틀(%clk) 안내문 제거
 *  - 암호화/DRM HWP는 명확한 안내 메시지로 거절
 */

import { parseCfb } from './cfb';
import { decompressHwpStream, decryptDistributionSection } from './hwp5-crypto';
import { classifyLine, normalizeLine, tableRowText } from './blocks';
import { hwpEquationToText } from './equation';
import { composeText, formatHwp5Number, mapPuaText } from './pua';
import { buildTableGrid, type GridCellInput } from './table-grid';
import { FileExtractError, type Block } from './types';

// ── 레코드 태그 & 플래그 ──

const TAG_NUMBERING = 0x0017;
const TAG_BULLET = 0x0018;
const TAG_DOC_PARA_SHAPE = 0x0019;

const TAG_PARA_HEADER = 0x0042;
const TAG_PARA_TEXT = 0x0043;
const TAG_CTRL_HEADER = 0x0047;
const TAG_LIST_HEADER = 0x0048;
const TAG_TABLE = 0x004d;
const TAG_EQEDIT = 0x0058;

const FLAG_COMPRESSED = 1 << 0;
const FLAG_ENCRYPTED = 1 << 1;
const FLAG_DISTRIBUTION = 1 << 2;
const FLAG_DRM = 1 << 4;

const MAX_RECORDS = 500_000;
const MAX_SECTIONS = 100;
const MAX_NEST_DEPTH = 8;

const HANCOM_FOLDED_START = 0xa000;
const HANCOM_FOLDED_END = 0xa48c;
const HANCOM_FOLDED_SHIFT = 0xf0000 - 0xa000;

const utf16le = new TextDecoder('utf-16le');
const utf8 = new TextDecoder('utf-8', { fatal: false });

function cid(s: string): number {
  return ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
}

const CTRL_TBL = cid('tbl ');
const CTRL_GSO = cid('gso ');
const CTRL_EQED = cid('eqed');
const CTRL_HEAD = cid('head');
const CTRL_FOOT = cid('foot');
const CTRL_FN = cid('fn  ');
const CTRL_EN = cid('en  ');
const CTRL_ATNO = cid('atno');
const CTRL_NWNO = cid('nwno');
const CTRL_TCPS = cid('tcps');
const CTRL_SECD = cid('secd');
const CTRL_TCMT = cid('tcmt');
const CTRL_COLD = cid('cold');
const CTRL_PGNP = cid('pgnp');
const CTRL_PGHD = cid('pghd');
const CTRL_IDXM = cid('idxm');
const CTRL_BOKM = cid('bokm');
const CTRL_TDUT = cid('tdut');
const CTRL_FORM = cid('form');
const CTRL_OLE = cid('ole ');
const FIELD_CLK = cid('%clk');

const KNOWN_CTRL = new Set([
  CTRL_TBL, CTRL_GSO, CTRL_EQED, CTRL_HEAD, CTRL_FOOT, CTRL_FN, CTRL_EN,
  CTRL_ATNO, CTRL_NWNO, CTRL_TCPS, CTRL_SECD, CTRL_TCMT, CTRL_COLD,
  CTRL_PGNP, CTRL_PGHD, CTRL_IDXM, CTRL_BOKM, CTRL_TDUT, CTRL_FORM, CTRL_OLE,
]);

function swap32(id: number): number {
  return (((id & 0xff) << 24) | (((id >>> 8) & 0xff) << 16) | (((id >>> 16) & 0xff) << 8) | ((id >>> 24) & 0xff)) >>> 0;
}

function isFieldCtrl(id: number): boolean {
  return (id >>> 24) === 0x25; // '%'
}

function normalizeCtrlId(raw: number): number {
  if (KNOWN_CTRL.has(raw) || isFieldCtrl(raw)) return raw;
  const sw = swap32(raw);
  return KNOWN_CTRL.has(sw) || isFieldCtrl(sw) ? sw : raw;
}

// ── 레코드 리더 ──

interface HwpRecord {
  tagId: number;
  level: number;
  data: Uint8Array;
  view: DataView;
}

function readRecords(data: Uint8Array): HwpRecord[] {
  const records: HwpRecord[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = 0;

  while (off + 4 <= data.byteLength && records.length < MAX_RECORDS) {
    const hdr = view.getUint32(off, true);
    off += 4;
    const tagId = hdr & 0x3ff;
    const level = (hdr >>> 10) & 0x3ff;
    let size = (hdr >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (off + 4 > data.byteLength) break;
      size = view.getUint32(off, true);
      off += 4;
    }
    if (off + size > data.byteLength) break;
    const slice = data.subarray(off, off + size);
    records.push({ tagId, level, data: slice, view: new DataView(slice.buffer, slice.byteOffset, slice.byteLength) });
    off += size;
  }
  return records;
}

// ── DocInfo (문단번호·글머리표) ──

interface HwpParaShape {
  headType: number; // 0=없음, 1=개요, 2=번호, 3=글머리표
  paraLevel: number;
  numberingId: number;
}

interface HwpNumbering {
  levelFormats: string[];
  numberFormats: number[];
  startNumbers: number[];
}

interface HwpDocInfo {
  paraShapes: HwpParaShape[];
  numberings: HwpNumbering[];
  bullets: string[];
}

function readHwpString(data: Uint8Array, view: DataView, offset: number): { value: string; next: number } {
  if (offset + 2 > data.byteLength) return { value: '', next: data.byteLength };
  const len = view.getUint16(offset, true);
  const start = offset + 2;
  const end = start + len * 2;
  if (len === 0 || end > data.byteLength) return { value: '', next: start };
  return { value: utf16le.decode(data.subarray(start, end)), next: end };
}

function parseDocInfo(records: HwpRecord[]): HwpDocInfo {
  const paraShapes: HwpParaShape[] = [];
  const numberings: HwpNumbering[] = [];
  const bullets: string[] = [];

  for (const rec of records) {
    if (rec.tagId === TAG_DOC_PARA_SHAPE && rec.data.byteLength >= 4) {
      const attr1 = rec.view.getUint32(0, true);
      paraShapes.push({
        headType: (attr1 >>> 23) & 0x03,
        paraLevel: (attr1 >>> 25) & 0x07,
        numberingId: rec.data.byteLength >= 32 ? rec.view.getUint16(30, true) : 0,
      });
    } else if (rec.tagId === TAG_NUMBERING && rec.data.byteLength >= 14) {
      const levelFormats: string[] = [];
      const numberFormats: number[] = [];
      const startNumbers = [1, 1, 1, 1, 1, 1, 1];
      let off = 0;
      for (let lv = 0; lv < 7; lv++) {
        if (off + 12 > rec.data.byteLength) {
          levelFormats.push('');
          numberFormats.push(0);
          continue;
        }
        const attr = rec.view.getUint32(off, true);
        numberFormats.push((attr >>> 5) & 0x0f);
        off += 12;
        const { value, next } = readHwpString(rec.data, rec.view, off);
        levelFormats.push(value);
        off = next;
      }
      let baseStart = 1;
      if (off + 2 <= rec.data.byteLength) {
        baseStart = rec.view.getUint16(off, true) || 1;
        off += 2;
      }
      for (let lv = 0; lv < 7; lv++) {
        if (off + 4 <= rec.data.byteLength) {
          startNumbers[lv] = rec.view.getUint32(off, true) || 1;
          off += 4;
        } else {
          startNumbers[lv] = baseStart;
        }
      }
      numberings.push({ levelFormats, numberFormats, startNumbers });
    } else if (rec.tagId === TAG_BULLET && rec.data.byteLength >= 14) {
      const code = rec.view.getUint16(12, true);
      bullets.push(code > 0 && code !== 0xffff ? mapPuaText(String.fromCharCode(code)) : '·');
    }
  }
  return { paraShapes, numberings, bullets };
}

class NumberingState {
  private currentId = 0;
  private counters = [0, 0, 0, 0, 0, 0, 0];
  private history = new Map<number, number[]>();

  advance(numberingId: number, level: number): number[] {
    const lv = Math.min(Math.max(level, 0), 6);
    if (this.currentId !== numberingId) {
      if (this.currentId !== 0) this.history.set(this.currentId, [...this.counters]);
      const saved = this.history.get(numberingId);
      if (saved) {
        this.counters = [...saved];
      } else {
        const prev = this.counters;
        this.counters = [0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < lv; i++) this.counters[i] = prev[i]!;
      }
      this.currentId = numberingId;
    }
    this.counters[lv]!++;
    for (let i = lv + 1; i < 7; i++) this.counters[i] = 0;
    return [...this.counters];
  }
}

function expandNumbering(fmt: string, counters: number[], def: HwpNumbering): string {
  let out = '';
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i]!;
    if (ch === '^' && i + 1 < fmt.length && fmt[i + 1]! >= '1' && fmt[i + 1]! <= '7') {
      const idx = fmt.charCodeAt(i + 1) - 49;
      const cnt = counters[idx] ?? 0;
      const start = def.startNumbers[idx] ?? 1;
      const num = cnt > 0 ? start - 1 + cnt : start;
      out += formatHwp5Number(num, def.numberFormats[idx] ?? 0);
      i++;
      continue;
    }
    if (ch === '^' && !/[\p{L}\p{N}]/u.test(fmt[i + 1] ?? '')) continue;
    out += ch;
  }
  return out.trim();
}

// ── 본문 파싱 상태 ──

interface HwpDocState {
  docInfo: HwpDocInfo;
  numbering: NumberingState;
  outlineNumberingId: number;
  autoCounters: Map<number, number>;
  tableCounter: number;
}

interface ParsedCtrl {
  id: number;
  idRaw: number;
  data: Uint8Array;
  view: DataView;
  childStart: number;
  childEnd: number;
  inlineText?: string;
  footnote?: string;
  afterBlocks?: Block[];
  guide?: string;
  resolved?: boolean;
}

function isExtendedOnlyCtrl(ch: number): boolean {
  return (ch >= 1 && ch <= 3) || (ch >= 11 && ch <= 12) || (ch >= 14 && ch <= 18) || (ch >= 21 && ch <= 23);
}

function extractParaText(
  textRecs: HwpRecord[],
  ctrls: ParsedCtrl[],
): string {
  let ctrlIdx = 0;
  let text = '';
  const fieldStack: Array<{ start: number; ctrlIdx: number }> = [];
  const fieldRanges: Array<{ start: number; end: number; ctrlIdx: number }> = [];

  const resolve = (idx: number, rawId: number): string => {
    let ctrl = idx >= 0 && idx < ctrls.length ? ctrls[idx] : undefined;
    if (!ctrl || (ctrl.idRaw !== rawId && ctrl.id !== rawId)) {
      ctrl = ctrls.find(c => !c.resolved && (c.idRaw === rawId || c.id === rawId));
    }
    if (!ctrl) return '';
    ctrl.resolved = true;
    return ctrl.inlineText ?? '';
  };

  for (const rec of textRecs) {
    const { data, view } = rec;
    let i = 0;
    while (i + 1 < data.byteLength) {
      const ch = view.getUint16(i, true);
      i += 2;
      if (ch === 0x0000) {
        text += '\n';
      } else if (ch === 0x000a) {
        if (i + 16 <= data.byteLength && view.getUint16(i, true) === 0x000b) {
          const rawId = view.getUint32(i + 2, true);
          text += resolve(ctrlIdx++, rawId);
          i += 16;
        } else {
          text += '\n';
        }
      } else if (ch === 0x000d || ch === 0x0018) {
        // 문단 끝 / 비표시 하이픈
      } else if (ch === 0x001e || ch === 0x001f) {
        text += ' ';
      } else if (ch === 0x0009) {
        text += ' ';
        if (i + 14 <= data.byteLength) i += 14;
      } else if (ch >= 0x0001 && ch <= 0x001f) {
        const isExt = isExtendedOnlyCtrl(ch);
        const isInl = (ch >= 4 && ch <= 9) || (ch >= 19 && ch <= 20);
        if ((isExt || isInl) && i + 14 <= data.byteLength) {
          if (ch === 0x0003) fieldStack.push({ start: text.length, ctrlIdx });
          else if (ch === 0x0004) {
            const open = fieldStack.pop();
            if (open) fieldRanges.push({ start: open.start, end: text.length, ctrlIdx: open.ctrlIdx });
          }
          const rawId = view.getUint32(i, true);
          text += resolve(isExt ? ctrlIdx++ : -1, rawId);
          i += 14;
        }
      } else if (ch >= 0x0020) {
        if (ch >= HANCOM_FOLDED_START && ch <= HANCOM_FOLDED_END) {
          text += String.fromCodePoint(ch + HANCOM_FOLDED_SHIFT);
        } else if (ch >= 0xd800 && ch <= 0xdbff && i + 1 < data.byteLength) {
          const lo = view.getUint16(i, true);
          if (lo >= 0xdc00 && lo <= 0xdfff) {
            i += 2;
            text += String.fromCodePoint(((ch - 0xd800) << 10) + (lo - 0xdc00) + 0x10000);
          } else {
            text += '□';
          }
        } else if (ch >= 0xd800 && ch <= 0xdfff) {
          text += '□';
        } else {
          text += String.fromCharCode(ch);
        }
      }
    }
  }

  // 미기입 누름틀 안내문 제거
  if (fieldRanges.length) {
    const sorted = [...fieldRanges].sort((a, b) => b.start - a.start);
    for (const r of sorted) {
      const ctrl = ctrls[r.ctrlIdx];
      if (!ctrl?.guide || r.end <= r.start) continue;
      const anchor = text.slice(r.start, r.end);
      if (anchor === ctrl.guide || anchor.trimEnd() === ctrl.guide) {
        text = text.slice(0, r.start) + text.slice(r.end);
      }
    }
  }
  return text;
}

function parseClickHereGuide(data: Uint8Array, view: DataView): string | undefined {
  if (data.byteLength < 11) return undefined;
  if ((view.getUint32(4, true) & (1 << 15)) !== 0) return undefined; // 수정된 필드면 본문 유지
  const cmdLen = view.getUint16(9, true);
  const end = 11 + cmdLen * 2;
  if (!cmdLen || end > data.byteLength) return undefined;
  const cmd = utf16le.decode(data.subarray(11, end));
  const m = /Direction:wstring:(\d+):/.exec(cmd);
  if (!m) return undefined;
  return cmd.slice(m.index + m[0].length, m.index + m[0].length + Number(m[1])) || undefined;
}

function parseListHeaderBlocks(records: HwpRecord[], start: number, end: number, doc: HwpDocState, depth: number): Block[] {
  if (depth >= MAX_NEST_DEPTH) return [];
  for (let i = start; i < end; i++) {
    if (records[i]!.tagId === TAG_LIST_HEADER) {
      return parseParagraphList(records, i + 1, end, doc, depth + 1);
    }
  }
  return [];
}

function parseTableControl(ctrl: ParsedCtrl, records: HwpRecord[], doc: HwpDocState, depth: number): Block[] {
  if (depth >= MAX_NEST_DEPTH) return [];
  const directLevel = records[ctrl.childStart - 1]!.level + 1;
  let tableIdx = -1;
  for (let i = ctrl.childStart; i < ctrl.childEnd; i++) {
    if (records[i]!.tagId === TAG_TABLE && records[i]!.level === directLevel && records[i]!.data.byteLength >= 8) {
      tableIdx = i;
      break;
    }
  }
  if (tableIdx < 0) return [];

  const out: Block[] = [];
  // 표 캡션 (TABLE 이전 LIST_HEADER)
  let caption = '';
  let captionBelow = false;
  for (let i = ctrl.childStart; i < tableIdx; i++) {
    if (records[i]!.tagId === TAG_LIST_HEADER) {
      const capBlocks = parseParagraphList(records, i + 1, tableIdx, doc, depth + 1);
      caption = normalizeLine(capBlocks.map(b => b.text).join(' '));
      captionBelow = records[i]!.data.byteLength >= 12 && (records[i]!.view.getUint32(8, true) & 3) === 3;
      break;
    }
  }
  if (caption && !captionBelow) out.push({ ...classifyLine(caption), text: caption });

  // 셀 목록 (TABLE 이후 LIST_HEADER)
  const cells: GridCellInput[] = [];
  let i = tableIdx + 1;
  while (i < ctrl.childEnd) {
    const rec = records[i]!;
    if (rec.tagId === TAG_LIST_HEADER) {
      const cellLevel = rec.level;
      let j = i + 1;
      while (j < ctrl.childEnd) {
        const r = records[j]!;
        if (r.level < cellLevel) break;
        if (r.level === cellLevel && (r.tagId === TAG_LIST_HEADER || r.tagId === TAG_TABLE)) break;
        j++;
      }
      let colSpan = 1;
      let rowSpan = 1;
      let colAddr: number | undefined;
      let rowAddr: number | undefined;
      if (rec.data.byteLength >= 16) {
        colAddr = rec.view.getUint16(8, true);
        rowAddr = rec.view.getUint16(10, true);
        colSpan = Math.max(1, rec.view.getUint16(12, true) || 1);
        rowSpan = Math.max(1, rec.view.getUint16(14, true) || 1);
      }
      const cellBlocks = parseParagraphList(records, i + 1, j, doc, depth + 1);
      const cellText = normalizeLine(cellBlocks.map(b => b.text).join(' '));
      cells.push({
        text: cellText,
        colSpan,
        rowSpan,
        ...(colAddr !== undefined ? { colAddr } : {}),
        ...(rowAddr !== undefined ? { rowAddr } : {}),
      });
      i = j;
      continue;
    }
    i++;
  }

  if (cells.length) {
    // 행별로 그룹핑 (rowAddr 있으면 buildTableGrid가 절대좌표로 직접 배치)
    const hasAddr = cells.some(c => c.colAddr !== undefined && c.rowAddr !== undefined);
    const grid = buildTableGrid(hasAddr ? [cells] : cells.map(c => [c]));
    const nonEmpty = grid.filter(r => r.some(Boolean));
    if (nonEmpty.length) {
      doc.tableCounter += 1;
      const tableNo = doc.tableCounter;
      nonEmpty.forEach((rowCells, idx) => {
        out.push({ kind: 'table-row', text: tableRowText(rowCells), table: tableNo, row: idx + 1 });
      });
    }
  }

  if (caption && captionBelow) out.push({ ...classifyLine(caption), text: caption });
  return out;
}

function applyCtrl(ctrl: ParsedCtrl, records: HwpRecord[], doc: HwpDocState, depth: number): void {
  switch (ctrl.id) {
    case CTRL_TBL: {
      const blocks = parseTableControl(ctrl, records, doc, depth);
      if (blocks.length) ctrl.afterBlocks = blocks;
      return;
    }
    case CTRL_GSO: {
      const blocks = parseListHeaderBlocks(records, ctrl.childStart, ctrl.childEnd, doc, depth);
      if (blocks.length) ctrl.afterBlocks = blocks;
      return;
    }
    case CTRL_EQED: {
      for (let i = ctrl.childStart; i < ctrl.childEnd; i++) {
        const r = records[i]!;
        if (r.tagId !== TAG_EQEDIT || r.data.byteLength < 6) continue;
        const len = r.view.getUint16(4, true);
        if (len > 0 && 6 + len * 2 <= r.data.byteLength) {
          const eq = hwpEquationToText(utf16le.decode(r.data.subarray(6, 6 + len * 2)));
          if (eq) ctrl.inlineText = ` ${eq} `;
        }
        break;
      }
      return;
    }
    case CTRL_FN:
    case CTRL_EN: {
      const blocks = parseListHeaderBlocks(records, ctrl.childStart, ctrl.childEnd, doc, depth);
      const note = normalizeLine(blocks.map(b => b.text).join(' '));
      if (note) ctrl.footnote = note;
      return;
    }
    case CTRL_SECD: {
      if (ctrl.data.byteLength >= 20) doc.outlineNumberingId = ctrl.view.getUint16(18, true);
      return;
    }
    case CTRL_ATNO: {
      if (ctrl.data.byteLength >= 8) {
        const attr = ctrl.view.getUint32(4, true);
        const type = attr & 0x0f;
        const fmt = (attr >>> 4) & 0xff;
        const stored = type !== 0 && ctrl.data.byteLength >= 10 ? ctrl.view.getUint16(8, true) : 0;
        const num = stored || (doc.autoCounters.get(type) ?? 1);
        doc.autoCounters.set(type, num + 1);
        if (type !== 0) ctrl.inlineText = formatHwp5Number(num, fmt);
      }
      return;
    }
    case CTRL_NWNO: {
      if (ctrl.data.byteLength >= 10) {
        const type = ctrl.view.getUint32(4, true) & 0x0f;
        const num = ctrl.view.getUint16(8, true);
        if (num > 0) doc.autoCounters.set(type, num);
      }
      return;
    }
    case CTRL_TCPS: {
      const n = ctrl.data.byteLength >= 6 ? ctrl.view.getUint16(4, true) : 0;
      if (n > 0 && ctrl.data.byteLength >= 6 + 2 * n) {
        const chars = utf16le.decode(ctrl.data.subarray(6, 6 + 2 * n));
        ctrl.inlineText = composeText(chars, (ctrl.data[6 + 2 * n] ?? 0) !== 0);
      }
      return;
    }
    case FIELD_CLK: {
      ctrl.guide = parseClickHereGuide(ctrl.data, ctrl.view);
      return;
    }
    case CTRL_HEAD: case CTRL_FOOT: case CTRL_TCMT: case CTRL_COLD:
    case CTRL_PGNP: case CTRL_PGHD: case CTRL_IDXM: case CTRL_BOKM:
    case CTRL_TDUT: case CTRL_FORM: case CTRL_OLE:
      return;
    default: {
      if (isFieldCtrl(ctrl.id)) return;
      const blocks = parseListHeaderBlocks(records, ctrl.childStart, ctrl.childEnd, doc, depth);
      if (blocks.length) ctrl.afterBlocks = blocks;
    }
  }
}

function parseParagraph(records: HwpRecord[], start: number, end: number, doc: HwpDocState, depth: number): Block[] {
  const hdr = records[start]!;
  const baseLevel = hdr.level;
  const paraShapeId = hdr.data.byteLength >= 10 ? hdr.view.getUint16(8, true) : -1;

  const textRecs: HwpRecord[] = [];
  const ctrls: ParsedCtrl[] = [];

  let i = start + 1;
  while (i < end) {
    const rec = records[i]!;
    if (rec.tagId === TAG_CTRL_HEADER && rec.level === baseLevel + 1 && rec.data.byteLength >= 4) {
      let j = i + 1;
      while (j < end && records[j]!.level > baseLevel + 1) j++;
      const idRaw = rec.view.getUint32(0, true);
      ctrls.push({ id: normalizeCtrlId(idRaw), idRaw, data: rec.data, view: rec.view, childStart: i + 1, childEnd: j });
      i = j;
      continue;
    }
    if (rec.tagId === TAG_PARA_TEXT && rec.level === baseLevel + 1) textRecs.push(rec);
    i++;
  }

  for (const ctrl of ctrls) applyCtrl(ctrl, records, doc, depth);

  const rawText = extractParaText(textRecs, ctrls);

  // 문단번호/글머리표/개요
  let headMarker = '';
  let isOutline = false;
  const ps = paraShapeId >= 0 ? doc.docInfo.paraShapes[paraShapeId] : undefined;
  if (ps && ps.headType > 0) {
    if (ps.headType === 1) isOutline = true;
    if (ps.headType === 1 || ps.headType === 2) {
      const nid = ps.numberingId || (ps.headType === 1 ? doc.outlineNumberingId : 0);
      const numDef = nid >= 1 ? doc.docInfo.numberings[nid - 1] : undefined;
      if (numDef) {
        const counters = doc.numbering.advance(nid, ps.paraLevel);
        const fmt = numDef.levelFormats[Math.min(ps.paraLevel, 6)];
        if (fmt) headMarker = expandNumbering(fmt, counters, numDef);
      }
    } else if (ps.headType === 3) {
      headMarker = (ps.numberingId >= 1 ? doc.docInfo.bullets[ps.numberingId - 1] : undefined) ?? '';
    }
  }

  const out: Block[] = [];
  const lines = rawText.split('\n').map(normalizeLine).filter(Boolean);
  lines.forEach((line, idx) => {
    const full = idx === 0 && headMarker ? `${headMarker} ${line}` : line;
    const classified = classifyLine(full);
    out.push(isOutline && classified.kind === 'para' ? { kind: 'heading', text: full } : { ...classified, text: full });
  });

  for (const ctrl of ctrls) {
    if (ctrl.footnote) out.push({ kind: 'para', text: `(주석) ${ctrl.footnote}` });
    if (ctrl.afterBlocks) out.push(...ctrl.afterBlocks);
  }
  return out;
}

function parseParagraphList(records: HwpRecord[], start: number, end: number, doc: HwpDocState, depth: number): Block[] {
  if (depth >= MAX_NEST_DEPTH || start >= end) return [];
  const out: Block[] = [];
  let minLevel = Infinity;
  for (let i = start; i < end; i++) {
    if (records[i]!.tagId === TAG_PARA_HEADER && records[i]!.level < minLevel) minLevel = records[i]!.level;
  }
  if (!Number.isFinite(minLevel)) return out;

  let i = start;
  while (i < end) {
    const rec = records[i]!;
    if (rec.tagId === TAG_PARA_HEADER && rec.level === minLevel) {
      let j = i + 1;
      while (j < end && !(records[j]!.tagId === TAG_PARA_HEADER && records[j]!.level === minLevel)) j++;
      out.push(...parseParagraph(records, i, j, doc, depth));
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

// ── 진입점 ──

export function extractHwp5(bytes: Uint8Array): { blocks: Block[]; warnings: string[] } {
  let cfb;
  try {
    cfb = parseCfb(bytes);
  } catch {
    throw new FileExtractError('구형 한글(.hwp) 파일의 내부 구조가 손상되어 읽을 수 없습니다.');
  }

  const headerData = cfb.findStream('/FileHeader');
  if (!headerData || headerData.byteLength < 40) {
    throw new FileExtractError('올바른 한글(.hwp 5.x) 파일이 아닙니다.');
  }
  const sig = utf8.decode(headerData.subarray(0, 32)).replace(/\0+$/, '');
  if (sig !== 'HWP Document File') {
    throw new FileExtractError('올바른 한글(.hwp 5.x) 파일이 아닙니다.');
  }

  const flags = new DataView(headerData.buffer, headerData.byteOffset, headerData.byteLength).getUint32(36, true);
  if (flags & FLAG_DRM) {
    throw new FileExtractError('문서보안(DRM)이 걸린 한글(.hwp) 파일은 읽을 수 없습니다.');
  }
  if (flags & FLAG_ENCRYPTED) {
    throw new FileExtractError('암호로 보호된 한글(.hwp) 파일입니다. 한글에서 암호를 해제한 뒤 다시 올려 주세요.');
  }

  const compressed = (flags & FLAG_COMPRESSED) !== 0;
  const distribution = (flags & FLAG_DISTRIBUTION) !== 0;
  const warnings: string[] = [];

  // DocInfo
  let docInfo: HwpDocInfo = { paraShapes: [], numberings: [], bullets: [] };
  const rawDocInfo = cfb.findStream('/DocInfo');
  if (rawDocInfo) {
    try {
      const data = compressed ? decompressHwpStream(rawDocInfo) : rawDocInfo;
      docInfo = parseDocInfo(readRecords(data));
    } catch {
      warnings.push('문서 서식(DocInfo)을 일부 읽지 못해 자동번호가 생략될 수 있습니다.');
    }
  }

  // 섹션 스트림 수집
  const sectionStreams: Uint8Array[] = [];
  const folder = distribution ? 'ViewText' : 'BodyText';
  for (let n = 0; n < MAX_SECTIONS; n++) {
    const raw = cfb.findStream(`/${folder}/Section${n}`);
    if (!raw) break;
    try {
      const data = distribution
        ? decryptDistributionSection(raw, compressed)
        : compressed
          ? decompressHwpStream(raw)
          : raw;
      sectionStreams.push(data);
    } catch {
      warnings.push(`섹션 ${n + 1}의 압축 해제/복호화에 실패해 건너뛰었습니다.`);
    }
  }

  if (!sectionStreams.length) {
    throw new FileExtractError('한글(.hwp) 본문 섹션을 찾지 못했습니다. 한글에서 HWPX나 PDF로 저장해 올려 주세요.');
  }

  const docState: HwpDocState = {
    docInfo,
    numbering: new NumberingState(),
    outlineNumberingId: 0,
    autoCounters: new Map(),
    tableCounter: 0,
  };

  const blocks: Block[] = [];
  for (const stream of sectionStreams) {
    const records = readRecords(stream);
    blocks.push(...parseParagraphList(records, 0, records.length, docState, 0));
  }

  return { blocks, warnings };
}
