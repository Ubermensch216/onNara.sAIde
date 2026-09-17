// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { clearPdfSourceCache, findPdfUrls, readPdfSources } from './pdf-source';
import { base64ToBytes } from './pdf-text';
import { withPdfSections } from './pdf-offscreen';

beforeEach(() => clearPdfSourceCache());

it('embed·object로 띄운 PDF 주소를 찾고, 브라우저 내부 뷰어의 about:blank는 건너뛴다', () => {
  document.body.innerHTML = `
    <embed type="application/pdf" src="about:blank">
    <embed type="application/pdf" src="/ekp/viewer/body.do?id=1">
    <object data="files/붙임.pdf"></object>
    <embed src="/banner.swf">`;
  expect(findPdfUrls(document)).toEqual([
    new URL('/ekp/viewer/body.do?id=1', document.baseURI).href,
    new URL('files/붙임.pdf', document.baseURI).href,
  ]);
});

it('프레임 문서 자체가 PDF면 그 문서 주소를 PDF로 본다', () => {
  const pdfDocument = { contentType: 'application/pdf', location: { href: 'https://onnara.test/body.pdf' } } as unknown as Document;
  expect(findPdfUrls(pdfDocument)).toEqual(['https://onnara.test/body.pdf']);
});

it('PDF 원본을 로그인 쿠키와 함께 한 번만 받고, PDF가 아닌 응답은 이유와 함께 돌려준다', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).endsWith('login')
    ? new Response('<html>로그인</html>')
    : new Response('%PDF-1.4 본문'));
  const first = await readPdfSources(['https://onnara.test/body.pdf', 'https://onnara.test/login'], fetcher as typeof fetch);
  expect(new TextDecoder().decode(base64ToBytes(first[0]!.base64!))).toBe('%PDF-1.4 본문');
  expect(first[1]).toEqual({ url: 'https://onnara.test/login', error: 'PDF가 아닌 응답을 받았습니다' });
  expect(fetcher).toHaveBeenCalledWith('https://onnara.test/body.pdf', { credentials: 'include' });

  // 상세 화면을 반복 추출해도 PDF는 다시 받지 않는다. 실패한 주소는 다시 시도한다.
  await readPdfSources(['https://onnara.test/body.pdf', 'https://onnara.test/login'], fetcher as typeof fetch);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('body.pdf'))).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('login'))).toHaveLength(2);
});

it('PDF 본문을 화면 글자 앞에 붙여 예산에 맞춘다', () => {
  const page = { url: 'https://onnara.test', title: '수신 공문', text: '붙임 1. 감사원 감사자료 제출 요구 공문.pdf', charCount: 30, truncated: false, keptRatio: 1, estimatedTokens: 10, method: 'innerText' as const, extractedAt: 1 };
  const merged = withPdfSections(page, [{ text: '감사원에서 실시 예정인 「창업기업 재정지원 운영실태」', pages: 2 }], 2000);
  expect(merged.method).toBe('pdf');
  expect(merged.text.indexOf('창업기업')).toBeLessThan(merged.text.indexOf('붙임 1.'));
  expect(merged.charCount).toBeGreaterThan(page.charCount);
});
