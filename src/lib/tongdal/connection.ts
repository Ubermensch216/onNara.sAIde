/**
 * TONGDAL.ai 연결 정보(브리지 주소와 페어링 토큰).
 *
 * ★ 토큰은 이 PC의 TONGDAL.ai 지식 공간을 읽는 열쇠다. 그래서
 *   - 주소는 **이 PC(loopback)만** 받는다. 설정이 손상되거나 조작되어도 토큰이 다른 호스트로 나가지 않는다.
 *   - 전체 백업 파일에 담지 않는다(storage/backup.ts의 SECRET_KEYS). 백업 파일은 사용자가 들고 다니는 파일이다.
 *   - chrome.storage.local에만 둔다. sync는 다른 PC로 복제되고, 그 PC의 TONGDAL.ai와는 짝이 아니다.
 */

import type { TongdalScope } from './types';

export const TONGDAL_KEY = 'saide.tongdal';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * 브리지 기본 주소. 빌드 때 `WXT_TONGDAL_BRIDGE_URL`로 바꿀 수 있고, 사용자는 연동 설정에서 바꾼다.
 * TONGDAL 설정에서 포트를 바꿨다면 여기도 맞춰야 한다.
 */
export const DEFAULT_TONGDAL_URL =
  normalizeBridgeUrl((import.meta.env as Record<string, string | undefined> | undefined)?.WXT_TONGDAL_BRIDGE_URL)
  ?? 'http://127.0.0.1:47821';

export interface TongdalConnection {
  baseUrl: string;
  token: string | null;
  clientId: string | null;
  scopes: TongdalScope[];
  pairedAt: number | null;
}

export const EMPTY_CONNECTION: TongdalConnection = {
  baseUrl: DEFAULT_TONGDAL_URL,
  token: null,
  clientId: null,
  scopes: [],
  pairedAt: null,
};

/**
 * 브리지 주소를 정규화한다. `http://127.0.0.1:<포트>` 또는 `http://localhost:<포트>`만 받는다.
 * 받을 수 없는 값이면 null이다.
 */
export function normalizeBridgeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
    return `http://${url.hostname}:${port}`;
  } catch {
    return null;
  }
}

const SCOPES: readonly TongdalScope[] = ['read', 'write', 'delete'];

export function normalizeConnection(raw: unknown): TongdalConnection {
  const value = raw && typeof raw === 'object' ? raw as Partial<TongdalConnection> : {};
  const token = typeof value.token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value.token) ? value.token : null;
  return {
    baseUrl: normalizeBridgeUrl(value.baseUrl) ?? DEFAULT_TONGDAL_URL,
    token,
    clientId: token && typeof value.clientId === 'string' ? value.clientId : null,
    scopes: token && Array.isArray(value.scopes) ? [...new Set(value.scopes.filter((s): s is TongdalScope => SCOPES.includes(s as TongdalScope)))] : [],
    pairedAt: token && typeof value.pairedAt === 'number' ? value.pairedAt : null,
  };
}

export async function loadConnection(): Promise<TongdalConnection> {
  try {
    const stored = await chrome.storage.local.get(TONGDAL_KEY);
    return normalizeConnection(stored?.[TONGDAL_KEY]);
  } catch {
    return { ...EMPTY_CONNECTION };
  }
}

export async function saveConnection(next: TongdalConnection): Promise<TongdalConnection> {
  const normalized = normalizeConnection(next);
  await chrome.storage.local.set({ [TONGDAL_KEY]: normalized });
  return normalized;
}

/** 페어링을 푼다. 주소는 남긴다 — 다시 연결할 때 또 적지 않게. */
export async function forgetToken(): Promise<TongdalConnection> {
  const current = await loadConnection();
  return saveConnection({ ...EMPTY_CONNECTION, baseUrl: current.baseUrl });
}

export function isPaired(connection: TongdalConnection): connection is TongdalConnection & { token: string } {
  return Boolean(connection.token);
}

export function onConnectionChanged(callback: (connection: TongdalConnection) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[TONGDAL_KEY]) return;
    callback(normalizeConnection(changes[TONGDAL_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
