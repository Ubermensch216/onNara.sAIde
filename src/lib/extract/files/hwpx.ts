/**
 * HWPX(한글 2014 이후 기본 저장 형식 중 하나) 본문 추출.
 *
 * 구조: ZIP 안 `Contents/section0.xml …` → `hp:p`(문단) → `hp:run` → `hp:t`(글자).
 * 표는 `hp:run` 안의 `hp:tbl` → `hp:tr` → `hp:tc` → `hp:subList` → `hp:p`.
 *
 * ★ 머리말·꼬리말(`hp:header`/`hp:footer`)은 쪽마다 반복되는 기관명·쪽번호라 뺀다.
 *   각주·미주는 근거 법령이 적히는 자리라 남긴다.
 */

import { childElements, isTag, parseXml, sortByNumber, unzipEntries } from './zip';
import { classifyLine, normalizeLine, tableRowText } from './blocks';
import { FileExtractError, type Block } from './types';

const SKIP = new Set(['header', 'footer', 'secPr', 'colPr', 'pageNum', 'pageHiding', 'fieldBegin', 'fieldEnd']);

/** `hp:t` 안의 글자. 탭·줄바꿈 요소는 빈칸으로 바꾼다. */
function runText(t: Element): string {
  let out = '';
  for (const node of Array.from(t.childNodes)) {
    if (node.nodeType === 3) out += node.nodeValue ?? '';
    else if (node.nodeType === 1) out += ' ';
  }
  return out;
}

/** 표 칸·글상자 안의 문단 글자를 모두 모은다(중첩 표 포함). */
function flatText(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Element) => {
    for (const child of childElements(node)) {
      if (SKIP.has(child.localName)) continue;
      if (child.localName === 't') parts.push(runText(child));
      else {
        if (child.localName === 'p' && parts.length) parts.push(' ');
        walk(child);
      }
    }
  };
  walk(el);
  return normalizeLine(parts.join(''));
}

interface State { blocks: Block[]; table: number }

function emitTable(tbl: Element, state: State) {
  state.table += 1;
  const table = state.table;
  let row = 0;
  for (const tr of childElements(tbl).filter(el => isTag(el, 'tr'))) {
    const cells = childElements(tr).filter(el => isTag(el, 'tc')).map(flatText);
    if (!cells.some(Boolean)) continue;
    row += 1;
    state.blocks.push({ kind: 'table-row', text: tableRowText(cells), table, row });
  }
}

function emitParagraph(p: Element, state: State) {
  let text = '';
  const flush = () => {
    const line = normalizeLine(text);
    text = '';
    if (line) state.blocks.push({ ...classifyLine(line), text: line });
  };
  const visit = (el: Element) => {
    for (const child of childElements(el)) {
      const name = child.localName;
      if (SKIP.has(name)) continue;
      if (name === 't') text += runText(child);
      else if (name === 'tbl') {
        flush();
        emitTable(child, state);
      } else if (name === 'footNote' || name === 'endNote') {
        const note = flatText(child);
        if (note) {
          flush();
          state.blocks.push({ kind: 'para', text: `(주석) ${note}` });
        }
      } else if (name === 'subList') {
        // 글상자 등 문단 안의 다른 본문
        flush();
        for (const inner of childElements(child).filter(item => isTag(item, 'p'))) emitParagraph(inner, state);
      } else visit(child);
    }
  };
  visit(p);
  flush();
}

export function extractHwpx(bytes: Uint8Array): Block[] {
  const entries = unzipEntries(bytes, name => /^Contents\/section\d+\.xml$/i.test(name));
  const sections = sortByNumber(Object.keys(entries));
  if (!sections.length) throw new FileExtractError('HWPX 본문(Contents/section*.xml)을 찾지 못했습니다. 한글에서 HWPX 형식으로 다시 저장해 주세요.');
  const state: State = { blocks: [], table: 0 };
  for (const name of sections) {
    const doc = parseXml(entries[name]!, name);
    for (const p of childElements(doc.documentElement).filter(el => isTag(el, 'p'))) emitParagraph(p, state);
  }
  return state.blocks;
}
