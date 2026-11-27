/**
 * 구형 엑셀(.xls, BIFF8 OLE2) 순수 브라우저 TypeScript 파서.
 *
 * kordoc(MIT) src/xls/{parser,record,sst,cell}.ts 벤치마킹:
 *  - CFB 컨테이너(cfb.ts)에서 Workbook/Book 스트림 추출
 *  - BIFF8 레코드 순회 + SST(CONTINUE 경계 플래그 재해석 포함)
 *  - Number / RK / MulRk / LabelSst / Label / Formula(+String) / BoolErr / MergeCells 처리
 *  - XF + Format + DATE1904 기반 날짜 시리얼 → ISO 날짜 변환(한국어 내장 서식 포함)
 *  - XLSX와 동일한 sheetRowsToBlocks()로 표 행 생성
 */

import { parseCfb } from './cfb';
import { cleanNumericValue, dateKindOfFmt, dateSerialToIso, sheetRowsToBlocks, XLSX_MAX_SHEETS, type DateKind, type SheetMerge } from './xlsx';
import { FileExtractError, type Block } from './types';

const OP_BOF = 0x0809;
const OP_EOF = 0x000a;
const OP_CONTINUE = 0x003c;
const OP_BOUNDSHEET8 = 0x0085;
const OP_SST = 0x00fc;
const OP_DATE1904 = 0x0022;
const OP_FILEPASS = 0x002f;
const OP_FORMAT = 0x041e;
const OP_XF = 0x00e0;

const OP_NUMBER = 0x0203;
const OP_RK = 0x027e;
const OP_MULRK = 0x00bd;
const OP_LABELSST = 0x00fd;
const OP_LABEL = 0x0204;
const OP_FORMULA = 0x0006;
const OP_STRING = 0x0207;
const OP_BOOLERR = 0x0205;
const OP_MERGECELLS = 0x00e5;
const OP_SHRFMLA = 0x04bc;
const OP_ARRAY = 0x0221;

const DT_GLOBALS = 0x0005;
const DT_WORKSHEET = 0x0010;
const MAX_RECORDS = 1_000_000;

const utf16le = new TextDecoder('utf-16le');

interface BiffRecord {
  opcode: number;
  data: Uint8Array;
  view: DataView;
  offset: number;
}

function readBiffRecords(stream: Uint8Array): BiffRecord[] {
  const out: BiffRecord[] = [];
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  let off = 0;
  while (off + 4 <= stream.byteLength && out.length < MAX_RECORDS) {
    const recOffset = off;
    const opcode = view.getUint16(off, true);
    const length = view.getUint16(off + 2, true);
    off += 4;
    const end = Math.min(off + length, stream.byteLength);
    const data = stream.subarray(off, end);
    out.push({ opcode, data, view: new DataView(data.buffer, data.byteOffset, data.byteLength), offset: recOffset });
    off = end;
    if (end < recOffset + 4 + length) break;
  }
  return out;
}

function decodeCompressedOrUtf16(data: Uint8Array, start: number, cch: number, highByte: boolean): string {
  if (cch <= 0 || start >= data.byteLength) return '';
  if (highByte) {
    const end = Math.min(start + cch * 2, data.byteLength);
    return utf16le.decode(data.subarray(start, end));
  }
  const end = Math.min(start + cch, data.byteLength);
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(data[i]!);
  return out;
}

