import { afterEach, expect, it, vi } from 'vitest';
import { chooseBestExtraction, handlePanelMessage, readDocumentInBackground } from '@/entrypoints/background';

afterEach(() => vi.unstubAllGlobals());
it('스크립트 주입을 기다리는 동안 취소하면 실행 메시지를 보내지 않는다', async () => {
  let resume!: () => void;
  let started!: () => void;
  const injected = new Promise<void>(resolve => { started = resolve; });
  const sendMessage = vi.fn(async () => ({ type: 'ACTED', result: { ok: true } }));
  vi.stubGlobal('chrome', {
    tabs: { get: vi.fn(async () => ({ id: 1, url: 'https://example.com' })), sendMessage },
    scripting: { executeScript: vi.fn(async () => { started(); await new Promise<void>(resolve => { resume = resolve; }); }) },
  });
  const control = { id: crypto.randomUUID(), deadline: Date.now() + 15000, expectedUrl: 'https://example.com', approvalToken: 'ticket' };
  const pending = handlePanelMessage({ type: 'EXEC_ACTION', tabId: 1, action: { kind: 'click', selector: '#go' }, control });
  await injected;
  await handlePanelMessage({ type: 'CANCEL_REQUEST', requestId: control.id });
  resume();
  expect(await pending).toMatchObject({ type: 'ERROR' });
  expect(sendMessage.mock.calls.some(call => (call as unknown as [number, { type: string }])[1].type === 'ACT')).toBe(false);
});

it('여러 iframe 결과 중 구조화된 온나라 문서 목록을 우선 선택한다', () => {
  const common = { truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: 1 };
  const best = chooseBestExtraction([
    {
      frameId: 0,
      frameUrl: 'https://onnara.test/',
      response: { type: 'EXTRACTED', payload: { ...common, url: 'https://onnara.test/', title: '온나라', text: '긴 일반 본문'.repeat(1000), charCount: 6000, method: 'innerText' } },
    },
    {
      frameId: 3,
      frameUrl: 'https://onnara.test/document/list',
      response: {
        type: 'EXTRACTED',
        payload: {
          ...common,
          url: 'https://onnara.test/document/list',
          title: '받은문서',
          text: '행 1 | 제목=감사자료',
          charCount: 20,
          method: 'onnara-document-list',
          structuredData: {
            kind: 'onnara-document-list',
            listName: '받은문서',
            columns: [{ key: 'title', label: '제목', sourceIndex: 1 }],
            rows: [{ title: '감사자료' }],
          },
        },
      },
    },
  ]);
  expect(best?.frameId).toBe(3);
});

it('추출 요청은 접근 가능한 iframe을 모두 읽고 탭 URL을 첨부 기준으로 유지한다', async () => {
  const common = { truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: 1 };
  const sendMessage = vi.fn(async (_tabId: number, _message: unknown, options: { frameId: number }) => options.frameId === 2
    ? {
        type: 'EXTRACTED',
        payload: {
          ...common,
          url: 'https://onnara.test/frame/list', title: '받은문서', text: '행 1', charCount: 4,
          method: 'onnara-document-list',
          structuredData: {
            kind: 'onnara-document-list', listName: '받은문서',
            columns: [{ key: 'title', label: '제목', sourceIndex: 0 }], rows: [{ title: '문서 A' }],
          },
        },
      }
    : { type: 'EXTRACTED', payload: { ...common, url: 'https://onnara.test/main', title: '온나라', text: '일반 본문', charCount: 5, method: 'innerText' } });
  vi.stubGlobal('chrome', {
    tabs: { get: vi.fn(async () => ({ id: 9, url: 'https://onnara.test/main', title: '온나라' })), sendMessage },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [
      { frameId: 0, parentFrameId: -1, url: 'https://onnara.test/main' },
      { frameId: 2, parentFrameId: 0, url: 'https://onnara.test/frame/list' },
    ]) },
  });
  const response = await handlePanelMessage({
    type: 'EXTRACT_PAGE', tabId: 9, budgetTokens: 2000,
    control: { id: crypto.randomUUID(), deadline: Date.now() + 15_000, expectedUrl: 'https://onnara.test/main' },
  });
  expect(response).toMatchObject({
    type: 'PAGE_EXTRACTED',
    payload: {
      url: 'https://onnara.test/main',
      title: '받은문서 · 온나라',
      sourceFrameId: 2,
      sourceFrameUrl: 'https://onnara.test/frame/list',
    },
  });
  expect(sendMessage).toHaveBeenCalledWith(9, expect.objectContaining({
    control: expect.objectContaining({ expectedUrl: 'https://onnara.test/frame/list' }),
  }), { frameId: 2 });
});

