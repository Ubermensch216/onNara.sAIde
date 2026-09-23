import { afterEach, expect, it, vi } from 'vitest';
import { chooseBestExtraction, handlePanelMessage, mergeDetailFrames, notifyScreenChange, readDocumentInBackground, releaseKeptWorkTab, toSummary } from '@/entrypoints/background';
import { forgetPanelSpawn, notePanelSpawn, rememberPanelTab, resetPanelSpawns } from '@/lib/browser/panel-sync';
import { noteNavigationTarget, noteTopCommit, workTabs } from '@/lib/browser/work-tabs';

afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); (await import('@/lib/browser/sw-lock')).resetWorkTabLock(); });
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
    if (message.type === 'LOCATE_DOCUMENT') return { type: 'DOCUMENT_LOCATED', location: { url: 'https://onnara.test/list-frame', framePath: [0] } };
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
    id: crypto.randomUUID(), deadline: Date.now() + 15000, expectedUrl: 'https://onnara.test/main',
  });
  expect(response).toMatchObject({ type: 'DOCUMENT_READ', requestedTitle: title, payload: { url: 'https://onnara.test/main' } });
  expect(sendMessage).toHaveBeenCalledWith(20, expect.objectContaining({ type: 'OPEN_DOCUMENT', title }), { frameId: 2 });
  expect(remove).toHaveBeenCalledWith([20]);
});

it.each(['success', 'missing', 'cancelled'] as const)('복제 목록 복원(%s): 원본을 보존하고 임시 탭을 정리한다', async outcome => {
  vi.useFakeTimers();
  const title = '선택한 문서';
  const common = { url: 'https://onnara.test/main', title: '온나라', text: '메뉴', charCount: 2, method: 'innerText', truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: Date.now() };
  const location = { url: 'https://onnara.test/list', framePath: [0], form: { method: 'post', fields: [['pageIndex', '3']] } };
  let restored = false;
  const sendMessage = vi.fn(async (id: number, msg: { type: string; purpose?: string }, options: { frameId: number }) => {
    if (msg.type === 'LOCATE_DOCUMENT') return { type: 'DOCUMENT_LOCATED', location };
    if (msg.type === 'RESTORE_DOCUMENT_LIST') { restored = true; return { type: 'DOCUMENT_LIST_RESTORED', restored: true }; }
    if (msg.type === 'OPEN_DOCUMENT') return { type: 'OPENING_DOCUMENT', title };
    if (msg.purpose === 'document-detail') return { type: 'EXTRACTED', payload: { ...common, title, text: `${title} 본문`.repeat(40), charCount: 400 } };
    if ((id === 1 || (restored && outcome === 'success')) && options.frameId === 2) return { type: 'EXTRACTED', payload: {
      ...common, structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '선택한\u200b  문서' }] },
    } };
    return { type: 'EXTRACTED', payload: common };
  });
  const remove = vi.fn(async () => undefined);
  const update = vi.fn();
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: common.url, active: id === 1 })),
      query: vi.fn(async () => [{ id: 1 }]), duplicate: vi.fn(async () => ({ id: 20 })),
      sendMessage, remove, update,
    },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0, url: common.url }, { frameId: 2, url: location.url }]) },
  });
  const requestId = crypto.randomUUID();
  const pending = readDocumentInBackground(1, title, 2000, { id: requestId, deadline: Date.now() + 120_000, expectedUrl: common.url });
  if (outcome === 'cancelled') {
    await vi.advanceTimersByTimeAsync(500);
    await handlePanelMessage({ type: 'CANCEL_REQUEST', requestId });
  }
  await vi.advanceTimersByTimeAsync(outcome === 'missing' ? 41_000 : 4000);
  if (outcome === 'success') {
    expect(await pending).toMatchObject({ type: 'DOCUMENT_READ', requestedTitle: title });
    expect(sendMessage).toHaveBeenCalledWith(20, expect.objectContaining({ type: 'OPEN_DOCUMENT' }), { frameId: 2 });
  } else if (outcome === 'missing') {
    // 복제 탭(20) 복원이 실패하면 원본 탭(1) 화면의 문서를 통해 계속 진행한다.
    expect(await pending).toMatchObject({ type: 'DOCUMENT_READ', requestedTitle: title });
    expect(sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'OPEN_DOCUMENT' }), { frameId: 2 });
  } else {
    expect(await pending).toMatchObject({ type: 'ERROR', error: { code: 'ABORTED' } });
    expect(sendMessage.mock.calls.some(([, msg]) => msg.type === 'OPEN_DOCUMENT')).toBe(false);
  }
  // 복원 요청은 모든 프레임에 동시에 묻고(부모 경로가 맞는 프레임만 실제 전송), 목록이 없으면 최대 3회 반복한다.
  expect(sendMessage.mock.calls.filter(([, msg]) => msg.type === 'RESTORE_DOCUMENT_LIST')).toHaveLength({ cancelled: 0, success: 2, missing: 6 }[outcome]);
  expect(sendMessage.mock.calls.filter(([id, msg]) => id === 1).every(([, msg]) => ['EXTRACT', 'LOCATE_DOCUMENT', 'OPEN_DOCUMENT', 'CHECK_DIALOG'].includes(msg.type))).toBe(true);
  expect(update).not.toHaveBeenCalled();
  expect(remove).toHaveBeenCalledWith([20]);
});

it('복제 탭 복원에 실패하고 원본 탭에서도 더 이상 문서를 찾을 수 없으면 오류를 알린다', async () => {
  vi.useFakeTimers();
  const title = '사라진 문서';
  const common = { url: 'https://onnara.test/main', title: '온나라', text: '메뉴', charCount: 2, method: 'innerText' as const, truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: Date.now() };
  const location = { url: 'https://onnara.test/list', framePath: [0], form: { method: 'post' as const, fields: [] } };
  let originalCalls = 0;
  const sendMessage = vi.fn(async (id: number, msg: { type: string }, options: { frameId: number }) => {
    if (msg.type === 'LOCATE_DOCUMENT') return { type: 'DOCUMENT_LOCATED', location };
    if (msg.type === 'RESTORE_DOCUMENT_LIST') return { type: 'DOCUMENT_LIST_RESTORED', restored: false };
    if (id === 1 && options.frameId === 2) {
      originalCalls++;
      // 첫 확인 때는 문서가 있었으나, 폴백 재확인 시점에는 문서가 사라진 상황
      if (originalCalls === 1) {
        return { type: 'EXTRACTED', payload: {
          ...common, structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title }] },
        } };
      }
    }
    return { type: 'EXTRACTED', payload: common };
  });
  const remove = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: common.url, active: id === 1 })),
      query: vi.fn(async () => [{ id: 1 }]), duplicate: vi.fn(async () => ({ id: 20 })),
      sendMessage, remove, update: vi.fn(),
    },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0, url: common.url }, { frameId: 2, url: location.url }]) },
  });
  const pending = readDocumentInBackground(1, title, 2000, { id: crypto.randomUUID(), deadline: Date.now() + 120_000, expectedUrl: common.url });
  await vi.advanceTimersByTimeAsync(41_000);
  expect(await pending).toMatchObject({ type: 'ERROR', error: { code: 'UNKNOWN', hint: expect.stringContaining('복원 시도 3회') } });
  expect(remove).toHaveBeenCalledWith([20]);
});

