// @vitest-environment jsdom
/**
 * 첫 실행 안내 (B3).
 *
 * ★ 여기서 지키는 것 둘.
 *   ① **어느 장에서든 닫을 수 있다.** 읽지 않고 닫는 안내는 없는 것과 같으므로 길을 막지 않는다.
 *   ② 닫으면 본 것으로 기록된다. 기록하지 않으면 패널을 열 때마다 같은 안내를 닫아야 한다.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Onboarding } from './Onboarding';
import { ONBOARDING_KEY, ONBOARDING_VERSION } from '@/lib/storage/onboarding';

let root: Root;
let stored: Record<string, unknown>;
const onClose = vi.fn();

beforeEach(() => {
  stored = {};
  onClose.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => ({})),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items); }),
  } } });
  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

const render = () => act(() => root.render(createElement(Onboarding, { onClose })));
const next = () => document.querySelector<HTMLButtonElement>('.onboard-next')!;
const title = () => document.querySelector('.onboard-title')!.textContent;

it('세 장을 차례로 넘기고 마지막에 닫는다', async () => {
  await render();
  expect(document.querySelector('.onboard-step')!.textContent).toBe('1 / 3');
  expect(title()).toContain('목록에서 처리');

  await act(async () => next().click());
  expect(title()).toContain('다른 탭에 남습니다');

  await act(async () => next().click());
  expect(document.querySelector('.onboard-step')!.textContent).toBe('3 / 3');

  await act(async () => next().click());
  expect(onClose).toHaveBeenCalled();
});

it('이전으로 돌아갈 수 있다', async () => {
  await render();
  await act(async () => next().click());
  await act(async () => document.querySelector<HTMLButtonElement>('.onboard-actions .minibtn')!.click());
  expect(document.querySelector('.onboard-step')!.textContent).toBe('1 / 3');
});

// ★ 첫 장에서 바로 나갈 수 있어야 한다. 끝까지 봐야 닫히는 안내는 방해다.
it('★ 어느 장에서든 건너뛰면 본 것으로 기록하고 닫는다', async () => {
  await render();
  await act(async () => document.querySelector<HTMLButtonElement>('.onboard-skip')!.click());

  expect(onClose).toHaveBeenCalled();
  expect(stored[ONBOARDING_KEY]).toBe(ONBOARDING_VERSION);
});

it('Esc로도 닫힌다', async () => {
  await render();
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(onClose).toHaveBeenCalled();
});
