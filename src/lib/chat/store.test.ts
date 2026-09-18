import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createChatSession } from './store';
import { createChatSessions } from './sessions';
import * as storage from '@/lib/storage/db';
import * as stream from '@/lib/ollama/stream';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import type { SWToPanel } from '@/lib/messaging/protocol';

let useChat: ReturnType<typeof createChatSessions>;

it('선택한 여러 문서는 읽기와 AI 요약을 한 건씩 순서대로 실행한다', async () => {
  const order: string[] = [];
  const common = { url: 'https://onnara.test/main', title: '문서등록대장', text: '본문', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return { type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '문서등록대장', columns: [],
      rows: [{ title: '문서 A' }, { title: '문서 B' }, { title: '문서 C' }], selectedTitles: ['문서 A', '문서 C'],
    } } };
    if (message.type === 'RELEASE_WORK_TAB') { order.push('release'); return { type: 'ACTIVE_TAB', tab: null }; }
    // 여러 문서는 목록 작업 탭 하나를 재사용하도록 요청한다.
    expect(message).toMatchObject({ keepWorkTab: true });
    order.push(`read:${message.title}`);
    expect(useChat.getState().documentProgress).toContain('문서 본문을 읽는 중');
    return { type: 'DOCUMENT_READ', requestedTitle: message.title, payload: { ...common, title: message.title, text: `${message.title}의 본문` } };
  }) } });
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, request, handlers) => {
    order.push('generate');
    expect(useChat.getState().documentProgress).toContain('AI가 분석하는 중');
    expect(useChat.getState().documentProgress).toContain(order.length === 2 ? '1/2번째' : '2/2번째');
    expect(useChat.getState().extracting).toBe(false);
    expect(request.think).toBe(false);
    const title = order.length === 2 ? '문서 A' : '문서 C';
    // 읽은 본문 자체가 모델에 가고, 미리 정한 항목 틀은 강요하지 않는다.
    expect(request.messages.some(message => message.content.includes(`${title}의 본문`))).toBe(true);
    const instruction = request.messages.at(-1)!.content;
    expect(instruction).toContain(`'${title}'`);
    expect(instruction).not.toMatch(/요청 사항|기한을 정리/);
    handlers.onToken?.('문서 요약 결과');
    return null;
  });
  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/요약', 'summary', '', DEFAULT_SETTINGS);
  expect(order).toEqual(['read:문서 A', 'generate', 'read:문서 C', 'generate', 'release']);
  expect(useChat.getState().messages.filter(message => message.role === 'assistant')).toHaveLength(2);
  expect(useChat.getState().streaming).toBe(false);
});

it('기록에서 연 대화의 탭이 닫혔으면 지금 보고 있는 탭으로 다시 연결해 페이지를 읽는다', async () => {
  const url = 'https://onnara.test/list';
  const id = await storage.createConversation(99, url, '이전 대화');
  await storage.addMessage({ conversationId: id, role: 'user', content: '이전 질문' });
  const conversation = (await storage.db.conversations.get(id))!;
  const sendMessage = vi.fn(async (message: { type: string; tabId?: number }) => ({ type: 'ERROR', error: { code: 'UNKNOWN', message: `읽기 대상 ${message.tabId}` } }));
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    tabs: {
      get: vi.fn(async (tabId: number) => { throw new Error(`No tab with id: ${tabId}`); }),
      query: vi.fn(async () => [{ id: 7, url, active: true }]),
    },
  });
  await useChat.getState().openConversation(conversation);
  await useChat.getState().runCommand('/요약', 'summary', '', DEFAULT_SETTINGS);
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXTRACT_PAGE', tabId: 7 }));
  expect(sendMessage.mock.calls.some(([message]) => message.tabId === 99)).toBe(false);
  expect((await storage.db.conversations.get(id))!.tabId).toBe(7);
});

it('연결된 탭도 현재 탭도 읽을 수 없으면 chrome:// 안내 대신 탭을 찾을 수 없다고 알린다', async () => {
  const id = await storage.createConversation(99, 'https://onnara.test/list', '이전 대화');
  const sendMessage = vi.fn();
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    tabs: { get: vi.fn(async () => { throw new Error('No tab'); }), query: vi.fn(async () => [{ id: 3, url: 'edge://newtab/', active: true }]) },
  });
  await useChat.getState().openConversation((await storage.db.conversations.get(id))!);
  await useChat.getState().runCommand('/첨부', 'attachments', '', DEFAULT_SETTINGS);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(useChat.getState().error).toMatchObject({ code: 'UNKNOWN', message: expect.stringContaining('탭을 찾을 수 없습니다') });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(async () => {
  await storage.deleteAllConversations();
  useChat = createChatSessions(createChatSession);
});
afterEach(() => { useChat.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['user', 'assistant'] as const)('선택한 %s 메시지만 저장소와 다음 질문의 문맥에서 삭제한다', async role => {
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('AI 답변');
    return null;
  });
  await useChat.getState().openForTab(1, 'https://a.test');
  await useChat.getState().send('사용자 질문', DEFAULT_SETTINGS);
  const selected = useChat.getState().messages.find(message => message.role === role)!;
  const kept = useChat.getState().messages.filter(message => message.id !== selected.id);
  await useChat.getState().removeMessage(selected.id);
  expect(useChat.getState().messages).toEqual(kept);
  expect(useChat.getState().lastContext).toBeNull();
  expect(await storage.listMessages(selected.conversationId)).toHaveLength(1);
  useChat.dispose();
  useChat = createChatSessions(createChatSession);
  await useChat.getState().openForTab(1, 'https://a.test');
  expect(useChat.getState().messages.map(message => message.id)).toEqual(kept.map(message => message.id));
  await useChat.getState().send('다음 질문', DEFAULT_SETTINGS);
  const context = vi.mocked(stream.streamChat).mock.calls.at(-1)![1].messages;
  expect(context.some(message => message.content === selected.content)).toBe(false);
});

