/**
 * HWPX → 문단별 서식.
 *
 * 구조: ZIP 안 `Contents/header.xml`(서식 정의 목록) + `Contents/section*.xml`(본문).
 *   글꼴 `hh:fontface[lang=HANGUL]/hh:font`, 글자 모양 `hh:charPr`(height 1000 = 10pt, spacing·ratio는 %),
 *   문단 모양 `hh:paraPr`(margin은 HWPUNIT: 100 = 1pt, lineSpacing은 % 또는 HWPUNIT).
 *   본문 문단 `hp:p@paraPrIDRef` → 글자 묶음 `hp:run@charPrIDRef` → 글자 `hp:t`.
 *
 * ★ 문단 모양의 여백·줄간격은 `hp:switch/hp:case` 안에 있는 경우가 있다(실물 확인). case → default 순으로 찾는다.
 * ★ 본문 누름틀(`hp:fieldBegin` 이름 '본문')이 있으면 그 범위만 본다.
 */

import { childElements, isTag, parseXml, sortByNumber, unzipEntries } from '../extract/files/zip';
import { FileExtractError } from '../extract/files/types';
import { classifyTable, dominantChar, isFrameField, type RawDoc, type RawPara, type RawTable } from './raw';
import type { CharStyle, PageSetup, ParaAlign, ParaStyle } from './types';
import { hwpunitToPt, ptToMm, round1 } from './units';

function attr(el: Element, localName: string): string | null {
  for (const a of Array.from(el.attributes)) if (a.localName === localName) return a.value;
  return null;
}

