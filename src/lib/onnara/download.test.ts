import { afterEach, expect, it, vi } from 'vitest';
import { downloadDocumentAttachments } from './download';
import type { ExtractedPage } from '@/lib/messaging/protocol';
afterEach(() => vi.unstubAllGlobals());

const base: ExtractedPage = { url: 'https://example.test/doc', title: '문서', text: '', charCount: 0,
  truncated: false, keptRatio: 1, estimatedTokens: 0, method: 'innerText', extractedAt: 1 };

it('목록 화면에서는 선택 문서마다 백그라운드 첨부 다운로드를 요청하고 결과를 보고한다', async () => {
  const sendMessage = vi.fn(async (message: { title?: string }) => ({
    type: 'ATTACHMENTS_DOWNLOADED',
    results: [{ name: `${message.title}.xlsx`, status: 'complete' }],
  }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const page: ExtractedPage = { ...base, structuredData: {
    kind: 'onnara-document-list', listName: '받은문서', columns: [],
    rows: [{ title: '가 문서' }, { title: '나 문서' }], selectedTitles: ['나 문서'],
  } };
  const report = vi.fn(async () => undefined);
  await downloadDocumentAttachments({ tabId: 1, page, titles: ['나 문서'], signal: new AbortController().signal, progress: vi.fn(), report });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'DOWNLOAD_ATTACHMENTS', tabId: 1, title: '나 문서' }));
  expect(report).toHaveBeenCalledWith(expect.stringContaining('나 문서.xlsx: 다운로드 완료'));
});

it('첨부 파일이 없는 문서인 경우 첨부 파일 없음을 명시하고 정상 보고한다', async () => {
  const sendMessage = vi.fn(async () => ({
    type: 'ATTACHMENTS_DOWNLOADED',
    results: [],
  }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const report = vi.fn(async () => undefined);
  await downloadDocumentAttachments({ tabId: 1, page: base, titles: [undefined], signal: new AbortController().signal, progress: vi.fn(), report });
  expect(report).toHaveBeenCalledWith(expect.stringContaining('첨부 파일이 없습니다.'));
});
