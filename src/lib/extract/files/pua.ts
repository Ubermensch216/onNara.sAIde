/**
 * 한컴 PUA(Private Use Area) · Wingdings 심볼 → 표준 유니코드 매핑 및 한국 공문 번호 시퀀스.
 *
 * 한글(HWP/HWPX)은 글머리표·문자표 기호를 BMP PUA(U+F020~F0FF)와 한컴 자체 Supplementary PUA-A
 * (U+F0000대)에 저장한다. 매핑 없이 추출하면 빈 네모(두부 글자)로 깨지거나 결재란 "(인)" 등이 사라진다.
 *
 * 출처·벤치마킹: chrisryugj/kordoc (MIT) src/shared/{pua,symbol-fonts,numbering}.ts
 *               & edwardkim/rhwp (MIT) verified Hancom PUA mapping table.
 */

// ── 번호 시퀀스 ──

const HANGUL_INITIALS = [0, 2, 3, 5, 6, 7, 9, 11, 12, 14, 15, 16, 17, 18];
const HANGUL_MEDIALS = [0, 4, 8, 13, 18, 20]; // ㅏ ㅓ ㅗ ㅜ ㅡ ㅣ
const HANGUL_JAMO = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ';
const CIRCLED_JAMO = '㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩㉪㉫㉬㉭';
const HANGUL_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const HANGUL_UNITS = ['', '십', '백', '천', '만'];
const HANJA_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HANJA_UNITS = ['', '十', '百', '千', '萬'];

/** 0-based n → 가, 나, 다, … 하, 거, 너, … (단모음 연속). */
export function hangulOrdinal(n: number): string {
  const safe = Math.max(0, n);
  const cols = HANGUL_INITIALS.length;
  const vowel = HANGUL_MEDIALS[Math.min(Math.floor(safe / cols), HANGUL_MEDIALS.length - 1)]!;
  const init = HANGUL_INITIALS[safe % cols]!;
  return String.fromCodePoint(0xac00 + init * 588 + vowel * 28);
}

/** 0-based n → ①~⑳, ㉑~㉟, ㊱~㊿ (50 초과는 "(51)"). */
export function circledNumber(n: number): string {
  if (n < 0) return String(n + 1);
  if (n < 20) return String.fromCodePoint(0x2460 + n);
  if (n < 35) return String.fromCodePoint(0x3251 + (n - 20));
  if (n < 50) return String.fromCodePoint(0x32b1 + (n - 35));
  return `(${n + 1})`;
}

/** 0-based n → ㉮~㉻ (14 초과는 가나다 서수). */
export function circledHangul(n: number): string {
  return n >= 0 && n < 14 ? String.fromCodePoint(0x326e + n) : hangulOrdinal(n);
}

/** 1-based n → 로마 숫자. */
export function romanNumeral(n: number, upper: boolean): string {
  if (n <= 0 || n > 3999) return String(n);
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const symbols = upper
    ? ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']
    : ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
  let out = '';
  let rem = n;
  for (let i = 0; i < values.length; i++) {
    while (rem >= values[i]!) {
      out += symbols[i]!;
      rem -= values[i]!;
    }
  }
  return out;
}

function formatEastAsianNumber(n: number, digits: string[], units: string[], zero: string): string {
  if (n === 0) return zero;
  if (n < 0 || n > 99999) return String(n);
  let out = '';
  let num = n;
  let unit = 0;
  while (num > 0) {
    const d = num % 10;
    if (d > 0) out = (d === 1 && unit > 0 ? '' : digits[d]!) + units[unit]! + out;
    num = Math.floor(num / 10);
    unit++;
  }
  return out;
}

function formatLatin(n: number, upper: boolean): string {
  if (n <= 0) return '';
  let out = '';
  let num = n;
  while (num > 0) {
    num--;
    out = String.fromCharCode((upper ? 65 : 97) + (num % 26)) + out;
    num = Math.floor(num / 26);
  }
  return out;
}

/** HWPX numFormat 문자열 → 표시 문자열. */
export function formatHeadNumber(n: number, numFormat: string): string {
  if (n === 0 && (numFormat === 'DIGIT' || numFormat === 'decimal')) return '0';
  const v = n <= 0 ? 1 : n;
  switch (numFormat) {
    case 'DIGIT': case 'decimal': return String(v);
    case 'CIRCLED_DIGIT': return v <= 50 ? circledNumber(v - 1) : `(${v})`;
    case 'HANGUL_SYLLABLE': case 'ganada': case 'koreanCounting': return hangulOrdinal(v - 1);
    case 'CIRCLED_HANGUL_SYLLABLE': return circledHangul(v - 1);
    case 'HANGUL_JAMO': case 'chosung': return HANGUL_JAMO[(v - 1) % HANGUL_JAMO.length]!;
    case 'CIRCLED_HANGUL_JAMO': return v <= 14 ? CIRCLED_JAMO[v - 1]! : HANGUL_JAMO[(v - 1) % 14]!;
    case 'LATIN_CAPITAL': case 'upperLetter': return formatLatin(v, true) || String(v);
    case 'LATIN_SMALL': case 'lowerLetter': return formatLatin(v, false) || String(v);
    case 'CIRCLED_LATIN_CAPITAL': return v <= 26 ? String.fromCodePoint(0x24b6 + v - 1) : formatLatin(v, true);
    case 'CIRCLED_LATIN_SMALL': return v <= 26 ? String.fromCodePoint(0x24d0 + v - 1) : formatLatin(v, false);
    case 'ROMAN_CAPITAL': case 'upperRoman': return romanNumeral(v, true);
    case 'ROMAN_SMALL': case 'lowerRoman': return romanNumeral(v, false);
    case 'HANGUL_PHONETIC': case 'koreanDigital': return formatEastAsianNumber(v, HANGUL_DIGITS, HANGUL_UNITS, '영');
    case 'HANJA_DIGIT': case 'ideographTraditional': return formatEastAsianNumber(v, HANJA_DIGITS, HANJA_UNITS, '零');
    default: return String(v);
  }
}