function decodeSST(records: BiffRecord[], globalsEnd: number): string[] {
  const idx = records.findIndex((r, i) => i < globalsEnd && r.opcode === OP_SST);
  if (idx < 0) return [];

  const chunks: Uint8Array[] = [records[idx]!.data];
  const segments: number[] = [records[idx]!.data.byteLength];
  let total = records[idx]!.data.byteLength;
  for (let i = idx + 1; i < globalsEnd && records[i]!.opcode === OP_CONTINUE; i++) {
    const d = records[i]!.data;
    chunks.push(d);
    total += d.byteLength;
    segments.push(total);
  }
  const combined = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { combined.set(c, pos); pos += c.byteLength; }
  if (combined.byteLength < 8) return [];

  const view = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
  const uniqueCount = view.getUint32(4, true);
  const strings: string[] = [];
  let off = 8;
  let segIdx = 0;

  for (let s = 0; s < uniqueCount && off + 3 <= combined.byteLength; s++) {
    const cch = view.getUint16(off, true);
    let flags = combined[off + 2]!;
    off += 3;
    let highByte = (flags & 0x01) !== 0;
    const extSt = (flags & 0x04) !== 0;
    const richSt = (flags & 0x08) !== 0;

    let cRun = 0;
    let cbExt = 0;
    if (richSt) {
      if (off + 2 > combined.byteLength) break;
      cRun = view.getUint16(off, true);
      off += 2;
    }
    if (extSt) {
      if (off + 4 > combined.byteLength) break;
      cbExt = view.getUint32(off, true);
      off += 4;
    }

    let text = '';
    let read = 0;
    while (read < cch) {
      while (segIdx < segments.length && segments[segIdx]! < off) segIdx++;
      if (segIdx < segments.length && segments[segIdx] === off) {
        if (off >= combined.byteLength) break;
        flags = combined[off]!;
        highByte = (flags & 0x01) !== 0;
        off += 1;
        segIdx++;
      }
      const nextBoundary = segIdx < segments.length ? segments[segIdx]! : combined.byteLength;
      const bpc = highByte ? 2 : 1;
      const takeChars = Math.min(cch - read, Math.floor((nextBoundary - off) / bpc));
      if (takeChars > 0) {
        text += decodeCompressedOrUtf16(combined, off, takeChars, highByte);
        off += takeChars * bpc;
        read += takeChars;
      } else if (nextBoundary < combined.byteLength) {
        off = nextBoundary;
      } else {
        break;
      }
    }

    if (richSt) off += 4 * cRun;
    if (extSt) off += cbExt;
    strings.push(text);
  }
  return strings;
}

function decodeRk(rk: number): number {
  const fDiv100 = (rk & 0x01) !== 0;
  const fInt = (rk & 0x02) !== 0;
  let num: number;
  if (fInt) {
    num = rk >> 2;
  } else {
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setUint32(0, 0, true);
    dv.setUint32(4, (rk & 0xfffffffc) >>> 0, true);
    num = dv.getFloat64(0, true);
  }
  return fDiv100 ? num / 100 : num;
}

function errorCodeText(code: number): string {
  switch (code) {
    case 0x00: return '#NULL!';
    case 0x07: return '#DIV/0!';
    case 0x0f: return '#VALUE!';
    case 0x17: return '#REF!';
    case 0x1d: return '#NAME?';
    case 0x24: return '#NUM!';
    case 0x2a: return '#N/A';
    default: return `#ERR${code}`;
  }
}

function formatNumCell(n: number, ixfe: number, dateXfs: Map<number, DateKind>, date1904: boolean): string {
  const kind = dateXfs.get(ixfe);
  if (kind) {
    const iso = dateSerialToIso(n, date1904, kind);
    if (iso) return iso;
  }
  return cleanNumericValue(String(n));
}

function findSheetBof(records: BiffRecord[], lbPlyPos: number): number {
  const exact = records.findIndex(r => r.opcode === OP_BOF && r.offset === lbPlyPos);
  if (exact >= 0) return exact;
  let best = -1;
  let bestOff = Infinity;
  for (let i = 1; i < records.length; i++) {
    const r = records[i]!;
    if (r.opcode === OP_BOF && r.offset >= lbPlyPos && r.offset < bestOff) {
      best = i;
      bestOff = r.offset;
    }
  }
  return best;
}

