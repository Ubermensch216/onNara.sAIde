/**
 * 순수 브라우저 TypeScript OLE2 / CFB(Compound File Binary) 컨테이너 리더.
 *
 * 구형 한글(.hwp 5.x)과 구형 엑셀(.xls BIFF8)이 공통으로 사용하는 OLE2 복합 문서를
 * Node.js 의존성 없이 Uint8Array · DataView · TextDecoder로 직접 읽는다.
 * 손상된 FAT/디렉터리에도 견디는 lenient 복구 로직과 순환·크기 폭탄 가드를 포함한다.
 *
 * 출처·벤치마킹: chrisryugj/kordoc (MIT) src/hwp5/cfb-lenient.ts & edwardkim/rhwp (MIT)
 */

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECT = 0xffffffff;
const MAX_CHAIN_LENGTH = 1_000_000;
const MAX_DIR_ENTRIES = 100_000;
const MAX_STREAM_SIZE = 100 * 1024 * 1024;

export interface CfbDirEntry {
  name: string;
  /** 0=unknown, 1=storage, 2=stream, 5=root */
  type: number;
  startSector: number;
  size: number;
  left: number;
  right: number;
  child: number;
}

export interface CfbContainer {
  findStream(path: string): Uint8Array | null;
  listStreams(): CfbDirEntry[];
}

export function isOleBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== CFB_MAGIC[i]) return false;
  }
  return true;
}

