/**
 * PPTX(파워포인트) 순수 브라우저 TypeScript 파서.
 *
 * kordoc(MIT) src/pptx/parser.ts 벤치마킹:
 *  - ppt/presentation.xml의 p:sldIdLst 발표 순서대로 슬라이드 추출(숨김 슬라이드 show="0" 제외)
 *  - 개체 틀(title/ctrTitle/subTitle → heading, body/obj → list/para, sldNum/dt/ftr/hdr/sldImg 제외)
 *  - 표(a:tbl) 병합(gridSpan/rowSpan/hMerge/vMerge) 2-pass 그리드 복원
 *  - 발표자 노트(notesSlide)를 `(발표자 노트)`로 추출
 */

import { attr, childElements, descendants, firstChild, isTag, parseXml, sortByNumber, unzipEntries } from './zip';
import { classifyLine, normalizeLine, tableRowText } from './blocks';
import { buildTableGrid, type GridCellInput } from './table-grid';
import { FileExtractError, type Block } from './types';

export const PPTX_MAX_SLIDES = 200;

const SKIP_PLACEHOLDERS = new Set(['sldNum', 'dt', 'ftr', 'hdr', 'sldImg']);
const TITLE_PLACEHOLDERS = new Set(['title', 'ctrTitle', 'subTitle']);
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseDir ? baseDir.split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function getRelId(el: Element): string | null {
  for (const a of Array.from(el.attributes)) {
    if (a.localName === 'id' && (a.namespaceURI === NS_REL || a.name === 'r:id')) return a.value;
  }
  return null;
}

function parseRelsMap(xml: string | undefined, baseDir: string): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>();
  if (!xml) return map;
  try {
    const doc = parseXml(xml, 'rels');
    for (const rel of descendants(doc, 'Relationship')) {
      const id = attr(rel, 'Id');
      const target = attr(rel, 'Target');
      if (!id || !target || attr(rel, 'TargetMode') === 'External') continue;
      map.set(id, { type: attr(rel, 'Type') ?? '', target: resolvePart(baseDir, target) });
    }
  } catch {
    // rels 파싱 실패 시 무시
  }
  return map;
}

function paragraphText(p: Element): string {
  let out = '';
  for (const child of childElements(p)) {
    const name = child.localName;
    if (name === 'r' || name === 'fld') {
      const t = firstChild(child, 't');
      if (t) out += t.textContent ?? '';
    } else if (name === 'br') {
      out += ' ';
    }
  }
  return normalizeLine(out);
}

function extractPptxTable(tbl: Element): string[][] {
  const trs = childElements(tbl).filter(el => isTag(el, 'tr'));
  const rows: GridCellInput[][] = [];
  for (const tr of trs) {
    const row: GridCellInput[] = [];
    for (const tc of childElements(tr).filter(el => isTag(el, 'tc'))) {
      const hMerge = /^(?:1|true)$/i.test(attr(tc, 'hMerge') ?? '');
      const vMerge = /^(?:1|true)$/i.test(attr(tc, 'vMerge') ?? '');
      if (hMerge || vMerge) continue;
      const colSpan = Math.max(1, Number(attr(tc, 'gridSpan') ?? 1) || 1);
      const rowSpan = Math.max(1, Number(attr(tc, 'rowSpan') ?? 1) || 1);
      const txBody = firstChild(tc, 'txBody');
      const lines = txBody
        ? childElements(txBody).filter(el => isTag(el, 'p')).map(paragraphText).filter(Boolean)
        : [];
      row.push({ text: lines.join(' '), colSpan, rowSpan });
    }
    rows.push(row);
  }
  return buildTableGrid(rows);
}

function placeholderType(sp: Element): string | null {
  const nvSpPr = firstChild(sp, 'nvSpPr');
  const nvPr = nvSpPr ? firstChild(nvSpPr, 'nvPr') : undefined;
  const ph = nvPr ? firstChild(nvPr, 'ph') : undefined;
  if (!ph) return null;
  return attr(ph, 'type') ?? 'obj';
}

