/**
 * 브리핑 대상 범위(N1 · 사용자 설정).
 *
 * ★ 모델을 부르지 않는다. 범위 판정은 사실 판정이라 매번 같은 답이 나와야 하고,
 *   "왜 걸러졌는가"를 한 줄로 댈 수 있어야 한다. 규칙이 이긴다.
 *
 * ★ 걸러진 문서를 버리지 않는다. 원장에 `filtered`로 남긴다 — 나중에 키워드를 넓혔을 때
 *   지난 문서를 되살릴 수 있어야 하고, 몇 건을 걸렀는지 화면에 보여야 사용자가 필터를 믿는다.
 */

import { normalizeForMatch } from '@/lib/onnara/document-list';
import type { InboxRow } from './types';

export type InboxScopeField = 'title' | 'sender' | 'department';
export const INBOX_SCOPE_FIELDS: readonly InboxScopeField[] = ['title', 'sender', 'department'];

export interface InboxScope {
  scope: 'all' | 'keywords';
  /** 포함 키워드(하나라도 걸리면 대상). 비어 있으면 전체와 같다. */
  keywords: string[];
  /** 제외 키워드. **포함보다 우선한다** — 범위를 좁히는 쪽이 사용자의 마지막 의사다. */
  exclude: string[];
  /** 어느 칸을 대조할 것인가. */
  fields: InboxScopeField[];
}

export interface ScopeVerdict {
  included: boolean;
  /** 걸린 키워드. 화면에 그대로 보인다. */
  hit?: string;
  reason: string;
}

/** 한 글자 키워드는 받지 않는다. 변별력이 없어 목록 전체가 걸린다. */
function usable(keyword: string): boolean {
  return normalizeForMatch(keyword).length >= 2;
}

function haystack(row: InboxRow, fields: InboxScopeField[]): string {
  const parts = fields.length ? fields : INBOX_SCOPE_FIELDS;
  return normalizeForMatch(parts.map(field => row[field] ?? '').join(' '));
}

function firstHit(text: string, keywords: string[]): string | undefined {
  return keywords.filter(usable).find(keyword => text.includes(normalizeForMatch(keyword)));
}

/**
 * 이 문서가 브리핑 대상인가.
 *
 * ★ 제외가 먼저다. `전체`로 두고 특정 낱말만 빼는 쓰임이 실제로 가장 흔하다.
 */
export function matchScope(row: InboxRow, scope: InboxScope): ScopeVerdict {
  const text = haystack(row, scope.fields);

  const excluded = firstHit(text, scope.exclude);
  if (excluded) return { included: false, hit: excluded, reason: `제외 키워드 "${excluded}"` };

  if (scope.scope === 'all') return { included: true, reason: '전체 문서' };

  const usableKeywords = scope.keywords.filter(usable);
  // ★ 키워드 범위인데 키워드가 하나도 없으면 전부 걸러진다 — 사용자가 의도한 적 없는 결과다.
  //   설정이 비어 있는 동안에는 전체로 본다.
  if (!usableKeywords.length) return { included: true, reason: '키워드가 비어 있어 전체를 봅니다' };

  const hit = firstHit(text, usableKeywords);
  return hit
    ? { included: true, hit, reason: `키워드 "${hit}"` }
    : { included: false, reason: '설정한 키워드가 들어 있지 않습니다' };
}
