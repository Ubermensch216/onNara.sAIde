// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { useChat } from '@/lib/chat/store';
import { addTask, deleteAllTasks, listTasks, useSchedule } from '@/lib/schedule/store';
import * as storage from '@/lib/storage/db';
import * as stream from '@/lib/ollama/stream';
import * as client from '@/lib/ollama/client';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import type { SWToPanel, TabSummary } from '@/lib/messaging/protocol';

/**
 * 패널의 탭 동기화 배선 시험.
 *
 * ★ 온나라 목록에서 문서를 열면 **다른 창에 팝업**이 뜬다. 예전에는 그 팝업의 활성화
 *   이벤트만으로 패널이 빈 대화로 갈아끼워졌다 — 화면이 바뀌고 방금까지의 문답이 사라졌다.
 */

let root: Root;
let listeners: Array<(msg: SWToPanel) => void> = [];
let sendMessage: ReturnType<typeof vi.fn>;

const LIST_URL = 'https://onnara.test/list';
const PANEL_WINDOW = 10;

const listTab: TabSummary = { tabId: 1, url: LIST_URL, title: '받은문서', active: true, windowId: PANEL_WINDOW };

function push(msg: SWToPanel) {
  for (const listener of [...listeners]) listener(msg);
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom에는 matchMedia가 없다. 테마 판정에만 쓰이므로 라이트로 고정한다.
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  // jsdom은 레이아웃이 없어 스크롤을 구현하지 않는다. 메시지 목록이 끝으로 내리는 호출만 받아 준다.
  Element.prototype.scrollIntoView = vi.fn();
  await storage.deleteAllConversations();
  listeners = [];
  localStorage.clear();
  sendMessage = vi.fn(async (message: { type: string; windowId?: number }) => {
    if (message.type === 'GET_ACTIVE_TAB') return { type: 'ACTIVE_TAB', tab: listTab };
    return { type: 'ACTIVE_TAB', tab: null };
  });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('오프라인'); }));
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: (fn: (msg: SWToPanel) => void) => listeners.push(fn),
        removeListener: (fn: (msg: SWToPanel) => void) => { listeners = listeners.filter(item => item !== fn); },
      },
    },
    windows: { getCurrent: vi.fn(async () => ({ id: PANEL_WINDOW })) },
    // 사이트 권한은 허용된 것으로 둔다. 여기서 보려는 것은 권한 대화상자가 아니라 배선이다.
    permissions: { request: vi.fn(async () => true), contains: vi.fn(async () => true) },
    tabs: { get: vi.fn(async () => ({ id: 1, url: LIST_URL })), query: vi.fn(async () => [{ id: 1, url: LIST_URL, active: true }]) },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('답변');
    return null;
  });
  useSchedule.setState({ focus: null });
  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

/**
 * 입력창에 글자를 넣는다. 제어 컴포넌트라 value를 직접 바꾸면 리액트가 모르므로,
 * 네이티브 setter로 넣고 input 이벤트를 흘려 onChange를 태운다.
 */