export function extractXls(bytes: Uint8Array): { blocks: Block[]; warnings: string[] } {
  let cfb;
  try {
    cfb = parseCfb(bytes);
  } catch {
    throw new FileExtractError('구형 엑셀(.xls) 파일의 구조가 손상되어 읽을 수 없습니다.');
  }

  const stream = cfb.findStream('/Workbook') ?? cfb.findStream('/Book');
  if (!stream) throw new FileExtractError('구형 엑셀(.xls)의 Workbook 스트림을 찾지 못했습니다.');

  const records = readBiffRecords(stream);
  if (!records.length || records[0]!.opcode !== OP_BOF || records[0]!.data.byteLength < 4) {
    throw new FileExtractError('올바른 BIFF8 엑셀(.xls) 파일이 아닙니다.');
  }
  if (records[0]!.view.getUint16(2, true) !== DT_GLOBALS) {
    throw new FileExtractError('엑셀(.xls) Globals 헤더를 찾지 못했습니다.');
  }

  interface BoundSheet { name: string; lbPlyPos: number; dt: number }
  const sheets: BoundSheet[] = [];
  const customFormats = new Map<number, string>();
  const xfFmtIds: number[] = [];
  let date1904 = false;
  let encrypted = false;

  let globalsEnd = 1;
  while (globalsEnd < records.length) {
    const r = records[globalsEnd]!;
    if (r.opcode === OP_EOF) { globalsEnd++; break; }
    if (r.opcode === OP_FILEPASS) encrypted = true;
    else if (r.opcode === OP_DATE1904 && r.data.byteLength >= 2) date1904 = r.view.getUint16(0, true) === 1;
    else if (r.opcode === OP_FORMAT && r.data.byteLength >= 5) {
      const ifmt = r.view.getUint16(0, true);
      const cch = r.view.getUint16(2, true);
      const highByte = (r.data[4]! & 0x01) !== 0;
      customFormats.set(ifmt, decodeCompressedOrUtf16(r.data, 5, cch, highByte));
    } else if (r.opcode === OP_XF && r.data.byteLength >= 4) {
      xfFmtIds.push(r.view.getUint16(2, true));
    } else if (r.opcode === OP_BOUNDSHEET8 && r.data.byteLength >= 8) {
      const lbPlyPos = r.view.getUint32(0, true);
      const dt = r.data[5]!;
      const cch = r.data[6]!;
      const highByte = (r.data[7]! & 0x01) !== 0;
      const name = decodeCompressedOrUtf16(r.data, 8, cch, highByte) || `시트${sheets.length + 1}`;
      sheets.push({ name, lbPlyPos, dt });
    }
    globalsEnd++;
  }

  if (encrypted) {
    throw new FileExtractError('암호로 보호된 엑셀(.xls) 파일입니다. 암호를 해제한 뒤 올려 주세요.');
  }

  const dateXfs = new Map<number, DateKind>();
  xfFmtIds.forEach((fmtId, idx) => {
    const kind = dateKindOfFmt(fmtId, customFormats);
    if (kind) dateXfs.set(idx, kind);
  });

  const sst = decodeSST(records, globalsEnd);
  const workSheets = sheets.filter(s => s.dt === 0);
  const warnings: string[] = [];
  if (workSheets.length > XLSX_MAX_SHEETS) {
    warnings.push(`시트가 ${workSheets.length}개라 앞 ${XLSX_MAX_SHEETS}개만 읽었습니다.`);
  }

  const blocks: Block[] = [];
  for (const [sheetIdx, sheet] of workSheets.slice(0, XLSX_MAX_SHEETS).entries()) {
    const bofIdx = findSheetBof(records, sheet.lbPlyPos);
    if (bofIdx < 0) continue;
    if (records[bofIdx]!.data.byteLength >= 4 && records[bofIdx]!.view.getUint16(2, true) !== DT_WORKSHEET) continue;

    const rowsMap = new Map<number, string[]>();
    const merges: SheetMerge[] = [];
    let maxCol = -1;
    const setCell = (r: number, c: number, val: string) => {
      if (!val) return;
      let row = rowsMap.get(r);
      if (!row) rowsMap.set(r, (row = []));
      row[c] = val;
      if (c > maxCol) maxCol = c;
    };

    for (let i = bofIdx + 1; i < records.length; i++) {
      const rec = records[i]!;
      if (rec.opcode === OP_EOF || rec.opcode === OP_BOF) break;

      if (rec.opcode === OP_NUMBER && rec.data.byteLength >= 14) {
        const r = rec.view.getUint16(0, true);
        const c = rec.view.getUint16(2, true);
        const ixfe = rec.view.getUint16(4, true);
        setCell(r, c, formatNumCell(rec.view.getFloat64(6, true), ixfe, dateXfs, date1904));
      } else if (rec.opcode === OP_RK && rec.data.byteLength >= 10) {
        const r = rec.view.getUint16(0, true);
        const c = rec.view.getUint16(2, true);
        const ixfe = rec.view.getUint16(4, true);
        setCell(r, c, formatNumCell(decodeRk(rec.view.getInt32(6, true)), ixfe, dateXfs, date1904));
      } else if (rec.opcode === OP_MULRK && rec.data.byteLength >= 12) {
        const r = rec.view.getUint16(0, true);
        const cFirst = rec.view.getUint16(2, true);
        const cLast = rec.view.getUint16(rec.data.byteLength - 2, true);
        let off = 4;
        for (let c = cFirst; c <= cLast && off + 6 <= rec.data.byteLength - 2; c++, off += 6) {
          const ixfe = rec.view.getUint16(off, true);
          const rk = rec.view.getInt32(off + 2, true);
          setCell(r, c, formatNumCell(decodeRk(rk), ixfe, dateXfs, date1904));
        }
      } else if (rec.opcode === OP_LABELSST && rec.data.byteLength >= 10) {
        const r = rec.view.getUint16(0, true);
        const c = rec.view.getUint16(2, true);
        const isst = rec.view.getUint32(6, true);
        setCell(r, c, sst[isst] ?? '');
      } else if (rec.opcode === OP_LABEL && rec.data.byteLength >= 9) {
        const r = rec.view.getUint16(0, true);
        const c = rec.view.getUint16(2, true);
        const cch = rec.view.getUint16(6, true);
        const highByte = (rec.data[8]! & 0x01) !== 0;
        setCell(r, c, decodeCompressedOrUtf16(rec.data, 9, cch, highByte));
      } else if (rec.opcode === OP_BOOLERR && rec.data.byteLength >= 8) {
        const r = rec.view.getUint16(0, true);
        const c = rec.view.getUint16(2, true);
        const val = rec.data[6]!;
        const isErr = rec.data[7]! === 1;
        setCell(r, c, isErr ? errorCodeText(val) : (val ? 'TRUE' : 'FALSE'));
      } else if (rec.opcode === OP_FORMULA && rec.data.byteLength >= 14) {
        const r = rec.view.getUint16(0, true);
        const c = rec.view.getUint16(2, true);
        const ixfe = rec.view.getUint16(4, true);
        const tail = rec.view.getUint16(12, true);
        if (tail === 0xffff) {
          const code = rec.data[6]!;
          if (code === 0x00) {
            let j = i + 1;
            while (j < records.length && (records[j]!.opcode === OP_SHRFMLA || records[j]!.opcode === OP_ARRAY)) j++;
            const strRec = records[j];
            if (strRec && strRec.opcode === OP_STRING && strRec.data.byteLength >= 3) {
              const cch = strRec.view.getUint16(0, true);
              const highByte = (strRec.data[2]! & 0x01) !== 0;
              setCell(r, c, decodeCompressedOrUtf16(strRec.data, 3, cch, highByte));
              i = j;
            }
          } else if (code === 0x01) {
            setCell(r, c, rec.data[8] === 1 ? 'TRUE' : 'FALSE');
          } else if (code === 0x02) {
            setCell(r, c, errorCodeText(rec.data[8]!));
          }
        } else {
          setCell(r, c, formatNumCell(rec.view.getFloat64(6, true), ixfe, dateXfs, date1904));
        }
      } else if (rec.opcode === OP_MERGECELLS && rec.data.byteLength >= 2) {
        const count = rec.view.getUint16(0, true);
        let off = 2;
        for (let k = 0; k < count && off + 8 <= rec.data.byteLength; k++, off += 8) {
          const r1 = rec.view.getUint16(off, true);
          const r2 = rec.view.getUint16(off + 2, true);
          const c1 = rec.view.getUint16(off + 4, true);
          const c2 = rec.view.getUint16(off + 6, true);
          if (r2 >= r1 && c2 >= c1) merges.push({ r1, c1, r2, c2 });
        }
      }
    }

    blocks.push(...sheetRowsToBlocks(sheet.name, sheetIdx, rowsMap, maxCol, merges, warnings));
  }

  return { blocks, warnings };
}