it('복제 탭 로딩이 끝난 뒤 복원하고, 첫 복원이 덮어써지면 다시 복원한다', async () => {
  vi.useFakeTimers();
  const title = '부산광역시 공공 홍보매체 통합DB 구축을 위한 현황 조사 협조 요청';
  const common = { url: 'https://onnara.test/main', title: '온나라', text: '메뉴', charCount: 2, method: 'innerText', truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: Date.now() };
  const location = { url: 'https://onnara.test/list', framePath: [0] };
  let workStatus = 'loading';
  const restoredAt: number[] = [];
  const sendMessage = vi.fn(async (id: number, msg: { type: string; purpose?: string }, options: { frameId: number }) => {
    if (msg.type === 'LOCATE_DOCUMENT') return { type: 'DOCUMENT_LOCATED', location };
    if (msg.type === 'RESTORE_DOCUMENT_LIST') {
      if (options.frameId !== 0) return { type: 'DOCUMENT_LIST_RESTORED', restored: false };
      restoredAt.push(Date.now());
      return { type: 'DOCUMENT_LIST_RESTORED', restored: true };
    }
    if (msg.type === 'OPEN_DOCUMENT') return { type: 'OPENING_DOCUMENT', title };
    if (msg.purpose === 'document-detail') return { type: 'EXTRACTED', payload: { ...common, title, text: `${title} 본문`.repeat(10), charCount: 400 } };
    // 첫 복원 결과는 복제 탭의 뒤늦은 초기 이동에 덮어써져 첫 화면만 남는다.
    if ((id === 1 || restoredAt.length >= 2) && options.frameId === 2) return { type: 'EXTRACTED', payload: {
      ...common, structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title }] },
    } };
    return { type: 'EXTRACTED', payload: common };
  });
  const remove = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: common.url, active: id === 1, status: id === 20 ? workStatus : 'complete' })),
      query: vi.fn(async () => [{ id: 1 }]), duplicate: vi.fn(async () => ({ id: 20 })),
      sendMessage, remove, update: vi.fn(),
    },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0, url: common.url }, { frameId: 2, url: location.url }]) },
  });
  const started = Date.now();
  const pending = readDocumentInBackground(1, title, 2000, { id: crypto.randomUUID(), deadline: Date.now() + 120_000, expectedUrl: common.url });
  await vi.advanceTimersByTimeAsync(4000);
  expect(restoredAt).toHaveLength(0);
  workStatus = 'complete';
  await vi.advanceTimersByTimeAsync(12_000);
  expect(await pending).toMatchObject({ type: 'DOCUMENT_READ', requestedTitle: title });
  expect(restoredAt).toHaveLength(2);
  expect(restoredAt[0]! - started).toBeGreaterThanOrEqual(4000);
  expect(restoredAt[1]! - restoredAt[0]!).toBeGreaterThanOrEqual(5000);
  expect(remove).toHaveBeenCalledWith([20]);
  vi.useRealTimers();
});

it('상세 본문을 끝내 읽지 못하면 원문 마감 오류 대신 단계별 시간 초과를 알린다', async () => {
  vi.useFakeTimers();
  const title = '선택한 문서';
  const common = { url: 'https://onnara.test/main', title: '온나라', text: '메뉴', charCount: 2, method: 'innerText', truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: Date.now() };
  const listPayload = { ...common, structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title }] } };
  const sendMessage = vi.fn(async (_id: number, msg: { type: string }, options: { frameId: number }) => {
    if (msg.type === 'LOCATE_DOCUMENT') return { type: 'DOCUMENT_LOCATED', location: { url: 'https://onnara.test/list', framePath: [0] } };
    if (msg.type === 'OPEN_DOCUMENT') return { type: 'OPENING_DOCUMENT', title };
    // 클릭이 팝업 차단 등으로 무시되어 목록이 그대로 남은 상황
    return { type: 'EXTRACTED', payload: options.frameId === 2 ? listPayload : common };
  });
  const remove = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: common.url, active: id === 1 })),
      query: vi.fn(async () => [{ id: 1 }]), duplicate: vi.fn(async () => ({ id: 20 })),
      sendMessage, remove, update: vi.fn(),
    },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0, url: common.url }, { frameId: 2, url: 'https://onnara.test/list' }]) },
  });
  const pending = readDocumentInBackground(1, title, 2000, { id: crypto.randomUUID(), deadline: Date.now() + 20_000, expectedUrl: common.url });
  await vi.advanceTimersByTimeAsync(25_000);
  expect(await pending).toMatchObject({
    type: 'ERROR',
    error: { code: 'TIMEOUT', hint: expect.stringContaining('팝업') },
  });
  expect(remove).toHaveBeenCalledWith([20]);
  vi.useRealTimers();
});

it('첨부 다운로드: 작업 탭에서 문서를 열고 스크립트 첨부를 눌러 생긴 다운로드가 끝난 뒤 탭을 닫는다', async () => {
  vi.useFakeTimers();
  const title = '선택한 문서';
  const common = { url: 'https://onnara.test/main', title: '온나라', text: '메뉴', charCount: 2, method: 'innerText', truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: Date.now() };
  const listPayload = { ...common, structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title }] } };
  const detailPayload = { ...common, title, text: `${title} 본문`.repeat(40), charCount: 400 };
  let createdListener: ((item: { id: number }) => void) | undefined;
  let opened = false;
  const events: string[] = [];
  const sendMessage = vi.fn(async (id: number, msg: { type: string; name?: string }, options: { frameId: number }) => {
    if (msg.type === 'LOCATE_DOCUMENT') return { type: 'DOCUMENT_LOCATED', location: { url: 'https://onnara.test/list', framePath: [0] } };
    if (msg.type === 'OPEN_DOCUMENT') { opened = true; return { type: 'OPENING_DOCUMENT', title }; }
    if (msg.type === 'SCAN_ATTACHMENTS') return { type: 'ATTACHMENTS_FOUND', items: options.frameId === 2 ? [{ index: 0, name: '양식.xlsx' }] : [] };
    if (msg.type === 'CLICK_ATTACHMENT') {
      events.push(`click:${msg.name}`);
      setTimeout(() => createdListener?.({ id: 77 }), 400);
      return { type: 'ATTACHMENT_CLICKED', clicked: true };
    }
    if (options.frameId !== 2) return { type: 'EXTRACTED', payload: common };
    return { type: 'EXTRACTED', payload: id === 20 && opened ? detailPayload : listPayload };
  });
  const remove = vi.fn(async () => { events.push('remove'); });
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: common.url, active: id === 1 })),
      query: vi.fn(async () => [{ id: 1 }]), duplicate: vi.fn(async () => ({ id: 20 })),
      sendMessage, remove, update: vi.fn(),
    },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0, url: common.url }, { frameId: 2, url: 'https://onnara.test/list' }]) },
    downloads: {
      onCreated: { addListener: vi.fn(listener => { createdListener = listener; }), removeListener: vi.fn(() => { createdListener = undefined; }) },
      search: vi.fn(async () => { events.push('search'); return [{ id: 77, state: 'complete', mime: 'application/vnd.ms-excel', filename: 'C:\\Downloads\\양식.xlsx' }]; }),
      download: vi.fn(), cancel: vi.fn(),
    },
  });
  const pending = handlePanelMessage({ type: 'DOWNLOAD_ATTACHMENTS', tabId: 1, title, control: { id: crypto.randomUUID(), deadline: Date.now() + 170_000, expectedUrl: common.url } });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await pending).toEqual({ type: 'ATTACHMENTS_DOWNLOADED', results: [{ name: '양식.xlsx', status: 'complete', downloadId: 77, path: 'C:\\Downloads\\양식.xlsx' }] });
  expect(events).toEqual(['click:양식.xlsx', 'search', 'remove']);
  expect(remove).toHaveBeenCalledWith([20]);
  vi.useRealTimers();
});

