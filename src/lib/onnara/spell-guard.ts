/**
 * 맞춤법 교정 결과 보호 모듈.
 *
 * AI 맞춤법 교정은 종종 소제목("1. 보고 배경 및 목적")을 지우거나, 항목 기호·줄 구성을 바꾸거나,
 * 문장을 새로 덧붙인다. 맞춤법 검사는 "글자만 고치는" 작업이어야 하므로,
 * 원문의 줄 구성을 기준으로 AI 결과를 다시 맞춰 넣는다.
 *
 *  - 원문의 줄 수·순서·빈 줄은 그대로 둔다.
 *  - 원문 줄과 충분히 닮은 교정 줄이 있을 때만 그 줄의 '내용'을 교정본으로 바꾼다.
 *  - 줄 앞의 들여쓰기와 항목 기호(1. 가. (1) - · 등)는 원문 것을 쓴다.
 *  - 짝이 없는 원문 줄(AI가 지운 소제목 등)은 원문 그대로 남긴다.
 *  - AI가 새로 만든 줄, 내용이 크게 줄거나 늘어난 줄은 버린다.
 */

/** 줄 앞 들여쓰기 + 공문서 항목 기호(+ 뒤 공백). 기호가 없으면 들여쓰기만 잡힌다. */
const LINE_PREFIX = /^(\s*)((?:\d{1,2}\.|[가-하]\.|\(\d{1,2}\)|\([가-하]\)|\d{1,2}\)|[가-하]\)|[①-⑳]|[-·•※○□■◦▪∙ㆍ])\s*)?/;

/** 비교·표시 전에 쓰는 정규화: 한글 조합형 → 완성형, 보이지 않는 문자 제거, 특수 공백 → 일반 공백. */
export function normalizeSpellText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[   　]/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function core(text: string): string {
  return text.replace(/\s+/g, '');
}

function bigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const g = text.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}

/** 두 줄의 닮은 정도(0~1). 공백은 무시한다(띄어쓰기 교정은 닮은 것으로 본다). */
export function lineSimilarity(a: string, b: string): number {
  const x = core(a);
  const y = core(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  if (x.length < 2 || y.length < 2) return 0;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let shared = 0;
  for (const [g, n] of gx) shared += Math.min(n, gy.get(g) ?? 0);
  return (2 * shared) / (x.length - 1 + y.length - 1);
}

const MATCH_THRESHOLD = 0.5;

/** 원문 줄 하나에 교정 줄을 맞춰 넣는다. 받아들일 수 없으면 원문 줄을 돌려준다. */
function mergeLine(original: string, corrected: string): string {
  const origPrefix = original.match(LINE_PREFIX)?.[0] ?? '';
  const origBody = original.slice(origPrefix.length);
  const origTrailing = origBody.match(/\s*$/)?.[0] ?? '';
  const origContent = origBody.slice(0, origBody.length - origTrailing.length);
  if (!core(origContent)) return original;

  const corrPrefix = corrected.match(LINE_PREFIX)?.[0] ?? '';
  const corrContent = corrected.slice(corrPrefix.length).trim();
  if (!corrContent) return original;

  // 맞춤법 교정으로는 내용이 크게 줄거나 늘지 않는다. 그런 줄은 내용이 바뀐 것으로 보고 버린다.
  const ratio = core(corrContent).length / core(origContent).length;
  if (ratio < 0.7 || ratio > 1.4) return original;

  return origPrefix + corrContent + origTrailing;
}

/**
 * AI 맞춤법 교정 결과를 원문 줄 구성에 맞춰 보호한다.
 * 반환값의 줄 수는 항상 원문과 같다.
 */
export function guardSpellcheckResult(original: string, corrected: string): string {
  const src = normalizeSpellText(original);
  const out = normalizeSpellText(corrected);
  const a = src.split('\n');
  const b = out.split('\n');
  const n = a.length;
  const m = b.length;

  // 순서를 지키는 줄 정렬: 닮은 정도의 합이 가장 큰 짝짓기를 찾는다.
  const sim: number[][] = a.map((la) => b.map((lb) => (core(la) ? lineSimilarity(la, lb) : 0)));
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const row = dp[i]!;
    const prev = dp[i - 1]!;
    for (let j = 1; j <= m; j++) {
      const s = sim[i - 1]![j - 1]!;
      row[j] = Math.max(prev[j]!, row[j - 1]!, s >= MATCH_THRESHOLD ? prev[j - 1]! + s : -Infinity);
    }
  }

  const matchOf = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const s = sim[i - 1]![j - 1]!;
    if (s >= MATCH_THRESHOLD && dp[i]![j] === dp[i - 1]![j - 1]! + s) {
      matchOf[i - 1] = j - 1;
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return a
    .map((line, idx) => {
      const k = matchOf[idx]!;
      return k >= 0 ? mergeLine(line, b[k]!) : line;
    })
    .join('\n');
}
