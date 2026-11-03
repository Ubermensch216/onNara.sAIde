/**
 * 텍스트 교정 전후 차이(Diff) 계산 모듈.
 * 단어/토큰 단위 LCS(Longest Common Subsequence) 기반으로 변경 사항을 산출합니다.
 */

export interface DiffPart {
  type: 'added' | 'removed' | 'unchanged';
  value: string;
}

/** 텍스트를 단어 및 구분자(공백, 구두점 등) 단위 토큰으로 분할 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const regex = /(\s+|[a-zA-Z0-9가-힣]+|[^\s\w가-힣])/g;
  let match: RegExpExecArray | null = null;
  let lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token) {
      tokens.push(token);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

/** 두 토큰 배열의 LCS(Longest Common Subsequence) 기반 Diff 계산 */
export function computeTextDiff(original: string, updated: string): DiffPart[] {
  if (original === updated) {
    return [{ type: 'unchanged', value: original }];
  }
  if (!original) {
    return [{ type: 'added', value: updated }];
  }
  if (!updated) {
    return [{ type: 'removed', value: original }];
  }

  const s1 = tokenize(original);
  const s2 = tokenize(updated);

  // 긴 텍스트 성능 보호 (토큰 수 1200개 이상이면 줄 단위 diff로 대체)
  if (s1.length > 1200 || s2.length > 1200) {
    return computeLineDiff(original, updated);
  }

  const n = s1.length;
  const m = s2.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    if (!row || !prevRow) continue;
    const token1 = s1[i - 1];

    for (let j = 1; j <= m; j++) {
      const token2 = s2[j - 1];
      if (token1 !== undefined && token2 !== undefined && token1 === token2) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }

  const parts: DiffPart[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    const curVal = row?.[j] ?? 0;
    const leftVal = row?.[j - 1] ?? 0;
    const topVal = prevRow?.[j] ?? 0;

    const token1 = i > 0 ? s1[i - 1] : undefined;
    const token2 = j > 0 ? s2[j - 1] : undefined;

    if (i > 0 && j > 0 && token1 !== undefined && token2 !== undefined && token1 === token2) {
      parts.unshift({ type: 'unchanged', value: token1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || leftVal >= topVal)) {
      if (token2 !== undefined) {
        parts.unshift({ type: 'added', value: token2 });
      }
      j--;
    } else if (i > 0 && (j === 0 || leftVal < topVal)) {
      if (token1 !== undefined) {
        parts.unshift({ type: 'removed', value: token1 });
      }
      i--;
    } else {
      break;
    }
  }

  // 연속된 동일 타입 병합
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.type === part.type) {
      last.value += part.value;
    } else {
      merged.push({ ...part });
    }
  }

  return merged;
}

/** 줄 단위 Diff 계산 (대용량 텍스트 폴백) */
function computeLineDiff(original: string, updated: string): DiffPart[] {
  const l1 = original.split('\n');
  const l2 = updated.split('\n');
  const n = l1.length;
  const m = l2.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    if (!row || !prevRow) continue;
    const line1 = l1[i - 1];

    for (let j = 1; j <= m; j++) {
      const line2 = l2[j - 1];
      if (line1 !== undefined && line2 !== undefined && line1 === line2) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }

  const parts: DiffPart[] = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    const leftVal = row?.[j - 1] ?? 0;
    const topVal = prevRow?.[j] ?? 0;

    const line1 = i > 0 ? l1[i - 1] : undefined;
    const line2 = j > 0 ? l2[j - 1] : undefined;

    if (i > 0 && j > 0 && line1 !== undefined && line2 !== undefined && line1 === line2) {
      parts.unshift({ type: 'unchanged', value: line1 + (i < n ? '\n' : '') });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || leftVal >= topVal)) {
      if (line2 !== undefined) {
        parts.unshift({ type: 'added', value: line2 + (j < m ? '\n' : '') });
      }
      j--;
    } else if (i > 0 && (j === 0 || leftVal < topVal)) {
      if (line1 !== undefined) {
        parts.unshift({ type: 'removed', value: line1 + (i < n ? '\n' : '') });
      }
      i--;
    } else {
      break;
    }
  }

  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && last.type === part.type) {
      last.value += part.value;
    } else {
      merged.push({ ...part });
    }
  }

  return merged;
}
