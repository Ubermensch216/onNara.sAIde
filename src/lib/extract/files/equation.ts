/**
 * 한컴 EqEdit 수식(HWPX/HWP5) 및 OOXML OMML 수식(DOCX) → 가독 텍스트/LaTeX 변환.
 *
 * 출처·벤치마킹: chrisryugj/kordoc (MIT) src/{hwpx,hwp5,docx}/equation.ts
 */

import { childElements, firstChild } from './zip';

// ── 한컴 EqEdit (HWPX <hp:script> / HWP5 EQEDIT) ──

const HWP_EQ_TOKENS: Record<string, string> = {
  // 그리스 문자
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  ALPHA: 'Α', BETA: 'Β', GAMMA: 'Γ', DELTA: 'Δ', THETA: 'Θ', LAMBDA: 'Λ',
  XI: 'Ξ', PI: 'Π', SIGMA: 'Σ', PHI: 'Φ', PSI: 'Ψ', OMEGA: 'Ω',
  // 연산자·관계·기호
  times: '×', TIMES: '×', cdot: '·', CDOT: '·', divide: '÷', div: '÷',
  pm: '±', mp: '∓', neq: '≠', NEQ: '≠', le: '≤', leq: '≤', LEQ: '≤',
  ge: '≥', geq: '≥', GEQ: '≥', approx: '≈', APPROX: '≈', equiv: '≡',
  sim: '∼', prop: '∝', inf: '∞', infty: '∞', INF: '∞',
  sum: '∑', SUM: '∑', smallsum: '∑', prod: '∏', PROD: '∏', int: '∫', INT: '∫',
  partial: '∂', nabla: '∇', in: '∈', IN: '∈', notin: '∉',
  subset: '⊂', supset: '⊃', cup: '∪', cap: '∩', smallinter: '∩', emptyset: '∅',
  rarrow: '→', rightarrow: '→', larrow: '←', leftarrow: '←', lrarrow: '↔',
  deg: '°', circ: '°', angle: '∠', triangle: '△', bot: '⊥',
  // 서식 지시자 제거
  rm: '', it: '', bold: '', left: '', right: '', LEFT: '', RIGHT: '',
  big: '', Big: '', bigg: '', Bigg: '',
};

/** `{A} over {B}` 또는 `A over B` 분수를 `(A)/(B)` 형태로 변환한다. */
function replaceOver(input: string): string {
  let s = input;
  for (let pass = 0; pass < 8; pass++) {
    const idx = s.search(/\bover\b/i);
    if (idx < 0) break;
    // 왼쪽 피연산자 추출
    const leftPart = s.slice(0, idx).trimEnd();
    let lStart = leftPart.length;
    let num = '';
    if (leftPart.endsWith('}')) {
      let depth = 0;
      for (let i = leftPart.length - 1; i >= 0; i--) {
        if (leftPart[i] === '}') depth++;
        else if (leftPart[i] === '{') {
          depth--;
          if (depth === 0) { lStart = i; num = leftPart.slice(i + 1, -1).trim(); break; }
        }
      }
    } else {
      const m = leftPart.match(/(\S+)$/);
      if (m) { lStart = leftPart.length - m[1]!.length; num = m[1]!; }
    }
    // 오른쪽 피연산자 추출
    const afterOver = s.slice(idx + 4);
    const leadWs = afterOver.match(/^\s*/)?.[0].length ?? 0;
    const rightPart = afterOver.slice(leadWs);
    let rConsumed = 0;
    let den = '';
    if (rightPart.startsWith('{')) {
      let depth = 0;
      for (let i = 0; i < rightPart.length; i++) {
        if (rightPart[i] === '{') depth++;
        else if (rightPart[i] === '}') {
          depth--;
          if (depth === 0) { rConsumed = i + 1; den = rightPart.slice(1, i).trim(); break; }
        }
      }
    } else {
      const m = rightPart.match(/^(\S+)/);
      if (m) { rConsumed = m[1]!.length; den = m[1]!; }
    }
    if (!num && !den) break;
    const before = leftPart.slice(0, lStart);
    const after = rightPart.slice(rConsumed);
    s = `${before}(${num})/(${den})${after}`;
  }
  return s;
}

