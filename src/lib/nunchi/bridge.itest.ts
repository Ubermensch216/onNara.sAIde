/**
 * 실제 눈치코치 브리지와의 종단 점검. 기본 `npm test`에는 들어가지 않는다.
 *
 *   NUNCHI_BRIDGE_URL=http://127.0.0.1:<포트>  NUNCHI_PAIR_CODE=<6자리>  npm run test:live -- src/lib/nunchi
 *
 * 눈치코치에서 연결을 켜고 코드를 만든 뒤 돌린다. 값이 없으면 건너뛴다.
 *
 * ★ 브라우저가 아니라 Node에서 돌기 때문에 확장이 보내는 `Origin` 머리글을 여기서 붙인다.
 *   실제 Edge에서 브라우저가 붙이는지는 이 시험이 확인하지 못한다.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getNunchiStatus, pairNunchi } from './client';
import { EMPTY_NUNCHI, normalizeBridgeUrl, type NunchiConnection } from './connection';

const baseUrl = normalizeBridgeUrl(process.env.NUNCHI_BRIDGE_URL);
const code = process.env.NUNCHI_PAIR_CODE ?? '';
const ORIGIN = `chrome-extension://${'a'.repeat(32)}`;

describe.skipIf(!baseUrl || !code)('live 눈치코치 브리지', () => {
  const realFetch = globalThis.fetch;
  let origin: string | null = ORIGIN;

  beforeAll(() => {
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({}), set: async () => undefined } } });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init: RequestInit = {}) =>
      realFetch(input, { ...init, headers: { ...(init.headers as Record<string, string>), ...(origin ? { Origin: origin } : {}) } }));
  });
  afterAll(() => vi.unstubAllGlobals());

  it('연결 전 상태 확인 → 코드로 연결 → 토큰으로 상태 확인 → 다른 확장의 토큰 사용은 거절', async () => {
    const fresh: NunchiConnection = { ...EMPTY_NUNCHI, baseUrl: baseUrl! };
    const before = await getNunchiStatus(fresh);
    expect(before).toMatchObject({ app: 'nunchi-coach', apiVersion: 1, paired: false });

    const wrong = code === '000000' ? '111111' : '000000';
    await expect(pairNunchi(fresh, wrong, 'onNara.sAIde')).rejects.toMatchObject({ code: 'pairing_code_mismatch', status: 403 });

    const result = await pairNunchi(fresh, code, 'onNara.sAIde (live 점검)');
    expect(result.scopes).toEqual(['read']);
    const paired: NunchiConnection = { ...fresh, token: result.token, clientId: result.clientId, scopes: result.scopes, pairedAt: Date.now() };

    const after = await getNunchiStatus(paired);
    console.log('  status:', JSON.stringify(after));
    expect(after).toMatchObject({ paired: true, scopes: ['read'] });

    await expect(pairNunchi(fresh, code, 'again')).rejects.toMatchObject({ code: 'pairing_not_started' });   // 코드는 한 번만

    origin = `chrome-extension://${'b'.repeat(32)}`;
    await expect(getNunchiStatus(paired)).rejects.toMatchObject({ code: 'origin_mismatch', status: 403 });
    origin = 'https://evil.test';
    await expect(getNunchiStatus(paired)).rejects.toMatchObject({ code: 'origin_rejected', status: 403 });
  });
});