it('문서 상세 추출은 고른 프레임과 하위 본문 프레임을 합치고 형제 목록 프레임은 제외한다', () => {
  const payload = (text: string) => ({ url: 'https://onnara.test/x', title: '문서', text, charCount: text.length,
    truncated: false, keptRatio: 1, estimatedTokens: 10, extractedAt: 1, method: 'innerText' as const });
  const candidate = (frameId: number, text: string) => ({ frameId, frameUrl: 'https://onnara.test/x', response: { type: 'EXTRACTED' as const, payload: payload(text) } });
  const wrapper = candidate(2, '행정전화 일시 중단 알림 인쇄 닫기 붙임 1부');
  const merged = mergeDetailFrames(wrapper, [
    candidate(0, '온나라 메뉴'),
    wrapper,
    candidate(5, '1. 부산광역시인재개발원 자가용 전기설비 정기검사로 10월 2일 09:00~12:00 행정전화가 중단됩니다. 급한 연락은 휴대전화로 하여 주시기 바랍니다.'),
    candidate(3, '다른 목록 프레임'),
  ], [
    { frameId: 0, parentFrameId: -1 }, { frameId: 2, parentFrameId: 0 },
    { frameId: 4, parentFrameId: 2 }, { frameId: 5, parentFrameId: 4 }, { frameId: 3, parentFrameId: 0 },
  ], 2000);
  expect(merged.text).toContain('10월 2일 09:00~12:00 행정전화가 중단');
  expect(merged.text).toContain('행정전화 일시 중단 알림');
  expect(merged.text).not.toContain('온나라 메뉴');
  expect(merged.text).not.toContain('다른 목록 프레임');
  expect(merged.text.indexOf('10월 2일')).toBeLessThan(merged.text.indexOf('인쇄 닫기'));
});

it('응답하지 않는 프레임이 있어도 나머지 프레임 결과로 추출을 마친다', async () => {
  vi.useFakeTimers();
  const common = { url: 'https://onnara.test/main', title: '온나라', text: '본문', charCount: 300, method: 'innerText', truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: Date.now() };
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async () => ({ id: 9, url: common.url, title: '온나라' })),
      sendMessage: vi.fn(async () => ({ type: 'EXTRACTED', payload: common })),
    },
    scripting: { executeScript: vi.fn(({ target }: { target: { frameIds: number[] } }) => target.frameIds[0] === 3 ? new Promise(() => undefined) : Promise.resolve([])) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0, url: common.url }, { frameId: 3, url: 'https://onnara.test/stuck' }]) },
    runtime: { id: 'ext' },
  });
  const pending = handlePanelMessage({ type: 'EXTRACT_PAGE', tabId: 9, budgetTokens: 1000, control: { id: crypto.randomUUID(), deadline: Date.now() + 60_000 } });
  await vi.advanceTimersByTimeAsync(9000);
  expect(await pending).toMatchObject({ type: 'PAGE_EXTRACTED', payload: { sourceFrameId: 0 } });
  vi.useRealTimers();
});

it('대상 문서가 있는 작은 목록이 다른 프레임의 큰 목록보다 우선한다', () => {
  const candidate = (frameId: number, titles: string[]) => ({ frameId, frameUrl: 'https://onnara.test/list', response: {
    type: 'EXTRACTED' as const, payload: { url: 'https://onnara.test/list', title: '목록', text: '', charCount: titles.length * 100,
      truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: 1, method: 'onnara-document-list' as const,
      structuredData: { kind: 'onnara-document-list' as const, listName: '목록', columns: [], rows: titles.map(title => ({ title })) },
    },
  } });
  expect(chooseBestExtraction([candidate(1, ['다른 문서', '또 다른 문서']), candidate(2, ['선택한 문서'])], { targetTitle: '선택한 문서' })?.frameId).toBe(2);
});

function popupFixture(openPopup: (control: { title: string }) => void, extraTabs: chrome.tabs.Tab[] = []) {
  const title = '2026년 제2회 고충상담원 역량강화 워크숍 개최 알림';
  const common = { url: 'https://onnara.test/main', title: '온나라', text: '메뉴', charCount: 2, method: 'innerText', truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: Date.now() };
  const listPayload = { ...common, structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title }] } };
  const detail = { ...common, url: 'https://onnara.test/view', title, text: `${title} 본문 내용`.repeat(20), charCount: 400 };
  const open = new Set<number>([1, ...extraTabs.map(tab => tab.id!)]);
  let popupReady = false;
  const sendMessage = vi.fn(async (id: number, msg: { type: string; purpose?: string }, options: { frameId: number }) => {
    if (msg.type === 'LOCATE_DOCUMENT') return { type: 'DOCUMENT_LOCATED', location: { url: 'https://onnara.test/list', framePath: [0] } };
    if (msg.type === 'OPEN_DOCUMENT') { openPopup({ title }); popupReady = true; return { type: 'OPENING_DOCUMENT', title }; }
    if (msg.purpose === 'document-detail') {
      if (id !== 20 && popupReady && options.frameId === 0) return { type: 'EXTRACTED', payload: detail };
      return { type: 'EXTRACTED', payload: options.frameId === 2 ? listPayload : common };
    }
    return { type: 'EXTRACTED', payload: options.frameId === 2 && (id === 1 || id === 20) ? listPayload : common };
  });
  const remove = vi.fn(async (ids: number | number[]) => { for (const id of [ids].flat()) open.delete(id); });
  const windows = { get: vi.fn(async (id: number) => ({ id, type: id === 7 ? 'normal' : 'popup', focused: false })), update: vi.fn(async () => undefined) };
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: id === 1 || id === 20 ? common.url : detail.url, active: true, windowId: id === 1 || id === 20 ? 7 : 8 })),
      // 새 창 팝업은 openerTabId가 없다.
      query: vi.fn(async () => [...open].map(id => ({ id, url: id === 1 || id === 20 ? common.url : detail.url, windowId: id === 1 || id === 20 ? 7 : 8 }))),
      duplicate: vi.fn(async () => { open.add(20); return { id: 20, windowId: 7 }; }),
      sendMessage, remove, update: vi.fn(async () => undefined),
    },
    windows,
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0, url: common.url }, { frameId: 2, url: 'https://onnara.test/list' }]) },
  });
  return { title, open, remove };
}

