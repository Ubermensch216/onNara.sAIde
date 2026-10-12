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
  expect(cards().map(card => card.disabled)).toEqual([false, false]);
});

it('눈치코치 꾸러미: 체크한 문서를 본문+첨부로 한 폴더에 받고 package.json을 그 폴더에 남긴다', async () => {
  type Download = { type: string; title?: string; mode?: string; naming?: { root?: string; folder?: boolean; rename?: boolean } };
  const sendMessage = vi.fn(async (message: Download) => {
    if (message.type === 'EXTRACT_PAGE') return list(['문서 A', '문서 C']);
    if (message.type === 'DOWNLOAD_ATTACHMENTS') {
      const folder = `C:\\Downloads\\${message.naming!.root!.replace(/\//g, '\\')}\\${message.title}`;
      return { type: 'ATTACHMENTS_DOWNLOADED', results: [
        { name: `${message.title}_본문.pdf`, status: 'complete', downloadId: 1, path: `${folder}\\download.pdf`, generated: true },
        { name: '붙임.hwpx', status: 'complete', downloadId: 2, path: `${folder}\\붙임.hwpx` },
      ] };
    }
    return { type: 'ACTIVE_TAB', tab: null };
  });
  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:package'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const download = vi.fn(async (_options: { url: string; filename: string }) => 31);
  vi.stubGlobal('chrome', {
    runtime: { sendMessage, getManifest: () => ({ version: '9.9.9' }) },
    downloads: { download, search: vi.fn(async () => [{ state: 'complete', filename: 'C:\\Downloads\\package.json' }]) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
  });
  await act(() => root.render(createElement(AutomationPanel, { tab, onDownloadLink: vi.fn() })));
  await settle();

  const card = [...document.querySelectorAll<HTMLButtonElement>('.auto-card')].find(button => button.textContent!.includes('눈치코치 꾸러미'))!;
  await act(async () => card.click());
  await settle();

  const downloads = sendMessage.mock.calls.map(([message]) => message).filter(message => message.type === 'DOWNLOAD_ATTACHMENTS');
  // 받기 대상 선택(첨부만)과 무관하게 본문+첨부를 받고, 파일명 설정과 무관하게 꾸러미 폴더에 모은다.
  expect(downloads.map(message => [message.title, message.mode, message.naming?.folder, message.naming?.rename])).toEqual([['문서 A', 'all', true, false], ['문서 C', 'all', true, false]]);
  const packageRoot = downloads[0]!.naming!.root!;
  expect(packageRoot).toMatch(/^onNara\.sAIde\/수집\/\d{8}_\d{6}_[0-9a-f]{4}$/);
  expect(downloads[1]!.naming!.root).toBe(packageRoot);

  expect(download).toHaveBeenCalledTimes(1);
  expect(download.mock.calls[0]![0].filename).toBe(`${packageRoot}/package.json`);
  const saved = JSON.parse(await blobs[0]!.text());
  expect(saved).toMatchObject({ format: 'saide-onnara-package', version: 1, exporter: { version: '9.9.9' }, system: { origin: 'https://onnara.test' }, scope: { kind: 'selection', list_name: '받은문서' } });
  expect(saved.documents.map((item: { title: string; assets: Array<{ role: string; path: string; fidelity: string }> }) => [item.title, item.assets.map(asset => [asset.role, asset.path, asset.fidelity])])).toEqual([
    ['문서 A', [['body', '문서 A/download.pdf', 'rendered-text'], ['attachment', '문서 A/붙임.hwpx', 'original']]],
    ['문서 C', [['body', '문서 C/download.pdf', 'rendered-text'], ['attachment', '문서 C/붙임.hwpx', 'original']]],
  ]);

  const rows = [...document.querySelectorAll('.auto-job')];
  expect(rows[0]!.textContent).toContain('눈치코치 꾸러미');
  expect(rows[0]!.textContent).toContain('문서 2건 · 파일 4개');
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
  expect(rows[1]!.querySelector('.auto-job-summary')!.textContent).toBe('다운로드할 파일이 없습니다.');
});

it('실행할 작업에서 "첨부만", "본문만", "본문+첨부" 옵션을 선택하면 해당 mode로 요청한다', async () => {
  const sendMessage = vi.fn(async (message: { type: string; title?: string }) => {
    if (message.type === 'EXTRACT_PAGE') return list(['문서 A']);
    if (message.type === 'DOWNLOAD_ATTACHMENTS') return { type: 'ATTACHMENTS_DOWNLOADED', results: [{ name: '문서 A_본문.pdf', status: 'complete', downloadId: 101, path: 'C:\\Downloads\\문서 A_본문.pdf' }] };
    return { type: 'ACTIVE_TAB', tab: null };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } } });
  await act(() => root.render(createElement(AutomationPanel, { tab, onDownloadLink: vi.fn() })));
  await settle();

  const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('.auto-mode-btn')];
  expect(modeButtons.map(b => b.textContent)).toEqual(['첨부만', '본문만', '본문+첨부']);

  // 1. 기본은 '첨부만'
  const card = document.querySelector<HTMLButtonElement>('.auto-card')!;
  expect(card.textContent).toContain('첨부 받기');

  // 2. '본문만' 선택
  await act(async () => modeButtons[1]!.click());
  await settle();
  expect(card.textContent).toContain('본문 받기 (PDF)');

  await act(async () => card.click());
  await settle();
  let downloads = sendMessage.mock.calls.map(([message]) => message).filter(m => m.type === 'DOWNLOAD_ATTACHMENTS');
  expect((downloads[0] as { mode?: string }).mode).toBe('body');

  // 3. '본문+첨부' 선택
  await act(async () => modeButtons[2]!.click());
  await settle();
  expect(card.textContent).toContain('본문 + 첨부 받기');

  await act(async () => card.click());
  await settle();
  downloads = sendMessage.mock.calls.map(([message]) => message).filter(m => m.type === 'DOWNLOAD_ATTACHMENTS');
  expect((downloads[1] as { mode?: string }).mode).toBe('all');
});

