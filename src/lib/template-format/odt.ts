/**
 * ODT(온나라 2.0 내려받기 형식) → 문단별 서식.
 *
 * 구조: ZIP 안 `content.xml`(본문·자동 스타일) + `styles.xml`(공통 스타일·쪽 설정).
 *   문단 `text:p` → 글자 묶음 `text:span`. 서식은 스타일 이름으로 가리키고, 부모 스타일을 따라 물려받는다.
 *
 * ★ 온나라 문서 틀(결재란·등록번호·발신명의)은 `CellField¡…` 북마크나 보호 칸(`table:protected`)이 붙은 표다. 분석에서 뺀다.
 * ★ 시행문은 본문이 누름틀 `NormalField¡본문¡…` 북마크 안에 있다. 있으면 그 범위만 본다.
 * ★ 표는 `draw:frame` 안에 들어 문단에 매달려 있다. 바깥 문단 글자에 표 글자가 섞이지 않게 따로 읽는다.
 */

import { childElements, parseXml, unzipEntries } from '../extract/files/zip';
import { FileExtractError } from '../extract/files/types';
import { classifyTable, dominantChar, isFrameField, type RawDoc, type RawPara, type RawTable } from './raw';
import type { CharStyle, PageSetup, ParaAlign, ParaStyle } from './types';
import { lengthToPt, odtLineHeightToHwp, percent, ptToMm, round1 } from './units';

type Props = Record<string, string>;
interface StyleDef { parent?: string; text: Props; para: Props }

/** 접두사와 무관하게 속성 값을 읽는다. */
function attr(el: Element, localName: string): string | null {
  for (const a of Array.from(el.attributes)) if (a.localName === localName) return a.value;
  return null;
}

function collectProps(el: Element, into: StyleDef) {
  for (const child of childElements(el)) {
    const target = child.localName === 'text-properties' ? into.text : child.localName === 'paragraph-properties' ? into.para : undefined;
    if (!target) continue;
    // fo:font-weight와 style:font-weight-asian처럼 접두사로 구분되는 속성이 있어 접두사까지 붙여 둔다.
    for (const a of Array.from(child.attributes)) target[`${a.prefix ?? ''}:${a.localName}`] = a.value;
  }
}

class StyleBook {
  private styles = new Map<string, StyleDef>();
  private defaults = new Map<string, StyleDef>();
  readonly fonts = new Map<string, string>();

