import { validBubbleBody } from '@/lib/messaging/draft-protocol';
import { normalizeAiEndpoint } from '@/lib/llm/destination';
import { abortable } from '@/lib/async';
/**
 * 오프스크린 문서 — PDF 본문 글자 추출 전용.
 *
 * 서비스 워커는 DOM·동적 import가 없어 pdf.js를 직접 돌리기 어렵고, 번들이 커지면
 * 깨어날 때마다 비용을 치른다. PDF가 있을 때만 이 문서를 만들어 해석을 맡긴다.
 * 화면에 보이지 않으며 lib/extract/pdf-offscreen.ts가 한동안 쓰지 않으면 닫는다.
 */

// Edge 최소 지원 버전(116)에 없는 문법·API를 쓰지 않도록 legacy 빌드를 쓴다.
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { base64ToBytes, extractPdfText, type GetPdfDocument } from '@/lib/extract/pdf-text';
import { isGenerateTextPdfRequest, isParsePdfRequest } from '@/lib/extract/pdf-offscreen';
import { renderTextToPdfBase64 } from '@/lib/extract/text-pdf';

GlobalWorkerOptions.workerSrc = workerSrc;

const aiRequests = new Map<string, AbortController>();
chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const value = msg as { target?: string; type?: string; requestId?: string; endpoint?: string; body?: unknown } | null;
  if (!sender.tab && value?.target === 'saide-offscreen' && typeof value.requestId === 'string') {
    if (value.type === 'CANCEL_AI') {
      aiRequests.get(value.requestId)?.abort();
      sendResponse({ ok: true });
      return false;
    }
    if (value.type === 'TRANSFORM_AI' && typeof value.endpoint === 'string' && validBubbleBody(value.body) && !aiRequests.has(value.requestId)) {
      const controller = new AbortController();
      aiRequests.set(value.requestId, controller);
      void (async () => {
        try {
          const response = await abortable(fetch(normalizeAiEndpoint(value.endpoint!) + '/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...value.body as object, stream: false }),
            signal: controller.signal, credentials: 'omit', redirect: 'error',
          }), controller.signal);
          if (!response.ok) throw new Error('Ollama 통신 오류 (' + response.status + ')');
          const json = await abortable(response.json(), controller.signal);
          const result = String(json.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
          if (!result) throw new Error('AI 변환 결과를 생성하지 못했습니다.');
          sendResponse({ result });
        } catch (error) {
          sendResponse({ error: controller.signal.aborted ? 'AI 변환을 취소했습니다.' : error instanceof Error ? error.message : String(error) });
        } finally { aiRequests.delete(value.requestId!); }
      })();
      return true;
    }
  }
  if (isParsePdfRequest(msg)) {
    void extractPdfText(getDocument as unknown as GetPdfDocument, base64ToBytes(msg.base64), { cMapUrl: chrome.runtime.getURL('/cmaps/') })
      .then(sendResponse);
    return true;
  }
  if (isGenerateTextPdfRequest(msg)) {
    void renderTextToPdfBase64(msg.input)
      .then(base64 => sendResponse({ base64 }))
      .catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  return false;
});
