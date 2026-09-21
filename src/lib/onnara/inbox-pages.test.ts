// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { fetchInboxPage, firstInboxPage, parseInboxPage } from './inbox-pages';
import type { DocumentListLocation } from './document-navigation';

const location: DocumentListLocation = {
  url: `${window.location.origin}/inbox`, framePath: [2, 1],
  form: { method: 'post', fields: [['pageIndex', '1'], ['searchKeyword', '예산'], ['searchFrom', '2020-01-01']] },
};
const table = (start = 0, count = 10) => `<h2>받은문서</h2><table>
  <tr><th>제목</th><th>보고일자</th><th>열람</th></tr>
  ${Array.from({ length: count }, (_, i) => `<tr><td>예산 문서 ${start + i}</td><td>2026.09.21</td><td>미열람</td></tr>`).join('')}
</table>`;
const pageNumber = (value: DocumentListLocation | null) => value?.form?.fields.find(([name]) => name === 'pageIndex')?.[1];
afterEach(() => vi.unstubAllGlobals());

it('중간 페이지에서 지정했어도 첫 페이지부터 조회하고 검색 조건은 유지한다', () => {
  const saved = { ...location, url: `${location.url}?pageIndex=7&menu=inbox`, form: { method: 'post' as const, fields: [['pageIndex', '7'], ['searchKeyword', '예산']] as Array<[string, string]> } };
  const first = firstInboxPage(saved);
  expect(pageNumber(first)).toBe('1');
  expect(new URL(first.url).searchParams.get('pageIndex')).toBe('1');
  expect(first.form?.fields).toContainEqual(['searchKeyword', '예산']);
  expect(pageNumber(saved)).toBe('7');
});

it('숫자 및 다음 묶음 링크를 보고 한 페이지씩 진행한다', () => {
  const html = table() + `<div class="paging"><strong>1</strong><a href="javascript:linkPage(2)">2</a><a onclick="linkPage(11)">다음</a></div>`;
  const page = parseInboxPage(html, location);
  expect(page.list.rows).toHaveLength(10);
  expect(pageNumber(page.next)).toBe('2');
  expect(page.next?.form?.fields).toContainEqual(['searchKeyword', '예산']);
  const tenth = { ...location, form: { ...location.form!, fields: [['pageIndex', '10']] as Array<[string, string]> } };
  expect(pageNumber(parseInboxPage(table() + `<a onclick="fn_egov_link_page(11)">다음</a>`, tenth).next)).toBe('11');
});

it('GET 페이지 링크를 따라갈 때 저장된 검색 조건을 유지한다', () => {
  const getLocation = { url: `${location.url}?keyword=budget`, framePath: [] };
  const page = parseInboxPage(table() + '<div class="pagination"><a href="?pageNo=2">2</a></div>', getLocation);
  expect(new URL(page.next!.url).searchParams.get('keyword')).toBe('budget');
  expect(new URL(page.next!.url).searchParams.get('pageNo')).toBe('2');
});

it('총 건수와 페이지 크기로도 다음 페이지를 찾는다', () => {
  expect(pageNumber(parseInboxPage(table() + '<input name="totalRecordCount" value="21"><input name="recordCountPerPage" value="10">', location).next)).toBe('2');
});

it('마지막 페이지와 빈 문서함에서는 정상 종료한다', () => {
  const last = { ...location, form: { ...location.form!, fields: [['pageIndex', '3']] as Array<[string, string]> } };
  expect(parseInboxPage(table(20, 1) + '<div class="paging"><a onclick="linkPage(2)">2</a><strong>3</strong><a aria-disabled="true">다음</a></div>', last).next).toBeNull();
  expect(parseInboxPage(table(0, 0), location).list.rows).toHaveLength(0);
});

it('알 수 없는 다음 페이지를 끝으로 오인하지 않는다', () => {
  expect(() => parseInboxPage(table() + '<div class="paging"><a onclick="unknownNext()">다음</a></div>', location)).toThrow('전체 수집');
});

it('로그인 화면을 문서 0건으로 처리하지 않는다', () => {
  expect(() => parseInboxPage('<h1>인증서 로그인</h1>', location)).toThrow('세션');
});

it('한 페이지에 500건보다 많이 있더라도 모두 읽는다', () => {
  expect(parseInboxPage(table(0, 525), location).list.rows).toHaveLength(525);
});

it('현재 화면에 목록이나 iframe이 없어도 POST로 조회하며 화면과 열람 상태를 바꾸지 않는다', async () => {
  document.body.innerHTML = '<h1>일정 화면</h1>';
  const fetcher = vi.fn(async () => new Response(table()));
  vi.stubGlobal('fetch', fetcher);
  const page = await fetchInboxPage(location, new AbortController().signal);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe(location.url);
  expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  expect((init.body as URLSearchParams).get('searchKeyword')).toBe('예산');
  expect(page.list.rows.every(row => row.readState === '미열람')).toBe(true);
  expect(document.body.innerHTML).toBe('<h1>일정 화면</h1>');
});

it('GET 폼의 중복 검색 필드와 URL의 다른 조건을 보존한다', async () => {
  const fetcher = vi.fn(async () => new Response(table()));
  vi.stubGlobal('fetch', fetcher);
  await fetchInboxPage({ url: `${location.url}?pageNo=9&menu=inbox`, framePath: [], form: { method: 'get', fields: [['pageNo', '1'], ['category', 'a'], ['category', 'b']] } }, new AbortController().signal);
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.searchParams.getAll('category')).toEqual(['a', 'b']);
  expect(url.searchParams.getAll('pageNo')).toEqual(['1']);
  expect(url.searchParams.get('menu')).toBe('inbox');
  expect(init.body).toBeUndefined();
});

it('조회 실패와 다른 출처를 오류로 전달한다', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(fetchInboxPage(location, new AbortController().signal)).rejects.toThrow('503');
  await expect(fetchInboxPage({ ...location, url: 'https://another.test/inbox' }, new AbortController().signal)).rejects.toThrow('출처');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('총 건수가 남았는데 페이지 필드가 없으면 일부만 완료하지 않는다', () => {
  expect(() => parseInboxPage(table() + '<input name="totalCount" value="21"><input name="pageSize" value="10">', { url: location.url, framePath: [] })).toThrow('전체 수집');
});

it('다른 출처의 다음 링크를 따라가거나 완료로 처리하지 않는다', () => {
  expect(() => parseInboxPage(table() + '<a rel="next" href="https://another.test/inbox?pageNo=2">다음</a>', location)).toThrow('전체 수집');
});