it('전체 초기화는 현재 생성만 취소하고 다른 세션을 보존하며 늦은 답변을 되살리지 않는다', async () => {
  const generate = vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('완료');
    return null;
  });
  await useChat.getState().openForTab(1, 'https://a.test');
  await useChat.getState().send('A 질문', DEFAULT_SETTINGS);
  const otherId = useChat.getState().conversation!.id;
  const started = deferred<void>();
  const finished = deferred<null>();
  let lateToken!: (text: string) => void;
  generate.mockImplementationOnce(async (_endpoint, _request, handlers) => {
    lateToken = handlers.onToken!;
    handlers.onToken?.('일부 답변');
    started.resolve();
    return finished.promise;
  });
  await useChat.getState().openForTab(2, 'https://b.test');
  const sending = useChat.getState().send('B 질문', DEFAULT_SETTINGS);
  await started.promise;
  const oldId = useChat.getState().conversation!.id;
  const controller = useChat.getState().abort!;
  await useChat.getState().resetConversation();
  await sending;
  lateToken('늦은 답변'); finished.resolve(null);
  expect(controller.signal.aborted).toBe(true);
  expect(useChat.getState()).toMatchObject({ conversation: null, messages: [], page: null, screenshot: null,
    pending: { tabId: 2, url: 'https://b.test' }, streaming: false, extracting: false, loading: false,
    lastContext: null, agentSteps: [], pendingApproval: null, documentProgress: null });
  expect(await storage.db.conversations.get(oldId)).toBeUndefined();
  expect(await storage.listMessages(oldId)).toEqual([]);
  expect(await storage.listMessages(otherId)).toHaveLength(2);
  await useChat.getState().openForTab(1, 'https://a.test');
  expect(useChat.getState().conversation!.id).toBe(otherId);
  await useChat.getState().openForTab(2, 'https://b.test');
  expect(useChat.getState().messages).toEqual([]);
  await useChat.getState().send('새 질문', DEFAULT_SETTINGS);
  expect(useChat.getState().conversation!.id).not.toBe(oldId);
  expect(useChat.getState().messages.map(message => message.content)).toEqual(['새 질문', '완료']);
});

it('삭제 저장에 실패하면 화면의 메시지를 보존하고 오류를 표시한다', async () => {
  vi.spyOn(stream, 'streamChat').mockResolvedValue(null);
  await useChat.getState().openForTab(1, 'https://a.test');
  await useChat.getState().send('질문', DEFAULT_SETTINGS);
  const original = useChat.getState().messages;
  vi.spyOn(storage, 'deleteMessage').mockRejectedValue(new Error('저장 실패'));
  await useChat.getState().removeMessage(original[0]!.id);
  expect(useChat.getState().messages).toEqual(original);
  expect(useChat.getState().error?.message).toContain('저장 실패');
  expect(useChat.getState().loading).toBe(false);
});

it('중단된 답변의 저장이 끝나기 전에 삭제해도 다시 나타나지 않는다', async () => {
  const started = deferred<void>();
  const finished = deferred<null>();
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('중단할 답변');
    started.resolve();
    return finished.promise;
  });
  await useChat.getState().openForTab(1, 'https://a.test');
  const sending = useChat.getState().send('질문', DEFAULT_SETTINGS);
  await started.promise;
  await vi.waitFor(() => expect(useChat.getState().messages.at(-1)?.content).toBe('중단할 답변'));
  const message = useChat.getState().messages.at(-1)!;
  expect(typeof message.id).toBe('string');
  useChat.getState().stop();
  await useChat.getState().removeMessage(message.id);
  await sending;
  finished.resolve(null);
  expect(useChat.getState().messages.map(item => item.content)).toEqual(['질문']);
  expect((await storage.listMessages(message.conversationId)).map(item => item.content)).toEqual(['질문']);
});

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

