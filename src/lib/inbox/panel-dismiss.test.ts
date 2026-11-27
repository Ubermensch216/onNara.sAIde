import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { clearInbox, listInboxDocs, saveInboxDocs } from './store';
import { dismissDoc, dismissDocs, useInbox } from './panel';
import type { InboxDoc } from './types';

const tab = { tabId: 9, url: 'https://onnara.test/main', title: '온나라', active: true };
const base: InboxDoc = {
  key: 'read-card', group: 'group', title: '법원문서 통보', reportDate: '2026-09-23',
  sender: '법원', department: '감사담당관', hasAttachment: false, readState: 'unknown',
  category: 'notice', reason: '규칙', dueDate: '', classifier: 'rule', firstSeenAt: 1, lastSeenAt: 1,
};

afterEach(async () => {
  await clearInbox();
  useInbox.setState({ docs: [], dismissing: null, dismissingKeys: [], error: null });
  vi.unstubAllGlobals();
});

it.each(['unknown', 'read'] as const)('원장 열람 상태가 %s여도 넘기기는 온나라 읽기처리를 요청한다', async readState => {
  const doc = { ...base, readState };
  await saveInboxDocs([doc]);
  useInbox.setState({ docs: [doc] });
  const sendMessage = vi.fn(async () => ({
    type: 'DOCUMENTS_MARKED_READ', marked: [doc.title], unconfirmed: [], missing: [], dialogs: [],
  }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });

  expect(await dismissDoc(doc, tab)).toBe(true);
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'MARK_DOCUMENTS_READ', tabId: tab.tabId, titles: [doc.title],
  }));
  expect((await listInboxDocs())[0]).toMatchObject({ readState: 'read', dismissedAt: expect.any(Number) });
});

it('온나라가 열람을 확인하지 못하면 카드를 남긴다', async () => {
  const doc = { ...base };
  await saveInboxDocs([doc]);
  useInbox.setState({ docs: [doc] });
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({
    type: 'DOCUMENTS_MARKED_READ', marked: [], unconfirmed: [doc.title], missing: [], dialogs: [],
  })) } });

  expect(await dismissDoc(doc, tab)).toBe(false);
  expect((await listInboxDocs())[0]!.dismissedAt).toBeUndefined();
});

it('일괄 넘기기는 여러 단순 공람 문서를 한 번에 읽기처리하고 확인된 건만 치운다', async () => {
  const docs: InboxDoc[] = [
    { ...base, key: 'n1', title: '단순 공람 1', readState: 'unread' },
    { ...base, key: 'n2', title: '단순 공람 2', readState: 'unread' },
    { ...base, key: 'n3', title: '단순 공람 3', readState: 'unread' },
  ];
  await saveInboxDocs(docs);
  useInbox.setState({ docs });
  const sendMessage = vi.fn(async () => ({
    type: 'DOCUMENTS_MARKED_READ',
    marked: ['단순 공람 1', '단순 공람 3'],
    unconfirmed: ['단순 공람 2'],
    missing: [],
    dialogs: ['일부 문서를 확인하지 못했습니다.'],
  }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });

  const result = await dismissDocs(docs, tab);
  expect(result).toEqual({ marked: 2, failed: 1, total: 3 });
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'MARK_DOCUMENTS_READ',
    tabId: tab.tabId,
    titles: ['단순 공람 1', '단순 공람 2', '단순 공람 3'],
  }));
  const saved = await listInboxDocs();
  const byKey = new Map(saved.map(item => [item.key, item]));
  expect(byKey.get('n1')!.dismissedAt).toBeTypeOf('number');
  expect(byKey.get('n2')!.dismissedAt).toBeUndefined();
  expect(byKey.get('n3')!.dismissedAt).toBeTypeOf('number');
  expect(useInbox.getState().error?.message).toContain('2건');
  expect(useInbox.getState().error?.message).toContain('1건');
  expect(useInbox.getState().error?.hint).toContain('일부 문서를 확인하지 못했습니다.');
});

it('일괄 넘기기가 50건을 넘으면 서비스 워커 상한(50건)에 맞춰 나눠 요청한다', async () => {
  const docs: InboxDoc[] = Array.from({ length: 55 }, (_, i) => ({
    ...base,
    key: `bulk-${i}`,
    title: `단순 공람 문서 ${i + 1}`,
    readState: 'unread',
  }));
  await saveInboxDocs(docs);
  useInbox.setState({ docs });
  const sendMessage = vi.fn(async (msg: { titles: string[] }) => ({
    type: 'DOCUMENTS_MARKED_READ',
    marked: msg.titles,
    unconfirmed: [],
    missing: [],
    dialogs: [],
  }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });

  const result = await dismissDocs(docs, tab);
  expect(result).toEqual({ marked: 55, failed: 0, total: 55 });
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(sendMessage.mock.calls[0]![0].titles).toHaveLength(50);
  expect(sendMessage.mock.calls[1]![0].titles).toHaveLength(5);
  expect(useInbox.getState().error).toBeNull();
});
