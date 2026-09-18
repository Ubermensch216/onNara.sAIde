// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConversationMenu } from './ConversationMenu';
import * as storage from '@/lib/storage/db';

let root: Root;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await storage.deleteAllConversations();
  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });

async function settle() {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

async function open(props: Partial<Parameters<typeof ConversationMenu>[0]> = {}) {
  const onRenamed = vi.fn();
  await act(() => root.render(createElement(ConversationMenu, {
    currentId: null, onPick: vi.fn(), onClose: vi.fn(), onDeleted: vi.fn(), onRenamed, ...props,
  })));
  await settle();
  return { onRenamed };
}

const rename = () => document.querySelector<HTMLButtonElement>('button[aria-label^="감사 자료"][aria-label$="제목 수정"]')!;
const input = () => document.querySelector<HTMLInputElement>('.conv-edit')!;

async function type(value: string) {
  const field = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(key: string) {
  await act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
  await settle();
}

it('목록에서 제목을 바로 고치고 Enter로 저장한다', async () => {
  const id = await storage.createConversation(1, 'https://onnara.test/main', '감사 자료 제출 관련 문의');
  const { onRenamed } = await open({ currentId: id });

  await act(async () => rename().click());
  expect(input().value).toBe('감사 자료 제출 관련 문의');

  await type('감사 자료 제출 - 9월 30일 기한');
  await press('Enter');

  expect((await storage.db.conversations.get(id))!.title).toBe('감사 자료 제출 - 9월 30일 기한');
  expect(onRenamed).toHaveBeenCalledWith(id, '감사 자료 제출 - 9월 30일 기한');
  // 편집이 끝나면 목록 표시로 돌아온다.
  expect(document.querySelector('.conv-edit')).toBeNull();
  expect(document.querySelector('.conv-title')!.textContent).toBe('감사 자료 제출 - 9월 30일 기한');
});

it('Esc는 제목 수정만 취소하고 대화 목록은 닫지 않는다', async () => {
  const id = await storage.createConversation(1, 'https://onnara.test/main', '감사 자료 제출 관련 문의');
  const onClose = vi.fn();
  const { onRenamed } = await open({ onClose });

  await act(async () => rename().click());
  await type('바꾸다 만 제목');
  await press('Escape');

  expect(onClose).not.toHaveBeenCalled();
  expect(onRenamed).not.toHaveBeenCalled();
  expect((await storage.db.conversations.get(id))!.title).toBe('감사 자료 제출 관련 문의');
  expect(document.querySelector('.conv-edit')).toBeNull();
});

it('빈 제목은 저장하지 않는다. 목록에서 대화를 구분할 수 없게 된다', async () => {
  const id = await storage.createConversation(1, 'https://onnara.test/main', '감사 자료 제출 관련 문의');
  const { onRenamed } = await open();

  await act(async () => rename().click());
  await type('   ');
  await press('Enter');

  expect((await storage.db.conversations.get(id))!.title).toBe('감사 자료 제출 관련 문의');
  expect(onRenamed).not.toHaveBeenCalled();
});

it('✓ 버튼으로도 저장되고, 제목 줄 클릭은 그대로 대화 열기다', async () => {
  const id = await storage.createConversation(1, 'https://onnara.test/main', '감사 자료 제출 관련 문의');
  const onPick = vi.fn();
  const { onRenamed } = await open({ onPick });

  await act(async () => rename().click());
  await type('기한 임박 문서');
  await act(async () => document.querySelector<HTMLButtonElement>('.conv-act.ok')!.click());
  await settle();
  expect((await storage.db.conversations.get(id))!.title).toBe('기한 임박 문서');
  expect(onRenamed).toHaveBeenCalledWith(id, '기한 임박 문서');

  await act(async () => document.querySelector<HTMLButtonElement>('.conv-main')!.click());
  expect(onPick).toHaveBeenCalledTimes(1);
});
