import { afterEach, expect, it, vi } from 'vitest';
import { handleFetchRelatedDocContent } from '@/entrypoints/background';
import * as pdf from '@/lib/extract/pdf-offscreen';

const title = '행사 개최계획 알림';
const id = 'DCTEF3F599DC9712EE4BC1EC15B8716FA9B';
const url = 'https://onnara.test/bms/dct/draft.do';
const text = `제목 ${title}\n1. 10월 1일부터 7일까지 행사를 개최하며 관련 부서의 협조를 요청합니다.\n붙임 : 1. 계획 1부. 끝.`;
function harness(sources: { texts: string[]; pdf: any[]; error?: string }) {
  const tabs = {
    get: vi.fn(async () => ({ id: 1, url })),
    create: vi.fn(), duplicate: vi.fn(), update: vi.fn(), remove: vi.fn(), query: vi.fn(async () => [] as chrome.tabs.Tab[]),
    sendMessage: vi.fn(async () => ({ type: 'RELATED_DOCUMENT_SOURCES', sources })),
  };
  const executeScript = vi.fn(async () => []);
  const windows = { create: vi.fn(), update: vi.fn() };
  vi.stubGlobal('chrome', { tabs, scripting: { executeScript }, windows });
  return { tabs, executeScript, windows };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('직접 조회가 비어 있으면 임시 원문을 열어 제목과 ID를 검증한 뒤 닫는다', async () => {
  const { tabs, executeScript } = harness({ texts: [], pdf: [] });
  const detailUrl = `https://onnara.test/bms/dct/viewreport.do?docid=${id}`;
  tabs.create.mockResolvedValue({ id: 9 });
  tabs.remove.mockResolvedValue(undefined);
  tabs.get.mockImplementation(async (tabId?: number) => ({ id: tabId || 1, url: tabId === 9 ? detailUrl : url, status: 'complete' }));
  executeScript.mockImplementation(async (opts?: any) => opts?.world === 'MAIN'
    ? [{ frameId: 0, result: { text, title, id } }] as any : []);
  expect((await handleFetchRelatedDocContent({ title, id }, 1)).content).toContain('10월 1일부터');
  expect(tabs.create).toHaveBeenCalledExactlyOnceWith({ url: detailUrl, active: true, openerTabId: 1 });
  expect(tabs.remove).toHaveBeenCalledExactlyOnceWith(9);
});

it('선택 문서의 직접 조회 응답을 반영하며 창·탭·기안 화면은 바꾸지 않는다', async () => {
  const { tabs, executeScript, windows } = harness({ texts: [text], pdf: [] });
  const result = await handleFetchRelatedDocContent({ title, id }, 1);
  expect(result.content).toContain('10월 1일부터 7일까지');
  expect(result.attachments).toEqual(['1. 계획 1부.']);
  expect(tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'FETCH_RELATED_DOCUMENT', doc: { title, id } }), { frameId: 0 });
  expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 1, frameIds: [0] }, files: ['injected.js'] });
  for (const fn of [tabs.create, tabs.duplicate, tabs.update, tabs.remove, tabs.query, windows.create, windows.update]) expect(fn).not.toHaveBeenCalled();
});

it('실패하면 이미 열린 문서를 확인하지만 새 창이나 탭은 만들지 않는다', async () => {
  const { tabs } = harness({ texts: [], pdf: [], error: '동적 뷰어 경로 확인 필요' });
  expect(await handleFetchRelatedDocContent({ title }, 1)).toMatchObject({ content: '', error: expect.stringContaining('동적 뷰어 경로 확인 필요') });
  expect(tabs.create).not.toHaveBeenCalled(); expect(tabs.duplicate).not.toHaveBeenCalled(); expect(tabs.query).toHaveBeenCalled();
});

it('직접 받은 PDF 바이트는 오프스크린 추출기로 읽는다', async () => {
  harness({ texts: [], pdf: [{ url: 'https://onnara.test/body.pdf', base64: 'JVBERi0=', bytes: 5 }] });
  const parse = vi.spyOn(pdf, 'pdfText').mockResolvedValue({ text, pages: 1 });
  expect((await handleFetchRelatedDocContent({ title, id }, 1)).content).toContain('10월 1일');
  expect(parse).toHaveBeenCalledWith(expect.objectContaining({ base64: 'JVBERi0=', url: expect.stringContaining('reference:') }));
});

it('PDF가 일부만 추출되면 성공으로 표시하지 않는다', async () => {
  harness({ texts: [], pdf: [{ url: 'https://onnara.test/body.pdf', base64: 'JVBERi0=' }] });
  vi.spyOn(pdf, 'pdfText').mockResolvedValue({ text, pages: 31 });
  const result = await handleFetchRelatedDocContent({ title, id }, 1);
  expect(result.content).toBe(''); expect(result.error).toContain('전체 본문');
});

it('다른 제목·화면 메뉴는 참고문서 본문으로 사용하지 않는다', async () => {
  harness({ texts: [text.replace(title, '다른 문서'), '본문 바로가기 주메뉴 결재대기함'], pdf: [] });
  expect((await handleFetchRelatedDocContent({ title, id }, 1)).content).toBe('');
});

it('조회 도중 원본 탭이 이동하면 결과를 폐기한다', async () => {
  const { tabs } = harness({ texts: [text], pdf: [] });
  tabs.get.mockResolvedValueOnce({ id: 1, url }).mockResolvedValueOnce({ id: 1, url: 'https://onnara.test/other' });
  const result = await handleFetchRelatedDocContent({ title, id }, 1);
  expect(result.content).toBe(''); expect(result.error).toContain('화면이 변경');
});