it('복제한 백그라운드 탭에서 제목 문서를 열고 본문만 회수한 뒤 임시 탭을 닫는다', async () => {
  const title = '감사결과 처분요구 이행실태 특정감사 자료 제출';
  const common = { truncated: false, keptRatio: 1, estimatedTokens: 80, extractedAt: Date.now() };
  const sendMessage = vi.fn(async (_tabId: number, message: { type: string; purpose?: string }, options: { frameId: number }) => {
    if (message.type === 'OPEN_DOCUMENT') return { type: 'OPENING_DOCUMENT', title };
    if (message.purpose === 'page' && options.frameId === 2) return {
      type: 'EXTRACTED',
      payload: {
        ...common, url: 'https://onnara.test/list-frame', title: '문서등록대장', text: `행 1 | 제목=${title}`,
        charCount: 80, method: 'onnara-document-list',
        structuredData: {
          kind: 'onnara-document-list', listName: '문서등록대장',
          columns: [{ key: 'title', label: '제목', sourceIndex: 2 }], rows: [{ title }],
        },
      },
    };
    if (message.purpose === 'document-detail' && options.frameId === 2) return {
      type: 'EXTRACTED',
      payload: {
        ...common, url: 'https://onnara.test/detail-frame', title,
        text: `${title}\n감사 목적은 이행실태를 확인하는 것이며 제출기한은 9월 30일입니다.`.repeat(4),
        charCount: 300, method: 'innerText',
      },
    };
    return { type: 'EXTRACTED', payload: { ...common, url: 'https://onnara.test/main', title: '온나라', text: '업무 메뉴', charCount: 5, method: 'innerText' } };
  });
  const remove = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async (id: number) => id === 1
        ? { id: 1, url: 'https://onnara.test/main', title: '온나라', active: true, windowId: 7 }
        : { id: 20, url: 'https://onnara.test/main', title: '온나라', active: false, windowId: 7 }),
      query: vi.fn(async () => [{ id: 1, url: 'https://onnara.test/main', active: true, windowId: 7 }, { id: 20, url: 'https://onnara.test/main', active: false, windowId: 7 }]),
      duplicate: vi.fn(async () => ({ id: 20, url: 'https://onnara.test/main', active: false, windowId: 7 })),
      update: vi.fn(async () => undefined), sendMessage, remove,
    },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [
      { frameId: 0, parentFrameId: -1, url: 'https://onnara.test/main' },
      { frameId: 2, parentFrameId: 0, url: 'https://onnara.test/list-frame' },
    ]) },
  });
  const response = await readDocumentInBackground(1, title, 2000, {
    id: crypto.randomUUID(), deadline: Date.now() + 5000, expectedUrl: 'https://onnara.test/main',
  });
  expect(response).toMatchObject({ type: 'DOCUMENT_READ', requestedTitle: title, payload: { url: 'https://onnara.test/main' } });
  expect(sendMessage).toHaveBeenCalledWith(20, expect.objectContaining({ type: 'OPEN_DOCUMENT', title }), { frameId: 2 });
  expect(remove).toHaveBeenCalledWith([20]);
});
