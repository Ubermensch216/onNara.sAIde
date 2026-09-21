import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { db } from '@/lib/storage/db';
import { inboxDocKey, inboxGroupKey, normalizeReportDate, trimEllipsis } from './identity';
import { matchScope } from './scope';
import {
  clearInbox, inboxStats, lastInboxRun, listInboxDocs, loadInboxGroups,
  markBriefed, patchInboxDoc, pruneInboxDocs, recordInboxRun, saveInboxDocs, unmarkBriefed,
} from './store';
import type { InboxDoc, InboxRow } from './types';

const NOW = new Date('2026-09-20T09:00:00');

function row(overrides: Partial<InboxRow> = {}): InboxRow {
  return { title: '자료 제출', reportDate: '2026-09-18', sender: '부산광역시', department: '감사담당관', hasAttachment: false, readState: 'unread', ...overrides };
}

function doc(overrides: Partial<InboxDoc> = {}): InboxDoc {
  const base = row(overrides);
  return {
    ...base, key: inboxDocKey(base), group: inboxGroupKey(base),
    category: 'notice', reason: '', dueDate: '', classifier: 'rule',
    firstSeenAt: NOW.getTime(), lastSeenAt: NOW.getTime(), ...overrides,
  };
}

afterEach(async () => { await clearInbox(); });

it('보고일자 표기가 달라도 같은 문서로 본다', () => {
  expect(normalizeReportDate('2026.09.18')).toBe('2026-09-18');
  expect(normalizeReportDate('2026. 9. 18.')).toBe('2026-09-18');
  expect(normalizeReportDate('없음')).toBe('');
  expect(inboxDocKey(row({ reportDate: '2026.09.18' }))).toBe(inboxDocKey(row({ reportDate: '2026-09-18' })));
  // 제목 뒤의 줄임표는 화면이 붙인 것이지 공문의 일부가 아니다.
  expect(trimEllipsis('자료 제출…')).toBe('자료 제출');
  expect(inboxDocKey(row({ title: '자료 제출…' }))).toBe(inboxDocKey(row()));
});

it('수발신자가 다르면 제목이 같아도 다른 문서다', () => {
  expect(inboxDocKey(row({ sender: '해운대구' }))).not.toBe(inboxDocKey(row()));
});

it('키워드는 띄어쓰기와 괄호 표기가 달라도 걸린다', () => {
  const scope = { scope: 'keywords' as const, keywords: ['예산편성'], exclude: [], fields: ['title' as const] };
  expect(matchScope(row({ title: '2027년도 예산 편성 지침' }), scope).included).toBe(true);
  expect(matchScope(row({ title: '2027년도 (예산)편성 지침' }), scope).included).toBe(true);
  expect(matchScope(row({ title: '체육대회 안내' }), scope).included).toBe(false);
});

it('키워드 범위인데 키워드가 비어 있으면 전체로 본다', () => {
  const verdict = matchScope(row(), { scope: 'keywords', keywords: ['가'], exclude: [], fields: ['title'] });
  // 한 글자 키워드는 변별력이 없어 받지 않는다 — 남은 키워드가 없으므로 전체로 본다.
  expect(verdict.included).toBe(true);
  expect(verdict.reason).toContain('비어 있어');
});

it('목록에 있는 묶음만 읽어 온다', async () => {
  await saveInboxDocs([doc(), doc({ title: '다른 문서', sender: '해운대구' })]);
  const loaded = await loadInboxGroups([row()]);
  expect(loaded).toHaveLength(1);
  expect(loaded[0]!.title).toBe('자료 제출');
});

it('브리핑 표시를 넣고 뺀다 — 다시 분류는 표시를 지우는 일이다', async () => {
  const entry = doc();
  await saveInboxDocs([entry]);
  await markBriefed([entry.key], 123);
  expect((await listInboxDocs())[0]!.briefedAt).toBe(123);

  await unmarkBriefed([entry.key]);
  expect((await listInboxDocs())[0]).not.toHaveProperty('briefedAt');
});

it('보관 기간이 지난 문서만 지운다', async () => {
  const old = NOW.getTime() - 61 * 86_400_000;
  await saveInboxDocs([doc({ firstSeenAt: old }), doc({ title: '최근 문서', firstSeenAt: NOW.getTime() })]);
  expect(await pruneInboxDocs(60, NOW)).toBe(1);
  expect((await listInboxDocs()).map(item => item.title)).toEqual(['최근 문서']);
  // 0일은 "무기한"이다. 아무것도 지우지 않는다.
  expect(await pruneInboxDocs(0, NOW)).toBe(0);
});

it('건너뛴 실행도 기록한다', async () => {
  await recordInboxRun({ at: 1, trigger: 'alarm', scanned: 0, added: 0, briefed: 0, filtered: 0, readStateChanged: 0, error: '온나라 세션이 끊겼습니다' });
  await recordInboxRun({ at: 2, trigger: 'manual', scanned: 3, added: 1, briefed: 1, filtered: 0, readStateChanged: 0 });
  const last = await lastInboxRun();
  expect(last).toMatchObject({ at: 2, trigger: 'manual', briefed: 1 });
});

it('브리핑 기록을 전부 지울 수 있다 — 공문 제목이 남는 자리이기 때문이다', async () => {
  await saveInboxDocs([doc()]);
  await recordInboxRun({ at: 1, trigger: 'manual', scanned: 1, added: 1, briefed: 1, filtered: 0, readStateChanged: 0 });
  expect((await inboxStats()).docs).toBe(1);
  await clearInbox();
  expect(await inboxStats()).toMatchObject({ docs: 0, briefed: 0, oldestAt: null });
  expect(await db.inboxRuns.count()).toBe(0);
});

it('넘긴 표시를 되돌리면 그 자리가 실제로 비워진다', async () => {
  // ★ Dexie의 update에 undefined를 넘기는 것으로 끝내지 않는다. 값이 남아 있으면
  //   "되돌리기"를 눌러도 문서가 목록에 돌아오지 않는다.
  const entry = doc();
  await saveInboxDocs([{ ...entry, dismissedAt: 1, openedAt: 2 }]);
  await patchInboxDoc(entry.key, { dismissedAt: undefined, openedAt: undefined });
  const stored = (await listInboxDocs())[0]!;
  expect(stored.dismissedAt).toBeUndefined();
  expect(stored.openedAt).toBeUndefined();
});

it('저장된 문서가 500건을 넘어도 화면에 전체를 돌려준다', async () => {
  await saveInboxDocs(Array.from({ length: 525 }, (_, i) => doc({ title: `문서 ${i}` })));
  expect(await listInboxDocs()).toHaveLength(525);
  expect(await listInboxDocs(10)).toHaveLength(10);
});