function openedHarness() {
  const setup = harness({ texts: [], pdf: [], error: '문서 ID 또는 원문 링크가 없어 직접 조회할 수 없습니다.' });
  const detailUrl = 'https://onnara.test/bms/dct/viewreport.do';
  setup.tabs.query.mockResolvedValue([{ id: 2, url: detailUrl, title: '온나라시스템' } as chrome.tabs.Tab]);
  setup.tabs.get.mockImplementation(async (tabId?: number) => ({ id: tabId || 1, url: tabId === 2 ? detailUrl : url }));
  return { ...setup, detailUrl };
}

it('제목만 있는 관련정보도 이미 열린 HTML·HWP 원문에서 읽는다', async () => {
  const { tabs, executeScript, windows } = openedHarness();
  executeScript.mockImplementation(async (opts?: any) => opts?.world === 'MAIN'
    ? [{ frameId: 0, result: { text, title, id } }] as any : []);
  const result = await handleFetchRelatedDocContent({ title }, 1);
  expect(result.content).toContain('10월 1일부터');
  for (const fn of [tabs.create, tabs.duplicate, tabs.update, tabs.remove, windows.create, windows.update]) expect(fn).not.toHaveBeenCalled();
});

it('제목만 있는 관련정보도 이미 열린 PDF 원문에서 읽는다', async () => {
  const { tabs } = openedHarness();
  tabs.sendMessage.mockImplementation(async (_tabId?: any, msg?: any) => msg?.type === 'EXTRACT' ? {
    type: 'EXTRACTED', payload: { url: 'https://onnara.test/bms/dct/viewreport.do', title: '온나라시스템', text,
      method: 'pdf', charCount: text.length, truncated: false, keptRatio: 1, estimatedTokens: 100, extractedAt: Date.now() },
  } as any : { type: 'RELATED_DOCUMENT_SOURCES', sources: { texts: [], pdf: [], error: 'ID 없음' } });
  expect((await handleFetchRelatedDocContent({ title }, 1)).content).toContain('10월 1일부터');
});

it('제목은 바깥 프레임, 한글 본문은 하위 프레임에 있어도 같은 탭에서 읽는다', async () => {
  const { executeScript } = openedHarness();
  executeScript.mockImplementation(async (opts?: any) => opts?.world === 'MAIN' ? [
    { frameId: 0, result: { text: '', title, id } },
    { frameId: 3, result: { text: '1. 행사 일정은 10월 1일부터 7일까지이며 안전 점검을 요청합니다.', title: '', id: '', bodyOnly: true } },
  ] as any : []);
  expect((await handleFetchRelatedDocContent({ title, id }, 1)).content).toContain('안전 점검');
});

it('다른 출처·기안기·문서 목록은 원문 후보로 읽지 않는다', async () => {
  const { tabs, executeScript } = openedHarness();
  tabs.query.mockResolvedValue([
    { id: 1, url }, { id: 2, url: 'https://other.test/bms/dct/viewreport.do' },
    { id: 3, url: 'https://onnara.test/bms/dct/addreport.do' }, { id: 4, url: 'https://onnara.test/main.do' },
  ] as chrome.tabs.Tab[]);
  expect((await handleFetchRelatedDocContent({ title }, 1)).content).toBe('');
  expect(executeScript.mock.calls.some((call: any) => call[0]?.world === 'MAIN')).toBe(false);
});

it('제목이 같아도 문서 ID가 다르면 열린 문서의 본문을 사용하지 않는다', async () => {
  const { executeScript } = openedHarness();
  executeScript.mockImplementation(async (opts?: any) => opts?.world === 'MAIN' ? [{ frameId: 0, result: { text, title, id: 'OTHER' } }] as any : []);
  expect((await handleFetchRelatedDocContent({ title, id }, 1)).content).toBe('');
});

it('한글 원문에 다른 제목이 있으면 바깥 카드 제목으로 덮어씌우지 않는다', async () => {
  const { executeScript } = openedHarness();
  executeScript.mockImplementation(async (opts?: any) => opts?.world === 'MAIN' ? [{ frameId: 0, result: { text: text.replace(title, '다른 문서 제목'), title, id } }] as any : []);
  expect((await handleFetchRelatedDocContent({ title }, 1)).content).toBe('');
});

it('한글 MAIN 월드 접근이 실패해도 열린 PDF 추출은 계속한다', async () => {
  const { tabs, executeScript } = openedHarness();
  executeScript.mockImplementation(async (opts?: any) => { if (opts?.world === 'MAIN') throw new Error('프레임 주입 실패'); return []; });
  tabs.sendMessage.mockImplementation(async (_tabId?: any, msg?: any) => msg?.type === 'EXTRACT' ? {
    type: 'EXTRACTED', payload: { url: 'https://onnara.test/bms/dct/viewreport.do', title: '온나라시스템', text,
      method: 'pdf', charCount: text.length, truncated: false, keptRatio: 1, estimatedTokens: 100, extractedAt: Date.now() },
  } as any : { type: 'RELATED_DOCUMENT_SOURCES', sources: { texts: [], pdf: [] } });
  expect((await handleFetchRelatedDocContent({ title }, 1)).content).toContain('10월 1일부터');
});
