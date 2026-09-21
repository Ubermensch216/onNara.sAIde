import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { db } from './db';

it('v1 데이터베이스를 최신 판으로 열어도 기존 대화·메시지·기억을 보존한다', async () => {
  const legacy = new Dexie('saide');
  legacy.version(1).stores({ conversations: '++id, tabId, createdAt, updatedAt, title', messages: '++id, conversationId, createdAt', pageVectors: '++id, url, visitedAt' });
  await legacy.table('conversations').add({ id: 1, tabId: 1, title: 'Keep', originUrl: 'https://example.com', createdAt: 1, updatedAt: 1 });
  await legacy.table('messages').add({ conversationId: 1, role: 'user', content: 'Keep', createdAt: 1 });
  await legacy.table('pageVectors').add({ url: 'https://example.com', visitedAt: 1, vector: new Float32Array([1, 0]) });
  legacy.close();
  await db.open();
  expect(db.verno).toBe(5);
  expect((await db.conversations.get(1))?.title).toBe('Keep');
  expect(await db.messages.count()).toBe(1);
  expect(await db.table('pageVectors').count()).toBe(1);
  expect(await db.table('memoryControl').count()).toBe(0);
  // v3에서 더한 일정 테이블은 비어 있는 채로 열린다.
  expect(await db.tasks.count()).toBe(0);
  // v4에서 더한 분석 캐시·정확도 기록도 마찬가지다. 옛 자료를 건드리지 않는다.
  expect(await db.docResults.count()).toBe(0);
  expect(await db.feedback.count()).toBe(0);
  // v5에서 더한 브리핑 원장·실행 기록도 빈 채로 열린다.
  expect(await db.inboxDocs.count()).toBe(0);
  expect(await db.inboxRuns.count()).toBe(0);
  await db.delete();
});

/**
 * ★ 표가 사라지는 것을 막는다(db.ts의 마이그레이션 규칙 ②).
 *
 *   `stores({ x: null })` 한 줄이면 표가 삭제된다. 실수든 정리든, 그 순간 사용자의
 *   그 데이터는 백업 파일에만 남는다. 지금 쓰지 않는 pageVectors·memoryControl까지
 *   여기 적어 두는 이유가 그것이다 — 쓰지 않게 됐다는 이유로 지우지 않는다.
 *
 *   백업(backup.ts)도 이 목록을 자동으로 따라간다. 표가 조용히 사라지면 백업에서도 사라진다.
 */
it('선언된 표는 사라지지 않는다', () => {
  expect([...db.tables.map(table => table.name)].sort()).toEqual([
    'conversations', 'docResults', 'feedback', 'inboxDocs', 'inboxRuns',
    'memoryControl', 'messages', 'pageVectors', 'tasks',
  ]);
});

/**
 * ★ 판본을 되돌렸을 때 실제로 무슨 일이 일어나는가(규칙 ①).
 *
 *   "VersionError로 아예 열리지 않는다"가 아니다 — 재어 보고 고친 자리다. Dexie 4는
 *   판본을 낮춘 빌드에도 DB를 열어 주고, **그 빌드가 선언하지 않은 표만 없는 것이 된다.**
 *   그래서 롤백의 증상은 "데이터가 없다"가 아니라 "새 기능만 오류로 멈춘다"이고,
 *   판본을 다시 올리면 그대로 돌아온다. 데이터가 지워지지 않는다는 이 사실이
 *   롤백을 얼마나 두려워해야 하는지를 정하므로, 시험으로 붙잡아 둔다.
 */
it('판본을 낮춘 빌드는 새 표만 보지 못한다 — 데이터는 남고, 판본을 올리면 돌아온다', async () => {
  await db.open();
  await db.tasks.add({ id: 1, title: '지켜야 할 일정', status: 'todo', dueDate: '', createdAt: 1, updatedAt: 1 });
  await db.inboxDocs.add({ key: 'doc-1', group: 'g1', title: '협조 요청', reportDate: '2026-09-20', category: 'mine', firstSeenAt: 1, briefedAt: 1, readState: 'unread' } as never);
  db.close();

  // v5가 나오기 전의 빌드가 선언했던 그대로.
  const v4 = new Dexie('saide');
  v4.version(1).stores({ conversations: '++id, tabId, createdAt, updatedAt, title', messages: '++id, conversationId, createdAt', pageVectors: '++id, url, visitedAt' });
  v4.version(2).stores({ memoryControl: 'id' });
  v4.version(3).stores({ tasks: '++id, status, dueDate, updatedAt, dedupeKey' });
  v4.version(4).stores({ docResults: 'key, identity, createdAt', feedback: '++id, kind, at' });

  await v4.open();
  // 옛 빌드가 아는 표는 그대로 읽힌다.
  expect(await v4.table('tasks').count()).toBe(1);
  // v5에서 생긴 표만 없는 것이 된다. 그 기능은 이 상태에서 오류로 멈춘다.
  expect(() => v4.table('inboxDocs')).toThrow();
  v4.close();

  // 판본을 다시 올리면 둘 다 그대로 있다. 롤백이 지운 것은 없다.
  await db.open();
  expect(await db.tasks.count()).toBe(1);
  expect(await db.inboxDocs.count()).toBe(1);
  await db.delete();
});
