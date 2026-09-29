// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { runReferenceProbe } from './reference-diagnosis';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

const id = 'DCTEF3F599DC9712EE4BC1EC15B8716FA9B';

it('원문 조회 응답의 프레임·폼 구조를 기록하고 하위 프레임을 따라간다', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(
      `<form action="/bms/dct/viewreportbodyview.do" method="post"><input type="hidden" name="docid" value="${id}"><input type="hidden" name="_csrf" value="secret-token"></form>` +
      `<iframe id="bodyFrame" src="/bms/dct/viewreportbodyview.do?docid=${id}"></iframe><script>HwpCtrl.Open('/bms/dct/hwpdown.do?fileid=1')</script>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    .mockResolvedValue(new Response('<div id="reportBody">제목 행사 개최계획 알림</div>', { headers: { 'content-type': 'text/html' } }));
  vi.stubGlobal('fetch', fetcher);
  const results = await runReferenceProbe('fetch', id) as any[];
  expect(results[0].dom.frames[0]).toMatchObject({ id: 'bodyFrame' });
  expect(results[0].dom.forms[0].inputs).toEqual([
    { name: 'docid', type: 'hidden', value: id },
    { name: '_csrf', type: 'hidden', value: '(12자)' },
  ]);
  expect(results[0].dom.inlineHints.join('\n')).toContain('hwpdown.do');
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('viewreportbodyview.do'))).toBe(true);
});

it('변경 동작 주소는 요청하지 않는다', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const results = await runReferenceProbe('fetch', undefined, '/bms/dct/deletereport.do?docid=1') as any[];
  expect(fetcher).not.toHaveBeenCalled();
  expect(results[0].skipped).toBeTruthy();
});

it('한글 컨트롤 속성을 읽지 않는다(속성 접근만으로 경고창이 뜬다)', async () => {
  const getter = vi.fn(() => 'x');
  (window as any).HwpCtrlProbe = Object.defineProperty({}, 'HwpDocuments', { get: getter, enumerable: true });
  await runReferenceProbe('frame');
  delete (window as any).HwpCtrlProbe;
  expect(getter).not.toHaveBeenCalled();
});

it('접수문서(ENF)는 접수문서 카드 주소로 조회한다', async () => {
  const fetcher = vi.fn(async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
  vi.stubGlobal('fetch', fetcher);
  await runReferenceProbe('fetch', 'ENF6989F09F81B3945218AD080C4645FC55');
  expect(String((fetcher.mock.calls[0] as unknown[])[0])).toContain('/bms/dctenf/BmsDctEnfReceiptCardDetail.do');
});

it('열린 프레임의 본문 컨트롤과 관련정보 행을 기록한다', async () => {
  document.body.innerHTML = '<table><tr><th>관련정보</th><td><span onclick="fn_view()">[보고문서] 행사 계획</span></td></tr></table><canvas></canvas>';
  (window as any).WebHwpCtrl = { GetTextFile() { return ''; } };
  const result = await runReferenceProbe('frame') as any;
  delete (window as any).WebHwpCtrl;
  expect(result.globals).toEqual(expect.arrayContaining([{ name: 'WebHwpCtrl', type: 'object' }]));
  expect(result.dom.relatedRows[0]).toContain('fn_view');
  expect(result.dom.canvasCount).toBe(1);
});
