/**
 * 페이지 기억 — 임베딩 저장과 검색. 계획서 §5 Phase 6-1 / 6-2
 *
 * ★ 무엇을 기억하는가: **sAIde가 이미 읽은 페이지만.**
 *
 *   계획서는 "방문 페이지"라고 썼지만, 이 확장의 구조에서는 불가능하다.
 *   모든 방문을 잡으려면 `<all_urls>` 상시 주입이 필요한데, 그것은 설계
 *   결정 ②(상시 주입 금지)를 정면으로 뒤집는다. 기억 기능 하나를 위해
 *   확장 전체의 권한 모델을 바꾸는 것은 값이 맞지 않는다.
 *
 *   그래서 사용자가 "이 페이지 요약" 등으로 **이미 읽힌 페이지**만 남긴다.
 *   부수적으로 프라이버시 이야기가 훨씬 정직해진다 — 사용자가 sAIde에게
 *   보여준 것만 기억한다.
 *
 * ★ 벡터는 저장 시점에 정규화한다.
 *   그러면 코사인 유사도가 내적 하나로 끝난다. 검색은 자주, 저장은 드물다.
 *
 * ★ 한 페이지는 여러 조각(청크)으로 나뉜다.
 *   페이지 하나를 벡터 하나로 뭉개면 긴 문서에서 검색이 무의미해진다.
 *   다만 조각 수에 상한을 둔다 — CPU 임베딩이라 무한정 늘릴 수 없다.
 */

import { db } from '@/lib/storage/db';
import { estimateTokens } from '@/lib/extract/budget';

/** 한 조각에 담을 대략의 토큰. bge-m3는 여유가 있지만 검색 정밀도를 위해 짧게 쥔다. */
export const CHUNK_TOKENS = 400;
/** 페이지당 조각 상한. 4 × 400 = 1,600토큰이면 본문 예산(2,000)과 비슷한 규모다. */
export const MAX_CHUNKS = 4;
/** bge-m3의 차원. 다른 모델로 바꾸면 기존 벡터와 섞이면 안 된다. */
export const EMBED_DIM = 1024;

export interface PageVector {
  id: number;
  url: string;
  title: string;
  /** 이 조각의 원문. 검색 결과로 사람과 모델에게 보여줄 것이다. */
  text: string;
  /** 같은 페이지 안에서의 순서. 0부터. */
  chunk: number;
  /** 정규화된 임베딩. */
  vector: Float32Array;
  /** 어느 모델로 만든 벡터인지. 모델이 바뀌면 비교가 무의미하다. */
  model: string;
  visitedAt: number;
}

/** db.ts가 선언한 테이블에 타입을 입힌다. 스키마 자체는 거기 있다. */
function table() {
  return db.table<PageVector, number>('pageVectors');
}

export interface MemoryControl {
  id: 'policy'; epoch: number; enabled?: boolean; excluded?: string[];
}
const policyTable = () => db.table<MemoryControl, string>('memoryControl');
export async function memoryEpoch(): Promise<number> { return (await policyTable().get('policy'))?.epoch ?? 0; }

/** Serialized in IndexedDB across all extension documents, including a panel closing mid-embed. */
export async function updateMemoryPolicy(patch: { enabled?: boolean; excluded?: string[] } = {}): Promise<void> {
  await db.transaction('rw', policyTable(), async () => {
    const old = await policyTable().get('policy');
    await policyTable().put({ ...old, ...patch, id: 'policy', epoch: (old?.epoch ?? 0) + 1 });
  });
}
function domainMatches(host: string, raw: string): boolean {
  const domain = raw.trim().toLowerCase().replace(/^\.+/, '').replace(/\.$/, '');
  const normalizedHost = host.toLowerCase().replace(/\.$/, '');
  return !!domain && (normalizedHost === domain || normalizedHost.endsWith(`.${domain}`));
}