it('openerTabId가 없는 새 창 팝업을 window.open 이벤트로 찾아 읽고, 다음 문서 전에 닫는다', async () => {
  vi.useFakeTimers();
  let next = 30;
  const fixture = popupFixture(() => { const id = next++; fixture.open.add(id); noteNavigationTarget({ sourceTabId: 20, tabId: id }); });
  for (const expected of [30, 31]) {
    const pending = readDocumentInBackground(1, fixture.title, 2000, { id: crypto.randomUUID(), deadline: Date.now() + 60_000, expectedUrl: 'https://onnara.test/main' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ type: 'DOCUMENT_READ', requestedTitle: fixture.title });
    expect(fixture.remove).toHaveBeenLastCalledWith([20, expected]);
    expect(fixture.open.has(expected)).toBe(false);
  }
  expect(workTabs.size).toBe(0);
});

it('같은 이름의 기존 팝업 창이 재사용되면 그 창에서 제목을 확인해 읽고 닫지 않는다', async () => {
  vi.useFakeTimers();
  const fixture = popupFixture(() => noteTopCommit({ tabId: 40, frameId: 0 }), [{ id: 40, windowId: 8 } as chrome.tabs.Tab]);
  const pending = readDocumentInBackground(1, fixture.title, 2000, { id: crypto.randomUUID(), deadline: Date.now() + 60_000, expectedUrl: 'https://onnara.test/main' });
  await vi.advanceTimersByTimeAsync(5000);
  expect(await pending).toMatchObject({ type: 'DOCUMENT_READ', requestedTitle: fixture.title });
  expect(fixture.remove).toHaveBeenCalledWith([20]);
  expect(fixture.open.has(40)).toBe(true);
});

it('상세 화면의 본문 프레임이 권한 없는 다른 주소면 기다리지 않고 그 주소를 알린다', async () => {
  vi.useFakeTimers();
  let opened = 0;
  const fixture = popupFixture(() => { opened = 30; fixture.open.add(30); noteNavigationTarget({ sourceTabId: 20, tabId: 30 }); });
  const executeScript = vi.fn(async ({ target }: { target: { tabId: number; frameIds: number[] } }) => {
    if (target.tabId === opened && target.frameIds[0] === 2) throw new Error('Cannot access contents of url "https://viewer.onnara.test/body". Extension manifest must request permission to access this host.');
    return [];
  });
  (globalThis.chrome as unknown as { scripting: unknown }).scripting = { executeScript };
  (globalThis.chrome as unknown as { webNavigation: unknown }).webNavigation = { getAllFrames: vi.fn(async ({ tabId }: { tabId: number }) => tabId === opened
    ? [{ frameId: 0, parentFrameId: -1, url: 'https://onnara.test/view' }, { frameId: 2, parentFrameId: 0, url: 'https://viewer.onnara.test/body' }]
    : [{ frameId: 0, parentFrameId: -1, url: 'https://onnara.test/main' }, { frameId: 2, parentFrameId: 0, url: 'https://onnara.test/list' }]) };
  let settled = false;
  const pending = readDocumentInBackground(1, fixture.title, 2000, { id: crypto.randomUUID(), deadline: Date.now() + 120_000, expectedUrl: 'https://onnara.test/main' });
  void pending.then(() => { settled = true; });
  // 이전에는 제한 시간(약 2분) 내내 팝업을 열어 둔 채 기다렸다.
  await vi.advanceTimersByTimeAsync(3000);
  expect(settled).toBe(true);
  expect(await pending).toMatchObject({ type: 'ERROR', error: { code: 'HOST_PERMISSION_REQUIRED', origins: ['https://viewer.onnara.test'] } });
  expect(fixture.open.has(30)).toBe(false);
});

it('여러 문서를 이어서 읽으면 복제한 목록 탭 하나를 재사용하고, 끝나면 닫는다', async () => {
  vi.useFakeTimers();
  let next = 30;
  const fixture = popupFixture(() => { const id = next++; fixture.open.add(id); noteNavigationTarget({ sourceTabId: 20, tabId: id }); });
  const store = new Map<string, unknown>();
  (globalThis.chrome as unknown as { storage: unknown }).storage = { session: {
    get: vi.fn(async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => { for (const [key, value] of Object.entries(items)) store.set(key, value); }),
    remove: vi.fn(async (key: string) => { store.delete(key); }),
  } };
  const duplicate = (globalThis.chrome as unknown as { tabs: { duplicate: ReturnType<typeof vi.fn> } }).tabs.duplicate;
  for (const popup of [30, 31]) {
    const pending = readDocumentInBackground(1, fixture.title, 2000, { id: crypto.randomUUID(), deadline: Date.now() + 60_000, expectedUrl: 'https://onnara.test/main' }, undefined, { keepWorkTab: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ type: 'DOCUMENT_READ' });
    // 문서 팝업은 닫고 목록 작업 탭은 다음 문서를 위해 남긴다.
    expect(fixture.open.has(popup)).toBe(false);
    expect(fixture.open.has(20)).toBe(true);
  }
  expect(duplicate).toHaveBeenCalledTimes(1);
  await releaseKeptWorkTab(1);
  expect(fixture.open.has(20)).toBe(false);
  expect(workTabs.size).toBe(0);
});

it('문서 열기 시 alert 대화상자(과제 미지정 등)가 감지되면 대기시간 없이 즉시 실패 처리한다', async () => {
  vi.useFakeTimers();
  const fixture = popupFixture(() => {
    // 팝업이 열리지 않고 alert만 발생함
  });
  const sendMessage = (globalThis.chrome as any).tabs.sendMessage;
  sendMessage.mockImplementation(async (id: number, msg: { type: string }, options: { frameId: number }) => {
    if (msg.type === 'LOCATE_DOCUMENT') return { type: 'DOCUMENT_LOCATED', location: { url: 'https://onnara.test/list', framePath: [0] } };
    if (msg.type === 'OPEN_DOCUMENT') return { type: 'OPENING_DOCUMENT', title: fixture.title };
    if (msg.type === 'CHECK_DIALOG') return { type: 'DIALOG_CHECKED', message: '과제 미지정상태이므로 문서를 열람하실 수 없습니다.' };
    return { type: 'EXTRACTED', payload: { url: 'https://onnara.test/main', title: '온나라', text: '메뉴', charCount: 2, method: 'innerText', truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: Date.now(), structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: fixture.title }] } } };
  });

  const pending = readDocumentInBackground(1, fixture.title, 2000, {
    id: crypto.randomUUID(),
    deadline: Date.now() + 60_000,
    expectedUrl: 'https://onnara.test/main',
  });
  await vi.advanceTimersByTimeAsync(500);
  const result = await pending;
  expect(result).toMatchObject({
    type: 'ERROR',
    error: {
      code: 'UNKNOWN',
      message: expect.stringContaining('과제 미지정상태이므로 문서를 열람하실 수 없습니다.'),
    },
  });
  vi.useRealTimers();
});