it('숨겨진 탭의 생성은 계속되고 결과는 원래 세션에만 저장된다', async () => {
  const started = deferred<void>();
  const slow = deferred<null>();
  let lateToken!: (text: string) => void;
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    lateToken = handlers.onToken!; started.resolve(); return slow.promise;
  });
  await useChat.getState().openForTab(1, 'https://a.test');
  const sending = useChat.getState().send('A', DEFAULT_SETTINGS);
  await started.promise;
  const controller = useChat.getState().abort!;
  await useChat.getState().openForTab(2, 'https://b.test');
  expect(controller.signal.aborted).toBe(false);
  expect(useChat.isBusy()).toBe(true);
  lateToken('old answer'); slow.resolve(null);
  await sending;
  expect(useChat.getState()).toMatchObject({ currentUrl: 'https://b.test', messages: [], streaming: false, error: null });
  expect((await storage.db.messages.toArray()).map(m => m.content)).toEqual(['A', 'old answer']);
  await useChat.getState().openForTab(1, 'https://a.test');
  expect(useChat.getState().messages.map(m => m.content)).toEqual(['A', 'old answer']);
  expect(useChat.isBusy()).toBe(false);
});

it('탭을 전환한 뒤 도착한 이전 탭 캡처를 붙이지 않는다', async () => {
  const slow = deferred<SWToPanel>();
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(() => slow.promise) } });
  await useChat.getState().openForTab(1, 'https://a.test');
  const attachment = useChat.getState().attachScreenshot(1);
  await useChat.getState().openForTab(2, 'https://b.test');
  slow.resolve({ type: 'SCREENSHOT', dataUrl: 'data:image/png;base64,old' });
  expect(await attachment).toBe('old');
  expect(useChat.getState()).toMatchObject({ screenshot: null, extracting: false });
  await useChat.getState().openForTab(1, 'https://a.test');
  expect(useChat.getState().screenshot).toBe('old');
});

it('삭제한 대화에 메시지를 쓰면 실패하고 고아 메시지를 만들지 않는다', async () => {
  const id = await storage.createConversation(1, 'https://a.test');
  await storage.deleteConversation(id);
  await expect(storage.addMessage({ conversationId: id, role: 'assistant', content: 'late' })).rejects.toThrow('삭제된');
  expect(await storage.db.messages.count()).toBe(0);
});

it('같은 탭에서 다른 페이지를 왕복해도 진행 중인 요약과 본문을 복원한다', async () => {
  const title = '감사자료 제출';
  const url = 'https://onnara.test/list';
  const started = deferred<void>();
  const finished = deferred<null>();
  let token!: (text: string) => void;
  const page = { url, title, text: '제출기한은 9월 30일입니다.', charCount: 20,
    truncated: false, keptRatio: 1, estimatedTokens: 10, method: 'innerText' as const, extractedAt: Date.now() };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string }) =>
    message.type === 'EXTRACT_PAGE'
      ? { type: 'PAGE_EXTRACTED', payload: { ...page, structuredData: {
        kind: 'onnara-document-list', listName: '문서등록대장', columns: [], rows: [{ title }], selectedTitles: [title],
      } } }
      : { type: 'DOCUMENT_READ', requestedTitle: title, payload: page }) } });
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    token = handlers.onToken!;
    started.resolve();
    return finished.promise;
  });
  await useChat.getState().openForTab(1, url);
  const sending = useChat.getState().runCommand('/요약', 'summary', '', DEFAULT_SETTINGS);
  await started.promise;
  const original = useChat.getState();
  await useChat.getState().openForTab(1, 'https://onnara.test/other');
  expect(useChat.getState().messages).toEqual([]);
  await useChat.getState().openForTab(1, `${url}#top`);
  expect(useChat.getState()).toMatchObject({ streaming: true, page, conversation: original.conversation,
    documentProgress: original.documentProgress, abort: original.abort });
  token('9월 30일까지 제출하세요.');
  finished.resolve(null);
  await sending;
  expect(useChat.getState().messages.at(-1)?.content).toBe('9월 30일까지 제출하세요.');
  expect(useChat.getState().streaming).toBe(false);
  expect(stream.streamChat).toHaveBeenCalledTimes(1);
});

it('명시적으로 중단한 세션의 늦은 응답은 다른 세션을 오염시키지 않는다', async () => {
  const started = deferred<void>();
  const finished = deferred<null>();
  let token!: (text: string) => void;
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    token = handlers.onToken!;
    started.resolve();
    return finished.promise;
  });
  await useChat.getState().openForTab(1, 'https://a.test');
  const sending = useChat.getState().send('A', DEFAULT_SETTINGS);
  await started.promise;
  useChat.getState().stop();
  await useChat.getState().openForTab(2, 'https://b.test');
  await sending;
  token('late');
  finished.resolve(null);
  expect(useChat.getState().messages).toEqual([]);
  await useChat.getState().openForTab(1, 'https://a.test');
  expect(useChat.getState().messages.map(m => m.content)).toEqual(['A']);
  expect(useChat.getState().streaming).toBe(false);
});

it('삭제한 대화를 캐시에서 되살리지 않는다', async () => {
  vi.spyOn(stream, 'streamChat').mockResolvedValue(null);
  await useChat.getState().openForTab(1, 'https://a.test');
  await useChat.getState().send('A', DEFAULT_SETTINGS);
  const id = useChat.getState().conversation!.id;
  await useChat.getState().openForTab(2, 'https://b.test');
  await storage.deleteConversation(id);
  await useChat.getState().openForTab(1, 'https://a.test');
  expect(useChat.getState()).toMatchObject({ conversation: null, messages: [], pending: { tabId: 1 } });
});