  add(doc: Document) {
    for (const el of Array.from(doc.getElementsByTagName('*'))) {
      if (el.localName === 'font-face') {
        const name = attr(el, 'name');
        const family = attr(el, 'font-family')?.replace(/^['"]|['"]$/g, '');
        if (name) this.fonts.set(name, family || name);
      } else if (el.localName === 'style' && el.namespaceURI?.includes(':style:')) {
        const def: StyleDef = { parent: attr(el, 'parent-style-name') ?? undefined, text: {}, para: {} };
        collectProps(el, def);
        this.styles.set(`${attr(el, 'family')}:${attr(el, 'name')}`, def);
      } else if (el.localName === 'default-style') {
        const def: StyleDef = { text: {}, para: {} };
        collectProps(el, def);
        this.defaults.set(attr(el, 'family') ?? '', def);
      }
    }
  }

  resolve(family: string, name: string | null | undefined): StyleDef {
    const chain: StyleDef[] = [];
    const seen = new Set<string>();
    let current = name ?? undefined;
    while (current && !seen.has(current)) {
      seen.add(current);
      const def = this.styles.get(`${family}:${current}`);
      if (!def) break;
      chain.unshift(def);
      current = def.parent;
    }
    const base = this.defaults.get(family);
    if (base) chain.unshift(base);
    const out: StyleDef = { text: {}, para: {} };
    for (const def of chain) {
      Object.assign(out.text, def.text);
      Object.assign(out.para, def.para);
    }
    return out;
  }
}

function charFromProps(props: Props, fonts: Map<string, string>): CharStyle {
  const fontName = props['style:font-name-asian'] ?? props['style:font-name'];
  const font = (fontName && fonts.get(fontName)) || fontName || props['style:font-family-asian']?.replace(/['"]/g, '') || props['fo:font-family']?.replace(/['"]/g, '') || '';
  const sizePt = lengthToPt(props['style:font-size-asian'] ?? props['fo:font-size']) ?? 10;
  const weight = props['style:font-weight-asian'] ?? props['fo:font-weight'] ?? 'normal';
  const bold = weight === 'bold' || Number(weight) >= 600;
  const spacing = lengthToPt(props['fo:letter-spacing']) ?? 0;
  return {
    font,
    sizePt: round1(sizePt),
    bold,
    spacingPct: sizePt ? Math.round(spacing / sizePt * 100) : 0,
    ratioPct: Math.round(percent(props['style:text-scale']) ?? 100),
  };
}

function alignOf(value: string | undefined): ParaAlign {
  if (value === 'center') return 'center';
  if (value === 'justify') return 'justify';
  if (value === 'end' || value === 'right') return 'right';
  return 'left';
}

function paraFromProps(props: Props, sizePt: number): ParaStyle {
  const lh = props['fo:line-height'];
  const pct = percent(lh);
  const abs = pct === undefined ? lengthToPt(lh) : undefined;
  const lineSpacingPct = pct !== undefined ? odtLineHeightToHwp(pct) : abs !== undefined && sizePt ? Math.round(abs / sizePt * 100) : 160;
  const ml = lengthToPt(props['fo:margin-left']) ?? 0;
  const ti = lengthToPt(props['fo:text-indent']) ?? 0;
  return {
    lineSpacingPct,
    beforePt: round1(lengthToPt(props['fo:margin-top']) ?? 0),
    afterPt: round1(lengthToPt(props['fo:margin-bottom']) ?? 0),
    // ODT는 "왼쪽 여백 + 음수 첫 줄"로 내어쓰기를 적는다. 한글은 "왼쪽 여백 + 내어쓰기"다.
    leftPt: round1(ml + Math.min(ti, 0)),
    indentPt: round1(ti),
    align: alignOf(props['fo:text-align']),
  };
}

interface Segment { text: string; style: string | null }

const BODY_FIELD = /¡본문¡/;

interface WalkState {
  paras: (RawPara & { inField: boolean })[];
  tables: RawTable[];
  field: 'before' | 'in' | 'after';
  sawField: boolean;
}

export function extractOdt(bytes: Uint8Array): RawDoc {
  const entries = unzipEntries(bytes, name => name === 'content.xml' || name === 'styles.xml');
  if (!entries['content.xml']) throw new FileExtractError('ODT 본문(content.xml)을 찾지 못했습니다. 한글이나 온나라에서 ODT로 다시 저장해 주세요.');
  const content = parseXml(entries['content.xml'], 'content.xml');
  const styles = entries['styles.xml'] ? parseXml(entries['styles.xml'], 'styles.xml') : undefined;
  const book = new StyleBook();
  if (styles) book.add(styles);
  book.add(content);

  const state: WalkState = { paras: [], tables: [], field: 'before', sawField: false };
  const body = Array.from(content.getElementsByTagName('*')).find(el => el.localName === 'text' && el.parentElement?.localName === 'body');
  if (!body) throw new FileExtractError('ODT 본문(office:text)을 찾지 못했습니다.');

  const emitParagraph = (p: Element, table?: { id: number; cell: number }) => {
    const segments: Segment[] = [];
    const nested: Element[] = [];
    let startsField = false;
    let endsField = false;
    const visit = (el: Element, style: string | null) => {
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === 3) { segments.push({ text: node.nodeValue ?? '', style }); continue; }
        if (node.nodeType !== 1) continue;
        const child = node as Element;
        const name = child.localName;
        if (name === 's') segments.push({ text: ' '.repeat(Number(attr(child, 'c') ?? 1) || 1), style });
        else if (name === 'tab') segments.push({ text: '\t', style });
        else if (name === 'line-break') segments.push({ text: ' ', style });
        else if (name === 'span' || name === 'a') visit(child, attr(child, 'style-name') ?? style);
        else if (name === 'bookmark-start' || name === 'bookmark') { if (BODY_FIELD.test(attr(child, 'name') ?? '')) startsField = true; }
        else if (name === 'bookmark-end') { if (BODY_FIELD.test(attr(child, 'name') ?? '')) endsField = true; }
        else if (name === 'frame') nested.push(child);
        else if (name === 'note' || name === 'annotation') continue;
        else visit(child, style);
      }
    };
    const pStyle = attr(p, 'style-name');
    visit(p, null);

    if (startsField) { state.field = 'in'; state.sawField = true; }
    const inField = state.field === 'in';
    const text = segments.map(s => s.text).join('');
    if (text.trim()) {
      const pDef = book.resolve('paragraph', pStyle);
      const char = dominantChar(segments.map(s => ({
        text: s.text,
        char: charFromProps({ ...pDef.text, ...(s.style ? book.resolve('text', s.style).text : {}) }, book.fonts),
      })));
      state.paras.push({ text, char, para: paraFromProps(pDef.para, char.sizePt), table, inField });
    }
    if (endsField) state.field = 'after';
    for (const frame of nested) walk(frame, table);
  };

  const emitTable = (tbl: Element, nested: boolean) => {
    const id = state.tables.length + 1;
    const entry: RawTable = { id, kind: 'data' };
    state.tables.push(entry);
    const cells: Element[] = [];
    let rows = 0;
    let fieldMark = false;
    const scan = (el: Element) => {
      for (const child of childElements(el)) {
        if (child.localName === 'table-row') { rows += 1; scan(child); }
        else if (child.localName === 'table-cell') {
          cells.push(child);
          if (attr(child, 'protected') === 'true') fieldMark = true;
        } else if (child.localName === 'table-rows' || child.localName === 'table-header-rows' || child.localName === 'table-row-group') scan(child);
      }
    };
    scan(tbl);
    if (!fieldMark) {
      fieldMark = Array.from(tbl.getElementsByTagName('*')).some(el => el.localName.startsWith('bookmark') && isFrameField(attr(el, 'name')));
    }
    const cellTexts = cells.map(c => Array.from(c.getElementsByTagName('*')).filter(el => el.localName === 'p' || el.localName === 'h').map(el => el.textContent ?? '').join(' '));
    entry.kind = classifyTable(cellTexts, rows, fieldMark, nested);
    cells.forEach((cell, index) => walk(cell, { id, cell: index + 1 }));
  };

  const walk = (el: Element, table?: { id: number; cell: number }) => {
    for (const child of childElements(el)) {
      const name = child.localName;
      if (name === 'p' || name === 'h') emitParagraph(child, table);
      else if (name === 'table') emitTable(child, Boolean(table));
      else if (name === 'sequence-decls' || name === 'variable-decls' || name === 'tracked-changes') continue;
      else walk(child, table);
    }
  };
  walk(body);

  const notes: string[] = ['ODT 줄간격은 한글 기준으로 환산한 추정값입니다(ODT 123% ≈ 한글 160%).'];
  const paras = state.sawField ? state.paras.filter(p => p.inField) : state.paras;
  return {
    paras: paras.map(({ inField: _inField, ...rest }) => rest),
    tables: state.tables,
    page: styles ? pageSetup(styles) : undefined,
    bodyFieldUsed: state.sawField,
    notes,
  };
}

function pageSetup(styles: Document): PageSetup | undefined {
  const all = Array.from(styles.getElementsByTagName('*'));
  const master = all.find(el => el.localName === 'master-page' && attr(el, 'name') === 'Standard') ?? all.find(el => el.localName === 'master-page');
  const layoutName = master ? attr(master, 'page-layout-name') : null;
  const layout = all.find(el => el.localName === 'page-layout' && (!layoutName || attr(el, 'name') === layoutName));
  const props = layout ? childElements(layout).find(el => el.localName === 'page-layout-properties') : undefined;
  if (!props) return undefined;
  const mm = (name: string) => Math.round(ptToMm(lengthToPt(attr(props, name)) ?? 0) * 10) / 10;
  const widthMm = mm('page-width');
  const heightMm = mm('page-height');
  if (!widthMm || !heightMm) return undefined;
  return { widthMm, heightMm, marginMm: { top: mm('margin-top'), bottom: mm('margin-bottom'), left: mm('margin-left'), right: mm('margin-right') } };
}
