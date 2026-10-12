/**
 * 눈치코치 브리지 호출.
 *
 * ★ 모든 요청이 여기를 지난다. 시간 제한·취소·오류 분류를 한곳에 둔다.
 * ★ 확장 페이지에서 바로 부른다. host 권한이 있어 CORS를 거치지 않고, 브라우저가
 *   `Origin: chrome-extension://<ID>`를 붙인다 — 눈치코치는 그 ID로 연결을 대조한다.
 * ★ 401을 받으면 토큰을 지운다. 눈치코치에서 연결을 해제했거나 확장 ID가 바뀐 것이다.
 * ★ 계약의 기준은 Nunchi_Coach `docs/온나라_연동_구현계획서_2026-10-12.md` §6이다.
 *   오류의 `message`는 눈치코치가 사용자에게 보여도 되게 쓴 한글이라 그대로 전한다.
 */

import { t } from '@/lib/i18n';
import { abortable } from '@/lib/async';
import { forgetNunchiToken, isNunchiPaired, type NunchiConnection, type NunchiScope } from './connection';

export interface NunchiStatus {
  app: string;
  apiVersion: number;
  appVersion: string;
  /** 보낸 토큰을 눈치코치가 알고 있는가. 토큰 없이 물으면 항상 false다. */
  paired: boolean;
  scopes?: NunchiScope[];
  /** 눈치코치에서 지금 열어 둔 인수인계 이름. 시작 화면에 있으면 없다. */
  project?: string;
}

export interface NunchiPairResult {
  token: string;
  clientId: string;
  scopes: NunchiScope[];
  apiVersion: number;
}

/** 클라이언트가 붙이는 코드. 나머지 코드는 브리지가 준 것을 그대로 옮긴다. */
export type NunchiClientCode = 'not_paired' | 'unreachable' | 'timeout' | 'aborted' | 'bad_response';

export class NunchiError extends Error {
  readonly code: NunchiClientCode | string;
  readonly status: number | null;

  constructor(code: NunchiClientCode | string, message: string, status: number | null = null) {
    super(message);
    this.name = 'NunchiError';
    this.code = code;
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** false면 토큰을 붙이지 않는다(상태 확인·페어링). */
  auth?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function nunchiRequest<T>(connection: NunchiConnection, path: string, options: RequestOptions = {}): Promise<T> {
  const auth = options.auth ?? true;
  if (auth && !isNunchiPaired(connection)) throw new NunchiError('not_paired', t('nunchi.err.notPaired'));
  if (options.signal?.aborted) throw new NunchiError('aborted', t('nunchi.err.aborted'));

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const relay = () => controller.abort();
  options.signal?.addEventListener('abort', relay, { once: true });

  const headers: Record<string, string> = {};
  if (auth && connection.token) headers.Authorization = `Bearer ${connection.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const response = await abortable(fetch(`${connection.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    }), controller.signal);

    let payload: unknown = null;
    try { payload = await abortable(response.json(), controller.signal); }
    catch (error) { if (controller.signal.aborted) throw error; }

    if (!response.ok) {
      const body = payload && typeof payload === 'object' ? payload as { code?: unknown; message?: unknown } : {};
      const code = typeof body.code === 'string' ? body.code : `http_${response.status}`;
      const message = typeof body.message === 'string' && body.message ? body.message : t('nunchi.err.http', { status: response.status });
      if (code === 'unauthorized' && auth) await forgetNunchiToken().catch(() => undefined);
      throw new NunchiError(code, message, response.status);
    }
    if (payload === null || typeof payload !== 'object') throw new NunchiError('bad_response', t('nunchi.err.badResponse'), response.status);
    return payload as T;
  } catch (error) {
    if (options.signal?.aborted) throw new NunchiError('aborted', t('nunchi.err.aborted'));
    if (timedOut) throw new NunchiError('timeout', t('nunchi.err.timeout'));
    if (error instanceof NunchiError) throw error;
    throw new NunchiError('unreachable', t('nunchi.err.unreachable'));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', relay);
  }
}

/**
 * 상태 확인. 토큰이 있으면 붙인다 — 붙이면 권한과 열린 인수인계까지 받는다.
 *
 * ★ 응답이 눈치코치의 것인지 확인한다. 같은 포트에 다른 프로그램이 떠 있을 수 있다.
 */
export async function getNunchiStatus(connection: NunchiConnection, signal?: AbortSignal): Promise<NunchiStatus> {
  const status = await nunchiRequest<NunchiStatus>(connection, '/bridge/v1/status', {
    auth: isNunchiPaired(connection), timeoutMs: 4_000, ...(signal ? { signal } : {}),
  });
  if (status.app !== 'nunchi-coach' || typeof status.apiVersion !== 'number') {
    throw new NunchiError('bad_response', t('nunchi.err.badResponse'));
  }
  return status;
}

export interface NunchiAnnouncement {
  runId: string;
  /** queued: 눈치코치가 사용자에게 물을 차례 · asked: 묻는 중 · imported · dismissed · failed */
  state: string;
  documents: number;
  files: number;
  project?: string | null;
}

/**
 * 꾸러미가 준비됐다고 알린다. 눈치코치는 받아 두고 사용자에게 등록할지 묻는다.
 *
 * ★ 보내는 것은 실행 ID와 꾸러미 폴더 경로뿐이다. 파일은 보내지 않는다.
 */
export function announcePackage(connection: NunchiConnection, input: { runId: string; path: string }, signal?: AbortSignal): Promise<NunchiAnnouncement> {
  return nunchiRequest<NunchiAnnouncement>(connection, '/bridge/v1/packages', { method: 'POST', body: input, ...(signal ? { signal } : {}) });
}

/**
 * 눈치코치에서 열어 둔 인수인계가 이미 온전히 가진 문서(본문을 받았고 빠진 파일이 없는 것)의 식별자.
 *
 * ★ `origin`은 온나라 주소다. 같은 식별자라도 다른 온나라의 문서는 가진 것으로 치지 않는다.
 */
export async function knownDocuments(connection: NunchiConnection, input: { origin: string; ids: string[] }, signal?: AbortSignal): Promise<Set<string>> {
  const result = await nunchiRequest<{ known?: unknown }>(connection, '/bridge/v1/known', { method: 'POST', body: input, ...(signal ? { signal } : {}) });
  return new Set(Array.isArray(result.known) ? result.known.filter((id): id is string => typeof id === 'string') : []);
}

/** 연결 코드로 토큰을 받는다. 눈치코치는 코드가 맞으면 곧바로 답한다(허용 확인 창이 없다). */
export async function pairNunchi(connection: NunchiConnection, code: string, label: string, signal?: AbortSignal): Promise<NunchiPairResult> {
  const result = await nunchiRequest<NunchiPairResult>(connection, '/bridge/v1/pair', {
    method: 'POST',
    body: { code: code.replace(/\s+/g, ''), label },
    auth: false,
    ...(signal ? { signal } : {}),
  });
  if (typeof result.token !== 'string' || typeof result.clientId !== 'string' || !Array.isArray(result.scopes)) {
    throw new NunchiError('bad_response', t('nunchi.err.badResponse'));
  }
  return result;
}
