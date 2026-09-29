/**
 * AI 초안 + 등록한 서식 → 서식이 입혀진 문단 목록 (기안 코파일럿 · 본문 삽입).
 *
 * 흐름: 줄마다 기호로 단계 판별 → 서식의 단계에 대응 → 기호·앞 칸·번호를 서식대로 바꾸고 글자·문단 서식을 붙인다.
 *
 * ★ 소형 모델은 기호 체계를 자주 틀린다(□ 대신 1., ❍ 대신 ○ 등). 모델에게 맡기지 않고 여기서 규칙으로 맞춘다.
 *   서식에 같은 단계가 있으면 그대로 쓰고, 없으면 "초안의 몇 번째 단계인지"로 서식의 같은 깊이 단계에 대응한다.
 * ★ 번호가 있는 단계(1. 가. ① Ⅰ 󰊱)는 번호를 새로 매긴다. 윗단계가 나오면 아랫단계 번호는 1부터 다시 센다.
 */

import { classifyMarker, rankOf } from './markers';
import type { CharStyle, LevelStyle, ParaStyle, TemplateFormat } from './types';

export type ParagraphRole = 'title' | 'chapter' | 'text';

export interface StyledParagraph {
  /** 앞 공백·기호를 서식대로 맞춘 문단 글자. 빈 줄이면 ''. */
  text: string;
  /** 대제목 막대(표)의 번호 칸 글자(Ⅰ). role이 chapter일 때만. */
  lead?: string;
  levelKey: string;
  role: ParagraphRole;
  char: CharStyle;
  para: ParaStyle;
  leadChar?: CharStyle;
}

/** 단계 판별에서 위아래 순서를 따지지 않는 단계(제목·붙임·주석·일반 문단). */
const NON_HIER = new Set(['title', 'attach', 'note', 'body']);
/** 번호를 새로 매기는 단계. */
const ORDINAL = new Set(['num', 'ga', 'num-paren', 'ga-paren', 'paren-num', 'paren-ga', 'circled', 'chapter']);
const GA = '가나다라마바사아자차카타파하';
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];

const DEFAULT_CHAR: CharStyle = { font: '', sizePt: 12, bold: false, spacingPct: 0, ratioPct: 100 };
const DEFAULT_PARA: ParaStyle = { lineSpacingPct: 160, beforePt: 0, afterPt: 0, leftPt: 0, indentPt: 0, align: 'justify' };

interface Target {
  key: string;
  glyph: string;
  glyphs: string[];
  leadSpaces: number;
  char: CharStyle;
  para: ParaStyle;
  role: ParagraphRole;
  leadChar?: CharStyle;
}

function fromLevel(level: LevelStyle): Target {
  return { key: level.key, glyph: level.glyph, glyphs: level.glyphs ?? [level.glyph], leadSpaces: level.leadSpaces, char: level.char, para: level.para, role: level.key === 'title' ? 'title' : 'text' };
}

/** 서식의 위아래 단계 목록. Ⅰ 대제목 막대(표)가 있으면 맨 위에 둔다. */
function hierarchyOf(format: TemplateFormat): Target[] {
  const out: Target[] = [];
  const chapter = format.boxes.find(b => b.role === 'chapter');
  if (chapter && !format.levels.some(l => l.key === 'chapter')) {
    out.push({ key: 'chapter', glyph: 'Ⅰ', glyphs: ['Ⅰ'], leadSpaces: 0, char: chapter.char, para: chapter.para, role: 'chapter', leadChar: chapter.leadChar });
  }
  for (const level of format.levels) if (!NON_HIER.has(level.key)) out.push(fromLevel(level));
  return out;
}

/** 번호 n(1부터)에 맞는 기호. */
function ordinalGlyph(target: Target, n: number): string {
  switch (target.key) {
    case 'num': return `${n}.`;
    case 'ga': return `${GA[(n - 1) % GA.length]}.`;
    case 'num-paren': return `${n})`;
    case 'ga-paren': return `${GA[(n - 1) % GA.length]})`;
    case 'paren-num': return `(${n})`;
    case 'paren-ga': return `(${GA[(n - 1) % GA.length]})`;
    case 'circled': return String.fromCodePoint(0x2460 + Math.min(n, 20) - 1);
    case 'chapter': return ROMAN[(n - 1) % ROMAN.length]!;
    default: break;
  }
  // 한컴 원문자 제목(󰊱 󰊲 …)처럼 코드가 이어지는 기호는 번호대로 다음 글자를 쓴다.
  const codes = target.glyphs.map(g => g.codePointAt(0)!).sort((a, b) => a - b);
  const consecutive = codes.length > 1 && codes.every((c, i) => i === 0 || c === codes[i - 1]! + 1);
  if (consecutive) return String.fromCodePoint(codes[0]! + n - 1);
  return target.glyph;
}

