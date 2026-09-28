/**
 * TONGDAL.ai 브리지 호출.
 *
 * ★ 모든 요청이 여기를 지난다. 시간 제한·취소·오류 분류를 한곳에 둔다.
 * ★ 확장 페이지(사이드패널·서랍·설정)에서 바로 부른다. host 권한이 있어 CORS를 거치지 않고,
 *   브라우저가 `Origin: chrome-extension://<ID>`를 붙인다 — TONGDAL은 그 ID로 페어링을 대조한다.
 * ★ 401을 받으면 토큰을 지운다. TONGDAL에서 연결을 해제했거나 확장 ID가 바뀐 것이고,
 *   남겨 두면 모든 화면이 같은 실패를 되풀이한다.
 */

import { t } from '@/lib/i18n';
import { forgetToken, isPaired, type TongdalConnection } from './connection';
import type {
  TongdalDocumentDetail,
  TongdalDocumentList,
  TongdalPairResult,
  TongdalSearchResult,
  TongdalShelf,
  TongdalStatus,
} from './types';

/** 클라이언트가 붙이는 코드. 나머지 코드는 브리지가 준 것을 그대로 옮긴다(docs/tongdal-bridge-api.md §4). */
export type TongdalClientCode = 'not_paired' | 'unreachable' | 'timeout' | 'aborted' | 'bad_response';

export class TongdalError extends Error {
  readonly code: TongdalClientCode | string;
  readonly status: number | null;

  constructor(code: TongdalClientCode | string, message: string, status: number | null = null) {
    super(message);
    this.name = 'TongdalError';
    this.code = code;
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** 0이면 시간 제한 없음. 페어링은 사용자가 TONGDAL 창에서 허용을 누를 때까지 기다린다. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** false면 토큰을 붙이지 않는다(상태 확인·페어링). */
  auth?: boolean;
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function request<T>(connection: TongdalConnection, path: string, options: RequestOptions = {}): Promise<T> {
  const auth = options.auth ?? true;
  if (auth && !isPaired(connection)) throw new TongdalError('not_paired', t('tongdal.err.notPaired'));

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
  const relay = () => controller.abort();
  options.signal?.addEventListener('abort', relay, { once: true });

  const headers: Record<string, string> = {};
  if (auth && connection.token) headers.Authorization = `Bearer ${connection.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${connection.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    if (options.signal?.aborted) throw new TongdalError('aborted', t('tongdal.err.aborted'));
    if (timedOut) throw new TongdalError('timeout', t('tongdal.err.timeout'));
    throw new TongdalError('unreachable', t('tongdal.err.unreachable'));
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', relay);
  }

  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* 본문이 JSON이 아니면 아래에서 처리한다 */ }

  if (!response.ok) {
    const body = payload && typeof payload === 'object' ? payload as { code?: unknown; message?: unknown } : {};
    const code = typeof body.code === 'string' ? body.code : `http_${response.status}`;
    const message = typeof body.message === 'string' && body.message ? body.message : t('tongdal.err.http', { status: response.status });
    if (code === 'unauthorized' && auth) await forgetToken().catch(() => undefined);
    throw new TongdalError(code, message, response.status);
  }
  if (payload === null || typeof payload !== 'object') throw new TongdalError('bad_response', t('tongdal.err.badResponse'), response.status);
  return payload as T;
}

/** 상태 확인. 토큰이 있으면 붙인다 — 붙이면 지식 공간·엔진 상태까지 받는다. */
export function getStatus(connection: TongdalConnection, signal?: AbortSignal): Promise<TongdalStatus> {
  return request<TongdalStatus>(connection, '/bridge/v1/status', { auth: isPaired(connection), timeoutMs: 4_000, signal });
}

/** 연결 코드로 토큰을 받는다. TONGDAL 창의 허용 확인을 기다리므로 2분 넘게 걸릴 수 있다. */
export function pair(connection: TongdalConnection, code: string, label: string, signal?: AbortSignal): Promise<TongdalPairResult> {
  return request<TongdalPairResult>(connection, '/bridge/v1/pair', {
    method: 'POST',
    body: { code: code.replace(/\s+/g, ''), label },
    auth: false,
    timeoutMs: 150_000,
    signal,
  });
}

export function search(
  connection: TongdalConnection,
  input: { query: string; topK?: number; maxChars?: number },
  signal?: AbortSignal,
): Promise<TongdalSearchResult> {
  return request<TongdalSearchResult>(connection, '/bridge/v1/search', {
    method: 'POST',
    body: { query: input.query, topK: input.topK, maxChars: input.maxChars },
    timeoutMs: 25_000,
    signal,
  });
}

export function listShelves(connection: TongdalConnection, signal?: AbortSignal): Promise<{ shelves: TongdalShelf[] }> {
  return request(connection, '/bridge/v1/shelves', { signal });
}

export function listDocuments(
  connection: TongdalConnection,
  input: { shelfId?: string | null; query?: string; limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<TongdalDocumentList> {
  const params = new URLSearchParams();
  if (input.shelfId) params.set('shelfId', input.shelfId);
  if (input.query?.trim()) params.set('query', input.query.trim());
  if (input.limit) params.set('limit', String(input.limit));
  if (input.offset) params.set('offset', String(input.offset));
  const qs = params.toString();
  return request(connection, `/bridge/v1/documents${qs ? `?${qs}` : ''}`, { signal });
}

export function getDocument(
  connection: TongdalConnection,
  id: string,
  options: { includeText?: boolean; maxChars?: number } = {},
  signal?: AbortSignal,
): Promise<TongdalDocumentDetail> {
  const params = new URLSearchParams();
  if (options.includeText) params.set('includeText', '1');
  if (options.maxChars) params.set('maxChars', String(options.maxChars));
  const qs = params.toString();
  return request(connection, `/bridge/v1/documents/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`, { signal });
}

/** TONGDAL 창을 앞으로 가져와 그 문서를 연다. */
export async function openInTongdal(connection: TongdalConnection, documentId: string): Promise<void> {
  await request(connection, '/bridge/v1/open', { method: 'POST', body: { documentId } });
}