it('상세 본문 추출 결과가 권한 불가 안내 문구이면 60초 대기 없이 즉시 실패 처리한다', async () => {
  vi.useFakeTimers();
  const fixture = popupFixture(() => undefined);
  const sendMessage = (globalThis.chrome as any).tabs.sendMessage;
  sendMessage.mockImplementation(async (id: number, msg: { type: string; purpose?: string }, options: { frameId: number }) => {
    if (msg.type === 'LOCATE_DOCUMENT') return { type: 'DOCUMENT_LOCATED', location: { url: 'https://onnara.test/list', framePath: [0] } };
    if (msg.type === 'OPEN_DOCUMENT') return { type: 'OPENING_DOCUMENT', title: fixture.title };
    if (msg.purpose === 'document-detail') {
      return {
        type: 'EXTRACTED',
        payload: {
          url: 'https://onnara.test/error',
          title: '오류',
          text: '해당 문서에 대한 열람 권한이 없습니다.',
          charCount: 30,
          method: 'innerText',
          truncated: false,
          keptRatio: 1,
          estimatedTokens: 10,
          extractedAt: Date.now(),
        },
      };
    }
    return { type: 'EXTRACTED', payload: { url: 'https://onnara.test/main', title: '온나라', text: '메뉴', charCount: 2, method: 'innerText', truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: Date.now(), structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: fixture.title }] } } };
  });

  const pending = readDocumentInBackground(1, fixture.title, 2000, {
    id: crypto.randomUUID(),
    deadline: Date.now() + 60_000,
    expectedUrl: 'https://onnara.test/main',
  });
  await vi.advanceTimersByTimeAsync(500);
  const result = await pending;
  expect(result).toMatchObject({
    type: 'ERROR',
    error: {
      code: 'UNKNOWN',
      message: expect.stringContaining('열람 권한이 없습니다'),
    },
  });
  vi.useRealTimers();
});

it('사용자 탭의 프레임 이동은 패널에 알리고, 백그라운드 작업 탭의 이동은 알리지 않는다', () => {
  const sendMessage = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  workTabs.clear();

  notifyScreenChange({ tabId: 3, frameId: 5, url: 'https://onnara.test/doc/123' });
  expect(sendMessage).toHaveBeenCalledWith({ type: 'SCREEN_CHANGED', tabId: 3, frameId: 5, url: 'https://onnara.test/doc/123' });

  sendMessage.mockClear();
  workTabs.add(9);
  notifyScreenChange({ tabId: 9, frameId: 0, url: 'https://onnara.test/work' });
  expect(sendMessage).not.toHaveBeenCalled();
  workTabs.clear();
  resetPanelSpawns();
});

it('패널이 보고 있지 않은 탭의 프레임 이동으로는 패널을 깨우지 않는다', () => {
  const sendMessage = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  resetPanelSpawns();
  rememberPanelTab({ tabId: 1, windowId: 10 });

  notifyScreenChange({ tabId: 55, frameId: 3, url: 'https://ads.test/frame' });
  expect(sendMessage).not.toHaveBeenCalled();

  notifyScreenChange({ tabId: 1, frameId: 3, url: 'https://onnara.test/doc/123' });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  resetPanelSpawns();
});

it('탭 요약에는 창과 팝업 출처가 실린다. 새 창 팝업은 webNavigation 기록에서 출처를 찾는다', () => {
  notePanelSpawn({ sourceTabId: 1, tabId: 7 });
  expect(toSummary({ id: 7, url: 'https://onnara.test/doc/123', title: '문서', active: true, windowId: 42 } as chrome.tabs.Tab))
    .toMatchObject({ tabId: 7, windowId: 42, openedFrom: 1 });
  expect(toSummary({ id: 1, url: 'https://onnara.test/list', title: '목록', active: true, windowId: 10 } as chrome.tabs.Tab).openedFrom)
    .toBeUndefined();
  forgetPanelSpawn(7);
});

/*
 * ★ 브리핑 대상 지정은 **목록이 있는 프레임**에 닿아야 한다.
 *
 *   추출이 아닌 메시지는 최상위 프레임에만 전달된다. 온나라 목록은 하위 iframe에 있는
 *   경우가 대부분이라, 최상위에 대고 물으면 표가 없어 "목록을 찾지 못했습니다"가 난다.
 *   실제로 그렇게 났고, 이 시험이 그 자리를 지킨다.
 */
it('브리핑 대상 지정은 목록이 있는 iframe에 위치를 묻는다', async () => {
  const common = { truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: 1 };
  const saved: Record<string, unknown> = {};
  const sendMessage = vi.fn(async (_tabId: number, message: { type: string }, options: { frameId: number }) => {
    if (message.type === 'LOCATE_INBOX') {
      // 최상위 프레임에는 목록이 없다. 그 자리에 물으면 실패해야 정상이다.
      return options.frameId === 4
        ? { type: 'INBOX_LOCATED', location: { url: 'https://onnara.test/frame/inbox', framePath: [1] }, listName: '받은문서' }
        : { type: 'FAILED', error: { code: 'UNKNOWN', message: '현재 화면에서 문서 목록을 찾지 못했습니다.' } };
    }
    return options.frameId === 4
      ? {
          type: 'EXTRACTED',
          payload: {
            ...common, url: 'https://onnara.test/frame/inbox', title: '받은문서', text: '행 1', charCount: 4,
            method: 'onnara-document-list',
            structuredData: {
              kind: 'onnara-document-list', listName: '받은문서', received: true,
              columns: [{ key: 'title', label: '제목', sourceIndex: 0 }], rows: [{ title: '문서 A' }],
            },
          },
        }
      : { type: 'EXTRACTED', payload: { ...common, url: 'https://onnara.test/main', title: '온나라', text: '메뉴', charCount: 2, method: 'innerText' } };
  });
  vi.stubGlobal('chrome', {
    tabs: { get: vi.fn(async () => ({ id: 7, url: 'https://onnara.test/main', title: '온나라' })), sendMessage },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [
      { frameId: 0, parentFrameId: -1, url: 'https://onnara.test/main' },
      { frameId: 4, parentFrameId: 0, url: 'https://onnara.test/frame/inbox' },
    ]) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(saved, next); }) } },
  });

  const response = await handlePanelMessage({
    type: 'CAPTURE_INBOX_LOCATION', tabId: 7,
    control: { id: crypto.randomUUID(), deadline: Date.now() + 15_000 },
  });

  expect(response).toMatchObject({ type: 'INBOX_LOCATION_SAVED', listName: '받은문서' });
  expect(sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'LOCATE_INBOX' }), { frameId: 4 });
  expect(saved['saide.inboxLocation']).toMatchObject({ listName: '받은문서', origin: 'https://onnara.test' });
});

