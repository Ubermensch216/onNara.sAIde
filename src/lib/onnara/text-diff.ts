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

/** 교정 항목 단위로 묶은 Diff. 'change' 하나가 사용자가 받아들이거나 제외할 수 있는 교정 하나다. */
export type DiffSegment =
  | { kind: 'same'; text: string }
  | { kind: 'change'; id: number; removed: string; added: string };

type CharOp = { t: 'eq' | 'del' | 'ins'; ch: string };

/** 글자 단위 LCS 편집 순서. 너무 크면 null. */
function charOps(a: string, b: string): CharOp[] | null {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > 2_500_000) return null;
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const ops: CharOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: 'eq', ch: a[i]! });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) {
      ops.push({ t: 'del', ch: a[i++]! });
    } else {
      ops.push({ t: 'ins', ch: b[j++]! });
    }
  }
  while (i < n) ops.push({ t: 'del', ch: a[i++]! });
  while (j < m) ops.push({ t: 'ins', ch: b[j++]! });
  return ops;
}

/**
 * 글자 단위로 비교한 뒤 낱말(공백으로 나뉜 덩어리) 단위로 교정 항목을 묶는다.
 * "감똥과"→"감동과"는 낱말 하나, "문장 입니다"→"문장입니다"(띄어쓰기)도 항목 하나가 된다.
 */
function wordSegments(ops: CharOp[], out: DiffSegment[], nextId: () => number) {
  let k = 0;
  while (k < ops.length) {
    const op = ops[k]!;
    // 양쪽에 똑같이 있는 공백은 낱말 경계다.
    if (op.t === 'eq' && /\s/.test(op.ch)) {
      out.push({ kind: 'same', text: op.ch });
      k++;
      continue;
    }
    let removed = '';
    let added = '';
    let changed = false;
    while (k < ops.length) {
      const cur = ops[k]!;
      if (cur.t === 'eq' && /\s/.test(cur.ch)) break;
      if (cur.t !== 'ins') removed += cur.ch;
      if (cur.t !== 'del') added += cur.ch;
      if (cur.t !== 'eq') changed = true;
      k++;
    }
    if (changed && removed !== added) out.push({ kind: 'change', id: nextId(), removed, added });
    else out.push({ kind: 'same', text: removed });
  }
}

function mergeSame(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (s.kind === 'same' && last?.kind === 'same') last.text += s.text;
    else merged.push(s.kind === 'same' ? { ...s } : s);
  }
  return merged;
}

/** 원문 대비 바뀐 곳을 교정 항목(낱말 단위)으로 묶는다. */
export function computeDiffSegments(original: string, updated: string): DiffSegment[] {
  if (original === updated) return original ? [{ kind: 'same', text: original }] : [];
  let id = 0;
  const nextId = () => id++;
  const out: DiffSegment[] = [];
  const la = original.split('\n');
  const lb = updated.split('\n');
  if (la.length === lb.length) {
    // 줄 구성이 같으면(맞춤법 교정 결과는 늘 그렇다) 줄마다 비교한다.
    for (let i = 0; i < la.length; i++) {
      if (i > 0) out.push({ kind: 'same', text: '\n' });
      const a = la[i]!;
      const b = lb[i]!;
      if (a === b) {
        if (a) out.push({ kind: 'same', text: a });
        continue;
      }
      const ops = charOps(a, b);
      if (!ops) return tokenSegments(original, updated);
      wordSegments(ops, out, nextId);
    }
    return mergeSame(out);
  }
  const ops = charOps(original, updated);
  if (!ops) return tokenSegments(original, updated);
  wordSegments(ops, out, nextId);
  return mergeSame(out);
}

/** 큰 텍스트용: 토큰 Diff의 연속된 삭제·추가 조각을 하나의 교정 항목으로 묶는다. */
function tokenSegments(original: string, updated: string): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let id = 0;
  let pending: { removed: string; added: string } | null = null;
  const flush = () => {
    if (!pending) return;
    if (pending.removed === pending.added) {
      segments.push({ kind: 'same', text: pending.removed });
    } else {
      segments.push({ kind: 'change', id: id++, ...pending });
    }
    pending = null;
  };
  for (const part of computeTextDiff(original, updated)) {
    if (part.type === 'unchanged') {
      flush();
      segments.push({ kind: 'same', text: part.value });
    } else {
      pending ??= { removed: '', added: '' };
      if (part.type === 'removed') pending.removed += part.value;
      else pending.added += part.value;
    }
  }
  flush();
  return segments;
}

/** 제외한 교정 항목은 원문으로 되돌려 최종 텍스트를 만든다. */
export function composeFromSegments(segments: DiffSegment[], excluded: ReadonlySet<number>): string {
  return segments
    .map((s) => (s.kind === 'same' ? s.text : excluded.has(s.id) ? s.removed : s.added))
    .join('');
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
