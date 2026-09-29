// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { fetchRelatedDocument } from './related-document-fetch';

const title = '행사 개최계획 알림';
const id = 'DCTEF3F599DC9712EE4BC1EC15B8716FA9B';
const body = '1. 행사 일정은 10월 1일부터 7일까지이며 안전 점검을 요청합니다.';
const html = `<div id="reportBody"><p>제목 ${title}</p><p>${body}</p><p>붙임 : 1. 계획 1부. 끝.</p></div>`;
const signal = () => AbortSignal.timeout(3000);
const url = `${location.origin}/bms/dct/view.do?docid=${id}`;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

it('DCT ID와 CSRF로 직접 POST하고 기안기 DOM·팝업·폼을 건드리지 않는다', async () => {
  document.body.innerHTML = '<input type="hidden" name="_csrf" value="local-token"><input name="draft" value="미저장 기안">';
  const before = document.body.innerHTML;
  const open = vi.spyOn(window, 'open');
  const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
  const fetcher = vi.fn(async () => new Response(html));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({ title, id }, signal());
  expect(result.texts[0]).toContain(body);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [requestUrl, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(requestUrl).toBe(`${location.origin}/bms/dct/viewreport.do`);
  expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
  expect((init.body as URLSearchParams).get('docid')).toBe(id);
  expect((init.body as URLSearchParams).get('_csrf')).toBe('local-token');
  expect(document.body.innerHTML).toBe(before);
  expect(open).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

it('POST가 지원되지 않으면 같은 문서 ID의 GET 조회를 시도한다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 405 })).mockResolvedValueOnce(new Response(html));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({ title, id }, signal());
  expect(result.texts[0]).toContain(body);
  expect(fetcher.mock.calls[1]![0]).toContain(`?docid=${id}`);
});

it('문서 카드의 iframe → PDF.js 파일 주소를 따라 원본 PDF를 받는다', async () => {
  const pdfUrl = `${location.origin}/body.pdf`;
  const fetcher = vi.fn(async (address: string) => new Response(address === url
    ? '<iframe src="/viewer.html?file=%2Fbody.pdf"></iframe>'
    : address === pdfUrl ? '%PDF-1.7 test' : '<html></html>'));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({ title, url }, signal());
  expect(result.pdf).toEqual([expect.objectContaining({ url: pdfUrl, bytes: 13, base64: expect.any(String) })]);
  expect(document.querySelector('iframe')).toBeNull();
});

it('조회 폼의 문서 ID·토큰은 유지하되 form.submit은 실행하지 않는다', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(`<form method="post" action="/bms/dct/viewreportbodyview.do"><input type="hidden" name="docid" value="${id}"><input type="hidden" name="_csrf" value="next-token"></form>`)).mockResolvedValueOnce(new Response(html));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({ title, id, url }, signal());
  expect(result.texts[0]).toContain(body);
  expect((fetcher.mock.calls[1]![1].body as URLSearchParams).get('_csrf')).toBe('next-token');
});

it('HWPX 원본을 Content-Disposition 파일명으로 판별해 전체 본문을 추출한다', async () => {
  const bytes = zipSync({ 'Contents/section0.xml': strToU8(`<hs:sec xmlns:hs="sec" xmlns:hp="para"><hp:p><hp:run><hp:t>제목 ${title}</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>${body}</hp:t></hp:run></hp:p></hs:sec>`) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { headers: { 'content-disposition': 'attachment; filename="body.hwpx"' } })));
  expect((await fetchRelatedDocument({ title, url }, signal())).texts[0]).toContain(body);
});

it('현재 선택 문서와 다른 문서 ID의 응답은 제목이 같아도 거부한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`<input name="docid" value="DCT00000000000000000000000000000000">${html}`)));
  const result = await fetchRelatedDocument({ title, id, url }, signal());
  expect(result.texts).toEqual([]);
  expect(result.error).toContain('문서 ID');
});

it('제목이 다른 본문을 받아도 성공으로 반환하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html.replace(title, '다른 공문 안내'))));
  expect((await fetchRelatedDocument({ title, url }, signal())).texts).toEqual([]);
});

it('제목·결재자·첨부 목록만 있는 문서관리카드는 본문이 아니다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`<h1>${title}</h1><div>결재자 홍길동 검토자 담당자 시행문서</div><a href="/other.pdf">붙임.pdf</a>`)));
  const result = await fetchRelatedDocument({ title, url }, signal());
  expect(result.texts).toEqual([]);
  expect(result.pdf).toEqual([]);
  expect(result.error).toContain('본문을 찾지 못했습니다');
});