export function extractPptx(bytes: Uint8Array): { blocks: Block[]; pages: number; warnings: string[] } {
  const entries = unzipEntries(bytes, name =>
    name === 'ppt/presentation.xml' ||
    name === 'ppt/_rels/presentation.xml.rels' ||
    /^ppt\/slides\/slide\d+\.xml$/i.test(name) ||
    /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/i.test(name) ||
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name),
  );

  // 슬라이드 순서 결정
  const orderedSlides: string[] = [];
  if (entries['ppt/presentation.xml']) {
    const presDoc = parseXml(entries['ppt/presentation.xml'], 'ppt/presentation.xml');
    const rels = parseRelsMap(entries['ppt/_rels/presentation.xml.rels'], 'ppt');
    const sldIdLst = descendants(presDoc, 'sldIdLst')[0];
    if (sldIdLst) {
      for (const sldId of childElements(sldIdLst).filter(e => isTag(e, 'sldId'))) {
        const target = rels.get(getRelId(sldId) ?? '')?.target;
        if (target && entries[target]) orderedSlides.push(target);
      }
    }
  }
  if (!orderedSlides.length) {
    orderedSlides.push(...sortByNumber(Object.keys(entries).filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))));
  }
  if (!orderedSlides.length) {
    throw new FileExtractError('PPTX 슬라이드(ppt/slides/slide*.xml)를 찾지 못했습니다.');
  }

  const warnings: string[] = [];
  if (orderedSlides.length > PPTX_MAX_SLIDES) {
    warnings.push(`슬라이드가 ${orderedSlides.length}장이라 앞 ${PPTX_MAX_SLIDES}장만 읽었습니다.`);
  }

  const blocks: Block[] = [];
  let tableCounter = 0;
  let visiblePages = 0;

  for (const slidePath of orderedSlides.slice(0, PPTX_MAX_SLIDES)) {
    const xml = entries[slidePath];
    if (!xml) continue;
    const doc = parseXml(xml, slidePath);
    // 숨김 슬라이드 제외
    if (attr(doc.documentElement, 'show') === '0') continue;

    visiblePages += 1;
    const page = visiblePages;
    const spTree = descendants(doc, 'spTree')[0];
    if (spTree) {
      const visitShapeContainer = (container: Element) => {
        for (const el of childElements(container)) {
          const name = el.localName;
          if (name === 'sp') {
            const ph = placeholderType(el);
            if (ph && SKIP_PLACEHOLDERS.has(ph)) continue;
            const isTitle = ph !== null && TITLE_PLACEHOLDERS.has(ph);
            const txBody = firstChild(el, 'txBody');
            if (!txBody) continue;
            for (const p of childElements(txBody).filter(c => isTag(c, 'p'))) {
              const text = paragraphText(p);
              if (!text) continue;
              if (isTitle) {
                blocks.push({ kind: 'heading', text, page });
              } else {
                const pPr = firstChild(p, 'pPr');
                const isList = Boolean(pPr && (firstChild(pPr, 'buChar') || firstChild(pPr, 'buAutoNum') || firstChild(pPr, 'buBlip')));
                const classified = classifyLine(text);
                blocks.push({
                  kind: isList && classified.kind === 'para' ? 'list' : classified.kind,
                  ...(classified.level ? { level: classified.level } : {}),
                  text,
                  page,
                });
              }
            }
          } else if (name === 'graphicFrame') {
            for (const tbl of descendants(el, 'tbl')) {
              const grid = extractPptxTable(tbl);
              const nonEmpty = grid.filter(r => r.some(Boolean));
              if (!nonEmpty.length) continue;
              tableCounter += 1;
              nonEmpty.forEach((cells, idx) => {
                blocks.push({ kind: 'table-row', text: tableRowText(cells), table: tableCounter, row: idx + 1, page });
              });
            }
          } else if (name === 'grpSp') {
            visitShapeContainer(el);
          }
        }
      };
      visitShapeContainer(spTree);
    }

    // 발표자 노트
    const fileName = slidePath.split('/').pop()!;
    const relsPath = `ppt/slides/_rels/${fileName}.rels`;
    const slideRels = parseRelsMap(entries[relsPath], 'ppt/slides');
    for (const rel of slideRels.values()) {
      if (!rel.type.endsWith('/notesSlide')) continue;
      const noteXml = entries[rel.target];
      if (!noteXml) continue;
      const noteDoc = parseXml(noteXml, rel.target);
      const noteTexts: string[] = [];
      for (const sp of descendants(noteDoc, 'sp')) {
        const ph = placeholderType(sp);
        if (ph && SKIP_PLACEHOLDERS.has(ph)) continue;
        const txBody = firstChild(sp, 'txBody');
        if (!txBody) continue;
        for (const p of childElements(txBody).filter(c => isTag(c, 'p'))) {
          const t = paragraphText(p);
          if (t) noteTexts.push(t);
        }
      }
      if (noteTexts.length) {
        blocks.push({ kind: 'para', text: `(발표자 노트) ${noteTexts.join(' ')}`, page });
      }
    }
  }

  return { blocks, pages: visiblePages, warnings };
}