function isOrdinal(target: Target): boolean {
  if (ORDINAL.has(target.key)) return true;
  const codes = target.glyphs.map(g => g.codePointAt(0)!);
  return codes.length > 1 && codes.every((c, i) => i === 0 || Math.abs(c - codes[i - 1]!) === 1);
}

/** 초안 → 서식이 입혀진 문단 목록. */
export function layoutDraft(draft: string, format: TemplateFormat): StyledParagraph[] {
  const hier = hierarchyOf(format);
  const levelByKey = new Map(format.levels.map(l => [l.key, fromLevel(l)]));
  for (const t of hier) if (!levelByKey.has(t.key)) levelByKey.set(t.key, t);
  const bodyLevel = levelByKey.get('body');
  const lines = draft.replace(/\r\n?/g, '\n').split('\n');

  // 초안에 쓰인 단계들을 위아래 순서로 늘어놓아 깊이를 정한다.
  const draftKeys = [...new Set(lines.map(l => classifyMarker(l)?.key).filter((k): k is string => Boolean(k) && !NON_HIER.has(k!)))]
    .sort((a, b) => rankOf(a) - rankOf(b));
  const resolve = (key: string): Target | undefined => {
    if (!hier.length) return levelByKey.get(key);
    // 서식에 같은 단계가 있으면 그 단계로, 없으면 초안에서의 깊이와 같은 깊이의 서식 단계로(초안 1. → 서식 □).
    const direct = hier.find(t => t.key === key);
    if (direct) return direct;
    const depth = draftKeys.indexOf(key);
    return hier[Math.min(depth < 0 ? hier.length - 1 : depth, hier.length - 1)];
  };

  const counters = new Map<Target, number>();
  const out: StyledParagraph[] = [];
  let last: Target | undefined;
  let sawMarker = false;
  let blankPending = false;

  for (const line of lines) {
    if (!line.trim()) {
      blankPending = out.length > 0;
      continue;
    }
    const marker = classifyMarker(line);
    if (blankPending) {
      // 빈 줄은 여러 개가 이어져도 하나로 줄인다.
      out.push({ text: '', levelKey: 'blank', role: 'text', char: (last ?? hier[0])?.char ?? DEFAULT_CHAR, para: (last ?? hier[0])?.para ?? DEFAULT_PARA });
      blankPending = false;
    }

    // 제목: 첫 항목 기호보다 앞의 기호 없는 줄.
    if (!marker && !sawMarker && !out.some(p => p.role === 'title') && levelByKey.has('title')) {
      const title = levelByKey.get('title')!;
      out.push({ text: line.trim(), levelKey: 'title', role: 'title', char: title.char, para: title.para });
      continue;
    }

    if (!marker) {
      // 기호 없는 줄: 서식의 '일반 문단'을 쓰고, 없으면 바로 앞 단계 서식으로 이어 쓴다(두 칸 더 들여서).
      const base = bodyLevel ?? last;
      const lead = bodyLevel ? bodyLevel.leadSpaces : (last?.leadSpaces ?? 0) + 2;
      out.push({ text: `${' '.repeat(lead)}${line.trim()}`, levelKey: 'body', role: 'text', char: base?.char ?? DEFAULT_CHAR, para: base?.para ?? DEFAULT_PARA });
      continue;
    }

    sawMarker = true;
    let target: Target | undefined;
    if (NON_HIER.has(marker.key)) target = levelByKey.get(marker.key) ?? (marker.key === 'note' ? hier.at(-1) : bodyLevel ?? hier.at(-1));
    else target = resolve(marker.key);
    if (!target) {
      out.push({ text: line.replace(/\s+$/, ''), levelKey: marker.key, role: 'text', char: last?.char ?? DEFAULT_CHAR, para: last?.para ?? DEFAULT_PARA });
      continue;
    }

    let glyph: string;
    if (NON_HIER.has(marker.key) && !levelByKey.has(marker.key)) {
      glyph = marker.glyph; // 서식에 없는 주석·붙임은 초안 기호를 그대로 둔다.
    } else if (isOrdinal(target)) {
      const n = (counters.get(target) ?? 0) + 1;
      counters.set(target, n);
      glyph = ordinalGlyph(target, n);
    } else {
      glyph = target.glyph || marker.glyph;
    }
    if (!NON_HIER.has(marker.key)) {
      const depth = hier.indexOf(target);
      if (depth >= 0) for (const deeper of hier.slice(depth + 1)) counters.delete(deeper);
      last = target;
    }

    if (target.role === 'chapter') {
      out.push({ text: marker.rest, lead: glyph, levelKey: 'chapter', role: 'chapter', char: target.char, para: target.para, leadChar: target.leadChar });
      continue;
    }
    const lead = NON_HIER.has(marker.key) && !levelByKey.has(marker.key) ? (last?.leadSpaces ?? 0) + 2 : target.leadSpaces;
    out.push({ text: `${' '.repeat(lead)}${glyph}${marker.rest ? ' ' : ''}${marker.rest}`, levelKey: target.key, role: 'text', char: target.char, para: target.para });
  }
  return out;
}