it('초기에 등록한 전송 핸들러도 현재 세션에만 질문을 보낸다', async () => {
  vi.spyOn(stream, 'streamChat').mockResolvedValue(null);
  const send = useChat.getState().send;
  await useChat.getState().openForTab(1, 'https://a.test');
  await useChat.getState().openForTab(2, 'https://b.test');
  await send('B', DEFAULT_SETTINGS);
  expect(useChat.getState().conversation?.tabId).toBe(2);
  await useChat.getState().openForTab(1, 'https://a.test');
  expect(useChat.getState().messages).toEqual([]);
});

it('대화 목록에서 실행 중인 세션을 다시 열어도 중단하거나 중복 실행하지 않는다', async () => {
  const started = deferred<void>();
  const finished = deferred<null>();
  vi.spyOn(stream, 'streamChat').mockImplementation(async () => {
    started.resolve();
    return finished.promise;
  });
  await useChat.getState().openForTab(1, 'https://a.test');
  const sending = useChat.getState().send('A', DEFAULT_SETTINGS);
  await started.promise;
  const conversation = useChat.getState().conversation!;
  await useChat.getState().openForTab(2, 'https://b.test');
  await useChat.getState().openConversation(conversation);
  expect(useChat.getState()).toMatchObject({ conversation, streaming: true });
  finished.resolve(null);
  await sending;
  expect(stream.streamChat).toHaveBeenCalledTimes(1);
});


it('체크한 문서를 백그라운드로 읽은 뒤 그 본문을 모델 컨텍스트에 넣는다', async () => {
  const title = '감사결과 처분요구 이행실태 특정감사 자료 제출';
  const sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'EXTRACT_PAGE') return {
      type: 'PAGE_EXTRACTED',
      payload: {
        url: 'https://onnara.test/main', title: '문서등록대장 · 온나라', text: `행 1 | 제목=${title}`,
        charCount: 70, truncated: false, keptRatio: 1, estimatedTokens: 30,
        method: 'onnara-document-list', extractedAt: Date.now(),
        structuredData: {
          kind: 'onnara-document-list', listName: '문서등록대장',
          columns: [{ key: 'title', label: '제목', sourceIndex: 2 }], rows: [{ title }], selectedTitles: [title],
        },
      },
    } satisfies SWToPanel;
    if (message.type === 'READ_DOCUMENT') return {
      type: 'DOCUMENT_READ', requestedTitle: title,
      payload: {
        url: 'https://onnara.test/main', title,
        text: '문서 본문: 제출기한은 9월 30일이며 담당 부서는 감사담당관입니다.',
        charCount: 46, truncated: false, keptRatio: 1, estimatedTokens: 25,
        method: 'innerText', extractedAt: Date.now(),
      },
    } satisfies SWToPanel;
    throw new Error(`unexpected ${message.type}`);
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  vi.spyOn(stream, 'streamChat').mockResolvedValue(null);
  await useChat.getState().openForTab(1, 'https://onnara.test/main');
  await useChat.getState().runCommand('/요약', 'summary', '핵심 내용을 요약해줘', DEFAULT_SETTINGS);

  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'READ_DOCUMENT', tabId: 1, title }));
  const request = vi.mocked(stream.streamChat).mock.calls[0]![1];
  expect(request.messages.some(message => message.content.includes('제출기한은 9월 30일'))).toBe(true);
  expect(useChat.getState().page?.title).toBe(title);
});

it('문서 읽기가 진행 중이면 질문과 처리 상태가 남고 실패 원인을 표시한다', async () => {
  const title = '감사위원회 직원 노고 격려를 위한 간담회 개최';
  const reading = deferred<SWToPanel>();
  const started = deferred<void>();
  const sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type === 'READ_DOCUMENT') { started.resolve(); return reading.promise; }
    return {
      type: 'PAGE_EXTRACTED', payload: {
        url: 'https://onnara.test/main', title: '문서등록대장', text: title,
        charCount: 30, truncated: false, keptRatio: 1, estimatedTokens: 20,
        method: 'onnara-document-list', extractedAt: Date.now(),
        structuredData: { kind: 'onnara-document-list', listName: '문서등록대장',
          columns: [{ key: 'title', label: '제목', sourceIndex: 0 }], rows: [{ title }], selectedTitles: [title] },
      },
    } satisfies SWToPanel;
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  vi.spyOn(stream, 'streamChat').mockResolvedValue(null);
  await useChat.getState().openForTab(1, 'https://onnara.test/main');
  const prompt = '/요약';
  const pending = useChat.getState().runCommand(prompt, 'summary', '', DEFAULT_SETTINGS);
  await started.promise;
  expect(useChat.getState()).toMatchObject({ streaming: true, extracting: true });
  expect(useChat.getState().messages.at(-1)?.content).toBe(prompt);
  await useChat.getState().openForTab(1, 'https://onnara.test/other');
  await useChat.getState().openForTab(1, 'https://onnara.test/main');
  expect(useChat.getState()).toMatchObject({ streaming: true, extracting: true });
  expect(useChat.getState().messages.at(-1)?.content).toBe(prompt);
  await useChat.getState().openForTab(1, 'https://onnara.test/other');
  reading.resolve({ type: 'ERROR', error: { code: 'TIMEOUT', message: '문서 본문을 읽을 수 없습니다.' } });
  await pending;
  expect(useChat.getState()).toMatchObject({ messages: [], error: null });
  await useChat.getState().openForTab(1, 'https://onnara.test/main');
  expect(useChat.getState()).toMatchObject({ streaming: false, extracting: false, error: { code: 'TIMEOUT' } });
  expect(useChat.getState().messages.at(-1)?.content).toBe(prompt);
  expect(stream.streamChat).not.toHaveBeenCalled();
});

