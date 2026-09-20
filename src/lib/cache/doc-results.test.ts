/**
 * 문서 분석 결과 캐시 (B1).
 *
 * ★ 여기서 지키는 것 셋.
 *   ① **본문이 바뀌면 재사용하지 않는다.** 이게 깨지면 정정 공문에 지난 요약이 붙는다 —
 *      배지와 원문 대조로 쌓아 온 신뢰가 한 번에 무너지는 종류의 사고다.
 *   ② 같은 문서·명령·지시·모델이면 같은 자리에 덮어쓴다. 자동 증가 키면 같은 분석이 계속 쌓인다.
 *   ③ 지시나 모델이 다르면 다른 결과다. 한 자리를 공유하면 `/요약 예산 위주로`의 결과가
 *      그냥 `/요약`의 결과로 나온다.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/storage/db';
import {
  bodyRevision,
  clearDocResults,
  docResultKey,
  docResultStats,
  documentIdentity,
  pruneDocResults,
  readDocResult,
  saveDocResult,
  type DocResultLookup,
} from './doc-results';

const LOOKUP: DocResultLookup = {
  identity: documentIdentity({ listName: '문서등록대장', title: '예산 편성 지침 통보', reportDate: '2026. 9. 30.' }),
  command: 'summary',
  instruction: '이 문서의 내용을 요약해줘.',
  model: 'gemma4:e2b',
};

beforeEach(async () => {
  await clearDocResults();
});

describe('문서 정체성', () => {
  it('공백과 대소문자 표기가 달라도 같은 문서로 본다', () => {
    const a = documentIdentity({ listName: '문서등록대장', title: '예산  편성 지침', reportDate: '2026. 9. 30.' });
    const b = documentIdentity({ listName: '문서등록대장', title: ' 예산 편성 지침 ', reportDate: '2026. 9. 30.' });
    expect(a).toBe(b);
  });

  // ★ 해마다 같은 제목의 공문이 온다. 보고일자를 빼면 작년 요약이 올해 공문에 붙는다.
  it('보고일자가 다르면 다른 문서다', () => {
    const last = documentIdentity({ title: '예산 편성 지침', reportDate: '2025. 9. 30.' });
    const now = documentIdentity({ title: '예산 편성 지침', reportDate: '2026. 9. 30.' });
    expect(last).not.toBe(now);
  });
});

describe('본문 판본', () => {
  it('공백만 다른 본문은 같은 판본이다', () => {
    expect(bodyRevision('가나  다라\n\n마바')).toBe(bodyRevision('가나 다라 마바'));
  });

  it('한 글자만 달라도 다른 판본이다', () => {
    expect(bodyRevision('제출 기한은 9월 30일')).not.toBe(bodyRevision('제출 기한은 9월 29일'));
  });
});

describe('읽기와 쓰기', () => {
  it('같은 본문이면 저장한 결과를 그대로 돌려준다', async () => {
    const revision = bodyRevision('본문');
    await saveDocResult(LOOKUP, { bodyRevision: revision, content: '요약 결과' });

    const hit = await readDocResult(LOOKUP, revision);
    expect(hit?.content).toBe('요약 결과');
  });

  // ★ 이 프로젝트에서 가장 중요한 한 줄이다. 정정 공문에 지난 요약을 보여 주지 않는다.
  it('★ 본문이 바뀌면 없는 것으로 친다', async () => {
    await saveDocResult(LOOKUP, { bodyRevision: bodyRevision('처음 본문'), content: '옛 요약' });

    expect(await readDocResult(LOOKUP, bodyRevision('고쳐진 본문'))).toBeNull();
  });

  it('지시가 다르면 다른 자리에 저장된다', () => {
    const other = { ...LOOKUP, instruction: '예산 위주로 요약해줘.' };
    expect(docResultKey(LOOKUP)).not.toBe(docResultKey(other));
  });

  it('모델이 다르면 다른 자리에 저장된다', () => {
    expect(docResultKey(LOOKUP)).not.toBe(docResultKey({ ...LOOKUP, model: 'other-model' }));
  });

  it('같은 조건으로 다시 저장하면 덮어쓴다', async () => {
    const revision = bodyRevision('본문');
    await saveDocResult(LOOKUP, { bodyRevision: revision, content: '첫 결과' });
    await saveDocResult(LOOKUP, { bodyRevision: revision, content: '다시 분석한 결과' });

    expect(await db.docResults.count()).toBe(1);
    expect((await readDocResult(LOOKUP, revision))?.content).toBe('다시 분석한 결과');
  });

  // ★ 등록 카드가 살아나야 캐시가 "결과를 그대로 보여 준 것"이 된다.
  it('일정 후보와 출처 공문까지 복원한다', async () => {
    const revision = bodyRevision('본문');
    await saveDocResult({ ...LOOKUP, command: 'actions' }, {
      bodyRevision: revision,
      content: '조치 카드',
      taskCandidates: [{ title: '실적 제출', evidenceVerified: true }],
      sourceDoc: { title: '예산 편성 지침 통보', url: 'https://example.gov/doc/1' },
    });

    const hit = await readDocResult({ ...LOOKUP, command: 'actions' }, revision);
    expect(hit?.taskCandidates).toHaveLength(1);
    expect(hit?.sourceDoc?.url).toBe('https://example.gov/doc/1');
  });
});

describe('보관', () => {
  it('상한을 넘으면 오래된 것부터 버린다', async () => {
    for (let i = 0; i < 5; i++) {
      await saveDocResult({ ...LOOKUP, identity: `doc-${i}` }, {
        bodyRevision: 'r', content: `결과 ${i}`, createdAt: 1000 + i,
      });
    }
    expect(await pruneDocResults(3)).toBe(2);

    const left = await db.docResults.toArray();
    expect(left.map(row => row.content).sort()).toEqual(['결과 2', '결과 3', '결과 4']);
  });

  it('통계는 저장된 건수와 가장 오래된 시각을 알려 준다', async () => {
    await saveDocResult(LOOKUP, { bodyRevision: 'r', content: 'x', createdAt: 500 });
    await saveDocResult({ ...LOOKUP, identity: 'other' }, { bodyRevision: 'r', content: 'y', createdAt: 900 });

    expect(await docResultStats()).toEqual({ entries: 2, oldestAt: 500 });
  });
});