it('받은문서가 0건인 날에도 브리핑 대상으로 지정할 수 있다', async () => {
  // 실제로 막혔던 자리다. `해당 문서가 없습니다`만 뜬 화면에서도 머리글은 그대로 있다.
  const common = { truncated: false, keptRatio: 1, estimatedTokens: 8, extractedAt: 1 };
  const saved: Record<string, unknown> = {};
  const sendMessage = vi.fn(async (_tabId: number, message: { type: string }, options: { frameId: number }) => {
    if (message.type === 'LOCATE_INBOX') {
      return options.frameId === 2
        ? { type: 'INBOX_LOCATED', location: { url: 'https://onnara.test/frame/inbox', framePath: [1] }, listName: '받은문서' }
        : { type: 'FAILED', error: { code: 'UNKNOWN', message: '현재 화면에서 문서 목록을 찾지 못했습니다.' } };
    }
    return options.frameId === 2
      ? {
          type: 'EXTRACTED',
          payload: {
            ...common, url: 'https://onnara.test/frame/inbox', title: '받은문서',
            text: '<onnara_document_list> 목록: 받은문서 · 현재 화면 표시 문서: 0건 </onnara_document_list>',
            charCount: 60, method: 'onnara-document-list',
            structuredData: {
              kind: 'onnara-document-list', listName: '받은문서', received: true,
              columns: [
                { key: 'reportDate', label: '보고일자', sourceIndex: 1 },
                { key: 'title', label: '제목', sourceIndex: 2 },
                { key: 'department', label: '부서', sourceIndex: 3 },
              ],
              rows: [],
            },
          },
        }
      // 메뉴가 있는 최상위 프레임은 글자 수가 훨씬 많다. 그래도 목록 프레임이 이겨야 한다.
      : { type: 'EXTRACTED', payload: { ...common, url: 'https://onnara.test/main', title: '온나라', text: '메뉴'.repeat(2000), charCount: 8000, method: 'innerText' } };
  });
  vi.stubGlobal('chrome', {
    tabs: { get: vi.fn(async () => ({ id: 7, url: 'https://onnara.test/main', title: '온나라' })), sendMessage },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [
      { frameId: 0, parentFrameId: -1, url: 'https://onnara.test/main' },
      { frameId: 2, parentFrameId: 0, url: 'https://onnara.test/frame/inbox' },
    ]) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(saved, next); }) } },
  });

  const response = await handlePanelMessage({
    type: 'CAPTURE_INBOX_LOCATION', tabId: 7,
    control: { id: crypto.randomUUID(), deadline: Date.now() + 15_000 },
  });
  expect(response).toMatchObject({ type: 'INBOX_LOCATION_SAVED', listName: '받은문서' });
  expect(sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'LOCATE_INBOX' }), { frameId: 2 });
});

it('화면에 문서 목록이 없으면 무엇을 해야 하는지 알려 준다', async () => {
  const common = { truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: 1 };
  vi.stubGlobal('chrome', {
    tabs: {
      get: vi.fn(async () => ({ id: 7, url: 'https://onnara.test/detail', title: '문서 상세' })),
      sendMessage: vi.fn(async () => ({ type: 'EXTRACTED', payload: { ...common, url: 'https://onnara.test/detail', title: '문서 상세', text: '본문', charCount: 2, method: 'innerText' } })),
    },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0, parentFrameId: -1, url: 'https://onnara.test/detail' }]) },
  });

  const response = await handlePanelMessage({
    type: 'CAPTURE_INBOX_LOCATION', tabId: 7,
    control: { id: crypto.randomUUID(), deadline: Date.now() + 15_000 },
  });
  expect(response).toMatchObject({ type: 'ERROR', error: { message: expect.stringContaining('문서 목록을 찾지 못했습니다') } });
});

it.each([7, undefined])('공유/공람 화면이 없어도 저장한 조회로 모든 페이지를 수집한다 (tabId=%s)', async hint => {
  const saved = { location: { url: 'https://onnara.test/frame/inbox', framePath: [1], form: { method: 'post', fields: [['pageIndex', '4'], ['searchKeyword', '예산']] } }, listName: '받은문서' };
  const sendMessage = vi.fn(async (_id: number, message: { type: string; location: typeof saved.location }) => {
    expect(message.type).toBe('FETCH_INBOX_PAGE');
    const page = Number(message.location.form.fields.find(([key]) => key === 'pageIndex')?.[1]);
    expect(message.location.form.fields).toContainEqual(['searchKeyword', '예산']);
    return { type: 'INBOX_PAGE', list: { kind: 'onnara-document-list', listName: '받은문서', columns: [],
      rows: Array.from({ length: page === 3 ? 3 : 10 }, (_, i) => ({ title: `문서 ${(page - 1) * 10 + i}` })) },
      next: page < 3 ? { ...message.location, form: { ...message.location.form, fields: [['pageIndex', String(page + 1)], ['searchKeyword', '예산']] } } : null };
  });
  const update = vi.fn();
  const duplicate = vi.fn();
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({ 'saide.inboxLocation': saved })) } },
    tabs: { get: vi.fn(async () => ({ id: 7, url: 'https://unrelated.test' })), query: vi.fn(async () => [{ id: 8, url: 'https://onnara.test/calendar' }]), sendMessage, update, duplicate },
    scripting: { executeScript: vi.fn(async () => []) },
  });
  const response = await handlePanelMessage({ type: 'COLLECT_INBOX', ...(hint === undefined ? {} : { tabId: hint }), budgetTokens: 1000,
    control: { id: crypto.randomUUID(), deadline: Date.now() + 180_000 } });
  expect(response).toMatchObject({ type: 'INBOX_COLLECTED', via: 'background-request' });
  if (response.type !== 'INBOX_COLLECTED') throw new Error('수집 실패');
  expect(response.list.rows).toHaveLength(23);
  expect(sendMessage).toHaveBeenCalledTimes(3);
  expect(sendMessage).toHaveBeenCalledWith(8, expect.anything(), { frameId: 0 });
  expect(update).not.toHaveBeenCalled();
  expect(duplicate).not.toHaveBeenCalled();
});