it('여러 문서 중 권한 오류가 나면 나머지 문서를 돌리지 않고 허용할 주소와 함께 멈춘다', async () => {
  const common = { url: 'https://onnara.test/main', title: '받은문서', text: '목록', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  const reads: string[] = [];
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return { type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '받은문서', columns: [],
      rows: [{ title: '문서 A' }, { title: '문서 B' }, { title: '문서 C' }], selectedTitles: ['문서 A', '문서 B', '문서 C'],
    } } };
    if (message.type === 'RELEASE_WORK_TAB') return { type: 'ACTIVE_TAB', tab: null };
    reads.push(message.title!);
    return { type: 'ERROR', error: { code: 'HOST_PERMISSION_REQUIRED', message: '문서 본문이 다른 주소에 있습니다.', origins: ['https://viewer.onnara.test'] } };
  }) } });
  const generate = vi.spyOn(stream, 'streamChat');
  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/요약', 'summary', '', DEFAULT_SETTINGS);
  expect(reads).toEqual(['문서 A']);
  expect(generate).not.toHaveBeenCalled();
  expect(useChat.getState().error).toMatchObject({ code: 'HOST_PERMISSION_REQUIRED', origins: ['https://viewer.onnara.test'] });
  expect(useChat.getState().streaming).toBe(false);
});

it('여러 문서 요약이 모두 끝나면 늦게 도착한 표시 갱신이 있어도 진행 표시가 남지 않는다', async () => {
  const common = { url: 'https://onnara.test/main', title: '받은문서', text: '목록', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return { type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '받은문서', columns: [],
      rows: [{ title: '문서 A' }, { title: '문서 B' }], selectedTitles: ['문서 A', '문서 B'],
    } } };
    return { type: 'DOCUMENT_READ', requestedTitle: message.title, payload: { ...common, title: message.title, text: `${message.title} 본문` } };
  }) } });
  // 마지막 토큰 직후 응답이 끝나 60ms 표시 지연 타이머가 남는 상황
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => { handlers.onToken?.('요약'); return null; });
  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/요약', 'summary', '', DEFAULT_SETTINGS);
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(useChat.getState().streaming).toBe(false);
  expect(useChat.getState().abort).toBeNull();
  expect(useChat.getState().messages.filter(message => message.role === 'assistant').map(message => message.content)).toEqual(['요약', '요약']);
});


it('핵심·조치사항 요청은 문서마다 JSON 스키마로 생성하고 원문과 대조한 카드를 남긴다', async () => {
  const common = { url: 'https://onnara.test/main', title: '받은문서', text: '목록', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  const body = '2. 참석자 명단을 붙임 서식에 작성하여 2026. 9. 30.(수)까지 감사담당관으로 제출하여 주시기 바랍니다.';
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return { type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '워크숍 알림' }, { title: '통계 알림' }], selectedTitles: ['워크숍 알림', '통계 알림'],
    } } };
    if (message.type !== 'READ_DOCUMENT') return { type: 'ACTIVE_TAB', tab: null };
    return { type: 'DOCUMENT_READ', requestedTitle: message.title, payload: { ...common, title: message.title, text: message.title === '워크숍 알림' ? body : '통계를 알립니다.' } };
  }) } });
  const formats: unknown[] = [];
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, request, handlers) => {
    formats.push(request.format);
    const workshop = request.messages.some(message => message.content.includes('참석자 명단'));
    handlers.onToken?.(workshop
      ? JSON.stringify({ summary: '명단 제출 요청', actions: [{ task: '참석자 명단 제출', evidence: '참석자 명단을 붙임 서식에 작성하여 2026. 9. 30.(수)까지 감사담당관으로 제출' }], deliverables: ['참석자 명단'], deadlines: [], contact: '' })
      : '죄송합니다, JSON으로 답할 수 없습니다');
    return null;
  });
  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/조치', 'actions', '', DEFAULT_SETTINGS);
  expect(formats).toHaveLength(2);
  expect(formats[0]).toMatchObject({ type: 'object', required: expect.arrayContaining(['actions', 'deadlines']) });
  const cards = useChat.getState().messages.filter(message => message.role === 'assistant');
  expect(cards).toHaveLength(1);
  expect(cards[0]!.content).toContain('참석자 명단 제출 (원문 확인)');
  expect(cards[0]!.content).toContain('AI가 빠뜨려 코드가 찾음');
  expect(useChat.getState().error?.message).toContain('통계 알림');
  expect(useChat.getState().streaming).toBe(false);
});

