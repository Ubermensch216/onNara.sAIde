/**
 * 근거 판본 고정·사후 대조(provenance)와 근거 필수 모드(grounding).
 *
 * ★ 지키는 약속:
 *   - 답변 근거에는 색인된 판본과 모델에게 준 발췌문의 해시가 남는다.
 *   - 원본이 답변 뒤 고쳐졌는지 현재 판본 해시와 대조해 가린다.
 *   - 업무 규정 질문은 근거가 없으면 답하지 않는다. 인용 번호가 근거 목록 밖이면 알린다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CONNECTION, TONGDAL_KEY, type TongdalConnection } from './connection';
import { pinExcerpts, selectEvidence, type KnowledgeSource } from './evidence';
import { gatherKnowledge } from './chat-knowledge';
import { checkSourceDrift, judgeDrift, pinnedLabel } from './provenance';
import { checkCitations, citationNotice, isRegulationQuestion, refusalMessage, requiresGrounding } from './grounding';
import { wrapKnowledgeQuestion } from '@/lib/prompts/knowledge';
import type { TongdalDocumentDetail, TongdalSearchHit } from './types';

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

const paired: TongdalConnection = { ...EMPTY_CONNECTION, token: 'a'.repeat(43), clientId: 'c1', scopes: ['read'], pairedAt: 1 };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const hit = (over: Partial<TongdalSearchHit> = {}): TongdalSearchHit => ({
  sourceDocumentId: 'doc_1', sourceVersionId: 'sv_1', versionLabel: 'v1', contentHash: 'a1'.repeat(32),
  title: '여비 규정', fileName: 'travel.hwpx', relativePath: 'raw/travel.hwpx',
  sectionPath: '제5조 일비', pageStart: 2, pageEnd: 2, text: '일비는 1일 2만 원이다.', truncated: false, score: 0.03, ...over,
});

const detail = (versions: Array<{ label: string; hash: string; current: boolean }>): TongdalDocumentDetail => ({
  document: {
    id: 'doc_1', title: '여비 규정', shelfId: null, shelfName: null, documentType: null, status: 'active', createdAt: 0, updatedAt: 0,
    metadata: { project: null, year: null, organizations: [], topics: [], importance: null },
    versions: versions.map(v => ({ versionLabel: v.label, isCurrent: v.current, relativePath: 'raw/travel.hwpx', size: 1, ext: '.hwpx', contentHash: v.hash, createdAt: 0 })),
  },
  text: null,
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('근거 판본 고정', () => {
  it('색인된 판본을 출처에 남기고, 모델에게 준 발췌문의 SHA-256을 붙인다', async () => {
    const { evidence, sources } = selectEvidence([hit()], 1000);
    expect(sources[0]).toMatchObject({ versionId: 'sv_1', versionLabel: 'v1', contentHash: 'a1'.repeat(32) });
    const pinned = await pinExcerpts(evidence, sources);
    expect(pinned[0]!.excerptHash).toBe(await sha256(evidence[0]!.text));
    expect(pinnedLabel(pinned[0]!)).toBe('v1 · #a1a1a1a1');
  });

  it('판본을 보내지 않는 이전 TONGDAL이면 판본은 null로 남는다', () => {
    const { sources } = selectEvidence([hit({ sourceVersionId: undefined, versionLabel: undefined, contentHash: undefined })], 1000);
    expect(sources[0]).toMatchObject({ versionId: null, versionLabel: null, contentHash: null });
    expect(pinnedLabel(sources[0]!)).toBe('');
  });

  it('gatherKnowledge가 판본과 발췌문 해시를 함께 돌려준다', async () => {
    local[TONGDAL_KEY] = paired;
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { results: [hit()], searchMode: 'hybrid' })));
    const result = await gatherKnowledge('일비는?', 1000);
    expect(result.sources[0]).toMatchObject({ versionLabel: 'v1', excerptHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(result.missing).toBeUndefined();
  });
});

describe('답변 뒤 원본 대조', () => {
  const source: KnowledgeSource = {
    n: 1, documentId: 'doc_1', title: '여비 규정', relativePath: 'raw/travel.hwpx', sectionPath: '', pageStart: null, pageEnd: null,
    versionId: 'sv_1', versionLabel: 'v1', contentHash: 'old',
  };

  it('현재 판본 해시가 같으면 현행, 다르면 수정됨', () => {
    expect(judgeDrift(source, detail([{ label: 'v1', hash: 'old', current: true }]))).toEqual({ state: 'same', label: 'v1' });
    expect(judgeDrift(source, detail([{ label: 'v1', hash: 'old', current: false }, { label: 'v2', hash: 'new', current: true }])))
      .toEqual({ state: 'revised', label: 'v1', currentLabel: 'v2' });
  });

  it('판본을 기록하지 못한 출처는 대조하지 않는다', () => {
    expect(judgeDrift({ ...source, contentHash: null }, detail([{ label: 'v1', hash: 'old', current: true }]))).toEqual({ state: 'unpinned' });
  });

  it('같은 문서는 한 번만 묻고, 지워진 문서는 원본 없음으로 알린다', async () => {
    local[TONGDAL_KEY] = paired;
    const fetchMock = vi.fn(async (url: string) => url.includes('doc_gone')
      ? json(404, { code: 'not_found', message: '문서를 찾을 수 없습니다.' })
      : json(200, detail([{ label: 'v2', hash: 'new', current: true }])));
    vi.stubGlobal('fetch', fetchMock);
    const drift = await checkSourceDrift([
      source, { ...source, n: 2 }, { ...source, n: 3, documentId: 'doc_gone' }, { ...source, n: 4, contentHash: undefined },
    ]);
    expect(drift.map(d => d.state)).toEqual(['revised', 'revised', 'missing', 'unpinned']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('연결이 끊겼으면 확인할 수 없다고 알린다', async () => {
    local[TONGDAL_KEY] = paired;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const [drift] = await checkSourceDrift([source]);
    expect(drift!.state).toBe('unavailable');
  });
});

describe('근거 필수 모드', () => {
  it('업무 규정 질문을 가린다', () => {
    const regulation = ['출장 여비 한도가 얼마야?', '연가는 며칠까지 쓸 수 있어?', '위임전결 규정상 과장 전결 사항은?',
      '제12조에 따르면?', '초과근무 수당 지급 기준 알려줘', '수의계약 가능한 금액은?'];
    for (const q of regulation) expect(isRegulationQuestion(q), q).toBe(true);
    for (const q of ['이 문서 요약해줘', '회의 일정 정리해줘', '보도자료 초안 써줘', '어떤 기준으로 골랐어?']) {
      expect(isRegulationQuestion(q), q).toBe(false);
    }
  });

  it('정책이 always면 모든 질문이 근거 필수다', () => {
    expect(requiresGrounding('회의 일정 정리해줘', 'regulation')).toBe(false);
    expect(requiresGrounding('회의 일정 정리해줘', 'always')).toBe(true);
  });

  it('근거가 없는 사유를 코드로 돌려준다', async () => {
    expect((await gatherKnowledge('x', 1000)).missing).toEqual({ code: 'notPaired' });
    local[TONGDAL_KEY] = paired;
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { results: [], searchMode: 'hybrid' })));
    expect((await gatherKnowledge('x', 1000)).missing).toEqual({ code: 'noResults' });
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { code: 'engine_not_ready', message: '준비 중입니다.' })));
    expect((await gatherKnowledge('x', 1000)).missing).toMatchObject({ code: 'unavailable', reason: expect.stringContaining('준비 중') });
    expect((await gatherKnowledge('x', 50)).missing).toEqual({ code: 'noBudget' });
  });

  it('거절 문구는 사유와 다시 묻는 방법을 적는다', () => {
    const text = refusalMessage(true, { code: 'noResults' });
    expect(text).toContain('답하지 않았습니다');
    expect(text).toContain('업무 규정');
    expect(text).toContain('관련 자료가 검색되지 않았습니다');
    expect(refusalMessage(false, { code: 'unavailable', reason: '연결 거부' })).toContain('연결 거부');
  });

  it('근거 필수 질문은 프롬프트에서 문장마다 번호를 요구한다', () => {
    const evidence = [{ n: 1, title: '여비 규정', location: '', text: '일비는 2만 원' }];
    expect(wrapKnowledgeQuestion('일비는?', evidence, { strict: true })).toContain('모든 문장 끝에 근거 번호');
    expect(wrapKnowledgeQuestion('일비는?', evidence)).not.toContain('모든 문장 끝에 근거 번호');
  });

  it('인용 번호를 근거 목록과 대조한다', () => {
    expect(checkCitations('일비는 2만 원이다 [1]. 숙박비는 7만 원이다 [1, 3].', 2)).toEqual({ cited: [1], invalid: [3], declined: false });
    expect(checkCitations('내 지식에서 찾지 못했다.', 2).declined).toBe(true);
    expect(citationNotice('숙박비는 7만 원이다 [3].', 2, false)).toContain('[3]');
    expect(citationNotice('일비는 2만 원이다.', 2, true)).toContain('근거 번호가 없습니다');
    expect(citationNotice('일비는 2만 원이다.', 2, false)).toBeUndefined();
    expect(citationNotice('내 지식에서 찾지 못했다.', 2, true)).toBeUndefined();
    expect(citationNotice('일비는 2만 원이다 [1].', 2, true)).toBeUndefined();
  });
});
