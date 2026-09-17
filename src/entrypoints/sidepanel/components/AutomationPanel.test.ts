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

it('기억한 탭이 닫혀 읽기에 실패해도 "다시 읽기"를 누르면 지금 보고 있는 탭을 찾아 다시 준비한다', async () => {
  let activeTabs: Array<{ id: number; url: string; title: string }> = [];
  const sendMessage = vi.fn(async (message: { type: string; tabId?: number }) => message.type === 'EXTRACT_PAGE' && message.tabId === 9
    ? list(['문서 A'])
    : { type: 'ERROR', error: { code: 'UNKNOWN', message: '읽을 탭을 찾을 수 없습니다. 탭이 닫혔거나 다시 열렸을 수 있습니다.' } });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    tabs: {
      query: vi.fn(async () => activeTabs),
      // 패널이 기억한 7번 탭은 이미 닫혔다.
      get: vi.fn(async (id: number) => { throw new Error(`No tab with id: ${id}`); }),
    },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
  });
  const onTabChange = vi.fn();
  await act(() => root.render(createElement(AutomationPanel, { tab, onDownloadLink: vi.fn(), onTabChange })));
  await settle();
  const cards = () => [...document.querySelectorAll<HTMLButtonElement>('.auto-card')];
  expect(document.querySelector('.auto-error')).not.toBeNull();
  expect(cards().every(card => card.disabled)).toBe(true);

  // 사용자가 온나라 탭을 다시 열었다.
  activeTabs = [{ id: 9, url: 'https://onnara.test/main2', title: '온나라' }];
  const refresh = [...document.querySelectorAll<HTMLButtonElement>('.auto-target .minibtn')].find(button => button.textContent === '다시 읽기')!;
  await act(async () => refresh.click());
  await settle();
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXTRACT_PAGE', tabId: 9 }));
  expect(onTabChange).toHaveBeenCalledWith(expect.objectContaining({ tabId: 9, url: 'https://onnara.test/main2' }));
  expect(document.querySelector('.auto-error')).toBeNull();
  expect(cards().map(card => card.disabled)).toEqual([false]);
});

it('문서 열기에 실패하거나 첨부파일이 없어도 멈추지 않고 다음 문서로 계속 진행한다', async () => {
  const selection = ['문서 A', '문서 B', '문서 C'];
  const sendMessage = vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return list(selection);
    if (message.type === 'DOWNLOAD_ATTACHMENTS') {
      if (message.title === '문서 A') {
        return { type: 'ERROR', error: { code: 'UNKNOWN', message: '문서 열기 실패' } };
      }
      if (message.title === '문서 B') {
        return { type: 'ATTACHMENTS_DOWNLOADED', results: [] };
      }
      return { type: 'ATTACHMENTS_DOWNLOADED', results: [{ name: '문서 C.hwpx', status: 'complete', downloadId: 13, path: 'C:\\Downloads\\문서 C.hwpx' }] };
    }
    return { type: 'ACTIVE_TAB', tab: null };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } } });
  const onDownloadLink = vi.fn();
  await act(() => root.render(createElement(AutomationPanel, { tab, onDownloadLink })));
  await settle();

  await act(async () => document.querySelector<HTMLButtonElement>('.auto-card')!.click());
  await settle();

  const downloads = sendMessage.mock.calls.map(([message]) => message).filter(message => message.type === 'DOWNLOAD_ATTACHMENTS');
  expect(downloads.map(message => message.title)).toEqual(['문서 A', '문서 B', '문서 C']);

  const rows = [...document.querySelectorAll('.auto-job')];
  expect(rows.map(row => row.querySelector('.auto-status')!.textContent)).toEqual(['완료', '완료', '실패']);
  expect(rows.map(row => row.querySelector('.auto-job-title')!.textContent)).toEqual(['문서 C', '문서 B', '문서 A']);
  expect(rows[1]!.querySelector('.auto-job-summary')!.textContent).toBe('첨부 파일이 없습니다.');
});
