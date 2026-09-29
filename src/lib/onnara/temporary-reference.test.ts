import { afterEach, expect, it, vi } from 'vitest';
import { readTemporaryReference } from './temporary-reference';

const source = 'https://onnara.test/bms/dct/draft.do';
const id = 'DCTEF3F599DC9712EE4BC1EC15B8716FA9B';
const url = `https://onnara.test/bms/dct/viewreport.do?docid=${id}`;
function setup() {
  const tabs = {
    create: vi.fn(async () => ({ id: 9 })),
    get: vi.fn(async (tabId: number) => ({ id: tabId, url: tabId === 1 ? source : url, status: 'complete' })),
    remove: vi.fn(async () => undefined),
  };
  vi.stubGlobal('chrome', { tabs });
  return tabs;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('원문을 실제로 열어 본문을 읽고 자신이 만든 탭만 닫는다', async () => {
  const tabs = setup();
  const read = vi.fn(async () => ({ content: '검증한 본문' }));
  expect(await readTemporaryReference({ title: '제목', id }, 1, source, read)).toEqual({ content: '검증한 본문' });
  expect(tabs.create).toHaveBeenCalledWith({ url, active: true, openerTabId: 1 });
  expect(read).toHaveBeenCalledWith(9, expect.any(Number));
  expect(tabs.remove).toHaveBeenCalledExactlyOnceWith(9);
});

it('문서 로딩이 끝나고 지연 생성된 본문이 준비될 때까지 기다린다', async () => {
  vi.useFakeTimers();
  const tabs = setup();
  tabs.get.mockResolvedValueOnce({ id: 1, url: source, status: 'complete' })
    .mockResolvedValueOnce({ id: 9, url, status: 'loading' });
  const read = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ content: '본문' });
  const pending = readTemporaryReference({ title: '제목', id }, 1, source, read);
  await vi.advanceTimersByTimeAsync(2000);
  expect((await pending)?.content).toBe('본문');
  expect(read).toHaveBeenCalledTimes(2);
  expect(tabs.remove).toHaveBeenCalledExactlyOnceWith(9);
});

it('읽기 중 오류가 나도 임시 탭을 정리한다', async () => {
  const tabs = setup();
  await expect(readTemporaryReference({ title: '제목', id }, 1, source, async () => { throw new Error('추출 실패'); })).rejects.toThrow('추출 실패');
  expect(tabs.remove).toHaveBeenCalledExactlyOnceWith(9);
});

it('시간이 초과되어도 임시 탭을 정리한다', async () => {
  vi.useFakeTimers();
  const tabs = setup();
  const pending = expect(readTemporaryReference({ title: '제목', id }, 1, source, async () => null)).rejects.toThrow('30초');
  await vi.advanceTimersByTimeAsync(31_000);
  await pending;
  expect(tabs.remove).toHaveBeenCalledExactlyOnceWith(9);
});

it('사용자가 임시 탭을 다른 화면으로 이동하면 닫지 않는다', async () => {
  const tabs = setup();
  tabs.get.mockImplementation(async tabId => ({ id: tabId, url: tabId === 1 ? source : 'https://onnara.test/other', status: 'complete' }));
  const read = vi.fn();
  expect(await readTemporaryReference({ title: '제목', id }, 1, source, read)).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(tabs.remove).not.toHaveBeenCalled();
});

it('문서를 특정할 수 없거나 다른 출처·수정 주소이면 열지 않는다', async () => {
  const tabs = setup();
  for (const info of [{ title: '제목' }, { title: '제목', url: 'https://other.test/view.do' },
    { title: '제목', url: '/bms/dct/view.do?action=delete' }, { title: '제목', url: '/bms/dct/addreport.do' },
    { title: '제목', id, url: '/bms/dct/viewreport.do?docid=OTHER' }]) {
    expect(await readTemporaryReference(info, 1, source, vi.fn())).toBeNull();
  }
  expect(tabs.create).not.toHaveBeenCalled();
});
