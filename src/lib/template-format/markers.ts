/**
 * 줄 머리 기호로 문단의 단계를 판별한다.
 *
 * ★ 같은 단계도 문서마다 기호 문자가 다르다(실물 확인).
 *   ○ 단계: `○`·`❍`·`ㅇ`, · 단계: `·`·`‧`·`∙`, □ 단계: `□` 또는 한컴 사용자 영역 문자(U+F03DA).
 *   그래서 모양이 아니라 **단계(key)** 로 묶고, 원래 문자(glyph)는 따로 남긴다.
 * ★ 모르는 기호(한컴 원문자 제목 󰊱 등 사용자 영역 문자)는 버리지 않고 `sym-코드` 단계로 둔다.
 */

export interface MarkerInfo {
  key: string;
  label: string;
  glyph: string;
  /** 위아래 순서. 작을수록 윗단계. */
  rank: number;
  /** 기호를 뺀 글자. */
  rest: string;
}

interface Rule { key: string; label: string; rank: number; re: RegExp }

const RULES: Rule[] = [
  { key: 'title', label: '제목', rank: 0, re: /^(제\s*목\s*[:：])\s*/ },
  { key: 'chapter', label: 'Ⅰ. 대제목', rank: 10, re: /^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.．]?)\s*/ },
  { key: 'section', label: '□ 소제목', rank: 20, re: /^([□■▣◆◇\u{F03DA}])\s*/u },
  // 공문(시행문) 개조식: 1. → 가. → 1) → 가) → (1) → (가)
  { key: 'num', label: '1. 항목', rank: 30, re: /^(\d{1,2}\.)(?!\d)\s*/ },
  { key: 'ga', label: '가. 항목', rank: 31, re: /^([가-하]\.)\s+/ },
  { key: 'num-paren', label: '1) 항목', rank: 32, re: /^(\d{1,2}\))\s*/ },
  { key: 'ga-paren', label: '가) 항목', rank: 33, re: /^([가-하]\))\s*/ },
  { key: 'paren-num', label: '(1) 항목', rank: 34, re: /^(\(\d{1,2}\))\s*/ },
  { key: 'paren-ga', label: '(가) 항목', rank: 35, re: /^(\([가-하]\))\s*/ },
  // 보고서형 개조식: ○ → ① → - → · → ▷
  { key: 'item', label: '○ 항목', rank: 40, re: /^([○❍◯●]|ㅇ(?=\s))\s*/ },
  { key: 'circled', label: '① 항목', rank: 45, re: /^([①-⑳])\s*/ },
  { key: 'sub', label: '- 세부항목', rank: 50, re: /^([-−–―])\s*/ },
  { key: 'detail', label: '· 세부내용', rank: 60, re: /^([·‧∙•・])\s*/ },
  { key: 'arrow', label: '▷ 참고', rank: 70, re: /^([▷▶►➢])\s*/ },
  { key: 'note', label: '※ 주석', rank: 80, re: /^([※*＊])\s*/ },
  { key: 'attach', label: '붙임', rank: 90, re: /^(붙\s*임)(?=[\s:：\d]|$)\s*[:：]?\s*/ },
];

/** 한 글자 기호로 볼 수 있는지. 한글·영문·숫자·괄호로 시작하면 기호가 아니다. */
function isSymbol(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0xf0000) return true; // 사용자 영역(한컴 전용 기호)
  if (cp >= 0xe000 && cp <= 0xf8ff) return true;
  return /[←-➿■-◿☀-⛿㈀-㋿]/u.test(ch);
}

/** 앞 공백을 뺀 줄의 기호를 판별한다. 기호가 없으면 undefined. */
export function classifyMarker(line: string): MarkerInfo | undefined {
  const text = line.replace(/^[\s　]+/, '');
  if (!text) return undefined;
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) return { key: rule.key, label: rule.label, rank: rule.rank, glyph: m[1]!, rest: text.slice(m[0].length).trim() };
  }
  const first = Array.from(text)[0]!;
  if (isSymbol(first)) {
    const cp = first.codePointAt(0)!;
    // 한컴 사용자 영역 문자(원문자 제목 󰊱 󰊲 …)는 글자마다 코드가 달라도 한 단계로 묶는다.
    const pua = cp >= 0xf0000 || (cp >= 0xe000 && cp <= 0xf8ff);
    const key = pua ? 'sym-pua' : `sym-${cp.toString(16).toUpperCase()}`;
    // 모르는 기호는 제목류로 쓰이는 경우가 많아 □ 바로 아래에 둔다.
    return { key, label: pua ? `${first} 중제목` : `${first} 기호`, rank: 25, glyph: first, rest: text.slice(first.length).trim() };
  }
  return undefined;
}

/** 줄 앞 공백 칸 수. 전각 공백은 2칸, 탭은 4칸으로 센다. */
export function countLeadSpaces(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ' || ch === ' ') n += 1;
    else if (ch === '　') n += 2;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
}

/** 한 단계의 대표 순서. 모르는 단계는 뒤로. */
export function rankOf(key: string): number {
  if (key.startsWith('sym-')) return 25;
  return RULES.find(rule => rule.key === key)?.rank ?? 100;
}