it.each(['failed', 'repeated'] as const)('뒤 페이지가 %s이면 앞의 10건만으로 완료하지 않는다', async failure => {
  const location = { url: 'https://onnara.test/inbox', framePath: [], form: { method: 'post', fields: [['pageIndex', '1']] } };
  const list = { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: [{ title: '문서' }] };
  const sendMessage = vi.fn()
    .mockResolvedValueOnce({ type: 'INBOX_PAGE', list, next: { ...location, form: { method: 'post', fields: [['pageIndex', '2']] } } })
    .mockResolvedValueOnce(failure === 'failed' ? { type: 'FAILED', error: { code: 'UNKNOWN', message: '세션 만료' } } : { type: 'INBOX_PAGE', list, next: null });
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({ 'saide.inboxLocation': { location, listName: '받은문서' } })) } },
    tabs: { query: vi.fn(async () => [{ id: 8, url: 'https://onnara.test/calendar' }]), sendMessage },
    scripting: { executeScript: vi.fn(async () => []) },
  });
  const response = await handlePanelMessage({ type: 'COLLECT_INBOX', budgetTokens: 1000, control: { id: crypto.randomUUID(), deadline: Date.now() + 180_000 } });
  expect(response.type).toBe('ERROR');
  expect(sendMessage).toHaveBeenCalledTimes(2);
});

/** 받은문서 목록 프레임(2번)을 흉내 낸다. rowsAfter는 읽기처리 뒤 목록이 다시 그린 행이다. */
function markReadHarness(rowsAfter: Array<{ title: string; readState?: string; status?: string }>, dialogs: string[] = [], serverRowsAfter?: Array<{ title: string; readState?: string; status?: string }>, buttonFrameId = 2, initialRows?: Array<{ title: string; readState?: string; status?: string }>) {
  const common = { truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: 1 };
  let clicked = false;
  const listPayload = (rows: Array<{ title: string; readState?: string; status?: string }>) => ({
    type: 'EXTRACTED',
    payload: {
      ...common, url: 'https://onnara.test/frame/list', title: '받은문서', text: '행', charCount: 1,
      method: 'onnara-document-list',
      structuredData: { kind: 'onnara-document-list', listName: '받은문서', columns: [{ key: 'title', label: '제목', sourceIndex: 0 }], rows },
    },
  });
  const sendMessage = vi.fn(async (_tabId: number, message: { type: string; titles?: string[] }, options: { frameId: number }) => {
    if (message.type === 'MARK_READ_BUTTON') return { type: 'READ_BUTTON_MARKED', marked: options.frameId === buttonFrameId };
    if (message.type === 'FETCH_INBOX_PAGE') return {
      type: 'INBOX_PAGE', list: { kind: 'onnara-document-list', listName: '받은문서', columns: [], rows: serverRowsAfter ?? [] }, next: null,
    };
    if (options.frameId !== 2) return { type: 'EXTRACTED', payload: { ...common, url: 'https://onnara.test/main', title: '온나라', text: '', charCount: 0, method: 'innerText' } };
    if (message.type === 'PREPARE_MARK_READ') return { type: 'MARK_READ_PREPARED', checked: message.titles, missing: [], buttonMarked: buttonFrameId === 2 };
    return listPayload(clicked ? rowsAfter : (initialRows ?? [{ title: '법원문서 통보', readState: '미열람' }, { title: '다른 공문 제목', readState: '미열람' }]));
  });
  const executeScript = vi.fn(async (injection: { world?: string; func?: { name: string } }) => {
    if (injection.world !== 'MAIN') return [];
    if (injection.func?.name === 'clickMarkedReadButton') { clicked = true; return [{ result: { clicked: true } }]; }
    return [{ result: dialogs }];
  });
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => serverRowsAfter === undefined ? {} : ({
      'saide.inboxLocation': { location: { url: 'https://onnara.test/frame/list', framePath: [1] }, listName: '받은문서' },
    })) } },
    tabs: {
      get: vi.fn(async () => ({ id: 9, url: 'https://onnara.test/main', title: '온나라' })),
      query: vi.fn(async () => [{ id: 9, url: 'https://onnara.test/main', active: true }]), sendMessage,
    },
    scripting: { executeScript },
    webNavigation: { getAllFrames: vi.fn(async () => [
      { frameId: 0, parentFrameId: -1, url: 'https://onnara.test/main' },
      { frameId: 2, parentFrameId: 0, url: 'https://onnara.test/frame/list' },
    ]) },
  });
  return { sendMessage, executeScript };
}

it('읽기처리 뒤 서버의 전체 미열람 목록에서 빠진 문서만 열람으로 보고한다', async () => {
  const { executeScript, sendMessage } = markReadHarness(
    [{ title: '다른 공문 제목', readState: '미열람' }], [],
    [{ title: '다른 공문 제목', readState: '미열람' }],
  );
  const response = await handlePanelMessage({
    type: 'MARK_DOCUMENTS_READ', tabId: 9, titles: ['법원문서 통보'],
    control: { id: crypto.randomUUID(), deadline: Date.now() + 30_000 },
  });
  expect(response).toMatchObject({ type: 'DOCUMENTS_MARKED_READ', marked: ['법원문서 통보'], unconfirmed: [] });
  // 목록이 있는 프레임에서, 페이지 영역으로 누른다.
  expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 9, frameIds: [2] }, world: 'MAIN' }));
  expect(sendMessage).toHaveBeenCalledWith(9, expect.objectContaining({ type: 'FETCH_INBOX_PAGE' }), { frameId: 0 });
});

it('전용 열람 열이 없어도 서버 상태 칸이 명시적으로 열람이면 성공으로 확인한다', async () => {
  markReadHarness([{ title: '법원문서 통보', status: '담당확인' }], [], [{ title: '법원문서 통보', status: '열람' }]);
  const response = await handlePanelMessage({ type: 'MARK_DOCUMENTS_READ', tabId: 9, titles: ['법원문서 통보'],
    control: { id: crypto.randomUUID(), deadline: Date.now() + 30_000 } });
  expect(response).toMatchObject({ type: 'DOCUMENTS_MARKED_READ', marked: ['법원문서 통보'], unconfirmed: [] });
});

it('목록은 하위 프레임에 있고 읽기처리 버튼은 상위 프레임에 있어도 실행한다', async () => {
  const { executeScript, sendMessage } = markReadHarness(
    [{ title: '다른 공문 제목' }], [], [{ title: '다른 공문 제목' }], 0,
  );
  const response = await handlePanelMessage({
    type: 'MARK_DOCUMENTS_READ', tabId: 9, titles: ['법원문서 통보'],
    control: { id: crypto.randomUUID(), deadline: Date.now() + 30_000 },
  });
  expect(response).toMatchObject({ type: 'DOCUMENTS_MARKED_READ', marked: ['법원문서 통보'] });
  expect(sendMessage).toHaveBeenCalledWith(9, expect.objectContaining({ type: 'MARK_READ_BUTTON' }), { frameId: 0 });
  expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 9, frameIds: [0] }, world: 'MAIN' }));
});