it('문서를 바꿔 세션을 다시 여는 중에 보낸 요약 요청도 버리지 않고 새 문서 대화에서 처리한다', async () => {
  // 패널은 탭이 바뀌면 openForTab을 기다리지 않고 부른다(App.tsx). 그 사이 사용자가 보낸 요청이 사라지면
  // 화면에서는 "지시를 무시한 것"으로 보이고, 한 번 더 보내야 동작한다.
  const page = { title: '문서', text: '문서 본문', charCount: 100, truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string; tabId?: number }) =>
    message.type === 'EXTRACT_PAGE' ? { type: 'PAGE_EXTRACTED', payload: { ...page, url: 'https://onnara.test/doc-b' } } : { type: 'ACTIVE_TAB', tab: null }) } });
  const generate = vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('요약 결과');
    return null;
  });

  await useChat.getState().openForTab(1, 'https://onnara.test/doc-a');
  await useChat.getState().send('앞 문서를 요약해줘', DEFAULT_SETTINGS);
  const firstConversation = useChat.getState().conversation!.id;
  generate.mockClear();

  // 사용자가 다른 문서를 선택했다. 패널이 대화를 갈아끼우는 동안 곧바로 질문을 보낸다.
  void useChat.getState().openForTab(1, 'https://onnara.test/doc-b');
  await useChat.getState().send('앞에서 본 내용을 정리해줘', DEFAULT_SETTINGS);

  expect(generate).toHaveBeenCalledTimes(1);
  expect(useChat.getState().messages.map(message => message.content)).toContain('앞에서 본 내용을 정리해줘');
  expect(useChat.getState().conversation!.id).not.toBe(firstConversation);
  expect(useChat.getState().conversation!.originUrl).toBe('https://onnara.test/doc-b');
  expect(useChat.getState().streaming).toBe(false);
});

it('이전 문서 대화로 돌아가는 중에 보낸 요청은 그 문서 대화에서 처리한다', async () => {
  // 상세 화면이 팝업·iframe으로 열렸다 닫히면 탭 주소가 원래 목록으로 돌아온다. 그때 세션을 다시 고르는
  // 동안(저장소 조회) 보낸 요청이 직전 세션으로 새면 사용자는 답이 엉뚱한 대화에 남는 것을 본다.
  const page = { title: '문서', text: '문서 본문', charCount: 100, truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string }) =>
    message.type === 'EXTRACT_PAGE' ? { type: 'PAGE_EXTRACTED', payload: { ...page, url: 'https://onnara.test/list' } } : { type: 'ACTIVE_TAB', tab: null }) } });
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('요약 결과');
    return null;
  });

  await useChat.getState().openForTab(1, 'https://onnara.test/list');
  await useChat.getState().send('앞 문서를 요약해줘', DEFAULT_SETTINGS);
  const listConversation = useChat.getState().conversation!.id;
  await useChat.getState().openForTab(1, 'https://onnara.test/detail');
  expect(useChat.getState().messages).toHaveLength(0);

  // 목록 화면으로 돌아오는 중에 곧바로 다음 질문을 보낸다.
  void useChat.getState().openForTab(1, 'https://onnara.test/list');
  await useChat.getState().send('앞에서 본 내용을 정리해줘', DEFAULT_SETTINGS);

  expect(useChat.getState().conversation!.id).toBe(listConversation);
  expect(useChat.getState().messages.map(message => message.content)).toContain('앞에서 본 내용을 정리해줘');
  expect(await storage.listMessages(listConversation)).toHaveLength(4);
});

it('요약을 마친 뒤 두 문서의 공통점을 물으면 다시 요약하지 않고 앞 답변을 근거로 한 번만 답한다', async () => {
  const common = { url: 'https://onnara.test/main', title: '받은문서', text: '목록', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  const sendMessage = vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return { type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '감사 자료 제출' }, { title: '정보보안 점검 계획' }],
      selectedTitles: ['감사 자료 제출', '정보보안 점검 계획'],
    } } };
    if (message.type !== 'READ_DOCUMENT') return { type: 'ACTIVE_TAB', tab: null };
    return { type: 'DOCUMENT_READ', requestedTitle: message.title, payload: { ...common, title: message.title, text: `${message.title}의 본문` } };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const generate = vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('문서 요약');
    return null;
  });

  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/요약', 'summary', '', DEFAULT_SETTINGS);
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'READ_DOCUMENT')).toHaveLength(2);
  generate.mockClear();
  sendMessage.mockClear();

  await useChat.getState().send('각 문서의 내용이 서로 다른 분야인데 그래도 공통점을 찾아줘', DEFAULT_SETTINGS);

  // 문서를 다시 읽지 않고, 질문 그대로 한 번만 생성한다.
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'READ_DOCUMENT')).toHaveLength(0);
  expect(generate).toHaveBeenCalledTimes(1);
  const context = generate.mock.calls.at(-1)![1].messages;
  expect(context.at(-1)!.content).toContain('공통점을 찾아줘');
  expect(context.some(message => message.content.includes('문서 요약'))).toBe(true);
  expect(useChat.getState().messages.at(-1)!.role).toBe('assistant');
});