/* ── 조각내기 ──────────────────────────────────────────── */

/**
 * 문단 경계를 지키며 자른다.
 *
 * ★ 문장 한가운데를 자르면 그 조각의 임베딩이 무엇을 뜻하는지 흐려진다.
 *   문단이 예산보다 크면 그때만 강제로 자른다.
 */
export function chunkText(text: string, chunkTokens = CHUNK_TOKENS, max = MAX_CHUNKS): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  let buf = '';

  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };

  for (const para of paras) {
    if (out.length >= max) break;

    if (estimateTokens(para) > chunkTokens) {
      flush();
      // 문단 하나가 예산을 넘는다. 이때만 길이로 자른다.
      const perChunk = Math.max(1, Math.round(para.length / Math.ceil(estimateTokens(para) / chunkTokens)));
      for (let i = 0; i < para.length && out.length < max; i += perChunk) {
        out.push(para.slice(i, i + perChunk).trim());
      }
      continue;
    }

    if (estimateTokens(buf + para) > chunkTokens) flush();
    buf = buf ? `${buf}\n\n${para}` : para;
  }
  if (out.length < max) flush();

  return out.slice(0, max).filter(Boolean);
}

/* ── 벡터 ──────────────────────────────────────────────── */

/**
 * 길이 1로 맞춘다. 영벡터는 그대로 둔다 — 0으로 나누느니 유사도 0이 낫다.
 */
export function normalize(v: number[] | Float32Array): Float32Array {
  if (!v.length || [...v].some(n => !Number.isFinite(n))) return new Float32Array(0);
  const out = new Float32Array(v.length);
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const len = Math.sqrt(sum);
  if (len === 0) return out;
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / len;
  return out;
}

/** 정규화된 벡터끼리의 코사인 유사도 = 내적. */
export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  const n = a.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

/* ── 저장 ──────────────────────────────────────────────── */

export interface SavePageInput {
  url: string;
  title: string;
  chunks: string[];
  /** chunks와 같은 순서·같은 길이. */
  vectors: number[][];
  model: string;
  visitedAt?: number;
}

/**
 * 페이지 하나를 저장한다. **같은 URL의 이전 기록은 지운다.**
 *
 * ★ 덮어쓰는 이유: 같은 페이지를 두 번 읽으면 검색 결과가 그 페이지로
 *   가득 찬다. 게다가 내용이 바뀌었다면 옛 조각은 이미 틀린 정보다.
 */
export async function savePage(input: SavePageInput, expectedEpoch?: number, canSave = () => true): Promise<number> {
  const dim = input.vectors[0]?.length ?? 0;
  if (input.chunks.length !== input.vectors.length || (input.chunks.length && (!dim || input.vectors.some(v => v.length !== dim || v.some(n => !Number.isFinite(n)))))) {
    throw new Error('유효하지 않은 임베딩 벡터입니다.');
  }
  const visitedAt = input.visitedAt ?? Date.now();
  const rows = input.chunks.map((text, chunk) => ({
    url: input.url,
    title: input.title,
    text,
    chunk,
    vector: normalize(input.vectors[chunk] ?? []),
    model: input.model,
    visitedAt,
  })) as PageVector[];

  return db.transaction('rw', table(), policyTable(), async () => {
    const policy = await policyTable().get('policy');
    if (expectedEpoch !== undefined && ((policy?.epoch ?? 0) !== expectedEpoch || policy?.enabled === false || !shouldRemember(input.url, policy?.excluded ?? []))) return 0;
    if (!canSave()) return 0;
    await table().where('url').equals(input.url).delete();
    if (rows.length) await table().bulkAdd(rows);
    return rows.length;
  });
}

/* ── 검색 ──────────────────────────────────────────────── */

export interface SearchHit {
  url: string;
  title: string;
  text: string;
  score: number;
  visitedAt: number;
}

