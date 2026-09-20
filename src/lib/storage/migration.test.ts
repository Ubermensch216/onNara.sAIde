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
  expect(db.verno).toBe(4);
  expect((await db.conversations.get(1))?.title).toBe('Keep');
  expect(await db.messages.count()).toBe(1);
  expect(await db.table('pageVectors').count()).toBe(1);
  expect(await db.table('memoryControl').count()).toBe(0);
  // v3에서 더한 일정 테이블은 비어 있는 채로 열린다.
  expect(await db.tasks.count()).toBe(0);
  // v4에서 더한 분석 캐시·정확도 기록도 마찬가지다. 옛 자료를 건드리지 않는다.
  expect(await db.docResults.count()).toBe(0);
  expect(await db.feedback.count()).toBe(0);
  await db.delete();
});