it('요약한 적 없는 상태에서 공통점을 물으면 문서들을 함께 읽어 한 번에 답한다', async () => {
  const common = { url: 'https://onnara.test/main', title: '받은문서', text: '목록', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  const sendMessage = vi.fn(async (message: { type: string; title?: string; budgetTokens?: number }) => {
    if (message.type === 'EXTRACT_PAGE') return { type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '감사 자료 제출' }, { title: '정보보안 점검 계획' }],
      selectedTitles: ['감사 자료 제출', '정보보안 점검 계획'],
    } } };
    if (message.type !== 'READ_DOCUMENT') return { type: 'ACTIVE_TAB', tab: null };
    // 문서 여러 건을 한 문맥에 담아야 하므로 문서마다 예산을 나눠 쓴다.
    expect(message.budgetTokens).toBe(Math.floor(DEFAULT_SETTINGS.pageTokenBudget / 2));
    return { type: 'DOCUMENT_READ', requestedTitle: message.title, payload: { ...common, title: message.title, text: `${message.title}의 본문` } };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const generate = vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('두 문서 모두 감사 대응 업무입니다');
    return null;
  });

  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/비교 공통점을 찾아줘', 'compare', '공통점을 찾아줘', DEFAULT_SETTINGS);

  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'READ_DOCUMENT').map(([message]) => message.title))
    .toEqual(['감사 자료 제출', '정보보안 점검 계획']);
  expect(generate).toHaveBeenCalledTimes(1);
  const context = generate.mock.calls.at(-1)![1].messages;
  expect(context.some(message => message.content.includes('감사 자료 제출의 본문'))).toBe(true);
  expect(context.some(message => message.content.includes('정보보안 점검 계획의 본문'))).toBe(true);
  expect(context.at(-1)!.content).toContain('공통점을 찾아줘');
  expect(useChat.getState().messages.filter(message => message.role === 'assistant')).toHaveLength(1);
  expect(useChat.getState().streaming).toBe(false);
});

/* ── 슬래시 명령과 일반 대화의 경계 ── */

it('슬래시 없는 문장은 문서를 읽지 않고 대화 문맥만으로 답한다', async () => {
  const sendMessage = vi.fn(async () => ({ type: 'ACTIVE_TAB', tab: null }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const generate = vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('답변');
    return null;
  });
  await useChat.getState().openForTab(1, 'https://onnara.test/main');
  // 예전에는 "문서"·"내용" 같은 낱말로 의도를 짐작해 문서를 다시 읽고 문서별 요약으로 바꿔 버렸다.
  await useChat.getState().send('앞 문서들의 내용을 비교해서 공통점을 정리해줘', DEFAULT_SETTINGS);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0]![1].messages.at(-1)!.content).toBe('앞 문서들의 내용을 비교해서 공통점을 정리해줘');
});

it('/읽기는 본문만 붙이고 모델을 부르지 않는다. 이어지는 질문이 그 본문을 문맥으로 쓴다', async () => {
  const common = { url: 'https://onnara.test/main', title: '받은문서', text: '목록', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return { type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '문서 A' }, { title: '문서 B' }],
      selectedTitles: ['문서 A', '문서 B'],
    } } };
    if (message.type !== 'READ_DOCUMENT') return { type: 'ACTIVE_TAB', tab: null };
    return { type: 'DOCUMENT_READ', requestedTitle: message.title, payload: { ...common, title: message.title, text: `${message.title}의 본문` } };
  }) } });
  const generate = vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('두 문서 모두 감사 대응 업무입니다');
    return null;
  });

  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/읽기', 'read', '', DEFAULT_SETTINGS);
  expect(generate).not.toHaveBeenCalled();
  expect(useChat.getState().messages.at(-1)!.content).toContain('본문을 읽어 대화에 붙였습니다');
  expect(useChat.getState().page!.text).toContain('문서 A의 본문');

  await useChat.getState().send('두 문서의 공통점을 정리해줘', DEFAULT_SETTINGS);
  const context = generate.mock.calls.at(-1)![1].messages;
  expect(context.some(message => message.content.includes('문서 B의 본문'))).toBe(true);
  expect(context.at(-1)!.content).toBe('두 문서의 공통점을 정리해줘');
});

it('/새로고침은 모델 없이 현재 목록과 체크 상태를 알려 준다', async () => {
  const common = { url: 'https://onnara.test/main', title: '받은문서', text: '목록', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
    kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '문서 A' }, { title: '문서 B' }],
    selectedTitles: ['문서 B'],
  } } })) } });
  const generate = vi.spyOn(stream, 'streamChat');
  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/새로고침', 'refresh', '', DEFAULT_SETTINGS);
  expect(generate).not.toHaveBeenCalled();
  const answer = useChat.getState().messages.at(-1)!;
  expect(answer.content).toContain('현재 화면 2건 / 체크 1건');
  expect(answer.content).toContain('1. 문서 B');
});

