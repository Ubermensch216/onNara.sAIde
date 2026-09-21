// @vitest-environment jsdom
/**
 * 공유/공람 탭의 오류 배너.
 *
 * ★ 배너의 "권한 허용"이 실제로 권한을 요청해야 한다. 예전에는 이 탭만 핸들러가 비어 있어
 *   버튼을 눌러도 아무 일도 일어나지 않았다 — 목록이 다른 주소의 iframe에 실려 오는
 *   온나라에서는 브리핑 대상 지정이 여기서 막혔다.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InboxPanel } from './InboxPanel';
import { useInbox } from '@/lib/inbox/panel';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';

let root: Root;
const tab = { tabId: 3, url: 'http://onnara.test/main', title: '온나라', active: true };
/** 본문 목록이 실려 오는 다른 주소. 탭 주소만 허용해서는 읽히지 않는다. */
const FRAME_ORIGIN = 'http://99.1.2.134';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useInbox.setState({ docs: [], briefing: null, lastRun: null, location: null, loaded: false, running: false, error: null, focus: null });
  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });

async function settle() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(node => node.textContent?.includes(label));
  if (!found) throw new Error(`버튼을 찾지 못했다: ${label}`);
  return found as HTMLButtonElement;
}

it('브리핑 대상 지정이 권한으로 막히면 "권한 허용"이 본문 주소까지 요청하고 지정을 다시 시도한다', async () => {
  let granted = false;
  const sendMessage = vi.fn(async (message: { type: string }) => {
    if (message.type !== 'CAPTURE_INBOX_LOCATION') return { type: 'ACTIVE_TAB', tab: null };
    return granted
      ? { type: 'INBOX_LOCATION_SAVED', listName: '받은문서' }
      : { type: 'ERROR', error: { code: 'HOST_PERMISSION_REQUIRED', message: `문서 본문이 다른 주소(${FRAME_ORIGIN})에 있어 읽을 권한이 없습니다.`, origins: [FRAME_ORIGIN] } };
  });
  const request = vi.fn(async () => { granted = true; return true; });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage, openOptionsPage: vi.fn() },
    permissions: { request, contains: vi.fn(async () => false) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
  });

  await act(() => root.render(createElement(InboxPanel, { tab, settings: DEFAULT_SETTINGS, onOpenSchedule: vi.fn() })));
  await settle();

  await act(async () => button('이 화면을 브리핑 대상으로 지정').click());
  await settle();
  expect(document.querySelector('.banner')!.textContent).toContain(FRAME_ORIGIN);

  await act(async () => button('권한 허용').click());
  await settle();

  // 탭 주소와 본문 프레임 주소를 한 번의 대화상자로 함께 요청한다.
  expect(request).toHaveBeenCalledWith({ origins: ['http://onnara.test/*', `${FRAME_ORIGIN}/*`] });
  // 허용한 뒤에는 사용자가 버튼을 다시 찾지 않아도 지정이 이어진다.
  expect(sendMessage.mock.calls.filter(([message]) => message.type === 'CAPTURE_INBOX_LOCATION')).toHaveLength(2);
  expect(useInbox.getState().error).toBeNull();
});