function typeInComposer(text: string) {
  const el = document.querySelector('textarea')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  setValue.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function pressEnter() {
  document.querySelector('textarea')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

/** 기억을 켠 상태로 패널을 띄운다. */
async function panelWithMemory(memoryEnabled: boolean) {
  chrome.storage.local.get = vi.fn(async () => ({ 'saide.settings': { ...DEFAULT_SETTINGS, memoryEnabled } }));
  await act(() => root.render(createElement(App)));
  await settle();
}

/** 목록 탭에서 대화를 하나 시작한 상태로 패널을 띄운다. */
async function panelWithConversation() {
  await act(() => root.render(createElement(App)));
  await settle();
  await act(async () => { await useChat.getState().send('목록에 무엇이 있나요', DEFAULT_SETTINGS); });
  await settle();
  const conversation = useChat.getState().conversation;
  expect(conversation).not.toBeNull();
  return conversation!.id;
}

/*
 * ★ `/기억`만 치고 Enter를 누르면 입력만 사라지고 아무 일도 없었다. runSlash가
 *   맨 위에서 입력창을 비운 뒤 인자가 없다고 조용히 return했기 때문이다.
 *   사용자에게는 명령이 먹통인 것과 구별되지 않는다.
 */
it('/기억을 찾을 말 없이 치면 입력을 되돌리고 무엇을 적을지 알린다', async () => {
  await panelWithMemory(true);
  // 스토어는 시험 사이에 살아남는다. 앞 시험이 남긴 배너로 통과하지 않게 지운다.
  act(() => useChat.getState().clearError());

  await act(async () => { typeInComposer('/기억'); });
  await act(async () => { pressEnter(); });
  await settle();

  expect(useChat.getState().error?.code).toBe('MEMORY_QUERY_REQUIRED');
  expect(document.querySelector('textarea')!.value).toBe('/기억 ');
  // 근거 없이 모델을 부르지 않는다.
  expect(useChat.getState().messages).toHaveLength(0);
});

/*
 * ★ 꺼져 있을 때 명령을 목록에서 빼면 `/기억`이 명령으로 잡히지 않고 그대로
 *   모델에게 문장으로 전송된다 — 명령이 사라진 것처럼 보이고 토큰까지 쓴다.
 */
it('기억이 꺼져 있으면 /기억을 모델에게 보내지 않고 켜는 길을 알린다', async () => {
  await panelWithMemory(false);
  act(() => useChat.getState().clearError());

  await act(async () => { typeInComposer('/기억'); });
  await act(async () => { pressEnter(); });
  await settle();

  expect(useChat.getState().error?.code).toBe('MEMORY_OFF');
  expect(useChat.getState().messages).toHaveLength(0);
});

it('@를 치면 `@` 그룹만 뜨고 어느 탭으로 가는지 뱃지로 알린다', async () => {
  await act(() => root.render(createElement(App)));
  await settle();

  await act(async () => { typeInComposer('@'); });
  await settle();

  const items = [...document.querySelectorAll('.slashmenu [role="option"]')].map(item => item.textContent ?? '');
  expect(items).toHaveLength(3);
  expect(items.join('|')).toContain('@브리핑');
  expect(items.join('|')).toContain('@일정');
  expect(items.join('|')).toContain('@첨부');
  // `/` 그룹은 섞이지 않는다.
  expect(items.join('|')).not.toContain('/요약');
  expect(document.querySelectorAll('.slash-badge.opens')).toHaveLength(3);
});

/*
 * ★ 실행했다고 화면을 옮기지 않는다. 사용자는 지시한 자리에서 결과를 읽고 다음 지시를
 *   잇는 중이다. 화면이 통째로 바뀌면 방금 무엇을 시켰는지, 답이 무엇이었는지가 함께 사라진다.
 */
it('@일정 조회는 AI 화면에 머무르고, 링크를 눌러야 일정 탭으로 간다', async () => {
  await deleteAllTasks();
  const id = await addTask({ title: '5월 정산', status: 'todo', dueDate: '2026-05-14' });
  // 인자가 붙은 명령은 자동완성이 닫힌 채 Enter로 들어간다 — 그 길은 입력창이 잠겨 있으면 막힌다.
  vi.spyOn(client, 'checkHealth').mockResolvedValue({ state: 'ok', models: [], resident: true, onGpu: true });
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('{"intent":"schedule.list","payload":{"from":"2026-05-01","to":"2026-05-31"}}');
    return null;
  });
  await act(() => root.render(createElement(App)));
  await settle();
  act(() => useChat.getState().clearError());

  await act(async () => { typeInComposer('@일정 5월 일정 보여줘'); });
  await act(async () => { pressEnter(); });
  await settle();

  // 화면은 그대로다.
  expect(document.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toContain('AI');
  expect(await listTasks()).toHaveLength(1);

  // 답변 안에 그 항목으로 가는 길이 있다.
  const link = document.querySelector<HTMLAnchorElement>(`a[href="#saide-goto=schedule:task:${id}"]`);
  expect(link).not.toBeNull();

  await act(async () => { link!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();

  expect(document.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toContain('일정');
  // 링크가 짚은 항목이 강조된 채로 보인다.
  expect(document.querySelector('.sched-task.lit')!.textContent).toContain('5월 정산');
});

/*
 * ★ `/기억`과 같은 규칙이다. 이름만 치고 Enter를 누르면 입력만 사라지고 아무 일도
 *   없었던 예전 동작은, 사용자에게 명령이 먹통인 것과 구별되지 않는다.
 */
it('@일정을 할 말 없이 치면 입력을 되돌리고 예문을 알린다', async () => {
  await act(() => root.render(createElement(App)));
  await settle();
  act(() => useChat.getState().clearError());

  await act(async () => { typeInComposer('@일정'); });
  await act(async () => { pressEnter(); });
  await settle();

  expect(useChat.getState().error?.code).toBe('SCHEDULE_INPUT_REQUIRED');
  expect(document.querySelector('textarea')!.value).toBe('@일정 ');
  // 근거 없이 모델을 부르지 않는다.
  expect(useChat.getState().messages).toHaveLength(0);
});

/*
 * ★ 옮겨 간 이름을 예전 접두 문자로 쳤을 때, 그 입력이 그대로 모델에게 문장으로
 *   전송되면 명령이 사라진 것처럼 보이고 토큰까지 쓴다.
 */
it('/첨부로 쳐도 @첨부 명령으로 실행되고, 화면은 AI에 머무른다', async () => {
  await act(() => root.render(createElement(App)));
  await settle();
  act(() => useChat.getState().clearError());

  await act(async () => { typeInComposer('/첨부'); });
  await act(async () => { pressEnter(); });
  await settle();

  // 문장으로 모델에게 가지 않았다 — 명령으로 잡혔다.
  expect(useChat.getState().messages.some(message => message.content === '/첨부')).toBe(false);
  expect(useChat.getState().messages.some(message => message.content === '@첨부')).toBe(true);
  // 실행했다고 화면을 옮기지 않는다.
  expect(document.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toContain('AI');
});

it('다른 창에 뜬 문서 팝업으로 옮겨도 대화는 그대로고 읽을 대상만 그 팝업이 된다', async () => {
  const id = await panelWithConversation();

  await act(async () => {
    push({ type: 'TAB_CHANGED', tab: { tabId: 7, url: 'https://onnara.test/doc/123', title: '문서', active: true, windowId: 42, openedFrom: 1 } });
  });
  await settle();

  expect(useChat.getState().conversation!.id).toBe(id);
  expect(useChat.getState().messages.map(message => message.content)).toContain('목록에 무엇이 있나요');
  expect(useChat.getState().currentUrl).toBe('https://onnara.test/doc/123');
  expect(useChat.getState().conversation!.tabId).toBe(7);
});

it('패널과 상관없는 다른 창의 탭 전환은 대화를 건드리지 않는다', async () => {
  const id = await panelWithConversation();

  await act(async () => {
    push({ type: 'TAB_CHANGED', tab: { tabId: 30, url: 'https://news.test/article', title: '기사', active: true, windowId: 77 } });
  });
  await settle();

  expect(useChat.getState().conversation!.id).toBe(id);
  expect(useChat.getState().currentUrl).toBe(LIST_URL);
});

it('문서 팝업을 닫으면 패널이 있는 창의 탭으로 되돌아오고 같은 대화를 이어간다', async () => {
  const id = await panelWithConversation();
  await act(async () => {
    push({ type: 'TAB_CHANGED', tab: { tabId: 7, url: 'https://onnara.test/doc/123', title: '문서', active: true, windowId: 42, openedFrom: 1 } });
  });
  await settle();

  await act(async () => { push({ type: 'TAB_CLOSED', tabId: 7 }); });
  await settle();

  // 패널이 있는 창을 지정해 다시 물어본다. 워커의 "마지막 초점 창"을 믿지 않는다.
  expect(sendMessage.mock.calls.some(([message]) => message.type === 'GET_ACTIVE_TAB' && message.windowId === PANEL_WINDOW)).toBe(true);
  expect(useChat.getState().conversation!.id).toBe(id);
  expect(useChat.getState().currentUrl).toBe(LIST_URL);
  expect(useChat.getState().conversation!.tabId).toBe(1);
});

it('같은 창에서 다른 문서 탭으로 옮기면 그 문서의 대화로 갈아끼운다', async () => {
  const id = await panelWithConversation();

  await act(async () => {
    push({ type: 'TAB_CHANGED', tab: { tabId: 2, url: 'https://onnara.test/other', title: '다른 문서', active: true, windowId: PANEL_WINDOW } });
  });
  await settle();

  expect(useChat.getState().conversation?.id).not.toBe(id);
  expect(useChat.getState().messages).toHaveLength(0);
});

it('탭 주소가 그대로인 채 화면만 바뀌면 붙어 있던 본문을 떼어낸다', async () => {
  await panelWithConversation();
  const page = { url: LIST_URL, title: '받은문서', text: '문서 A의 본문', charCount: 20, truncated: false,
    keptRatio: 1, estimatedTokens: 10, method: 'innerText' as const, extractedAt: Date.now() - 1000, sourceFrameId: 5 };
  sendMessage.mockImplementation(async (message: { type: string }) =>
    message.type === 'EXTRACT_PAGE' ? { type: 'PAGE_EXTRACTED', payload: page } : { type: 'ACTIVE_TAB', tab: listTab });
  await act(async () => { await useChat.getState().attachPage(1, DEFAULT_SETTINGS); });
  expect(useChat.getState().page).not.toBeNull();

  await act(async () => { push({ type: 'SCREEN_CHANGED', tabId: 1, frameId: 5, url: 'https://onnara.test/doc/123' }); });
  await act(async () => { await useChat.getState().send('이 문서 요약해줘', DEFAULT_SETTINGS); });
  await settle();

  expect(useChat.getState().page).toBeNull();
  expect(useChat.getState().messages.at(-1)!.notice).toContain('페이지가 바뀌어');
});

it('다른 탭에서 일어난 화면 변화는 지금 보고 있는 본문을 떼지 않는다', async () => {
  await panelWithConversation();
  const page = { url: LIST_URL, title: '받은문서', text: '문서 A의 본문', charCount: 20, truncated: false,
    keptRatio: 1, estimatedTokens: 10, method: 'innerText' as const, extractedAt: Date.now() - 1000, sourceFrameId: 5 };
  sendMessage.mockImplementation(async (message: { type: string }) =>
    message.type === 'EXTRACT_PAGE' ? { type: 'PAGE_EXTRACTED', payload: page } : { type: 'ACTIVE_TAB', tab: listTab });
  await act(async () => { await useChat.getState().attachPage(1, DEFAULT_SETTINGS); });

  await act(async () => { push({ type: 'SCREEN_CHANGED', tabId: 99, frameId: 5, url: 'https://other.test/' }); });
  await act(async () => { await useChat.getState().send('이 문서 요약해줘', DEFAULT_SETTINGS); });
  await settle();

  expect(useChat.getState().page).not.toBeNull();
});
