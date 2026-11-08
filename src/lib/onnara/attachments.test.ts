// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import {
  cleanAttachmentFileName,
  clickAttachment,
  isHtmlAttachmentName,
  listAttachments,
  markAttachment,
  readAttachmentContent,
  scanAttachments,
  withAttachedFileTexts,
} from './attachments';

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

it('확장자가 점 없이 붙는 온나라 링크 첨부도 찾아낸다', () => {
  document.body.innerHTML = `<div id="atchFileList"><span>첨부</span>
    <label><input type="checkbox"> 1.</label><a href="#" onclick="down(1)">2025년 정기종합감사 처분요구 처리결과(수영구, 20260916)hwpx(link).html</a> [3K]
    <label><input type="checkbox"> 2.</label><a href="#" onclick="down(2)">증빙자료zip(link).html</a> [3K]
    <a href="#" onclick="help()">도움말 보기</a></div>`;
  const items = listAttachments();
  expect(items.map(item => item.name)).toEqual([
    '2025년 정기종합감사 처분요구 처리결과(수영구, 20260916)hwpx(link).html',
    '증빙자료zip(link).html',
  ]);
  expect(items.every(item => isHtmlAttachmentName(item.name))).toBe(true);
  expect(isHtmlAttachmentName('붙임.hwp')).toBe(false);
});

it('첨부 파일 이름에서 크기 표기를 걷어내고 온나라 링크 첨부 이름을 보존한다', () => {
  expect(cleanAttachmentFileName('부산시_홍보매체통합DB_현황조사양식.xlsx (23KB)')).toBe('부산시_홍보매체통합DB_현황조사양식.xlsx');
  expect(cleanAttachmentFileName('처분요구 처리결과hwpx(link).html [3K]')).toBe('처분요구 처리결과hwpx(link).html');
});

it('첨부 요소를 표시하고 텍스트·HTML 첨부를 읽어 문서 본문 뒤에 합친다', async () => {
  document.body.innerHTML = `<div id="attachments"><a href="#" onclick="down(1)">붙임1_세부추진계획.txt (12KB)</a></div>`;
  const items = listAttachments();
  expect(markAttachment(items[0]!.index, '다른파일.txt')).toBe(false);
  expect(markAttachment(items[0]!.index, items[0]!.name)).toBe(true);

  const fetchMock = vi.fn(async () => new Response('세부 추진 일정: 11월 15일까지 제출', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  }));
  vi.stubGlobal('fetch', fetchMock);

  const read = await readAttachmentContent({
    name: items[0]!.name,
    url: 'https://onnara.test/download/1',
  });
  expect(read.name).toBe('붙임1_세부추진계획.txt');
  expect(read.text).toContain('세부 추진 일정: 11월 15일까지 제출');

  const basePage = {
    url: 'https://onnara.test/doc/1',
    title: '추진계획 안내',
    text: '본문: 붙임 계획을 참고하시기 바랍니다.',
    charCount: 24,
    truncated: false,
    keptRatio: 1,
    estimatedTokens: 15,
    method: 'innerText' as const,
    extractedAt: 1000,
  };
  const merged = withAttachedFileTexts(basePage, [{ name: read.name, text: read.text }], 2000);
  expect(merged.text).toContain('본문: 붙임 계획을 참고하시기 바랍니다.');
  expect(merged.text).toContain('[첨부문서: 붙임1_세부추진계획.txt]');
  expect(merged.text).toContain('세부 추진 일정: 11월 15일까지 제출');
  vi.unstubAllGlobals();
});
