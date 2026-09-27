/**
 * DOCX(워드) 본문 추출.
 *
 * 구조: ZIP 안 `word/document.xml` → `w:body` → `w:p`(문단) / `w:tbl`(표).
 * 제목 스타일(Heading1, 제목 1 등)이나 개요 수준이 있는 문단은 제목으로 표시한다.
 */

import { childElements, isTag, parseXml, unzipEntries } from './zip';
import { classifyLine, normalizeLine, tableRowText } from './blocks';
import { FileExtractError, type Block } from './types';

/** 문단 안 글자. 삭제 표시(`w:delText`)는 `t`가 아니므로 자연히 빠진다. */
function paragraphText(p: Element): string {
  let out = '';
  const walk = (el: Element) => {
    for (const child of childElements(el)) {
      const name = child.localName;
      if (name === 't') out += child.textContent ?? '';
      else if (name === 'tab' || name === 'br' || name === 'cr') out += ' ';
      else if (name === 'pPr' || name === 'rPr' || name === 'del' || name === 'txbxContent') continue;
      else walk(child);
    }
  };
  walk(p);
  return normalizeLine(out);
}

function isHeading(p: Element): boolean {
  const pPr = childElements(p).find(el => isTag(el, 'pPr'));
  if (!pPr) return false;
  const style = childElements(pPr).find(el => isTag(el, 'pStyle'))?.getAttribute('w:val') ?? '';
  if (/heading|title|제목/i.test(style)) return true;
  return childElements(pPr).some(el => isTag(el, 'outlineLvl'));
}

function cellText(tc: Element): string {
  const parts: string[] = [];
  const walk = (el: Element) => {
    for (const child of childElements(el)) {
      if (isTag(child, 'p')) parts.push(paragraphText(child));
      else walk(child);
    }
  };
  walk(tc);
  return parts.filter(Boolean).join(' ');
}

export function extractDocx(bytes: Uint8Array): Block[] {
  const entries = unzipEntries(bytes, name => name === 'word/document.xml');
  const xml = entries['word/document.xml'];
  if (!xml) throw new FileExtractError('DOCX 본문(word/document.xml)을 찾지 못했습니다.');
  const doc = parseXml(xml, 'word/document.xml');
  const body = Array.from(doc.getElementsByTagName('*')).find(el => el.localName === 'body');
  if (!body) throw new FileExtractError('DOCX 본문을 찾지 못했습니다.');

  const blocks: Block[] = [];
  let table = 0;
  const visit = (container: Element) => {
    for (const el of childElements(container)) {
      if (isTag(el, 'p')) {
        const text = paragraphText(el);
        if (!text) continue;
        blocks.push(isHeading(el) ? { kind: 'heading', text } : { ...classifyLine(text), text });
      } else if (isTag(el, 'tbl')) {
        table += 1;
        let row = 0;
        for (const tr of childElements(el).filter(item => isTag(item, 'tr'))) {
          const cells = childElements(tr).filter(item => isTag(item, 'tc')).map(cellText);
          if (!cells.some(Boolean)) continue;
          row += 1;
          blocks.push({ kind: 'table-row', text: tableRowText(cells), table, row });
        }
      } else if (isTag(el, 'sdt') || isTag(el, 'sdtContent') || isTag(el, 'customXml')) {
        visit(el);
      }
    }
  };
  visit(body);
  return blocks;
}
