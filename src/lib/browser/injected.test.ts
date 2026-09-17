// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import injected from '@/entrypoints/injected';
import type { ContentToSW, PageAction, RequestControl, SWToContent } from '@/lib/messaging/protocol';

let listener: (msg: SWToContent, sender: chrome.runtime.MessageSender, reply: (reply: ContentToSW) => void) => unknown;
let root: Root | undefined;
const control = (): RequestControl => ({ id: crypto.randomUUID(), deadline: Date.now() + 15000, expectedUrl: location.href });
const send = (msg: SWToContent) => new Promise<ContentToSW>(resolve => listener(msg, { id: 'ext' }, resolve));
async function approved(action: PageAction, request = control()) {
  const prepared = await send({ type: 'PREPARE', action, control: request });
  expect(prepared.type).toBe('PREPARED');
  if (prepared.type !== 'PREPARED') throw new Error('not prepared');
  return { ...request, approvalToken: prepared.token };
}
beforeEach(() => {
  document.body.innerHTML = '<div id="fixture"></div>';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', { runtime: { id: 'ext', onMessage: { addListener: vi.fn(cb => { listener = cb; }) } } });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 20 }] as unknown as DOMRectList);
  delete window.__saideInjected;
  injected.main();
});
afterEach(async () => { if (root) await act(() => root!.unmount()); root = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('승인된 입력이 React controlled input의 앱 상태에도 반영된다', async () => {
  function Form() {
    const [value, setValue] = useState('');
    return createElement('div', null,
      createElement('input', { id: 'query', value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value) }),
      createElement('output', null, value));
  }
  root = createRoot(document.getElementById('fixture')!);
  await act(() => root!.render(createElement(Form)));
  const action = { kind: 'type_text' as const, selector: '#query', text: 'local AI' };
  const request = await approved(action);
  let reply!: ContentToSW;
  await act(async () => { reply = await send({ type: 'ACT', action, control: request }); });
  expect(reply).toMatchObject({ type: 'ACTED', result: { ok: true } });
  expect(document.querySelector('output')?.textContent).toBe('local AI');
});
it('중복되거나 숨겨진 버튼은 승인 대상으로 선택하지 않는다', async () => {
  document.body.innerHTML = '<button class="duplicate">One</button><button class="duplicate">Two</button><button id="hidden" style="display:none">Hidden</button>';
  for (const selector of ['.duplicate', '#hidden']) expect(await send({ type: 'PREPARE', action: { kind: 'click', selector }, control: control() })).toMatchObject({ type: 'FAILED' });
});
it('취소가 먼저 도착한 요청의 승인 토큰이 있어도 클릭하지 않는다', async () => {
  document.body.innerHTML = '<button id="target">Click</button>';
  const click = vi.fn(); document.querySelector('button')!.addEventListener('click', click);
  const action = { kind: 'click' as const, selector: '#target' };
  const request = await approved(action);
  await send({ type: 'CANCEL', control: request });
  expect(await send({ type: 'ACT', action, control: request })).toMatchObject({ type: 'FAILED' });
  expect(click).not.toHaveBeenCalled();
});
