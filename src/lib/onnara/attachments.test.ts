// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { clickAttachment, listAttachments, scanAttachments } from './attachments';

it('첨부 영역의 일반 링크만 수집하고 메뉴·스크립트·중복을 제외한다', () => {
  document.body.innerHTML = `<a href="https://example.test/help.pdf">도움말.pdf</a><div id="attachments">
    <a href="https://example.test/file?id=1">붙임.hwp</a>
    <a href="https://example.test/file?id=1">붙임.hwp</a>
    <a href="javascript:download(2)">자료.pdf</a>
    <button onclick="download(3)">자료.xlsx</button></div>`;
  expect(scanAttachments()).toEqual({ links: [{ name: '붙임.hwp', url: 'https://example.test/file?id=1' }], unsupported: 2 });
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
