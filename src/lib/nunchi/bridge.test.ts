/**
 * 눈치코치 연동 — 연결 정보·호출·상태 판정.
 *
 * ★ 지키는 약속:
 *   - 토큰은 이 PC(loopback) 주소로만 나간다. TONGDAL.ai 연결과 저장 자리도 토큰도 따로다.
 *   - 눈치코치가 연결을 해제하면(401) 토큰을 지운다.
 *   - 같은 포트에 다른 프로그램이 떠 있으면 연결된 것으로 보지 않는다.
 *   - 쓸 수 없는 상태는 이유와 함께 드러난다.
 * ★ 응답 모양의 기준은 Nunchi_Coach `docs/온나라_연동_구현계획서_2026-10-12.md` §6(B1·B2)이다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TONGDAL_KEY } from '@/lib/tongdal/connection';
import { getNunchiStatus, NunchiError, nunchiRequest, pairNunchi, type NunchiStatus } from './client';
import { DEFAULT_NUNCHI_URL, EMPTY_NUNCHI, loadNunchi, normalizeNunchi, NUNCHI_KEY, type NunchiConnection } from './connection';
import { judgeNunchi } from './status';

const TOKEN = 'n'.repeat(43);
let local: Record<string, unknown>;

beforeEach(() => {
  local = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: structuredClone(local[key]) })),
        set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(local, structuredClone(next)); }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const paired: NunchiConnection = { ...EMPTY_NUNCHI, token: TOKEN, clientId: 'c1', scopes: ['read'], pairedAt: 1 };
const status = (over: Partial<NunchiStatus> = {}): NunchiStatus =>
  ({ app: 'nunchi-coach', apiVersion: 1, appVersion: '1.0.0', paired: true, scopes: ['read'], project: '2026 인수인계', ...over });

function reply(code: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } }));
}

describe('연결 정보', () => {
  it('TONGDAL.ai와 다른 포트·다른 저장 자리를 쓴다', () => {
    expect(DEFAULT_NUNCHI_URL).toBe('http://127.0.0.1:47831');
    expect(NUNCHI_KEY).not.toBe(TONGDAL_KEY);
  });

  it('★ 손상된 저장값은 연결되지 않은 기본값으로 떨어진다', () => {
    expect(normalizeNunchi({ baseUrl: 'http://evil.test:1', token: 'short', scopes: ['read'] })).toEqual(EMPTY_NUNCHI);
    expect(normalizeNunchi({ baseUrl: 'https://127.0.0.1:47831', token: TOKEN }).baseUrl).toBe(DEFAULT_NUNCHI_URL);
    expect(normalizeNunchi({ token: TOKEN, clientId: 'c1', scopes: ['read', 'delete', 'read'], pairedAt: 5 }))
      .toMatchObject({ token: TOKEN, scopes: ['read'], pairedAt: 5 });
  });
});

describe('호출', () => {
  it('토큰과 함께 이 PC 주소로만 보낸다', async () => {
    const fetchMock = reply(200, status());
    vi.stubGlobal('fetch', fetchMock);
    await getNunchiStatus(paired);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:47831/bridge/v1/status');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
  });

  it('연결하지 않았으면 인증이 필요한 요청을 보내지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(nunchiRequest(EMPTY_NUNCHI, '/bridge/v1/packages')).rejects.toMatchObject({ code: 'not_paired' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('연결 요청에는 토큰을 붙이지 않고 코드의 공백을 뺀다', async () => {
    const fetchMock = reply(200, { token: TOKEN, clientId: 'c1', scopes: ['read'], apiVersion: 1 });
    vi.stubGlobal('fetch', fetchMock);
    const result = await pairNunchi(paired, '123 456', 'onNara.sAIde');
    expect(result).toMatchObject({ token: TOKEN, scopes: ['read'] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:47831/bridge/v1/pair');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({ code: '123456', label: 'onNara.sAIde' });
  });

  it('눈치코치가 쓴 거절 사유를 그대로 전한다', async () => {
    vi.stubGlobal('fetch', reply(403, { code: 'pairing_code_mismatch', message: '연결 코드가 맞지 않습니다.' }));
    await expect(pairNunchi(EMPTY_NUNCHI, '000000', 'x')).rejects.toMatchObject({ code: 'pairing_code_mismatch', message: '연결 코드가 맞지 않습니다.', status: 403 });
  });

  it('★ 401이면 눈치코치 토큰만 지우고 주소와 TONGDAL.ai 연결은 남긴다', async () => {
    local[NUNCHI_KEY] = { ...paired, baseUrl: 'http://127.0.0.1:5000' };
    local[TONGDAL_KEY] = { baseUrl: 'http://127.0.0.1:47821', token: 't'.repeat(43), clientId: 'tongdal', scopes: ['read'], pairedAt: 1 };
    vi.stubGlobal('fetch', reply(401, { code: 'unauthorized', message: '연결 정보가 없거나 만료되었습니다. 눈치코치와 다시 연결하세요.' }));
    await expect(nunchiRequest(paired, '/bridge/v1/packages')).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    const after = await loadNunchi();
    expect(after.token).toBeNull();
    expect(after.baseUrl).toBe('http://127.0.0.1:5000');
    expect((local[TONGDAL_KEY] as { token: string }).token).toBe('t'.repeat(43));
  });

  it('★ 같은 포트의 다른 프로그램을 눈치코치로 여기지 않는다', async () => {
    vi.stubGlobal('fetch', reply(200, { apiVersion: 1, appVersion: '0.9', paired: true, knowledgeSpace: { connected: true } }));
    await expect(getNunchiStatus(paired)).rejects.toMatchObject({ code: 'bad_response' });
    vi.stubGlobal('fetch', reply(200, { hello: 'world' }));
    await expect(pairNunchi(EMPTY_NUNCHI, '123456', 'x')).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('꺼져 있으면 연결할 수 없다고 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(getNunchiStatus(paired)).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('멈추면 멈췄다고 알린다', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn());
    await expect(getNunchiStatus(paired, controller.signal)).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('상태 판정', () => {
  it('토큰이 없으면 묻지 않고도 연결 전이다', () => {
    expect(judgeNunchi(null, null, false)).toEqual({ state: 'unpaired', project: null });
  });

  it('연결됐으면 열어 둔 인수인계를 알려 준다', () => {
    expect(judgeNunchi(status(), null, true)).toEqual({ state: 'ready', project: '2026 인수인계' });
    expect(judgeNunchi(status({ project: undefined }), null, true)).toEqual({ state: 'ready', project: null });
  });

  it('★ 눈치코치가 토큰을 모르면 연결 전으로 돌아간다', () => {
    expect(judgeNunchi(status({ paired: false }), null, true).state).toBe('unpaired');
    expect(judgeNunchi(null, new NunchiError('unauthorized', '다시 연결하세요.', 401), true).state).toBe('unpaired');
  });

  it('꺼져 있음과 판본 불일치를 가른다', () => {
    const offline = judgeNunchi(null, new NunchiError('unreachable', '연결할 수 없습니다.'), true);
    expect(offline.state).toBe('offline');
    expect(offline.error?.code).toBe('unreachable');
    expect(judgeNunchi(null, null, true).state).toBe('offline');
    expect(judgeNunchi(status({ apiVersion: 2 }), null, true).state).toBe('version_mismatch');
  });
});
