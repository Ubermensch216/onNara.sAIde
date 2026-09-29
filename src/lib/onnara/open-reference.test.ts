// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readOpenReferenceFrame } from './open-reference';
afterEach(() => { delete (window as any).HwpCtrl; document.body.innerHTML = ''; });
const title = '2026년 북구 종합감사 유공 표창 대상자 알림';
const body = '1. 종합감사 유공 표창 대상자 자료를 10월 1일까지 제출하여 주시기 바랍니다.';
it('열린 한글 컨트롤의 비동기 GetTextFile 콜백을 기다리며 편집하지 않는다', async () => {
  const control = { GetTextFile: vi.fn((_format, _options, done) => { queueMicrotask(() => done(`제목 ${title}\n${body}`)); }), Run: vi.fn(), SetTextFile: vi.fn() };
  (window as any).HwpCtrl = control;
  expect((await readOpenReferenceFrame())?.text).toContain(body);
  expect(control.GetTextFile).toHaveBeenCalledWith('TEXT', '', expect.any(Function));
  expect(control.Run).not.toHaveBeenCalled(); expect(control.SetTextFile).not.toHaveBeenCalled();
});
it('GetFieldText 본문과 문서 제목·ID를 함께 반환한다', async () => {
  document.body.innerHTML = `<input name="docid" value="DCT123"><table><tr><th>제목</th><td>${title}</td></tr></table>`;
  (window as any).HwpCtrl = { GetFieldText: vi.fn(() => body) };
  expect(await readOpenReferenceFrame()).toEqual({ text: body, title, id: 'DCT123', bodyOnly: true });
});
it('본문 없는 문서관리카드는 메타정보만 반환한다', async () => {
  document.body.innerHTML = `<input name="docTitle" value="${title}"><p>관련정보 결재경로 담당자 보고일자</p>`;
  expect(await readOpenReferenceFrame()).toEqual({ text: '', title, id: '' });
});
it('HTML 본문은 줄바꿈을 보존하고 DOM을 변경하지 않는다', async () => {
  document.body.innerHTML = `<div id="reportBody"><p>제목 ${title}</p><p>${body}</p></div>`;
  const before = document.body.innerHTML;
  expect((await readOpenReferenceFrame())?.text).toContain(`제목 ${title}\n${body}`);
  expect(document.body.innerHTML).toBe(before);
});
