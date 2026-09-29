/**
 * 서식 파일(.hwpx·.odt) → 서식관리에 등록할 본문 서식.
 *
 * 흐름: 형식 확인 → 형식별 해석(문단마다 글자·서식) → 문서 틀 제외 → 기호로 단계 판별 → 단계마다 가장 많이 쓰인 값.
 *
 * ★ AI를 쓰지 않는다. 파일에 적힌 값을 그대로 읽는 규칙 기반 처리라 결과가 늘 같다.
 * ★ 한 단계 안에서도 줄간격·칸 수가 문단마다 조금씩 다르다(실물 확인). 평균이 아니라 가장 많이 쓰인 값을 고르고,
 *   흩어진 값은 알림(notes)으로 남겨 사용자가 확인 화면에서 고치게 한다.
 */

import { FileExtractError } from '../extract/files/types';
import { isZipBytes } from '../extract/files/zip';
import { sha256Hex } from '../extract/files';
import { extractHwpxFormat } from './hwpx';
import { classifyMarker, countLeadSpaces, rankOf } from './markers';
import { extractOdt } from './odt';
import type { RawDoc, RawPara } from './raw';
import type { BoxStyle, CharStyle, FormatSourceKind, LevelStyle, ParaStyle, TemplateFormat } from './types';

export * from './types';
export { classifyMarker, countLeadSpaces } from './markers';

export const TEMPLATE_ACCEPT = '.hwpx,.odt';
export const TEMPLATE_FORMATS_LABEL = 'HWPX · ODT';
/** 그림이 많이 든 보고서도 받을 수 있게 넉넉히 둔다. 본문 XML만 풀어 읽는다. */
export const TEMPLATE_MAX_BYTES = 30 * 1024 * 1024;
const SAMPLE_CHARS = 30;
const MAX_HEADINGS = 10;