/** 문단 목록 → 글자만(서식 명령을 못 쓸 때 삽입·복사용). 대제목 막대는 "Ⅰ. 제목" 한 줄로 쓴다. */
export function paragraphsToText(paras: StyledParagraph[]): string {
  return paras.map(p => (p.role === 'chapter' ? `${p.lead}. ${p.text}` : p.text)).join('\n');
}

/* ── 서식 있는 HTML (한글 기안기 HTML 끼워 넣기 · 클립보드 · 웹 편집기) ── */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function charCss(c: CharStyle): string {
  const font = c.font ? `font-family:'${c.font.replace(/'/g, '')}';` : '';
  return `${font}font-size:${c.sizePt}pt;font-weight:${c.bold ? 'bold' : 'normal'};letter-spacing:${(c.spacingPct / 100).toFixed(2)}em;`;
}

function paraCss(p: ParaStyle): string {
  const align = p.align === 'justify' ? 'justify' : p.align;
  return `margin:${p.beforePt}pt 0 ${p.afterPt}pt ${p.leftPt - Math.min(p.indentPt, 0)}pt;text-indent:${p.indentPt}pt;line-height:${p.lineSpacingPct}%;text-align:${align};`;
}

/** 앞 공백은 HTML에서 사라지므로 &nbsp;로 바꾼다. */
function textHtml(text: string): string {
  const lead = text.match(/^ */)![0].length;
  return '&nbsp;'.repeat(lead) + escapeHtml(text.slice(lead));
}

/**
 * 문단 목록 → HTML. 제목 상자·Ⅰ 대제목 막대는 서식에 상자가 있으면 표로 그린다.
 * ODT 내어쓰기(margin-left + 음수 text-indent)와 같은 방식으로 적어 한글·웹 편집기 모두 두 번째 줄이 기호 뒤에 맞게 한다.
 */
export function paragraphsToHtml(paras: StyledParagraph[], format?: TemplateFormat): string {
  const titleBox = format?.boxes.find(b => b.role === 'title');
  const out: string[] = [];
  for (const p of paras) {
    if (p.role === 'chapter') {
      const lead = p.leadChar ?? p.char;
      out.push(
        `<table style="border-collapse:collapse;width:100%;margin:${p.para.beforePt || 6}pt 0 4pt 0;"><tr>` +
        `<td style="width:2.2em;border:1px solid #1f3a6b;background:#1f3a6b;color:#fff;text-align:center;${charCss(lead)}">${escapeHtml(p.lead ?? '')}</td>` +
        `<td style="border:1px solid #1f3a6b;padding:1pt 6pt;${charCss(p.char)}">${escapeHtml(p.text)}</td>` +
        `</tr></table>`,
      );
    } else if (p.role === 'title' && titleBox) {
      out.push(`<table style="border-collapse:collapse;width:100%;margin:0 0 8pt 0;"><tr><td style="border:1.5px solid #333;padding:4pt 8pt;text-align:center;${charCss(p.char)}">${escapeHtml(p.text)}</td></tr></table>`);
    } else if (!p.text) {
      out.push(`<p style="margin:0;${charCss(p.char)}line-height:${p.para.lineSpacingPct}%;">&nbsp;</p>`);
    } else {
      out.push(`<p style="${paraCss(p.para)}${charCss(p.char)}">${textHtml(p.text)}</p>`);
    }
  }
  return out.join('\n');
}

