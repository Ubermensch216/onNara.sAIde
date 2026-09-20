/**
 * 문서 분석 결과 캐시 (B1). 계획서 §4.1 "문서 정체성 키" · §4.2
 *
 * ★ 왜 필요한가.
 *   `/요약`·`/조치`는 문서 한 건에 프리필 약 15초 + 생성 수십 초를 쓴다. 온나라 업무는
 *   목록과 문서를 오가는 일이 잦아 같은 공문을 다시 분석하는 일이 흔한데, 지금까지는
 *   그때마다 같은 값을 다시 치렀다.
 *
 * ★ 무엇을 키로 삼는가.
 *   계획서의 `DocumentKey`는 온나라 문서 ID를 쓰지만, 그 값은 실 화면 표본(P0-5)이
 *   확보되어야 읽을 수 있다. 지금 확실히 손에 쥔 것은 **목록 이름 + 문서 제목 + 보고일자**다.
 *   이 셋을 정체성으로 삼고, 본문 해시(`bodyRevision`)를 따로 둔다.
 *
 * ★ 본문을 읽기 전에는 캐시를 쓰지 않는다.
 *   제목만 같고 본문이 바뀐 공문(정정·재통보)에 지난 요약을 보여 주면, 이 프로젝트가
 *   배지와 원문 대조로 지켜 온 원칙이 무너진다. 그래서 **본문은 언제나 읽고**, 본문 해시가
 *   같을 때만 모델 호출을 건너뛴다. 아끼는 것은 비싼 쪽(모델)이다.
 *
 * ★ 모델·지시문이 다르면 다른 결과다. 키에 함께 넣는다.
 */

import { db } from '@/lib/storage/db';
import type { TaskCandidate } from '@/lib/schedule/candidates';

/** 보관할 최대 건수. 넘치면 오래된 것부터 버린다. */
export const MAX_DOC_RESULTS = 300;

export interface DocResult {
  /** `identity::command::variant` — 같은 조건이면 같은 자리에 덮어쓴다. */
  key: string;
  identity: string;
  command: string;
  /** 본문 정규화 해시. 이 값이 다르면 다른 판본이라 재사용하지 않는다. */
  bodyRevision: string;
  model: string;
  /** 화면에 그대로 다시 보여 줄 답변 문자열. */
  content: string;
  /** 핵심·조치사항에서 나온 일정 후보. 카드까지 그대로 복원한다. */
  taskCandidates?: TaskCandidate[];
  sourceDoc?: { title: string; url?: string };
  createdAt: number;
}

export interface DocIdentityInput {
  /** 목록 이름(접수대기함·문서등록대장 등). 없으면 상세 화면 한 건이다. */
  listName?: string | undefined;
  title: string;
  /** 보고일자. 같은 제목의 공문을 해마다 받는 업무가 많아 정체성에 넣는다. */
  reportDate?: string | undefined;
}

/**
 * 문서 정체성 키. 온나라 문서 ID를 읽을 수 있게 되면 이 함수만 바꾼다.
 *
 * ★ 공백·괄호 표기가 화면마다 달라 그대로 쓰면 같은 문서가 둘로 갈린다. 낮춰 쓰고 공백을 접는다.
 */
export function documentIdentity(input: DocIdentityInput): string {
  const parts = [input.listName ?? '', input.title, input.reportDate ?? '']
    .map(part => part.replace(/\s+/g, ' ').trim().toLowerCase());
  return parts.join('|');
}

/**
 * 본문 판본 해시.
 *
 * ★ 32비트 하나로는 수백 건에서도 충돌이 남는다. 서로 다른 오프셋 basis로 두 번 돌려
 *   64비트 문자열로 만든다. 암호학적 용도가 아니라 "같은 본문인가"만 가린다.
 */
export function bodyRevision(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return `${fnv1a(normalized, 0x811c9dc5)}${fnv1a(normalized, 0x01000193)}`;
}

function fnv1a(text: string, basis: number): string {
  let hash = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

export interface DocResultLookup {
  identity: string;
  command: string;
  /** 명령 뒤에 붙인 추가 지시. 다르면 다른 결과다. */
  instruction: string;
  model: string;
}

/** 같은 조건의 결과가 어느 자리에 저장되는가. */
export function docResultKey(lookup: DocResultLookup): string {
  return `${lookup.identity}::${lookup.command}::${fnv1a(`${lookup.instruction}|${lookup.model}`, 0x811c9dc5)}`;
}

/**
 * 재사용할 수 있는 결과를 찾는다. 본문 판본이 다르면 **없는 것으로 친다** —
 * 지난 판본을 보여 주느니 다시 분석하는 편이 맞다.
 */
export async function readDocResult(
  lookup: DocResultLookup,
  revision: string,
): Promise<DocResult | null> {
  try {
    const row = await db.docResults.get(docResultKey(lookup));
    return row && row.bodyRevision === revision ? row : null;
  } catch {
    // 저장소를 못 쓰면 캐시가 없는 것과 같다. 분석은 그대로 진행된다.
    return null;
  }
}

export async function saveDocResult(
  lookup: DocResultLookup,
  entry: Omit<DocResult, 'key' | 'identity' | 'command' | 'model' | 'createdAt'> & { createdAt?: number },
): Promise<void> {
  const row: DocResult = {
    key: docResultKey(lookup),
    identity: lookup.identity,
    command: lookup.command,
    model: lookup.model,
    createdAt: entry.createdAt ?? Date.now(),
    bodyRevision: entry.bodyRevision,
    content: entry.content,
    ...(entry.taskCandidates?.length ? { taskCandidates: entry.taskCandidates } : {}),
    ...(entry.sourceDoc ? { sourceDoc: entry.sourceDoc } : {}),
  };
  try {
    await db.docResults.put(row);
    await pruneDocResults();
  } catch { /* 저장 실패는 다음 분석을 한 번 더 하게 만들 뿐이다 */ }
}

/** 상한을 넘으면 오래된 것부터 지운다. 지운 건수를 돌려준다. */
export async function pruneDocResults(max = MAX_DOC_RESULTS): Promise<number> {
  const total = await db.docResults.count();
  if (total <= max) return 0;
  const stale = await db.docResults.orderBy('createdAt').limit(total - max).primaryKeys();
  await db.docResults.bulkDelete(stale);
  return stale.length;
}

export interface DocResultStats {
  entries: number;
  oldestAt: number | null;
}

export async function docResultStats(): Promise<DocResultStats> {
  try {
    const rows = await db.docResults.toArray();
    return { entries: rows.length, oldestAt: rows.length ? Math.min(...rows.map(row => row.createdAt)) : null };
  } catch {
    return { entries: 0, oldestAt: null };
  }
}

export async function clearDocResults(): Promise<void> {
  try { await db.docResults.clear(); } catch { /* 지울 것이 없거나 저장소가 없다 */ }
}