/** HWP 5.x 번호 형식 코드(표 43) → 표시 문자열. */
export function formatHwp5Number(n: number, code: number): string {
  switch (code) {
    case 1: return formatHeadNumber(n, 'CIRCLED_DIGIT');
    case 2: return formatHeadNumber(n, 'ROMAN_CAPITAL');
    case 3: return formatHeadNumber(n, 'ROMAN_SMALL');
    case 4: return formatHeadNumber(n, 'LATIN_CAPITAL');
    case 5: return formatHeadNumber(n, 'LATIN_SMALL');
    case 6: return formatHeadNumber(n, 'CIRCLED_LATIN_CAPITAL');
    case 7: return formatHeadNumber(n, 'CIRCLED_LATIN_SMALL');
    case 8: return formatHeadNumber(n, 'HANGUL_SYLLABLE');
    case 9: return formatHeadNumber(n, 'CIRCLED_HANGUL_SYLLABLE');
    case 10: return formatHeadNumber(n, 'HANGUL_JAMO');
    case 11: return formatHeadNumber(n, 'CIRCLED_HANGUL_JAMO');
    case 12: return formatHeadNumber(n, 'HANGUL_PHONETIC');
    case 13: return formatHeadNumber(n, 'HANJA_DIGIT');
    default: return formatHeadNumber(n, 'DIGIT');
  }
}

// ── Wingdings & 한컴 PUA 매핑 ──

/** Wingdings 0x21~0xFF → 유니코드 (인덱스 = 코드 - 0x21). */
const WINGDINGS: readonly string[] = [
  '🖉', '✂', '✁', '👓', '🕭', '🕮', '🕯', '🕿', '✆', '🖂', '🖃', '📪', '📫', '📬', '📭', '📁',
  '📂', '📄', '🗏', '🗐', '🗄', '⌛', '🖮', '🖰', '🖲', '🖳', '🖴', '🖫', '🖬', '✇', '✍', '🖎',
  '✌', '👌', '👍', '👎', '☜', '☞', '☝', '☟', '🖐', '☺', '😐', '☹', '💣', '☠', '🏳', '🏱',
  '✈', '☼', '💧', '❄', '🕆', '✞', '🕈', '✠', '✡', '☪', '☯', 'ॐ', '☸', '♈', '♉', '♊',
  '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🙰', '🙵', '●', '○', '■', '□', '□',
  '❑', '❒', '⬧', '⧫', '◆', '❖', '⬥', '⌧', '⮹', '⌘', '🏵', '🏶', '🙶', '🙷', '', '⓪',
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⓿', '❶', '❷', '❸', '❹', '❺',
  '❻', '❼', '❽', '❾', '❿', '🙢', '🙠', '🙡', '🙣', '🙞', '🙜', '🙝', '🙟', '·', '•', '▪',
  '⚪', '○', '◯', '◉', '◎', '🔿', '▪', '◻', '🟂', '✦', '★', '✶', '✴', '✹', '✵', '⯐',
  '⌖', '⟡', '⌑', '⯑', '✪', '✰', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙',
  '🕚', '🕛', '⮰', '⮱', '⮲', '⮳', '⮴', '⮵', '⮶', '⮷', '🙪', '🙫', '🙕', '🙔', '🙗', '🙖',
  '🙐', '🙑', '🙒', '🙓', '⌫', '⌦', '⮘', '⮚', '⮙', '⮛', '⮈', '⮊', '⮉', '⮋', '←', '→',
  '↑', '↓', '↖', '↗', '↙', '↘', '⬅', '➔', '⬆', '⬇', '⬉', '⬈', '⬋', '⬊', '⇦', '⇨',
  '⇧', '⇩', '⬄', '⇳', '⬀', '⬁', '⬃', '⬂', '🢬', '🢭', '✗', '✔', '☒', '☑', '',
];

export function wingdingsChar(code: number): string | undefined {
  if (code < 0x21 || code > 0xff) return undefined;
  return WINGDINGS[code - 0x21] || undefined;
}