function concatUint8(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

const utf16leDecoder = new TextDecoder('utf-16le');

export function parseCfb(data: Uint8Array): CfbContainer {
  if (data.byteLength < 512) throw new Error('OLE2 파일이 너무 짧습니다.');
  if (!isOleBytes(data)) throw new Error('OLE2 시그니처가 일치하지 않습니다.');

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sectorShift = view.getUint16(30, true);
  if (sectorShift < 7 || sectorShift > 16) throw new Error('유효하지 않은 CFB 섹터 크기입니다.');
  const sectorSize = 1 << sectorShift;
  const miniShift = view.getUint16(32, true);
  if (miniShift > 16) throw new Error('유효하지 않은 CFB 미니 섹터 크기입니다.');
  const miniSectorSize = 1 << miniShift;

  const headerFatCount = view.getUint32(44, true);
  if (headerFatCount > 10_000) throw new Error('CFB FAT 섹터 수가 비정상적으로 큽니다.');
  const maxRealSectors = Math.ceil(Math.max(0, data.byteLength - 512) / sectorSize);
  const maxFatSectors = Math.max(1, Math.ceil(maxRealSectors / (sectorSize / 4)));
  const fatSectorCount = Math.min(headerFatCount, maxFatSectors);

  const firstDirSector = view.getUint32(48, true);
  const miniStreamCutoff = view.getUint32(56, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const miniFatSectorCount = view.getUint32(64, true);
  const firstDifatSector = view.getUint32(68, true);
  const difatSectorCount = view.getUint32(72, true);

  const readSector = (id: number): Uint8Array => {
    const off = 512 + id * sectorSize;
    if (off < 512 || off + sectorSize > data.byteLength) return new Uint8Array(0);
    return data.subarray(off, off + sectorSize);
  };

  // DIFAT → FAT 섹터 목록
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatSectorCount; i++) {
    const sid = view.getUint32(76 + i * 4, true);
    if (sid === FREE_SECT || sid === END_OF_CHAIN) break;
    fatSectors.push(sid);
  }

  let difatSect = firstDifatSector;
  const visitedDifat = new Set<number>();
  for (let d = 0; d < difatSectorCount && difatSect !== END_OF_CHAIN && difatSect !== FREE_SECT; d++) {
    if (visitedDifat.has(difatSect)) break;
    visitedDifat.add(difatSect);
    const buf = readSector(difatSect);
    if (buf.byteLength < sectorSize) break;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const perSect = sectorSize / 4 - 1;
    for (let i = 0; i < perSect && fatSectors.length < fatSectorCount; i++) {
      const sid = dv.getUint32(i * 4, true);
      if (sid !== FREE_SECT && sid !== END_OF_CHAIN) fatSectors.push(sid);
    }
    difatSect = dv.getUint32(perSect * 4, true);
  }

  // FAT 테이블
  const perFat = sectorSize / 4;
  const fatTable = new Uint32Array(fatSectors.length * perFat);
  for (let fi = 0; fi < fatSectors.length; fi++) {
    const buf = readSector(fatSectors[fi]!);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < perFat; i++) {
      fatTable[fi * perFat + i] = i * 4 + 4 <= buf.byteLength ? dv.getUint32(i * 4, true) : FREE_SECT;
    }
  }

  const readChain = (startSector: number, maxBytes: number): Uint8Array => {
    if (startSector === END_OF_CHAIN || startSector === FREE_SECT) return new Uint8Array(0);
    if (maxBytes > MAX_STREAM_SIZE) throw new Error('스트림 크기가 상한을 초과했습니다.');
    const chunks: Uint8Array[] = [];
    let cur = startSector;
    let total = 0;
    const visited = new Set<number>();
    while (cur !== END_OF_CHAIN && cur !== FREE_SECT && total < maxBytes) {
      if (visited.has(cur) || visited.size > MAX_CHAIN_LENGTH) break;
      visited.add(cur);
      const buf = readSector(cur);
      if (!buf.byteLength) break;
      const rem = maxBytes - total;
      chunks.push(rem < buf.byteLength ? buf.subarray(0, rem) : buf);
      total += Math.min(buf.byteLength, rem);
      cur = cur < fatTable.length ? fatTable[cur]! : END_OF_CHAIN;
    }
    return concatUint8(chunks);
  };

  // 디렉터리 엔트리
  const dirData = readChain(firstDirSector, MAX_DIR_ENTRIES * 128);
  const dirView = new DataView(dirData.buffer, dirData.byteOffset, dirData.byteLength);
  const entries: CfbDirEntry[] = [];

  for (let off = 0; off + 128 <= dirData.byteLength && entries.length < MAX_DIR_ENTRIES; off += 128) {
    const nameLen = dirView.getUint16(off + 64, true);
    if (nameLen <= 0 || nameLen > 64) {
      entries.push({ name: '', type: 0, startSector: 0, size: 0, left: FREE_SECT, right: FREE_SECT, child: FREE_SECT });
      continue;
    }
    const nameBytes = Math.max(0, nameLen - 2);
    const name = nameBytes > 0 ? utf16leDecoder.decode(dirData.subarray(off, off + nameBytes)).replace(/\0+$/, '') : '';
    entries.push({
      name,
      type: dirData[off + 66]!,
      startSector: dirView.getUint32(off + 116, true),
      size: dirView.getUint32(off + 120, true),
      left: dirView.getUint32(off + 68, true),
      right: dirView.getUint32(off + 72, true),
      child: dirView.getUint32(off + 76, true),
    });
  }

  // Mini-FAT & Mini-Stream (지연 초기화)
  let miniFat: Uint32Array | null = null;
  let miniStream: Uint8Array | null = null;

  const getMiniFat = (): Uint32Array => {
    if (miniFat) return miniFat;
    if (!miniFatSectorCount || firstMiniFatSector === END_OF_CHAIN) {
      miniFat = new Uint32Array(0);
      return miniFat;
    }
    const raw = readChain(firstMiniFatSector, miniFatSectorCount * sectorSize);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const count = Math.floor(raw.byteLength / 4);
    miniFat = new Uint32Array(count);
    for (let i = 0; i < count; i++) miniFat[i] = dv.getUint32(i * 4, true);
    return miniFat;
  };

  const getMiniStream = (): Uint8Array => {
    if (miniStream) return miniStream;
    const root = entries[0];
    if (!root || root.type !== 5) {
      miniStream = new Uint8Array(0);
      return miniStream;
    }
    miniStream = readChain(root.startSector, root.size || MAX_STREAM_SIZE);
    return miniStream;
  };

  const readMini = (startSector: number, size: number): Uint8Array => {
    const mft = getMiniFat();
    const ms = getMiniStream();
    if (!mft.length || !ms.byteLength) return new Uint8Array(0);
    const chunks: Uint8Array[] = [];
    let cur = startSector;
    let total = 0;
    const visited = new Set<number>();
    while (cur !== END_OF_CHAIN && cur !== FREE_SECT && total < size) {
      if (visited.has(cur) || visited.size > MAX_CHAIN_LENGTH) break;
      visited.add(cur);
      const off = cur * miniSectorSize;
      const chunkLen = Math.min(miniSectorSize, size - total);
      if (off + chunkLen <= ms.byteLength) chunks.push(ms.subarray(off, off + chunkLen));
      total += chunkLen;
      cur = cur < mft.length ? mft[cur]! : END_OF_CHAIN;
    }
    return concatUint8(chunks);
  };

  const readStreamData = (entry: CfbDirEntry): Uint8Array => {
    if (entry.size === 0) return new Uint8Array(0);
    if (entry.size < miniStreamCutoff) {
      const mini = readMini(entry.startSector, entry.size);
      if (mini.byteLength > 0) return mini;
    }
    return readChain(entry.startSector, entry.size);
  };

  const findChild = (parent: CfbDirEntry, name: string): CfbDirEntry | null => {
    const stack = [parent.child];
    const visited = new Set<number>();
    while (stack.length) {
      const id = stack.pop()!;
      if (id === END_OF_CHAIN || id === FREE_SECT || id >= entries.length || visited.has(id)) continue;
      visited.add(id);
      const e = entries[id]!;
      if (e.name === name) return e;
      stack.push(e.left, e.right);
    }
    return null;
  };

  const findEntryByPath = (path: string): CfbDirEntry | null => {
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
    const last = parts.pop();
    if (!last) return null;
    const root = entries.find(e => e.type === 5);
    if (root) {
      let cur: CfbDirEntry | null = root;
      for (const part of parts) {
        const next: CfbDirEntry | null = cur ? findChild(cur, part) : null;
        cur = next && next.type === 1 ? next : null;
      }
      const hit = cur ? findChild(cur, last) : null;
      if (hit && (hit.type === 1 || hit.type === 2 || hit.type === 5)) return hit;
    }
    const matches = entries.filter(e => e.name === last && (e.type === 1 || e.type === 2 || e.type === 5));
    return matches.length === 1 ? matches[0]! : null;
  };

  return {
    findStream(path: string): Uint8Array | null {
      const entry = findEntryByPath(path);
      if (!entry || entry.type !== 2) return null;
      const out = readStreamData(entry);
      return out.byteLength > 0 ? out : null;
    },
    listStreams(): CfbDirEntry[] {
      return entries.filter(e => e.type === 2);
    },
  };
}

/** OLE2 컨테이너 내부 스트림으로 HWP 5.x vs XLS(BIFF8)를 판별한다. */
export function detectOle2Format(bytes: Uint8Array): 'hwp' | 'xls' | null {
  try {
    const cfb = parseCfb(bytes);
    const names = new Set(cfb.listStreams().map(e => e.name));
    if (names.has('Workbook') || names.has('Book')) return 'xls';
    if (names.has('FileHeader') || names.has('DocInfo') || [...names].some(n => /^Section\d+$/.test(n))) return 'hwp';
    return null;
  } catch {
    return null;
  }
}
