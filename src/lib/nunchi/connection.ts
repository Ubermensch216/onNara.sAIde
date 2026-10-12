/**
 * 눈치코치(Nunchi_Coach) 연결 정보(브리지 주소와 페어링 토큰).
 *
 * ★ TONGDAL.ai 연결(lib/tongdal/connection.ts)과 같은 약속을 지킨다.
 *   - 주소는 **이 PC(loopback)만** 받는다. 설정이 손상되거나 조작되어도 토큰이 다른 호스트로 나가지 않는다.
 *   - 전체 백업 파일에 담지 않는다(storage/backup.ts의 SECRET_KEYS).
 *   - chrome.storage.local에만 둔다. 다른 PC의 눈치코치와는 짝이 아니다.
 * ★ 두 연결은 저장 키도 토큰도 따로다. 한쪽을 풀어도 다른 쪽은 그대로다.
 */

import { normalizeBridgeUrl } from '@/lib/tongdal/connection';

export { normalizeBridgeUrl };

export const NUNCHI_KEY = 'saide.nunchi';
export const NUNCHI_API_VERSION = 1;

export type NunchiScope = 'read' | 'write';
const SCOPES: readonly NunchiScope[] = ['read', 'write'];

/** 눈치코치 브리지의 기본 주소. TONGDAL.ai(47821)와 다른 포트다. 눈치코치 설정에서 포트를 바꿨다면 여기도 맞춘다. */
export const DEFAULT_NUNCHI_URL =
  normalizeBridgeUrl((import.meta.env as Record<string, string | undefined> | undefined)?.WXT_NUNCHI_BRIDGE_URL)
  ?? 'http://127.0.0.1:47831';

export interface NunchiConnection {
  baseUrl: string;
  token: string | null;
  clientId: string | null;
  scopes: NunchiScope[];
  pairedAt: number | null;
}

export const EMPTY_NUNCHI: NunchiConnection = {
  baseUrl: DEFAULT_NUNCHI_URL,
  token: null,
  clientId: null,
  scopes: [],
  pairedAt: null,
};

export function normalizeNunchi(raw: unknown): NunchiConnection {
  const value = raw && typeof raw === 'object' ? raw as Partial<NunchiConnection> : {};
  const token = typeof value.token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value.token) ? value.token : null;
  return {
    baseUrl: normalizeBridgeUrl(value.baseUrl) ?? DEFAULT_NUNCHI_URL,
    token,
    clientId: token && typeof value.clientId === 'string' ? value.clientId : null,
    scopes: token && Array.isArray(value.scopes) ? [...new Set(value.scopes.filter((s): s is NunchiScope => SCOPES.includes(s as NunchiScope)))] : [],
    pairedAt: token && typeof value.pairedAt === 'number' ? value.pairedAt : null,
  };
}

export async function loadNunchi(): Promise<NunchiConnection> {
  try {
    const stored = await chrome.storage.local.get(NUNCHI_KEY);
    return normalizeNunchi(stored?.[NUNCHI_KEY]);
  } catch {
    return { ...EMPTY_NUNCHI };
  }
}

export async function saveNunchi(next: NunchiConnection): Promise<NunchiConnection> {
  const normalized = normalizeNunchi(next);
  await chrome.storage.local.set({ [NUNCHI_KEY]: normalized });
  return normalized;
}

/** 페어링을 푼다. 주소는 남긴다 — 다시 연결할 때 또 적지 않게. */
export async function forgetNunchiToken(): Promise<NunchiConnection> {
  const current = await loadNunchi();
  return saveNunchi({ ...EMPTY_NUNCHI, baseUrl: current.baseUrl });
}

export function isNunchiPaired(connection: NunchiConnection): connection is NunchiConnection & { token: string } {
  return Boolean(connection.token);
}

export function onNunchiChanged(callback: (connection: NunchiConnection) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[NUNCHI_KEY]) return;
    callback(normalizeNunchi(changes[NUNCHI_KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
