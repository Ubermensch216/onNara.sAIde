/**
 * 백업·복원 시험.
 *
 * ★ 이 기능이 지키는 약속은 하나다 — **받아 둔 파일로 되돌리면 전과 같아진다.**
 *   그래서 왕복(내보내기 → 비우기 → 복원)을 통째로 돌려 대조한다. 표를 하나씩
 *   확인하는 시험은 새 표가 생겼을 때 조용히 빠진다.
 *
 * ★ 백업 파일은 사용자가 고른 외부 파일이다. 손상·위조된 파일을 어떻게 막는지도
 *   함께 고정한다.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from './db';
import {
  BACKUP_FORMAT,
  collectBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  summarize,
} from './backup';

let local: Record<string, unknown>;

beforeEach(async () => {
  local = {};
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '0.1.0' }) },
    storage: {
      local: {
        // 실제 chrome.storage.local과 같이 **합친다.** 통째로 바꾸면 복원이 남긴 키를 놓친다.
        get: vi.fn(async (keys: string | null) =>
          keys === null || keys === undefined
            ? structuredClone(local)
            : { [keys as string]: structuredClone(local[keys as string]) }),
        set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(local, structuredClone(next)); }),
      },
    },
  });
  await db.open();
  for (const table of db.tables) await table.clear();
});
afterEach(() => vi.unstubAllGlobals());

/** 사용자가 며칠 써서 쌓인 상태. */
async function seed() {
  await db.conversations.add({ id: 7, tabId: 1, title: '공문 검토', originUrl: 'http://onnara.test/a', createdAt: 10, updatedAt: 20 });
  await db.messages.add({ id: 3, conversationId: 7, role: 'user', content: '요약해 줘', createdAt: 11 });
  await db.tasks.add({ id: 4, title: '예산 자료 제출', status: 'todo', dueDate: '2026-10-01', createdAt: 12, updatedAt: 12 });
  await db.inboxDocs.add({ key: 'doc-1', group: 'g1', title: '협조 요청', reportDate: '2026-09-20', category: 'mine', firstSeenAt: 13, briefedAt: 13, readState: 'unread' } as never);
  await db.feedback.add({ id: 1, kind: 'inbox-relevance', key: 'doc-1', verdict: 'good', at: 14 } as never);
  local['saide.settings'] = { model: 'gemma4:e2b', theme: 'dark', pageTokenBudget: 3000 };
  local['saide.presets'] = [{ id: 'p1', slash: '/검토', body: '검토해 줘' }];
  // 휘발성 신호. 담기지도 되살아나지도 않아야 한다.
  local['saide.openInbox'] = 999;
  local['saide.taskAlertOn'] = '2026-09-21';
}

async function wipeEverything() {
  for (const table of db.tables) await table.clear();
  local = {};
}

it('★ 내보낸 파일로 되돌리면 일정·대화·브리핑 원장·설정이 전과 같아진다', async () => {
  await seed();
  const file = serializeBackup(await collectBackup());

  await wipeEverything();
  expect(await db.tasks.count()).toBe(0);

  const restored = await restoreBackup(parseBackup(file));

  expect(await db.tasks.get(4)).toMatchObject({ title: '예산 자료 제출', dueDate: '2026-10-01' });
  expect(await db.conversations.get(7)).toMatchObject({ title: '공문 검토' });
  // 메시지의 대화 참조가 살아 있어야 한다. id를 새로 매기면 여기서 끊긴다.
  expect((await db.messages.get(3))?.conversationId).toBe(7);
  expect(await db.inboxDocs.get('doc-1')).toMatchObject({ title: '협조 요청' });
  expect(await db.feedback.count()).toBe(1);
  expect(local['saide.settings']).toMatchObject({ model: 'gemma4:e2b', theme: 'dark', pageTokenBudget: 3000 });
  expect(local['saide.presets']).toEqual([{ id: 'p1', slash: '/검토', body: '검토해 줘' }]);
  // 대화 1 · 메시지 1 · 일정 1 · 브리핑 원장 1 · 정확도 기록 1.
  expect(restored.total).toBe(5);
});

it('복원한 뒤 새로 등록한 일정이 되살린 id와 부딪히지 않는다', async () => {
  await seed();
  const file = serializeBackup(await collectBackup());
  await wipeEverything();
  await restoreBackup(parseBackup(file));

  const id = await db.tasks.add({ title: '새 할 일', status: 'todo', dueDate: '', createdAt: 99, updatedAt: 99 } as never);

  expect(id).toBeGreaterThan(4);
  expect(await db.tasks.count()).toBe(2);
});