const BMP_SYMBOL_MAP: Record<number, string> = {
  0x6c: '●', 0x6d: '●', 0x6e: '■', 0x6f: '□', 0x70: '□', 0x71: '□', 0x72: '□',
  0x73: '⬧', 0x74: '⧫', 0x75: '◆', 0x76: '❖', 0x77: '⬥',
  0x9e: '·', 0x9f: '•', 0xa0: '·', 0xa1: '⚪', 0xa2: '○', 0xa3: '○', 0xa4: '◉', 0xa5: '◎',
  0xa7: '▪', 0xa8: '◻', 0xaa: '✦', 0xab: '★', 0xac: '✶', 0xad: '✴', 0xae: '✹',
  0x45: '☜', 0x46: '☞', 0x47: '☝', 0x48: '☟',
  0xfb: '✗', 0xfc: '✔', 0xfd: '☒', 0xfe: '☑',
  0xe8: '➔', 0xef: '⇦', 0xf0: '⇨', 0xf1: '⇧', 0xf2: '⇩',
  0x22: '✂', 0x36: '⌛', 0x4a: '☺', 0x4e: '☠', 0x52: '☼', 0x54: '❄', 0x58: '✠', 0x59: '✡',
};

const SUPPLEMENTARY_MAP: Record<number, string> = {
  0xf003b: '↓',
  0xf0090: '✺',
  0xf00da: '[예]',
  0xf00e1: '(인)',
  0xf012b: '(인)',
  0xf02ec: '◇',
  0xf02ef: '·',
  0xf02fb: '▸',
  0xf02fc: '►',
  0xf031c: '■',
  0xf03a0: '↵',
  0xf03a7: '⊟',
  0xf03a8: '⊞',
  0xf03c5: '□',
  0xf03da: '□',
  0xf03ef: '한', 0xf03f0: '글', 0xf03f1: '과', 0xf03f2: '컴', 0xf03f3: '퓨', 0xf03f4: '터',
  0xf03ff: '□',
  0xf0806: '┌', 0xf0807: '┬', 0xf0808: '┐',
  0xf080c: '└', 0xf080e: '┘', 0xf080f: '━', 0xf0810: '│',
  0xf081c: '┈', 0xf0827: '■', 0xf0832: '═', 0xf0848: '━',
  0xf0854: '《', 0xf0855: '》',
};

export function enclosedNumber(n: number): string {
  return n === 0 ? '⓪' : circledNumber(n - 1);
}

function tensDigit(code: number): number | undefined {
  if (code >= 0xf0288 && code <= 0xf0291) return code - 0xf0288;
  if (code >= 0xf02ba && code <= 0xf02c2) return code - 0xf02b9;
  return undefined;
}

function unitsDigit(code: number): number | undefined {
  if (code >= 0xf0292 && code <= 0xf029b) return code - 0xf0292;
  if (code >= 0xf02c3 && code <= 0xf02cc) return code - 0xf02c3;
  return undefined;
}

function numberGlyph(code: number): string | undefined {
  const t = tensDigit(code);
  if (t !== undefined) return enclosedNumber(t);
  if (code >= 0xf02b0 && code <= 0xf02b9) return enclosedNumber(code - 0xf02b0);
  const u = unitsDigit(code);
  return u === undefined ? undefined : String(u);
}

/** 글자 겹치기(hp:compose · HWP5 tcps): 도형 안 숫자는 원 숫자로 변환. */
export function composeText(chars: string, enclosed: boolean): string {
  return enclosed && /^\d{1,2}$/.test(chars) ? enclosedNumber(Number(chars)) : chars;
}

function mapPuaChar(code: number): string | undefined {
  if (code >= 0xf020 && code <= 0xf0ff) {
    return BMP_SYMBOL_MAP[code - 0xf000] ?? wingdingsChar(code - 0xf000);
  }
  if (code >= 0xf0000 && code <= 0xf09ff) {
    return numberGlyph(code) ?? SUPPLEMENTARY_MAP[code];
  }
  return undefined;
}

/** 문자열 내 한컴 PUA 기호를 표준 유니코드로 변환한다. 매핑 없는 Supplementary PUA는 제거해 두부 글자를 막는다. */
export function mapPuaText(text: string): string {
  if (!text) return '';
  let needsScan = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c >= 0xf000 && c <= 0xf0ff) || (c >= 0xd800 && c <= 0xdbff)) {
      needsScan = true;
      break;
    }
  }
  if (!needsScan) return text;
  let out = '';
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i]!.codePointAt(0)!;
    if (i + 1 < chars.length) {
      const t = tensDigit(code);
      const u = unitsDigit(chars[i + 1]!.codePointAt(0)!);
      if (t !== undefined && u !== undefined) {
        out += enclosedNumber(t * 10 + u);
        i++;
        continue;
      }
    }
    const mapped = mapPuaChar(code);
    if (mapped !== undefined) {
      out += mapped;
    } else if (code >= 0xf0000 && code <= 0xffffd) {
      // 매핑되지 않은 Supplementary PUA-A (두부 글자) 제거
    } else {
      out += chars[i]!;
    }
  }
  return out;
}

/** 비표시 제어문자(NULL, ZERO-WIDTH, U+F000 등)를 제거한다. */
export function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200d\ufeff\uf000]/g, '');
}