it('로그인 폼을 본문으로 사용하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`<input type="password">${html}`)));
  const result = await fetchRelatedDocument({ title, url }, signal());
  expect(result.texts).toEqual([]);
  expect(result.error).toContain('로그인');
});

it('HTTP 권한 실패를 반환하고 새 창으로 우회하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
  expect((await fetchRelatedDocument({ title, url }, signal())).error).toContain('403');
});

it('외부 출처·저장 경로·javascript 링크는 요청하지 않는다', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const link of ['https://other.test/body.pdf', `${location.origin}/bms/dct/save.do`, 'javascript:window.open("/body.pdf")']) {
    expect((await fetchRelatedDocument({ title, url: link }, signal())).error).toBeTruthy();
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('응답 속 스크립트·폼·외부 프레임을 실행하거나 제출하지 않는다', async () => {
  const fetcher = vi.fn(async () => new Response('<script>window.open("/popup");</script><iframe src="https://other.test/body.pdf"></iframe><form method="post" action="/bms/dct/save.do"><input type="hidden" name="docid" value="1"></form>'));
  vi.stubGlobal('fetch', fetcher);
  const open = vi.spyOn(window, 'open');
  await fetchRelatedDocument({ title, url }, signal());
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
});

it('크기 초과 원본과 구형 HWP는 사유를 알린다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('large', { headers: { 'content-length': '99999999' } })));
  expect((await fetchRelatedDocument({ title, url }, signal())).error).toContain('15MB');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), { headers: { 'content-disposition': 'attachment; filename="body.hwp"' } })));
  expect((await fetchRelatedDocument({ title, url }, signal())).error).toContain('구형 한글');
});