/* ── 한글 기안기 서식 명령용 직렬화 ── */

/** 메인 월드 스크립트로 넘길 문단 하나. 함수·클래스 없이 JSON만 담는다. */
export interface HwpStyledPara {
  text: string;
  font: string;
  /** HWPUNIT(1pt = 100). */
  height: number;
  bold: boolean;
  spacing: number;
  ratio: number;
  lineSpacing: number;
  /** 아래 네 값은 HWPUNIT. */
  prev: number;
  next: number;
  left: number;
  indent: number;
  /** 한글 문단 정렬 번호: 0 양쪽, 1 왼쪽, 2 오른쪽, 3 가운데. */
  align: number;
}

const ALIGN_NO: Record<ParaStyle['align'], number> = { justify: 0, left: 1, right: 2, center: 3 };

export function paragraphsToHwp(paras: StyledParagraph[]): HwpStyledPara[] {
  return paras.map(p => {
    const text = p.role === 'chapter' ? `${p.lead}. ${p.text}` : p.text;
    const c = p.char;
    return {
      text,
      font: c.font,
      height: Math.round(c.sizePt * 100),
      bold: c.bold,
      spacing: Math.round(c.spacingPct),
      ratio: Math.round(c.ratioPct),
      lineSpacing: Math.round(p.para.lineSpacingPct),
      prev: Math.round(p.para.beforePt * 100),
      next: Math.round(p.para.afterPt * 100),
      left: Math.round(p.para.leftPt * 100),
      indent: Math.round(p.para.indentPt * 100),
      align: ALIGN_NO[p.para.align],
    };
  });
}

/* ── AI 요청문: 서식의 단계 기호 체계 ── */

/**
 * 모델에게 알려 줄 단계 기호. 한컴 전용 문자(사용자 영역)는 모델이 쓸 수 없으므로 일반 문자로 바꿔 알려 주고,
 * 삽입할 때 layoutDraft가 원래 문자로 되돌린다. 원문자 제목(󰊱)은 ①(다른 단계)과 겹치지 않게 ◎로 알린다.
 */
const PROMPT_GLYPH: Record<string, string> = {
  chapter: 'Ⅰ.', section: '□', 'sym-pua': '◎', num: '1.', ga: '가.', 'num-paren': '1)', 'ga-paren': '가)',
  'paren-num': '(1)', 'paren-ga': '(가)', item: '○', circled: '①', sub: '-', detail: '·', arrow: '▷',
};

export function formatHierarchyPrompt(format: TemplateFormat): string {
  const glyphs = hierarchyOf(format).map(t => PROMPT_GLYPH[t.key] ?? t.glyph).filter(Boolean);
  if (!glyphs.length) return '';
  return `선택한 서식의 단계 기호 체계가 다른 번호 규칙보다 우선합니다. 본문은 ${glyphs.join(' → ')} 순서의 기호로만 작성하십시오. 각 줄은 해당 단계 기호로 시작하고 기호 뒤에 한 칸을 띄우며, 하위 단계는 상위 단계 바로 아래에 둡니다. 들여쓰기 공백과 글꼴·크기는 서식에 맞춰 자동으로 조정되므로 넣지 마십시오.`;
}

/** 기안기 삽입 요청에 실어 보낼 서식 묶음. */
export interface StyledInsertPayload {
  paras: HwpStyledPara[];
  html: string;
  /** 서식 명령을 못 쓸 때 넣을 글자(기호·앞 칸은 서식대로 맞춘 것). */
  text: string;
}

export function buildStyledInsert(draft: string, format: TemplateFormat): StyledInsertPayload {
  const paras = layoutDraft(draft, format);
  return { paras: paragraphsToHwp(paras), html: paragraphsToHtml(paras, format), text: paragraphsToText(paras) };
}
