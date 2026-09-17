import { afterEach, expect, it, vi } from 'vitest';
import { chooseBestExtraction, handlePanelMessage, mergeDetailFrames, readDocumentInBackground, releaseKeptWorkTab } from '@/entrypoints/background';
import { noteNavigationTarget, noteTopCommit, workTabs } from '@/lib/browser/work-tabs';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
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
    expect(await pending).toMatchObject({ type: 'ERROR', error: { code: 'UNKNOWN', hint: expect.stringContaining('복원 시도 3회') } });
    expect(sendMessage.mock.calls.some(([, msg]) => msg.type === 'OPEN_DOCUMENT')).toBe(false);
  } else {
    expect(await pending).toMatchObject({ type: 'ERROR', error: { code: 'ABORTED' } });
    expect(sendMessage.mock.calls.some(([, msg]) => msg.type === 'OPEN_DOCUMENT')).toBe(false);
  }
  // 복원 요청은 모든 프레임에 동시에 묻고(부모 경로가 맞는 프레임만 실제 전송), 목록이 없으면 최대 3회 반복한다.
  expect(sendMessage.mock.calls.filter(([, msg]) => msg.type === 'RESTORE_DOCUMENT_LIST')).toHaveLength({ cancelled: 0, success: 2, missing: 6 }[outcome]);
  expect(sendMessage.mock.calls.filter(([id, msg]) => id === 1).every(([, msg]) => ['EXTRACT', 'LOCATE_DOCUMENT'].includes(msg.type))).toBe(true);
  expect(update).not.toHaveBeenCalled();
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
