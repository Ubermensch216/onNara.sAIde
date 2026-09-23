import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { clearInbox, listInboxDocs, saveInboxDocs } from './store';
import { dismissDoc, useInbox } from './panel';
import type { InboxDoc } from './types';

const tab = { tabId: 9, url: 'https://onnara.test/main', title: '온나라', active: true };
const base: InboxDoc = {
  key: 'read-card', group: 'group', title: '법원문서 통보', reportDate: '2026-09-23',
  sender: '법원', department: '감사담당관', hasAttachment: false, readState: 'unknown',
  category: 'notice', reason: '규칙', dueDate: '', classifier: 'rule', firstSeenAt: 1, lastSeenAt: 1,
};

afterEach(async () => {
  await clearInbox();
  useInbox.setState({ docs: [], dismissing: null, error: null });
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