it('카드의 문서가 현재 페이지에 없으면 작업 탭에 해당 페이지를 복원해 읽기처리한다', async () => {
  vi.useFakeTimers();
  const title = '두 번째 페이지 문서';
  const location = { url: 'https://onnara.test/frame/list', framePath: [1], form: { method: 'post' as const, fields: [['pageIndex', '1']] } };
  const common = { url: location.url, title: '받은문서', text: '행', charCount: 1, method: 'onnara-document-list', truncated: false, keptRatio: 1, estimatedTokens: 20, extractedAt: 1 };
  let restored = false;
  let clicked = false;
  const sendMessage = vi.fn(async (tabId: number, message: { type: string; location?: typeof location; titles?: string[] }, options: { frameId: number }) => {
    if (message.type === 'FETCH_INBOX_PAGE') {
      const page = message.location!.form.fields[0]![1];
      return { type: 'INBOX_PAGE', list: { kind: 'onnara-document-list', listName: '받은문서', columns: [],
        rows: page === '1' ? [{ title: '첫 페이지 문서' }] : clicked ? [] : [{ title, readState: '미열람' }] },
      next: page === '1' ? { ...location, form: { ...location.form, fields: [['pageIndex', '2']] } } : null };
    }
    if (message.type === 'RESTORE_DOCUMENT_LIST') {
      if (tabId === 20 && options.frameId === 0) restored = true;
      return { type: 'DOCUMENT_LIST_RESTORED', restored: tabId === 20 && options.frameId === 0 };
    }
    if (message.type === 'PREPARE_MARK_READ') return { type: 'MARK_READ_PREPARED', checked: message.titles, missing: [], buttonMarked: true };
    if (options.frameId === 2) return { type: 'EXTRACTED', payload: { ...common, structuredData: {
      kind: 'onnara-document-list', listName: '받은문서', columns: [{ key: 'title', label: '제목', sourceIndex: 0 }],
      rows: tabId === 20 && restored && !clicked ? [{ title, readState: '미열람' }] : [{ title: '첫 페이지 문서' }],
    } } };
    return { type: 'EXTRACTED', payload: { ...common, text: '메뉴', structuredData: undefined } };
  });
  const remove = vi.fn(async () => undefined);
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({ 'saide.inboxLocation': { location, listName: '받은문서' } })) } },
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: 'https://onnara.test/main', active: id === 9, status: 'complete', windowId: 1 })),
      query: vi.fn(async () => [{ id: 9, url: 'https://onnara.test/main', active: true }, { id: 20, url: 'https://onnara.test/main' }]),
      duplicate: vi.fn(async () => ({ id: 20, url: 'https://onnara.test/main', active: false, windowId: 1 })),
      sendMessage, remove,
    },
    scripting: { executeScript: vi.fn(async (injection: { world?: string; func?: { name: string } }) => {
      if (injection.world !== 'MAIN') return [];
      if (injection.func?.name === 'clickMarkedReadButton') { clicked = true; return [{ result: { clicked: true } }]; }
      return [{ result: [] }];
    }) },
    webNavigation: { getAllFrames: vi.fn(async () => [
      { frameId: 0, parentFrameId: -1, url: 'https://onnara.test/main' },
      { frameId: 2, parentFrameId: 0, url: location.url },
    ]) },
  });
  const pending = handlePanelMessage({ type: 'MARK_DOCUMENTS_READ', tabId: 9, titles: [title],
    control: { id: crypto.randomUUID(), deadline: Date.now() + 90_000 } });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await pending).toMatchObject({ type: 'DOCUMENTS_MARKED_READ', marked: [title] });
  expect(sendMessage).toHaveBeenCalledWith(20, expect.objectContaining({ type: 'PREPARE_MARK_READ', titles: [title] }), { frameId: 2 });
  expect(remove).toHaveBeenCalledWith(20);
});

it('온나라가 실패를 알리면 기다리지 않고 확인하지 못한 채로 돌려준다', async () => {
  markReadHarness([{ title: '법원문서 통보', readState: '미열람' }], ['처리 권한이 없습니다.']);
  const started = Date.now();
  const response = await handlePanelMessage({
    type: 'MARK_DOCUMENTS_READ', tabId: 9, titles: ['법원문서 통보'],
    control: { id: crypto.randomUUID(), deadline: Date.now() + 30_000 },
  });
  expect(response).toMatchObject({ type: 'DOCUMENTS_MARKED_READ', marked: [], unconfirmed: ['법원문서 통보'], dialogs: ['처리 권한이 없습니다.'] });
  expect(Date.now() - started).toBeLessThan(5000);
});

it('서버 목록이 여전히 미열람이면 완료 알림만으로 열람 확정하지 않는다', async () => {
  vi.useFakeTimers();
  markReadHarness(
    [{ title: '법원문서 통보', readState: '미열람' }],
    ['읽기처리 되었습니다.'],
    [{ title: '법원문서 통보', readState: '미열람' }],
  );
  const pending = handlePanelMessage({
    type: 'MARK_DOCUMENTS_READ', tabId: 9, titles: ['법원문서 통보'],
    control: { id: crypto.randomUUID(), deadline: Date.now() + 30_000 },
  });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await pending).toMatchObject({ type: 'DOCUMENTS_MARKED_READ', marked: [], unconfirmed: ['법원문서 통보'] });
});

it('화면에 있는 문서가 이미 열람 상태이면 읽기처리 버튼을 누르지 않고 즉시 열람 완료로 보고한다', async () => {
  const { executeScript } = markReadHarness(
    [], [], undefined, 2,
    [{ title: '법원문서 통보', readState: '열람' }, { title: '다른 공문 제목', readState: '미열람' }],
  );
  const response = await handlePanelMessage({
    type: 'MARK_DOCUMENTS_READ', tabId: 9, titles: ['법원문서 통보'],
    control: { id: crypto.randomUUID(), deadline: Date.now() + 30_000 },
  });
  expect(response).toMatchObject({ type: 'DOCUMENTS_MARKED_READ', marked: ['법원문서 통보'], unconfirmed: [] });
  expect(executeScript).not.toHaveBeenCalledWith(expect.objectContaining({ world: 'MAIN' }));
});

it('메인 화면에서 이미 열람되어 저장된 미열람 목록에서 문서를 찾을 수 없으면 열람 완료로 보고한다', async () => {
  markReadHarness(
    [{ title: '다른 문서' }], [],
    [{ title: '다른 문서' }], 2,
    [{ title: '다른 문서' }],
  );
  const response = await handlePanelMessage({
    type: 'MARK_DOCUMENTS_READ', tabId: 9, titles: ['이미 읽은 문서'],
    control: { id: crypto.randomUUID(), deadline: Date.now() + 30_000 },
  });
  expect(response).toMatchObject({ type: 'DOCUMENTS_MARKED_READ', marked: ['이미 읽은 문서'], unconfirmed: [] });
});
