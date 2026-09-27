import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { db } from './db';
import { addUserRef, deleteUserRef, listUserRefs, updateUserRef, USER_REFS_MAX, type NewUserRef } from './user-refs';
import { collectBackup } from './backup';
import { extractCodeFacts } from '@/lib/onnara/reference-analysis';

const sample = (hash: string, name = `${hash}.txt`): NewUserRef => ({
  name, format: 'text', size: 10, contentHash: hash, role: 'fact', text: '본문', warnings: [], codeFacts: extractCodeFacts('본문'),
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.userRefs.clear();
});

it('넣고, 같은 지문은 새로 만들지 않고, 고치고, 지운다', async () => {
  const first = await addUserRef(sample('a'));
  expect(first.existed).toBe(false);
  const again = await addUserRef(sample('a', '이름만 다름.txt'));
  expect(again).toMatchObject({ existed: true, ref: { id: first.ref.id, name: 'a.txt' } });
  expect(await listUserRefs()).toHaveLength(1);

  await updateUserRef(first.ref.id, { role: 'example', memo: '문체만 참고' });
  expect((await listUserRefs())[0]).toMatchObject({ role: 'example', memo: '문체만 참고' });

  await deleteUserRef(first.ref.id);
  expect(await listUserRefs()).toHaveLength(0);
});

it('자료함이 가득 차면 오래된 자료를 지우지 않고 거절한다', async () => {
  await db.userRefs.bulkAdd(Array.from({ length: USER_REFS_MAX }, (_, i) => ({ ...sample(`h${i}`), id: `id${i}`, memo: '', createdAt: i, lastUsedAt: i })));
  await expect(addUserRef(sample('new'))).rejects.toThrow(/50건/);
  expect(await db.userRefs.count()).toBe(USER_REFS_MAX);
});

it('전체 백업에 포함된다', async () => {
  vi.stubGlobal('chrome', {
    storage: { local: { get: async () => ({}) } },
    runtime: { getManifest: () => ({ version: '0.1.0' }) },
  });
  await addUserRef(sample('b'));
  const backup = await collectBackup();
  expect(backup.tables.userRefs).toHaveLength(1);
});