/**
 * 코사인 유사도 상위 N건. 계획서 6-2의 완료 기준은 상위 5건이다.
 *
 * ★ 전량 스캔이다. IndexedDB에 벡터 인덱스는 없고, 이 규모(수천 조각)에서는
 *   1024차원 내적 수천 번이 수 밀리초다. ANN 색인을 들일 이유가 없다.
 *
 * ★ 같은 URL은 가장 잘 맞는 조각 하나만 남긴다. 그러지 않으면 상위 5건이
 *   한 페이지의 조각 다섯 개로 채워진다.
 */
export async function search(
  queryVector: number[] | Float32Array,
  limit = 5,
  model?: string,
  policy: { retentionDays?: number; excluded?: string[]; minScore?: number } = {},
): Promise<SearchHit[]> {
  const q = normalize(queryVector);
  // ★ 영벡터는 "빈 질의"다. 길이만 보면 0으로 채워진 벡터를 놓치고, 그러면
  //   모든 기록이 점수 0으로 나와 아무 뜻 없는 순서가 상위 5건이 된다.
  if (dot(q, q) === 0) return [];

  const best = new Map<string, SearchHit>();
  await table().each((row) => {
    // 다른 모델로 만든 벡터와는 비교하지 않는다. 좌표계가 다르다.
    if (model && row.model !== model) return;
    if (row.vector.length !== q.length || !shouldRemember(row.url, policy.excluded ?? [])) return;
    if (policy.retentionDays && row.visitedAt < Date.now() - policy.retentionDays * 86_400_000) return;
    const score = dot(q, row.vector);
    if (!Number.isFinite(score) || score < (policy.minScore ?? -1)) return;
    const prev = best.get(row.url);
    if (!prev || score > prev.score) {
      best.set(row.url, {
        url: row.url,
        title: row.title,
        text: row.text,
        score,
        visitedAt: row.visitedAt,
      });
    }
  });

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ── 통제 (계획서 6-3 / 6-4) ───────────────────────────── */

/**
 * 보관 기간이 지난 것을 지운다. 0이면 무기한이라 아무것도 지우지 않는다.
 * 지운 조각 수를 돌려준다.
 */
export async function prune(retentionDays: number, now = Date.now()): Promise<number> {
  if (retentionDays <= 0) return 0;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  return table().where('visitedAt').below(cutoff).delete();
}

/** 특정 도메인의 기록을 지운다. 제외 목록에 추가할 때 함께 부른다. */
export async function forgetDomain(domain: string): Promise<number> {
  return db.transaction('rw', table(), policyTable(), async () => {
    await updateMemoryPolicy();
    return table().filter(r => domainMatches(hostOf(r.url), domain)).delete();
  });
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', table(), policyTable(), async () => {
    await updateMemoryPolicy();
    await table().clear();
  });
}

export interface MemoryStats {
  pages: number;
  chunks: number;
  oldestAt: number | null;
}

export async function stats(): Promise<MemoryStats> {
  const rows = await table().toArray();
  const urls = new Set(rows.map((r) => r.url));
  return {
    pages: urls.size,
    chunks: rows.length,
    oldestAt: rows.length ? Math.min(...rows.map((r) => r.visitedAt)) : null,
  };
}

/* ── 저장 대상 판정 ────────────────────────────────────── */

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 이 URL을 기억해도 되는가.
 *
 * ★ 제외 도메인은 **서브도메인까지** 막는다. 사용자가 `example.com`을
 *   적었는데 `mail.example.com`이 그대로 저장되면 통제가 아니다.
 *
 * ★ http/https가 아닌 것은 저장하지 않는다. 로컬 파일 경로 등이 기록으로
 *   남는 것은 사용자가 기대하는 바가 아니다.
 */
export function shouldRemember(url: string, excluded: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (!/^https?:$/.test(safeProtocol(url))) return false;

  return !excluded.some(raw => domainMatches(host, raw));
}

function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}