function num(el: Element | undefined, localName: string, fallback = 0): number {
  const v = el ? Number(attr(el, localName)) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

function descendants(el: Element | Document, localName: string): Element[] {
  return Array.from(el.getElementsByTagName('*')).filter(e => e.localName === localName);
}

function firstChild(el: Element, localName: string): Element | undefined {
  return childElements(el).find(e => e.localName === localName);
}

interface ParaDef { margin?: Element; lineSpacing?: Element; align: ParaAlign }

function alignOf(value: string | null): ParaAlign {
  switch (value) {
    case 'CENTER': return 'center';
    case 'RIGHT': return 'right';
    case 'JUSTIFY': case 'DISTRIBUTE': case 'DISTRIBUTE_SPACE': return 'justify';
    default: return 'left';
  }
}

class Header {
  private fonts = new Map<string, string>();
  private chars = new Map<string, CharStyle>();
  private paraDefs = new Map<string, ParaDef>();
  private styles = new Map<string, { para: string; char: string }>();

  constructor(doc: Document) {
    for (const face of descendants(doc, 'fontface')) {
      if (attr(face, 'lang') !== 'HANGUL') continue;
      for (const font of childElements(face).filter(e => e.localName === 'font')) this.fonts.set(attr(font, 'id') ?? '', attr(font, 'face') ?? '');
    }
    for (const c of descendants(doc, 'charPr')) {
      const fontRef = firstChild(c, 'fontRef');
      this.chars.set(attr(c, 'id') ?? '', {
        font: this.fonts.get(attr(fontRef ?? c, 'hangul') ?? '') ?? '',
        sizePt: round1(num(c, 'height', 1000) / 100),
        bold: Boolean(firstChild(c, 'bold')),
        spacingPct: num(firstChild(c, 'spacing'), 'hangul'),
        ratioPct: num(firstChild(c, 'ratio'), 'hangul', 100),
      });
    }
    for (const p of descendants(doc, 'paraPr')) {
      // hp:switch 안이면 case(새 규격)를 먼저, 없으면 default, 그것도 없으면 바로 아래 요소를 쓴다.
      const sw = firstChild(p, 'switch');
      const scopes = [sw && firstChild(sw, 'case'), sw && firstChild(sw, 'default'), p].filter((e): e is Element => Boolean(e));
      const pick = (name: string) => scopes.map(s => firstChild(s, name)).find(Boolean);
      this.paraDefs.set(attr(p, 'id') ?? '', { margin: pick('margin'), lineSpacing: pick('lineSpacing'), align: alignOf(attr(firstChild(p, 'align') ?? p, 'horizontal')) });
    }
    for (const s of descendants(doc, 'style')) {
      this.styles.set(attr(s, 'id') ?? '', { para: attr(s, 'paraPrIDRef') ?? '0', char: attr(s, 'charPrIDRef') ?? '0' });
    }
  }

  char(id: string | null, styleId: string | null): CharStyle {
    return this.chars.get(id ?? '') ?? this.chars.get(this.styles.get(styleId ?? '0')?.char ?? '0') ?? { font: '', sizePt: 10, bold: false, spacingPct: 0, ratioPct: 100 };
  }

  para(id: string | null, styleId: string | null, sizePt: number): ParaStyle {
    const def = this.paraDefs.get(id ?? '') ?? this.paraDefs.get(this.styles.get(styleId ?? '0')?.para ?? '0');
    const marginValue = (name: string) => {
      const el = def?.margin && firstChild(def.margin, name);
      if (!el) return 0;
      const v = num(el, 'value');
      // 글자 단위(CHAR)로 적힌 값은 글자 크기를 곱해 pt로 바꾼다.
      return attr(el, 'unit') === 'CHAR' ? v * sizePt : hwpunitToPt(v);
    };
    const ls = def?.lineSpacing;
    const lsType = ls ? attr(ls, 'type') : 'PERCENT';
    const lsValue = num(ls, 'value', 160);
    // 같은 설정인데도 199·200·201%처럼 1%씩 흔들려 적힌다(실물 확인). 한글 사용자가 고르는 5% 단위로 맞춘다.
    const rawPct = lsType === 'PERCENT' ? lsValue : sizePt ? hwpunitToPt(lsValue) / sizePt * 100 : 160;
    const lineSpacingPct = Math.round(rawPct / 5) * 5;
    return {
      lineSpacingPct,
      beforePt: round1(marginValue('prev')),
      afterPt: round1(marginValue('next')),
      leftPt: round1(marginValue('left')),
      indentPt: round1(marginValue('intent')),
      align: def?.align ?? 'left',
    };
  }
}

interface Segment { text: string; charId: string | null }

interface WalkState {
  paras: (RawPara & { inField: boolean })[];
  tables: RawTable[];
  field: 'before' | 'in' | 'after';
  bodyFieldId: string | null;
  page?: PageSetup;
}

export function extractHwpxFormat(bytes: Uint8Array): RawDoc {
  const entries = unzipEntries(bytes, name => name === 'Contents/header.xml' || /^Contents\/section\d+\.xml$/i.test(name));
  if (!entries['Contents/header.xml']) throw new FileExtractError('HWPX 서식 정의(Contents/header.xml)를 찾지 못했습니다. 한글에서 HWPX로 다시 저장해 주세요.');
  const sections = sortByNumber(Object.keys(entries).filter(name => /section\d+\.xml$/i.test(name)));
  if (!sections.length) throw new FileExtractError('HWPX 본문(Contents/section*.xml)을 찾지 못했습니다.');
  const header = new Header(parseXml(entries['Contents/header.xml'], 'header.xml'));
  const state: WalkState = { paras: [], tables: [], field: 'before', bodyFieldId: null };

  const emitParagraph = (p: Element, table?: { id: number; cell: number }) => {
    const segments: Segment[] = [];
    const nested: Element[] = [];
    let startsField = false;
    let endsField = false;
    const styleId = attr(p, 'styleIDRef');
    for (const run of childElements(p).filter(e => e.localName === 'run')) {
      const charId = attr(run, 'charPrIDRef');
      for (const child of childElements(run)) {
        const name = child.localName;
        if (name === 't') {
          for (const node of Array.from(child.childNodes)) {
            if (node.nodeType === 3) segments.push({ text: node.nodeValue ?? '', charId });
            else if (node.nodeType === 1) {
              const inner = (node as Element).localName;
              segments.push({ text: inner === 'tab' ? '\t' : inner === 'fwSpace' ? '　' : ' ', charId });
            }
          }
        } else if (name === 'tbl') nested.push(child);
        else if (name === 'ctrl') {
          for (const ctrl of childElements(child)) {
            if (ctrl.localName === 'fieldBegin' && /본문/.test(attr(ctrl, 'name') ?? '')) {
              startsField = true;
              state.bodyFieldId = attr(ctrl, 'id') ?? attr(ctrl, 'fieldid');
            } else if (ctrl.localName === 'fieldEnd' && state.bodyFieldId !== null) {
              const ref = attr(ctrl, 'beginIDRef') ?? attr(ctrl, 'fieldid');
              if (!ref || ref === state.bodyFieldId) endsField = true;
            }
          }
        } else if (name === 'secPr' && !state.page) state.page = pageSetup(child);
      }
    }
    if (startsField) state.field = 'in';
    const inField = state.field === 'in';
    const text = segments.map(s => s.text).join('');
    if (text.trim()) {
      const char = dominantChar(segments.map(s => ({ text: s.text, char: header.char(s.charId, styleId) })));
      state.paras.push({ text, char, para: header.para(attr(p, 'paraPrIDRef'), styleId, char.sizePt), table, inField });
    }
    if (endsField) state.field = 'after';
    for (const tbl of nested) emitTable(tbl, Boolean(table));
  };

  const emitTable = (tbl: Element, nestedTable: boolean) => {
    const id = state.tables.length + 1;
    const entry: RawTable = { id, kind: 'data' };
    state.tables.push(entry);
    const rows = childElements(tbl).filter(e => isTag(e, 'tr'));
    const cells = rows.flatMap(tr => childElements(tr).filter(e => isTag(e, 'tc')));
    const cellParas = cells.map(tc => {
      const sub = firstChild(tc, 'subList');
      return sub ? childElements(sub).filter(e => isTag(e, 'p')) : [];
    });
    const cellTexts = cellParas.map(ps => ps.map(p => descendants(p, 't').map(t => t.textContent ?? '').join('')).join(' '));
    const fieldMark = descendants(tbl, 'fieldBegin').some(f => isFrameField(attr(f, 'name')));
    entry.kind = classifyTable(cellTexts, rows.length, fieldMark, nestedTable);
    cellParas.forEach((ps, index) => ps.forEach(p => emitParagraph(p, { id, cell: index + 1 })));
  };

  for (const name of sections) {
    const doc = parseXml(entries[name]!, name);
    for (const p of childElements(doc.documentElement).filter(e => isTag(e, 'p'))) emitParagraph(p);
  }

  const sawField = state.field !== 'before';
  const paras = sawField ? state.paras.filter(p => p.inField) : state.paras;
  return {
    paras: paras.map(({ inField: _inField, ...rest }) => rest),
    tables: state.tables,
    page: state.page,
    bodyFieldUsed: sawField,
    notes: [],
  };
}

function pageSetup(secPr: Element): PageSetup | undefined {
  const pagePr = firstChild(secPr, 'pagePr');
  if (!pagePr) return undefined;
  const mm = (v: number) => Math.round(ptToMm(hwpunitToPt(v)) * 10) / 10;
  const margin = firstChild(pagePr, 'margin');
  let widthMm = mm(num(pagePr, 'width'));
  let heightMm = mm(num(pagePr, 'height'));
  // landscape="NARROWLY"는 가로 방향이다(WIDELY가 세로). 폭·높이를 바꿔 적는다.
  if (attr(pagePr, 'landscape') === 'NARROWLY' && widthMm < heightMm) [widthMm, heightMm] = [heightMm, widthMm];
  if (!widthMm || !heightMm) return undefined;
  return {
    widthMm,
    heightMm,
    marginMm: { top: mm(num(margin, 'top')), bottom: mm(num(margin, 'bottom')), left: mm(num(margin, 'left')), right: mm(num(margin, 'right')) },
  };
}
