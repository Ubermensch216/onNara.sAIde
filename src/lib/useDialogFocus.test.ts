// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApprovalCard } from '@/entrypoints/sidepanel/components/ApprovalCard';
let root: Root;
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });
it('승인은 거부부터 시작하고 Tab을 가두며 Escape 거부 후 이전 포커스를 복원한다', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<button id="previous">Open</button><div id="fixture"></div>';
  const previous = document.getElementById('previous')!; previous.focus();
  const decide = vi.fn();
  root = createRoot(document.getElementById('fixture')!);
  await act(() => root.render(createElement(ApprovalCard, { request: { action: { kind: 'click', selector: '#test' }, humanDescription: 'Click', pageUrl: 'https://example.com', pageTitle: 'Test' }, onDecide: decide })));
  const deny = document.querySelector<HTMLElement>('.btn-deny')!;
  const allow = document.querySelector<HTMLElement>('.btn-allow')!;
  expect(document.activeElement).toBe(deny);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }));
  expect(document.activeElement).toBe(allow);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
  expect(document.activeElement).toBe(deny);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  expect(decide).toHaveBeenCalledWith(false);
  await act(() => root.render(null));
  expect(document.activeElement).toBe(previous);
});