it('체크한 문서가 없으면 읽지 않고 무엇을 해야 하는지 알려 준다', async () => {
  const common = { url: 'https://onnara.test/main', title: '받은문서', text: '목록', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  const sendMessage = vi.fn(async (message: { type: string }) => {
    void message;
    return { type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '문서 A' }], selectedTitles: [],
    } } };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const generate = vi.spyOn(stream, 'streamChat');
  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/요약', 'summary', '', DEFAULT_SETTINGS);
  expect(generate).not.toHaveBeenCalled();
  expect(sendMessage.mock.calls.some(([message]) => message.type === 'READ_DOCUMENT')).toBe(false);
  expect(useChat.getState().error).toMatchObject({ message: expect.stringContaining('문서를 체크한 뒤') });
  expect(useChat.getState().error!.hint).toContain('/요약 전체');
});

/* ── 문서를 바꿔 이어서 대화하기 ── */

it('새 문서를 읽으면 앞 문서에 대한 문답은 화면에만 남고 모델 문맥에서는 빠진다', async () => {
  const common = { url: 'https://onnara.test/main', title: '받은문서', text: '목록', charCount: 100,
    truncated: false, keptRatio: 1, estimatedTokens: 30, method: 'innerText' as const, extractedAt: Date.now() };
  let selected = ['문서 A'];
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return { type: 'PAGE_EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '문서 A' }, { title: '문서 B' }],
      selectedTitles: selected,
    } } };
    if (message.type !== 'READ_DOCUMENT') return { type: 'ACTIVE_TAB', tab: null };
    return { type: 'DOCUMENT_READ', requestedTitle: message.title, payload: { ...common, title: message.title, text: `${message.title}의 본문` } };
  }) } });
  const generate = vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('답변');
    return null;
  });

  await useChat.getState().openForTab(1, common.url);
  await useChat.getState().runCommand('/읽기', 'read', '', DEFAULT_SETTINGS);
  await useChat.getState().send('문서 A의 기한은?', DEFAULT_SETTINGS);
  expect(generate.mock.calls.at(-1)![1].messages.some(message => message.content.includes('문서 A의 본문'))).toBe(true);

  // 사용자가 온나라에서 다른 문서를 체크하고 다시 읽는다.
  selected = ['문서 B'];
  await useChat.getState().runCommand('/읽기', 'read', '', DEFAULT_SETTINGS);
  await useChat.getState().send('이 문서의 기한은?', DEFAULT_SETTINGS);

  const context = generate.mock.calls.at(-1)![1].messages;
  expect(context.some(message => message.content.includes('문서 B의 본문'))).toBe(true);
  expect(context.some(message => message.content.includes('문서 A의 본문'))).toBe(false);
  expect(context.some(message => message.content.includes('문서 A의 기한은?'))).toBe(false);
  // 화면 기록은 지우지 않는다.
  expect(useChat.getState().messages.map(message => message.content)).toContain('문서 A의 기한은?');
});

it('본문 칩의 ×로 본문을 떼면 그 문서에 대한 문답도 모델 문맥에서 빠진다', async () => {
  const page = { url: 'https://onnara.test/doc', title: '문서 A', text: '문서 A의 본문', charCount: 20,
    truncated: false, keptRatio: 1, estimatedTokens: 10, method: 'innerText' as const, extractedAt: Date.now() };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ type: 'PAGE_EXTRACTED', payload: page })) } });
  const generate = vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('답변');
    return null;
  });

  await useChat.getState().openForTab(1, page.url);
  await useChat.getState().attachPage(1, DEFAULT_SETTINGS, true);
  await useChat.getState().send('이 문서의 기한은?', DEFAULT_SETTINGS);
  useChat.getState().detachPage();
  await new Promise(resolve => setTimeout(resolve, 0));
  await useChat.getState().send('오늘 날씨 얘기나 하자', DEFAULT_SETTINGS);

  const context = generate.mock.calls.at(-1)![1].messages;
  expect(context.some(message => message.content.includes('문서 A의 본문'))).toBe(false);
  expect(context.some(message => message.content.includes('이 문서의 기한은?'))).toBe(false);
  expect(context.at(-1)!.content).toBe('오늘 날씨 얘기나 하자');
});

it('문맥 경계는 저장돼 대화를 다시 열어도 유지된다', async () => {
  const page = { url: 'https://onnara.test/doc', title: '문서 A', text: '문서 A의 본문', charCount: 20,
    truncated: false, keptRatio: 1, estimatedTokens: 10, method: 'innerText' as const, extractedAt: Date.now() };
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({ type: 'PAGE_EXTRACTED', payload: page })) } });
  const generate = vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('답변');
    return null;
  });

  await useChat.getState().openForTab(1, page.url);
  await useChat.getState().send('첫 질문', DEFAULT_SETTINGS);
  useChat.getState().detachPage();
  await new Promise(resolve => setTimeout(resolve, 0));

  // 패널을 닫았다 다시 연 상황
  useChat.dispose();
  useChat = createChatSessions(createChatSession);
  await useChat.getState().openForTab(1, page.url);
  expect(useChat.getState().messages.map(message => message.content)).toContain('첫 질문');
  await useChat.getState().send('다음 질문', DEFAULT_SETTINGS);
  const context = generate.mock.calls.at(-1)![1].messages;
  expect(context.some(message => message.content === '첫 질문')).toBe(false);
});
