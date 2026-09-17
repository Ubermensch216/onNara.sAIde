import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChat } from './store';
import * as storage from '@/lib/storage/db';
import * as stream from '@/lib/ollama/stream';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import type { SWToPanel } from '@/lib/messaging/protocol';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(async () => {
  useChat.getState().stop();
  await storage.deleteAllConversations();
  useChat.setState({ conversation: null, pending: null, messages: [], loading: false, page: null, screenshot: null, extracting: false, error: null });
});
afterEach(() => { useChat.getState().stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('A 조회가 B보다 늦게 끝나도 현재 탭은 B로 유지한다', async () => {
  const slow = deferred<storage.Conversation | null>();
  vi.spyOn(storage, 'findForTab').mockImplementation(tab => tab === 1 ? slow.promise : Promise.resolve(null));
  const a = useChat.getState().openForTab(1, 'https://a.test');
  await useChat.getState().openForTab(2, 'https://b.test');
  slow.resolve({ id: 1, tabId: 1, originUrl: 'https://a.test', title: 'A', createdAt: 0, updatedAt: 0 });
  await a;
  expect(useChat.getState()).toMatchObject({ currentUrl: 'https://b.test', conversation: null, pending: { tabId: 2 }, messages: [], loading: false });
});

it('동시에 두 번 전송해도 사용자 메시지와 생성은 한 번뿐이다', async () => {
  vi.spyOn(stream, 'streamChat').mockResolvedValue(null);
  await useChat.getState().openForTab(1, 'https://a.test');
  await Promise.all([useChat.getState().send('first', DEFAULT_SETTINGS), useChat.getState().send('duplicate', DEFAULT_SETTINGS)]);
  expect(stream.streamChat).toHaveBeenCalledTimes(1);
  expect(await storage.db.conversations.count()).toBe(1);
  expect((await storage.db.messages.toArray()).filter(m => m.role === 'user').map(m => m.content)).toEqual(['first']);
});

it('중단을 무시한 이전 스트림의 늦은 응답이 새 대화를 오염시키지 않는다', async () => {
  const started = deferred<void>();
  const slow = deferred<null>();
  let lateToken!: (text: string) => void;
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    lateToken = handlers.onToken!; started.resolve(); return slow.promise;
  });
  await useChat.getState().openForTab(1, 'https://a.test');
  const sending = useChat.getState().send('A', DEFAULT_SETTINGS);
  await started.promise;
  await useChat.getState().openForTab(2, 'https://b.test');
  await sending; // underlying slow promise has not resolved
  lateToken('old answer'); slow.resolve(null);
  expect(useChat.getState()).toMatchObject({ currentUrl: 'https://b.test', messages: [], streaming: false, error: null });
  expect((await storage.db.messages.toArray()).map(m => m.content)).toEqual(['A']);
});

it('탭을 전환한 뒤 도착한 이전 탭 캡처를 붙이지 않는다', async () => {
  const slow = deferred<SWToPanel>();
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => slow.promise) } });
  await useChat.getState().openForTab(1, 'https://a.test');
  const attachment = useChat.getState().attachScreenshot(1);
  await useChat.getState().openForTab(2, 'https://b.test');
  slow.resolve({ type: 'SCREENSHOT', dataUrl: 'data:image/png;base64,old' });
  expect(await attachment).toBeNull();
  expect(useChat.getState()).toMatchObject({ screenshot: null, extracting: false });
});

it('삭제한 대화에 메시지를 쓰면 실패하고 고아 메시지를 만들지 않는다', async () => {
  const id = await storage.createConversation(1, 'https://a.test');
  await storage.deleteConversation(id);
  await expect(storage.addMessage({ conversationId: id, role: 'assistant', content: 'late' })).rejects.toThrow('삭제된');
  expect(await storage.db.messages.count()).toBe(0);
});

it('받은문서 제목 표 요청은 화면을 다시 읽고 모델 없이 Markdown 표로 답한다', async () => {
  const sendMessage = vi.fn(async () => ({
    type: 'PAGE_EXTRACTED',
    payload: {
      url: 'https://onnara.test/main',
      title: '받은문서 · 온나라',
      text: '행 1 | 제목=감사자료 제출\n행 2 | 제목=처분요구 자료 제출',
      charCount: 44,
      truncated: false,
      keptRatio: 1,
      estimatedTokens: 20,
      method: 'onnara-document-list',
      extractedAt: Date.now(),
      structuredData: {
        kind: 'onnara-document-list',
        listName: '받은문서',
        columns: [{ key: 'title', label: '제목', sourceIndex: 2 }],
        rows: [{ title: '감사자료 제출' }, { title: '처분요구 자료 제출' }],
      },
    },
  } satisfies SWToPanel));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  vi.spyOn(stream, 'streamChat').mockResolvedValue(null);
  await useChat.getState().openForTab(1, 'https://onnara.test/main');
  await useChat.getState().send('받은문서 메뉴에 리스트업된 모든 문서의 제목을 읽어서 테이블로 만들어줘.', DEFAULT_SETTINGS);
  const messages = useChat.getState().messages;
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXTRACT_PAGE', tabId: 1 }));
  expect(messages.at(-1)?.content).toContain('| 1 | 감사자료 제출 |');
  expect(messages.at(-1)?.content).toContain('| 2 | 처분요구 자료 제출 |');
  expect(stream.streamChat).not.toHaveBeenCalled();
});
