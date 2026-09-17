// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { clickAttachment, isAttachmentDownloadRequest, listAttachments, scanAttachments } from './attachments';

it('첨부 영역의 일반 링크만 수집하고 메뉴·스크립트·중복을 제외한다', () => {
  document.body.innerHTML = `<a href="https://example.test/help.pdf">도움말.pdf</a><div id="attachments">
    <a href="https://example.test/file?id=1">붙임.hwp</a>
    <a href="https://example.test/file?id=1">붙임.hwp</a>
    <a href="javascript:download(2)">자료.pdf</a>
    <button onclick="download(3)">자료.xlsx</button></div>`;
  expect(scanAttachments()).toEqual({ links: [{ name: '붙임.hwp', url: 'https://example.test/file?id=1' }], unsupported: 2 });
  expect(isAttachmentDownloadRequest('문서에 첨부된 자료를 모두 다운로드 하라')).toBe(true);
  expect(isAttachmentDownloadRequest('첨부 자료를 요약해줘')).toBe(false);
});

it('다운받아줘·내려받아 같은 구어체 요청도 첨부 다운로드로 인식한다', () => {
  expect(isAttachmentDownloadRequest('선택한 문서에 첨부된 파일을 다운받아줘.')).toBe(true);
  expect(isAttachmentDownloadRequest('붙임 파일 내려 받아줘')).toBe(true);
  expect(isAttachmentDownloadRequest('첨부파일 받아줘')).toBe(true);
  expect(isAttachmentDownloadRequest('선택한 문서의 내용을 요약해줘')).toBe(false);
});

it('스크립트 방식 첨부도 목록에 포함하고 겹친 요소는 가장 안쪽만 남기며 이름이 맞을 때만 누른다', () => {
  document.body.innerHTML = `<table><tr><th>첨부</th><td onclick="void 1"><span>부산시_홍보매체통합DB_현황조사양식.xlsx (23KB)</span></td></tr>
    <tr><td><a href="#" onclick="void 2">붙임2.hwp</a></td><td><a href="#" onclick="void 2" class="x">붙임2.hwp</a></td></tr></table>
    <div class="menu"><a onclick="void 3">사용자매뉴얼.pdf</a></div>`;
  const items = listAttachments();
  expect(items.map(item => item.name)).toEqual(['부산시_홍보매체통합DB_현황조사양식.xlsx (23KB)', '붙임2.hwp']);
  expect(items.every(item => item.url === undefined)).toBe(true);
  const clicked = vi.fn();
  document.querySelector('td')!.addEventListener('click', clicked);
  expect(clickAttachment(items[0]!.index, '다른 이름.xlsx')).toBe(false);
  expect(clickAttachment(items[0]!.index, items[0]!.name)).toBe(true);
  expect(clicked).toHaveBeenCalledTimes(1);
});