function extensionOf(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

/** 형식을 정한다. 읽을 수 없으면 사용자에게 보여 줄 문장과 함께 던진다. */
export function detectTemplateKind(name: string, bytes: Uint8Array): FormatSourceKind {
  const ext = extensionOf(name);
  const isOle = bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (ext === 'hwp' || isOle) throw new FileExtractError("구형 한글(.hwp) 파일은 서식을 읽을 수 없습니다. 한글에서 [다른 이름으로 저장]으로 'HWPX' 형식을 골라 저장한 뒤 올려 주세요.");
  if (!isZipBytes(bytes)) throw new FileExtractError(`서식 파일은 ${TEMPLATE_FORMATS_LABEL} 형식만 올릴 수 있습니다.`);
  if (ext === 'hwpx') return 'hwpx';
  if (ext === 'odt' || ext === 'ott') return 'odt';
  throw new FileExtractError(`'.${ext || '?'}' 형식은 지원하지 않습니다. ${TEMPLATE_FORMATS_LABEL} 파일을 올려 주세요.`);
}

/** 가장 많이 나온 값. 같으면 먼저 나온 값. */
function mode<T>(values: T[]): T {
  const counts = new Map<string, { value: T; n: number; first: number }>();
  values.forEach((value, index) => {
    const key = JSON.stringify(value);
    const hit = counts.get(key);
    if (hit) hit.n += 1;
    else counts.set(key, { value, n: 1, first: index });
  });
  return [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first)[0]!.value;
}

function modeChar(items: CharStyle[]): CharStyle {
  return {
    font: mode(items.map(c => c.font)),
    sizePt: mode(items.map(c => c.sizePt)),
    bold: mode(items.map(c => c.bold)),
    spacingPct: mode(items.map(c => c.spacingPct)),
    ratioPct: mode(items.map(c => c.ratioPct)),
  };
}

function modePara(items: ParaStyle[]): ParaStyle {
  return {
    lineSpacingPct: mode(items.map(p => p.lineSpacingPct)),
    beforePt: mode(items.map(p => p.beforePt)),
    afterPt: mode(items.map(p => p.afterPt)),
    leftPt: mode(items.map(p => p.leftPt)),
    indentPt: mode(items.map(p => p.indentPt)),
    align: mode(items.map(p => p.align)),
  };
}

function clip(text: string, n = SAMPLE_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

interface Classified { para: RawPara; key: string; label: string; glyph: string; rest: string; order: number }

function levelOf(group: Classified[]): LevelStyle {
  const first = group[0]!;
  return {
    key: first.key,
    label: first.label,
    glyph: mode(group.map(g => g.glyph)),
    glyphs: [...new Set(group.map(g => g.glyph).filter(Boolean))].slice(0, 10),
    sample: clip(first.para.text),
    leadSpaces: mode(group.map(g => countLeadSpaces(g.para.text))),
    char: modeChar(group.map(g => g.para.char)),
    para: modePara(group.map(g => g.para.para)),
    count: group.length,
  };
}

function spreadNote(label: string, values: number[]): string | undefined {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  if (distinct.length < 2) return undefined;
  return `'${label}'의 줄간격이 문단마다 달라(${distinct[0]}~${distinct.at(-1)}%) 가장 많이 쓰인 값을 골랐습니다.`;
}

const OFFICIAL_KEYS = new Set(['num', 'ga', 'num-paren', 'ga-paren', 'paren-num', 'paren-ga']);
const TITLE_LABEL = /^\s*제\s*목\s*[:：]?\s*$/;

/** 해석 결과 → 등록할 서식. 형식과 무관한 공통 단계. */
export function buildTemplateFormat(raw: RawDoc, source: TemplateFormat['source']): TemplateFormat {
  const notes = [...raw.notes];
  if (raw.bodyFieldUsed) notes.push("온나라 '본문' 누름틀 안의 내용만 분석했습니다.");
  const position = new Map(raw.paras.map((p, index) => [p, index]));

  // 1. 본문 문단(표 밖)을 단계별로 묶는다.
  const bodyParas = raw.paras.filter(p => !p.table);
  const classified: Classified[] = bodyParas.map((para, order) => {
    const marker = classifyMarker(para.text);
    return marker
      ? { para, key: marker.key, label: marker.label, glyph: marker.glyph, rest: marker.rest, order }
      : { para, key: 'body', label: '일반 문단', glyph: '', rest: para.text.trim(), order };
  });

  // 기호 없는 첫 문단이 가운데 정렬이거나 가장 큰 글자면 제목으로 본다(보고서 첫 줄 제목).
  const firstMarked = classified.findIndex(c => c.key !== 'body');
  const maxSize = Math.max(0, ...bodyParas.map(p => p.char.sizePt));
  if (!classified.some(c => c.key === 'title')) {
    const candidate = classified.slice(0, firstMarked < 0 ? classified.length : firstMarked).find(c => c.para.para.align === 'center' || c.para.char.sizePt >= maxSize);
    if (candidate) Object.assign(candidate, { key: 'title', label: '제목', glyph: '' });
  }
  // 요약 상자는 본문 첫 항목보다 앞에 있는 표만 인정한다(문서 끝 체크리스트 표를 요약으로 오인하지 않게).
  const firstItem = classified.find(c => c.key !== 'body' && c.key !== 'title');
  const firstItemAt = firstItem ? position.get(firstItem.para)! : Infinity;

  const groups = new Map<string, Classified[]>();
  for (const c of classified) {
    const list = groups.get(c.key) ?? [];
    list.push(c);
    groups.set(c.key, list);
  }
  // 기호 없는 일반 문단은 이어지는 줄(두 번째 줄 이후)이 대부분이라 두 번 이상 나올 때만 단계로 남긴다.
  if ((groups.get('body')?.length ?? 0) < 2) groups.delete('body');

  const levels = [...groups.values()]
    .map(levelOf)
    .sort((a, b) => (rankOf(a.key) - rankOf(b.key)) || (groups.get(a.key)![0]!.order - groups.get(b.key)![0]!.order));
  for (const level of levels) {
    const group = groups.get(level.key)!;
    const spread = group.length >= 3 ? spreadNote(level.label, group.map(g => g.para.para.lineSpacingPct)) : undefined;
    if (spread) notes.push(spread);
  }

  // 2. 상자 요소(표): 제목 상자, 요약 상자, Ⅰ 대제목 막대.
  const boxes: BoxStyle[] = [];
  const parasOf = (id: number) => raw.paras.filter(p => p.table?.id === id);
  const largest = (ps: RawPara[]) => [...ps].sort((a, b) => b.char.sizePt - a.char.sizePt)[0]!;
  const summaryParas: RawPara[] = [];

  const titleTable = raw.tables.find(t => t.kind === 'title');
  let titleUsedTable: number | undefined;
  if (titleTable) {
    // 업무보고 제목 표: '제목:' 칸 → 제목 칸 → (아래 행) 요약 문단.
    const ps = parasOf(titleTable.id);
    const label = ps.find(p => TITLE_LABEL.test(p.text));
    const labelCell = label?.table?.cell ?? 0;
    const titleParas = ps.filter(p => p.table!.cell === labelCell + 1);
    if (titleParas.length) {
      const main = largest(titleParas);
      boxes.push({ role: 'title', sample: clip(titleParas.map(p => p.text).join(' ')), char: main.char, para: main.para, ...(label ? { leadChar: label.char } : {}) });
    }
    summaryParas.push(...ps.filter(p => p.table!.cell > labelCell + 1));
    titleUsedTable = titleTable.id;
  } else {
    // 첫 한 칸 표가 글자 하나짜리이고 문서에서 가장 큰 글자를 쓰면 제목 상자다.
    const allMax = Math.max(0, ...raw.paras.map(p => p.char.sizePt));
    const first = raw.tables.find(t => t.kind === 'summary');
    const ps = first ? parasOf(first.id) : [];
    if (first && ps.length === 1 && ps[0]!.char.sizePt >= Math.max(18, allMax)) {
      boxes.push({ role: 'title', sample: clip(ps[0]!.text), char: ps[0]!.char, para: ps[0]!.para });
      titleUsedTable = first.id;
    }
  }
  for (const t of raw.tables) {
    if (t.kind !== 'summary' || t.id === titleUsedTable) continue;
    const ps = parasOf(t.id);
    if (ps.length && position.get(ps[0]!)! < firstItemAt) summaryParas.push(...ps);
  }
  const summaryMain = summaryParas.filter(p => classifyMarker(p.text)?.key !== 'note');
  if (summaryMain.length) {
    boxes.push({ role: 'summary', sample: clip(summaryMain[0]!.text), char: modeChar(summaryMain.map(p => p.char)), para: modePara(summaryMain.map(p => p.para)) });
  }

  const chapterCells = raw.tables.filter(t => t.kind === 'chapter').map(t => ({
    number: parasOf(t.id).find(p => p.table!.cell === 1),
    title: parasOf(t.id).find(p => p.table!.cell > 1 && p.text.trim()),
  })).filter((c): c is { number: RawPara; title: RawPara } => Boolean(c.number && c.title));
  if (chapterCells.length) {
    boxes.push({
      role: 'chapter',
      sample: clip(`${chapterCells[0]!.number.text.trim()} ${chapterCells[0]!.title.text.trim()}`),
      char: modeChar(chapterCells.map(c => c.title.char)),
      para: modePara(chapterCells.map(c => c.title.para)),
      leadChar: modeChar(chapterCells.map(c => c.number.char)),
    });
  }

  // 3. 시행문(1. → 가.)인지 보고서(□ → ○)인지: 가장 윗단계 기호로 정한다.
  const top = levels.find(l => l.key !== 'title' && l.key !== 'body');
  const docKind = top && OFFICIAL_KEYS.has(top.key) && !chapterCells.length ? 'official' : 'report';

  // 4. 대제목 글자 → '필수 주요 항목' 초안. 시행문의 1. 2. 3.은 문장이라 항목 이름으로 쓰지 않는다.
  const headingSource = docKind === 'official'
    ? []
    : chapterCells.length
      ? chapterCells.map(c => c.title.text)
      : (groups.get('section') ?? groups.get('sym-pua') ?? []).map(c => c.rest);
  const headings = [...new Set(headingSource.map(h => clip(h, 40)).filter(Boolean))].slice(0, MAX_HEADINGS);

  const approval = raw.tables.filter(t => t.kind === 'approval').length;
  const data = raw.tables.filter(t => t.kind === 'data').length;
  if (approval || data) notes.push(`결재란 등 문서 틀 표 ${approval}개와 자료 표 ${data}개는 분석에서 뺐습니다.`);

  return { version: 1, source, docKind, page: raw.page, levels, boxes, headings, notes };
}

/** 올린 파일 바이트 → 서식. */
export async function analyzeTemplateBytes(fileName: string, bytes: Uint8Array, now = Date.now()): Promise<TemplateFormat> {
  if (!bytes.length) throw new FileExtractError('빈 파일입니다.');
  if (bytes.length > TEMPLATE_MAX_BYTES) throw new FileExtractError(`파일이 ${Math.round(TEMPLATE_MAX_BYTES / 1024 / 1024)}MB를 넘어 올릴 수 없습니다.`);
  const kind = detectTemplateKind(fileName, bytes);
  const raw = kind === 'hwpx' ? extractHwpxFormat(bytes) : extractOdt(bytes);
  const format = buildTemplateFormat(raw, { fileName, kind, sha256: await sha256Hex(bytes), importedAt: now });
  if (!format.levels.length && !format.boxes.length) throw new FileExtractError('본문에서 서식을 찾지 못했습니다. 본문 글자가 들어 있는 문서인지 확인해 주세요.');
  return format;
}

export async function analyzeTemplateFile(file: File): Promise<TemplateFormat> {
  if (file.size > TEMPLATE_MAX_BYTES) throw new FileExtractError(`파일이 ${Math.round(TEMPLATE_MAX_BYTES / 1024 / 1024)}MB를 넘어 올릴 수 없습니다.`);
  return analyzeTemplateBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}
