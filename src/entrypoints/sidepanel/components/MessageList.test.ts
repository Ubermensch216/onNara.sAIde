// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MessageList } from './MessageList';
import type { UiMessage } from '@/lib/chat/store';

vi.mock('./Markdown', () => ({ Markdown: ({ text }: { text: string }) => createElement('div', null, text) }));

let root: Root;
const writeText = vi.fn();
const onDelete = vi.fn();
const messages: UiMessage[] = [
  { id: 1, conversationId: 1, role: 'user', content: '사용자 질문\n두 번째 줄', createdAt: 1 },
  { id: 2, conversationId: 1, role: 'assistant', content: '**AI 답변**\n\n- 항목', createdAt: 2 },
];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
  writeText.mockReset().mockResolvedValue(undefined);
  onDelete.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

it('사용자와 AI 말풍선 아래에서 본문 전체를 복사하고 해당 메시지만 삭제한다', async () => {
  await act(() => root.render(createElement(MessageList, { messages, dark: false, showThinking: false, deleteDisabled: false, model: 'm', onDelete })));
  for (const [index, selector] of ['.msg-user', '.msg-assistant'].entries()) {
    const bubble = document.querySelector(selector)!;
    const buttons = bubble.querySelectorAll<HTMLButtonElement>('.message-actions button');
    expect(buttons).toHaveLength(2);
    await act(async () => buttons[0]!.click());
    expect(writeText).toHaveBeenLastCalledWith(messages[index]!.content);
    expect(bubble.querySelector('[role="status"]')?.textContent).toBe('복사됨');
    await act(async () => buttons[1]!.click());
    expect(onDelete).toHaveBeenLastCalledWith(messages[index]!.id);
  }
});

it('클립보드 실패를 알리고 생성 중에는 개별 삭제를 막는다', async () => {
  writeText.mockRejectedValue(new Error('denied'));
  await act(() => root.render(createElement(MessageList, { messages, dark: false, showThinking: false, deleteDisabled: true, model: 'm', onDelete })));
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="메시지 복사"]')!.click());
  expect(document.querySelector('[role="status"]')?.textContent).toContain('복사하지 못했습니다');
  for (const button of document.querySelectorAll<HTMLButtonElement>('[aria-label="메시지 삭제"]')) {
    expect(button.disabled).toBe(true);
    button.click();
  }
  expect(onDelete).not.toHaveBeenCalled();
});

it('답변 안의 다운로드 링크를 누르면 페이지 이동 없이 해당 동작을 요청한다', async () => {
  const onDownloadLink = vi.fn();
  await act(() => root.render(createElement(MessageList, { messages, dark: false, showThinking: false, deleteDisabled: false, model: 'm', onDelete, onDownloadLink })));
  const body = document.querySelector('.msg-assistant')!;
  body.insertAdjacentHTML('beforeend', '<a href="#saide-download=open:9"><span>C:\붙임.hwpx</span></a><a href="https://example.com">외부</a>');
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => { body.querySelector('a[href^="#saide-download"] span')!.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(onDownloadLink).toHaveBeenCalledWith('open', 9);
  const external = new MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => { body.querySelector('a[href^="https"]')!.dispatchEvent(external); });
  expect(external.defaultPrevented).toBe(false);
  expect(onDownloadLink).toHaveBeenCalledTimes(1);
});

it('AI 답변과 자동화 실행 결과에 서로 다른 출처 표시를 붙인다', async () => {
  const mixed: UiMessage[] = [
    { id: 1, conversationId: 1, role: 'assistant', content: '요약입니다', createdAt: 1 },
    { id: 2, conversationId: 1, role: 'assistant', content: '첨부 1건을 내려받았습니다', origin: 'automation', createdAt: 2 },
  ];
  await act(() => root.render(createElement(MessageList, { messages: mixed, dark: false, showThinking: false, deleteDisabled: false, model: 'm', onDelete })));
  expect([...document.querySelectorAll('.origin-badge')].map(badge => badge.textContent)).toEqual(['AI 생성 · 검토 필요', '자동화 실행 기록']);
});