it('그때그때의 신호는 담지도 되살리지도 않는다', async () => {
  await seed();
  const backup = await collectBackup();

  expect(backup.local).not.toHaveProperty('saide.openInbox');
  expect(backup.local).not.toHaveProperty('saide.taskAlertOn');

  await wipeEverything();
  await restoreBackup(parseBackup(serializeBackup(backup)));
  expect(local).not.toHaveProperty('saide.openInbox');
});

/**
 * ★ 임베딩은 Float32Array다. JSON이 모르는 형이라 그냥 담으면 `{"0":…}` 객체로 되살아나고,
 *   길이도 내적도 성립하지 않아 검색이 조용히 망가진다.
 */
it('기억을 함께 담으면 임베딩이 Float32Array 그대로 돌아온다', async () => {
  const vector = new Float32Array([0.5, -0.25, 0.125, 1]);
  await db.table('pageVectors').add({ id: 1, url: 'http://a.test/', title: 'A', text: '본문', chunk: 0, vector, model: 'bge-m3', visitedAt: 5 });

  const file = serializeBackup(await collectBackup({ includeMemory: true }));
  await wipeEverything();
  await restoreBackup(parseBackup(file));

  const row = await db.table('pageVectors').get(1);
  expect(row.vector).toBeInstanceOf(Float32Array);
  expect([...row.vector]).toEqual([0.5, -0.25, 0.125, 1]);
});

it('기억을 뺀 백업으로 복원해도 지금 쌓인 기억은 지우지 않는다', async () => {
  await seed();
  const file = serializeBackup(await collectBackup());
  await db.table('pageVectors').add({ id: 2, url: 'http://b.test/', title: 'B', text: '본문', chunk: 0, vector: new Float32Array([1]), model: 'bge-m3', visitedAt: 6 });

  await restoreBackup(parseBackup(file));

  // 사용자가 지우라고 한 적이 없다. 백업이 다루지 않은 표는 건드리지 않는다.
  expect(await db.table('pageVectors').count()).toBe(1);
});

/* ── 외부 파일 방어 ─────────────────────────────────────── */

it('sAIde 백업이 아니거나 손상된 파일은 받지 않는다', () => {
  expect(() => parseBackup('{')).toThrow();
  expect(() => parseBackup('{"format":"something-else"}')).toThrow();
  expect(() => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, schemaVersion: 1, local: {}, tables: [] }))).toThrow();
});

it('더 새로운 판본에서 만든 백업은 받지 않는다', async () => {
  const backup = await collectBackup();
  expect(() => parseBackup(JSON.stringify({ ...backup, version: 99 }))).toThrow();
  expect(() => parseBackup(JSON.stringify({ ...backup, schemaVersion: db.verno + 1 }))).toThrow();
});

it('이 판본이 모르는 표는 조용히 버리고, 센 건수에도 넣지 않는다', async () => {
  const backup = await collectBackup();
  const parsed = parseBackup(JSON.stringify({ ...backup, tables: { ...backup.tables, futureTable: [{ a: 1 }] } }));

  expect(parsed.tables).not.toHaveProperty('futureTable');
  expect(summarize(parsed).counts).not.toHaveProperty('futureTable');
});

/**
 * ★ 백업 파일 안의 설정은 사용자가 손으로 고칠 수 있다. 그대로 넣으면 엔드포인트가
 *   임의 주소로 바뀌고, 그다음부터 공문 본문이 그리로 간다.
 */
it('백업 안의 설정은 원래의 검증기를 다시 통과한다', async () => {
  const backup = await collectBackup();
  const parsed = parseBackup(JSON.stringify({
    ...backup,
    local: { 'saide.settings': { endpoint: 'javascript:alert(1)', numCtx: 1e9, locale: 'xx' } },
  }));

  const settings = parsed.local['saide.settings'] as { endpoint: string; numCtx: number; locale: string };
  expect(settings.endpoint).toBe('http://localhost:11434');
  expect(settings.numCtx).toBe(32768);
  expect(settings.locale).toBe('ko');
});

/**
 * ★ 브리핑 대상 위치는 나중에 로그인된 온나라 출처로 **조회 폼을 다시 보내는** 값이다.
 *   파일에서 들어온 것을 검증 없이 넣으면 확장이 임의 주소로 폼을 보내는 길이 된다.
 */
it('브리핑 대상 위치가 형태를 벗어나면 버린다', async () => {
  const backup = await collectBackup();
  const parsed = parseBackup(JSON.stringify({
    ...backup,
    local: { 'saide.inboxLocation': { location: { url: 'javascript:alert(1)', framePath: [] }, listName: '받은문서', origin: 'x', savedAt: 1 } },
  }));

  expect(parsed.local).not.toHaveProperty('saide.inboxLocation');
});
