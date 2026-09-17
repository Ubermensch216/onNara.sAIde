/**
 * 기억 — 실서버 점검. 계획서 §5 Phase 6
 *
 * `npm run test:live`로만 돈다. 여기서 확인하는 것은 단위 테스트가 가짜
 * 임베딩으로는 절대 알 수 없는 것들이다.
 *
 *   ① bge-m3가 정말 1024차원을 돌려주는가 (계획서 6-1의 완료 기준)
 *   ② 검색이 실제로 뜻이 통하는가 — 가짜 벡터로는 "가까운 것이 먼저 온다"만
 *      확인할 수 있을 뿐, 의미가 맞는지는 알 수 없다
 *   ③ `keep_alive: '0'`이 정말 모델을 내려놓는가 — 이것이 안 되면 대화용
 *      모델이 밀려나고, 그 증상은 "가끔 느려진다"로만 나타난다
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { embed } from '@/lib/ollama/client';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/storage/settings';
import { recall } from './recall';
import { chunkText, clearAll, EMBED_DIM, savePage, search } from './store';

const EP = 'http://localhost:11434';
const MODEL = 'bge-m3';
const S: Settings = {
  ...DEFAULT_SETTINGS,
  endpoint: EP,
  embedModel: MODEL,
  memoryEnabled: true,
};

/** 서로 뚜렷이 다른 주제 셋. 검색이 의미를 잡는지 보려면 주제가 갈려야 한다. */
const PAGES = [
  {
    url: 'https://example.com/coffee',
    title: '핸드드립 커피 내리는 법',
    text: '원두는 중간 굵기로 분쇄한다. 물 온도는 92도가 적당하고, 뜸을 30초 들인 뒤 세 번에 나눠 붓는다. 추출 시간은 2분 30초를 넘기지 않는다.',
  },
  {
    url: 'https://example.com/tax',
    title: '연말정산 소득공제 정리',
    text: '신용카드 사용액은 총급여의 25%를 넘는 부분부터 공제된다. 의료비는 총급여의 3%를 초과한 금액이 대상이고, 주택청약저축도 요건을 갖추면 공제받을 수 있다.',
  },
  {
    url: 'https://example.com/react',
    title: 'React 렌더링 최적화',
    text: 'useMemo와 useCallback은 참조 동일성을 유지해 자식 컴포넌트의 불필요한 리렌더를 막는다. 다만 남용하면 메모이제이션 비용이 이득을 넘는다.',
  },
];

async function seedReal() {
  for (const p of PAGES) {
    const chunks = chunkText(p.text);
    const vectors = await embed(EP, MODEL, chunks, '0');
    await savePage({ url: p.url, title: p.title, chunks, vectors, model: MODEL });
  }
}

async function resident(): Promise<string[]> {
  const res = await fetch(`${EP}/api/ps`);
  const json = (await res.json()) as { models?: Array<{ name: string }> };
  return (json.models ?? []).map((m) => m.name);
}

describe('기억 (실서버)', () => {
  beforeEach(async () => {
    await clearAll();
  });

  it('6-1: bge-m3가 1024차원을 돌려준다', async () => {
    const [v] = await embed(EP, MODEL, '차원 확인용 문장', '0');
    expect(v).toBeDefined();
    console.log('  임베딩 차원:', v!.length);
    expect(v!.length).toBe(EMBED_DIM);
  }, 120_000);

  it('6-2: 뜻이 통하는 검색이다 — 단어가 겹치지 않아도 주제로 찾는다', async () => {
    await seedReal();

    // 어느 질의도 본문의 단어를 그대로 쓰지 않는다. 키워드 매칭이면 실패한다.
    const cases: Array<[string, string]> = [
      ['에스프레소 말고 드립으로 마시고 싶은데', 'coffee'],
      ['세금 환급 얼마나 받을 수 있지', 'tax'],
      ['화면이 자꾸 다시 그려져서 느려요', 'react'],
    ];

    for (const [query, expected] of cases) {
      const [top] = await search((await embed(EP, MODEL, query, '0'))[0]!, 3, MODEL);
      console.log(`  "${query}" → ${top?.title} (${top?.score.toFixed(3)})`);
      expect(top?.url, query).toContain(expected);
    }
  }, 300_000);

  it('6-2: recall이 근거를 붙인 프롬프트를 만든다', async () => {
    await seedReal();
    const r = await recall('커피 물 온도가 몇 도였지', S);

    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0]!.url).toContain('coffee');
    expect(r.prompt).toContain('<memory>');
    expect(r.prompt).toContain('92도');
    console.log('  프롬프트 길이:', r.prompt.length, '자');
  }, 300_000);

  /**
   * ★ 이것이 Phase 6-1 주의사항의 핵심이다.
   *   keep_alive '0'이 듣지 않으면 bge-m3가 상주하며 gemma를 밀어낸다.
   *   그 증상은 "다음 질문이 갑자기 21초 걸린다"로만 나타나 원인을 짚기 어렵다.
   */
  it('6-1: keep_alive 0이면 임베딩 모델이 상주하지 않는다', async () => {
    await embed(EP, MODEL, '상주 확인용', '0');
    // 언로드가 즉시가 아닐 수 있어 잠깐 기다린다.
    await new Promise((r) => setTimeout(r, 3000));

    const names = await resident();
    console.log('  상주 중:', names.length ? names.join(', ') : '(없음)');
    expect(names.some((n) => n.startsWith(MODEL))).toBe(false);
  }, 120_000);
});
