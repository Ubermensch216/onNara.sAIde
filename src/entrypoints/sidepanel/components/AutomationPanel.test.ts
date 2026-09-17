// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AutomationPanel } from './AutomationPanel';
import { useAutomation } from '@/lib/automation/jobs';

let root: Root;
const tab = { tabId: 7, url: 'https://onnara.test/main', title: '온나라', active: true };
const list = (selectedTitles: string[]) => ({
  type: 'PAGE_EXTRACTED',
  payload: {
    url: tab.url, title: '받은문서', text: '', charCount: 0, truncated: false, keptRatio: 1, estimatedTokens: 0, method: 'onnara-document-list', extractedAt: 1,
    structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '문서 A' }, { title: '문서 B' }, { title: '문서 C' }], selectedTitles },
  },
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useAutomation.setState({ jobs: [], loaded: false });
  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });

async function settle() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

it('목록에서 체크한 문서를 실행 직전에 다시 읽어 첨부를 받고, 기록의 경로로 파일을 연다', async () => {
  let selection = ['문서 A'];
  const sendMessage = vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return list(selection);
    if (message.type === 'DOWNLOAD_ATTACHMENTS') return { type: 'ATTACHMENTS_DOWNLOADED', results: [{ name: `${message.title}.hwpx`, status: 'complete', downloadId: message.title === '문서 A' ? 11 : 12, path: `C:\\Downloads\\${message.title}.hwpx` }] };
    return { type: 'ACTIVE_TAB', tab: null };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } } });
  const onDownloadLink = vi.fn();
  await act(() => root.render(createElement(AutomationPanel, { tab, onDownloadLink })));
  await settle();
  expect(document.querySelector('.auto-target')!.textContent).toContain('선택 1건 / 전체 3건');

  // 패널을 연 뒤 사용자가 온나라 목록에서 체크를 하나 더 했다.
  selection = ['문서 A', '문서 C'];
  await act(async () => document.querySelector<HTMLButtonElement>('.auto-card')!.click());
  await settle();
  const downloads = sendMessage.mock.calls.map(([message]) => message).filter(message => message.type === 'DOWNLOAD_ATTACHMENTS');
  expect(downloads.map(message => [message.title, (message as { keepWorkTab?: boolean }).keepWorkTab])).toEqual([['문서 A', true], ['문서 C', true]]);
  expect(sendMessage.mock.calls.some(([message]) => message.type === 'RELEASE_WORK_TAB')).toBe(true);

  const rows = [...document.querySelectorAll('.auto-job')];
  expect(rows.map(row => row.querySelector('.auto-status')!.textContent)).toEqual(['완료', '완료']);
  // 긴 저장 경로 대신 파일 이름을 보이고, 전체 경로는 툴팁으로 확인한다.
  const path = [...document.querySelectorAll<HTMLButtonElement>('.auto-path')].find(button => button.textContent === '문서 A.hwpx')!;
  expect(path.title).toContain('C:\\Downloads\\문서 A.hwpx');
  path.click();
  expect(onDownloadLink).toHaveBeenCalledWith('open', 11);
});

it('목록에서 아무것도 체크하지 않았으면 첨부 받기를 막고 체크를 안내한다', async () => {
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => list([])) }, storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() } } });
  await act(() => root.render(createElement(AutomationPanel, { tab, onDownloadLink: vi.fn() })));
  await settle();
  const card = document.querySelector<HTMLButtonElement>('.auto-card')!;
  expect(card.disabled).toBe(true);
  expect(card.textContent).toContain('목록에서 문서를 체크하세요');
});