it('취소된 요청은 서버에 보내지 않는다', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController(); controller.abort();
  await expect(fetchRelatedDocument({ title, url }, controller.signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('순환 iframe 요청을 반복하지 않는다', async () => {
  const fetcher = vi.fn(async () => new Response(`<iframe src="${url}"></iframe>`));
  vi.stubGlobal('fetch', fetcher);
  await fetchRelatedDocument({ title, url }, signal());
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('서버 응답의 제목 셀과 본문 영역이 떨어져 있어도 읽는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`<table><tr><th>제 목</th><td>${title}</td></tr></table><div id="reportBody"><p>${body}</p></div>`)));
  expect((await fetchRelatedDocument({ title, url }, signal())).texts[0]).toContain(body);
});

it('제목이 요청 문서의 접두사와 같더라도 다른 문서는 거부한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(html.replace(title, title + ' 변경 계획'))));
  expect((await fetchRelatedDocument({ title, url }, signal())).texts).toEqual([]);
});

it('선택 ID와 다른 PDF 조회 주소는 요청하지 않는다', async () => {
  const fetcher = vi.fn(async (_address: string) => new Response('<iframe src="/body.pdf?docid=OTHER"></iframe>'));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({ title, id, url }, signal());
  expect(result.pdf).toEqual([]);
  expect(fetcher.mock.calls.every(([address]) => !String(address).includes('OTHER'))).toBe(true);
});

it('본문 URL 상수는 읽되 스크립트를 실행하거나 임의 PDF 문자열을 따르지 않는다', async () => {
  const fetcher = vi.fn(async (address: string) => new Response(address === url
    ? '<script>const bodyUrl = "/body.pdf"; window.open("/other.pdf");</script>'
    : '%PDF-1.7 test'));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({ title, url }, signal());
  expect(result.pdf).toHaveLength(1);
  expect(result.pdf[0]?.url).toBe(`${location.origin}/body.pdf`);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('원본 PDF를 확보하면 대체 경로를 더 요청하지 않는다', async () => {
  const fetcher = vi.fn(async () => new Response('%PDF-1.7 test'));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({ title, id, url }, signal());
  expect(result.pdf).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('드로어가 제목만 전달했어도 현재 관련정보 DOM에서 식별자를 다시 얻는다', async () => {
  document.body.innerHTML = `<input type="hidden" name="infodessource" value="${id}|문서「${title}」"><table><tr><th>관련정보</th><td><span>[문서] ${title}</span></td></tr></table>`;
  const fetcher = vi.fn(async () => new Response(html));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({ title }, signal());
  expect(result.texts[0]).toContain(body);
  expect(result.documentId).toBe(id);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('접수문서(ENF) ID는 BmsDctEnfReceiptCardDetail.do로 조회하고 카드의 변환 본문 PDF를 받는다', async () => {
  const enfId = 'ENF6989F09F81B3945218AD080C4645FC55';
  const pdfPath = '/bms/dctenf/Document.pdf?sFileName=5EC27A4B_docconv.pdf&docTitle=%ED%96%89%EC%82%AC.pdf&transFlag=N';
  const fetcher = vi.fn(async (address: string, _init?: RequestInit) => new Response(address.includes('BmsDctEnfReceiptCardDetail.do')
    ? `<input type="hidden" name="enfdocid" value="${enfId}"><input type="hidden" name="docid" value="DCT00000000000000000000000000000000"><script>jQuery("#bodyFrame").attr("src", "${pdfPath}");</script>`
    : address.includes('Document.pdf') ? '%PDF-1.7 body' : '<html></html>'));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({ title, id: enfId }, signal());
  const [cardUrl, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(cardUrl).toBe(`${location.origin}/bms/dctenf/BmsDctEnfReceiptCardDetail.do`);
  expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
  expect((init.body as URLSearchParams).get('enfdocid')).toBe(enfId);
  expect(fetcher.mock.calls.some(([address]) => String(address).includes('/bms/dct/viewreport.do'))).toBe(false);
  expect(result.pdf).toEqual([expect.objectContaining({ url: `${location.origin}${pdfPath}` })]);
});

it('기안기 열기 함수에서 기록한 요청을 먼저 보내고, 카드 스크립트와 같은 방식으로 본문 PDF 주소를 만든다', async () => {
  const enfId = 'ENF6989F09F81B3945218AD080C4645FC55';
  const cardUrl = `${location.origin}/bms/dctenf/BmsDctEnfReceiptCardDetail.do`;
  const pdfTitle = '2026년 핑크문화데이 운영 홍보 협조 요청(10월).pdf';
  // 실제 접수문서 카드(2026-09-29 진단 파일)에서 본 스크립트 모양
  const card = `<input type="hidden" name="enfdocid" value="${enfId}"><input type="hidden" name="docid" value="DCT6391A82FB7617A64F66D0C3ADAFB6820">
    <iframe id="pdfViewerArea" src=""></iframe><script>
    var strFileName = "${pdfTitle}";
    var pdfUrl = encodeURI( httpBaseURL + "/bms/dctenf/Document.pdf?sFileName=" + pdfCommFileInfo.sfilename + "&docTitle=" + strFileName + "&transFlag=N");
    initfileobj = new objf("14151da88dcadb1e80ea67c8640bc53f", "3AE35419512A920B7EE1CAC7AA0574D7.odt", "2026년 핑크문화데이 운영 홍보 협조 요청(10월).odt", "savebody", "64851", "0", "0", "0");
    initfileobj = new objf("bb281ea43b18aec40cca83a5f54ed7e0", "5EC27A4B1608F63657FABD7FFEB90E46_docconv.pdf", "${pdfTitle}", "savebody", "148870", "0", "0", "0");
    </script>`;
  const expectedPdf = `${location.origin}${encodeURI(`/bms/dctenf/Document.pdf?sFileName=5EC27A4B1608F63657FABD7FFEB90E46_docconv.pdf&docTitle=${pdfTitle}&transFlag=N`)}`;
  const fetcher = vi.fn(async (address: string, _init?: RequestInit) => new Response(address === cardUrl ? card
    : address === expectedPdf ? '%PDF-1.7 body' : '<html>잘못된 요청</html>'));
  vi.stubGlobal('fetch', fetcher);
  const result = await fetchRelatedDocument({
    title, id: enfId,
    open: { method: 'POST', url: cardUrl, fields: [['cmd', 'viewreport'], ['docid', ''], ['enfdocid', enfId], ['procgb', 'ctrl'], ['popupflag', 'Y']] },
  }, signal());
  const [firstUrl, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(firstUrl).toBe(cardUrl);
  expect((init.body as URLSearchParams).get('procgb')).toBe('ctrl');
  expect(fetcher.mock.calls.some(([address]) => String(address).endsWith('/Document.pdf?sFileName='))).toBe(false);
  expect(result.pdf).toEqual([expect.objectContaining({ url: expectedPdf })]);
  expect(result.trace).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/bms/dctenf/Document.pdf', status: 200, pdf: true })]));
});