/** 한컴 EqEdit 수식 스크립트를 읽기 쉬운 수식 문자열로 변환한다. */
export function hwpEquationToText(script: string): string {
  let s = script.replace(/\0/g, '').replace(/`/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // 연산자 기호 치환
  s = s
    .replace(/\+-/g, ' ± ')
    .replace(/-\+/g, ' ∓ ')
    .replace(/!=/g, ' ≠ ')
    .replace(/<=/g, ' ≤ ')
    .replace(/>=/g, ' ≥ ')
    .replace(/==/g, ' ≡ ');

  // root {n} of {x} → n√(x), sqrt {x} → √(x)
  s = s.replace(/\broot\s+\{([^}]*)\}\s+of\s+\{([^}]*)\}/gi, (_, n: string, x: string) => `${n.trim()}√(${x.trim()})`);
  s = s.replace(/\broot\s+(\S+)\s+of\s+(\S+)/gi, (_, n: string, x: string) => `${n}√(${x})`);
  s = s.replace(/\bsqrt\s+\{([^}]*)\}/gi, (_, x: string) => `√(${x.trim()})`);
  s = s.replace(/\bsqrt\s+(\S+)/gi, (_, x: string) => `√(${x})`);

  // 분수 변환
  s = replaceOver(s);

  // 단어 토큰 매핑
  s = s.replace(/\b([A-Za-z]+)\b/g, word => {
    if (Object.hasOwn(HWP_EQ_TOKENS, word)) return HWP_EQ_TOKENS[word]!;
    const lower = word.toLowerCase();
    if (Object.hasOwn(HWP_EQ_TOKENS, lower)) return HWP_EQ_TOKENS[lower]!;
    return word;
  });

  // 괄호 정리: 단순 중괄호 그룹 풀기 (첨자 ^ / _ 뒤 제외)
  s = s.replace(/(?<![_^])\{([^{}]+)\}/g, '$1');
  s = s.replace(/\s*\^\s*/g, '^').replace(/\s*_\s*/g, '_');
  return s.replace(/\s+/g, ' ').trim();
}

// ── DOCX OMML (<m:oMath> / <m:oMathPara>) ──

function ommlChildren(el: Element): string {
  return childElements(el).map(ommlNode).join('');
}

function ommlNode(el: Element): string {
  const tag = el.localName;
  switch (tag) {
    case 'r':
      return childElements(el).filter(c => c.localName === 't').map(c => c.textContent ?? '').join('');
    case 't':
      return el.textContent ?? '';
    case 'e': case 'num': case 'den': case 'sub': case 'sup': case 'deg': case 'lim': case 'fName':
    case 'oMath': case 'oMathPara':
      return ommlChildren(el);
    case 'f': {
      const num = firstChild(el, 'num');
      const den = firstChild(el, 'den');
      return `(${num ? ommlChildren(num) : ''})/(${den ? ommlChildren(den) : ''})`;
    }
    case 'rad': {
      const deg = firstChild(el, 'deg');
      const e = firstChild(el, 'e');
      const degText = deg ? ommlChildren(deg).trim() : '';
      const body = e ? ommlChildren(e).trim() : '';
      return degText ? `${degText}√(${body})` : `√(${body})`;
    }
    case 'sSup': {
      const e = firstChild(el, 'e');
      const sup = firstChild(el, 'sup');
      return `${e ? ommlChildren(e) : ''}^${sup ? ommlChildren(sup) : ''}`;
    }
    case 'sSub': {
      const e = firstChild(el, 'e');
      const sub = firstChild(el, 'sub');
      return `${e ? ommlChildren(e) : ''}_${sub ? ommlChildren(sub) : ''}`;
    }
    case 'sSubSup': {
      const e = firstChild(el, 'e');
      const sub = firstChild(el, 'sub');
      const sup = firstChild(el, 'sup');
      return `${e ? ommlChildren(e) : ''}_${sub ? ommlChildren(sub) : ''}^${sup ? ommlChildren(sup) : ''}`;
    }
    case 'd': {
      const dPr = firstChild(el, 'dPr');
      const beg = dPr ? firstChild(dPr, 'begChr')?.getAttribute('m:val') ?? firstChild(dPr, 'begChr')?.getAttribute('val') ?? '(' : '(';
      const end = dPr ? firstChild(dPr, 'endChr')?.getAttribute('m:val') ?? firstChild(dPr, 'endChr')?.getAttribute('val') ?? ')' : ')';
      const items = childElements(el).filter(c => c.localName === 'e').map(ommlChildren);
      return `${beg}${items.join(', ')}${end}`;
    }
    case 'nary': {
      const naryPr = firstChild(el, 'naryPr');
      const chrEl = naryPr ? firstChild(naryPr, 'chr') : undefined;
      const op = chrEl?.getAttribute('m:val') ?? chrEl?.getAttribute('val') ?? '∫';
      const sub = firstChild(el, 'sub');
      const sup = firstChild(el, 'sup');
      const e = firstChild(el, 'e');
      const subT = sub ? ommlChildren(sub).trim() : '';
      const supT = sup ? ommlChildren(sup).trim() : '';
      return `${op}${subT ? `_${subT}` : ''}${supT ? `^${supT}` : ''} ${e ? ommlChildren(e) : ''}`;
    }
    case 'func': {
      const name = firstChild(el, 'fName');
      const e = firstChild(el, 'e');
      return `${name ? ommlChildren(name) : ''}(${e ? ommlChildren(e) : ''})`;
    }
    case 'm': {
      const rows = childElements(el)
        .filter(c => c.localName === 'mr')
        .map(mr => childElements(mr).filter(c => c.localName === 'e').map(ommlChildren).join(', '));
      return `[${rows.join('; ')}]`;
    }
    case 'fPr': case 'rPr': case 'radPr': case 'dPr': case 'naryPr': case 'sSupPr': case 'sSubPr':
    case 'sSubSupPr': case 'mPr': case 'funcPr': case 'ctrlPr': case 'oMathParaPr':
      return '';
    default:
      return ommlChildren(el);
  }
}

/** DOCX OMML 요소(`<m:oMath>` / `<m:oMathPara>`)를 가독 텍스트로 변환한다. */
export function ommlToText(el: Element): string {
  return ommlNode(el).replace(/\s+/g, ' ').trim();
}
