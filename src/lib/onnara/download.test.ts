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
  await downloadDocumentAttachments({ tabId: 1, page, prompt: '선택한 문서에 첨부된 파일을 다운받아줘', signal: new AbortController().signal, progress: vi.fn(), report });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'DOWNLOAD_ATTACHMENTS', tabId: 1, title: '나 문서' }));
  expect(report).toHaveBeenCalledWith(expect.stringContaining('나 문서.xlsx: 다운로드 완료'));
});

it('상세 화면에서는 제목 없이 현재 화면의 첨부를 받고 실패 사유를 보여준다', async () => {
  const sendMessage = vi.fn(async (_message: object) => ({ type: 'ERROR', error: { code: 'UNKNOWN', message: '문서 화면에서 첨부 파일을 찾지 못했습니다.', hint: '확인하세요' } }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  const report = vi.fn(async () => undefined);
  await downloadDocumentAttachments({ tabId: 1, page: base, prompt: '첨부 다운로드', signal: new AbortController().signal, progress: vi.fn(), report });
  expect(sendMessage.mock.calls[0]![0]).not.toHaveProperty('title');
  expect(report).toHaveBeenCalledWith(expect.stringContaining('첨부 파일을 찾지 못했습니다'));
});
