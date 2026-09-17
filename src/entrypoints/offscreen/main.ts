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
import { isParsePdfRequest } from '@/lib/extract/pdf-offscreen';

GlobalWorkerOptions.workerSrc = workerSrc;

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isParsePdfRequest(msg)) return false;
  void extractPdfText(getDocument as unknown as GetPdfDocument, base64ToBytes(msg.base64), { cMapUrl: chrome.runtime.getURL('/cmaps/') })
    .then(sendResponse);
  return true;
});
