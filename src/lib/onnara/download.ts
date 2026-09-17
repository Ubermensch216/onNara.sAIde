import { sendToSW, type AppError, type AttachmentDownloadResult, type ExtractedPage } from '@/lib/messaging/protocol';
import { requestedDocumentTitles } from './document-list';
import { downloadLink, escapeMarkdownText } from '@/lib/downloads/links';

/** 서비스 워커 요청 한도(180초)보다 약간 짧게 둔다. 한 문서의 첨부를 모두 받는 시간이다. */
const DOCUMENT_DOWNLOAD_TIMEOUT_MS = 170_000;

const STATUS_LABEL: Record<AttachmentDownloadResult['status'], string> = {
  complete: '다운로드 완료',
  in_progress: '다운로드 진행 중',
  not_started: '다운로드 시작 안 됨',
  failed: '다운로드 실패',
};

/**
 * 목록 화면이면 요청한 문서를 백그라운드 작업 탭에서 열어 첨부를 받고,
 * 상세 화면이면 현재 화면의 첨부를 받는다. 실제 클릭·감지는 서비스 워커가 한다.
 */
export async function downloadDocumentAttachments(options: {
  tabId: number; page: ExtractedPage; prompt: string; signal: AbortSignal;
  progress: (message: string) => void;
  report: (message: string) => Promise<void>;
}): Promise<void> {
  const { tabId, page, prompt, signal, progress, report } = options;
  const titles: Array<string | undefined> = page.structuredData ? requestedDocumentTitles(prompt, page.structuredData) : [undefined];
  if (!titles.length) throw new Error('첨부를 받을 문서를 체크하거나 문서 제목 또는 전체 문서를 지정하세요.');
  // 여러 문서면 복제한 목록 탭을 문서마다 새로 만들지 않고 이어서 쓴다. 끝나면 반드시 닫는다.
  const keepWorkTab = titles.filter(Boolean).length > 1;
  try {
    for (const [index, title] of titles.entries()) {
      signal.throwIfAborted();
      const label = title ?? page.title;
      progress(`${index + 1}/${titles.length}번째 문서의 첨부 파일을 찾아 내려받는 중 · ${label}`);
      const response = await sendToSW({
        type: 'DOWNLOAD_ATTACHMENTS', tabId, ...(title ? { title, keepWorkTab } : {}),
        control: { id: '', deadline: 0, expectedUrl: page.url },
      }, signal, DOCUMENT_DOWNLOAD_TIMEOUT_MS);
      signal.throwIfAborted();
      if (response.type === 'ERROR') {
        await report(formatAttachmentReport(label, { error: response.error }));
        continue;
      }
      if (response.type !== 'ATTACHMENTS_DOWNLOADED') {
        await report(`${label}\n첨부 다운로드 결과를 받지 못했습니다.`);
        continue;
      }
      await report(formatAttachmentReport(label, { results: response.results }));
      // 진행 중인 파일이 있으면 동시 다운로드를 피하려고 다음 문서로 넘어가지 않는다.
      if (response.results.some(result => result.status === 'in_progress')) return;
    }
  } finally {
    if (keepWorkTab) await releaseWorkTab(tabId);
  }
}

/** 남겨 둔 작업 탭을 닫는다. 중단·오류 뒤에도 탭이 남지 않게 요청 취소 신호와 무관하게 보낸다. */
export async function releaseWorkTab(tabId: number): Promise<void> {
  await sendToSW({ type: 'RELEASE_WORK_TAB', tabId, control: { id: '', deadline: 0 } }).catch(() => undefined);
}

/** 한 문서의 첨부 다운로드 결과를 답변 문구로 만든다. 요약과 함께 받을 때도 같은 형식을 쓴다. */
export function formatAttachmentReport(label: string, outcome: { results?: AttachmentDownloadResult[]; error?: AppError }): string {
  if (outcome.error) return `${label}\n첨부 다운로드 실패: ${outcome.error.message}${outcome.error.hint ? `\n${outcome.error.hint}` : ''}`;
  const results = outcome.results ?? [];
  const done = results.filter(result => result.status === 'complete').length;
  const guide = done ? ' 경로를 누르면 파일이 열리고, "폴더 열기"를 누르면 저장 위치가 탐색기로 열립니다.' : '';
  return `${label}\n첨부 ${results.length}건 중 ${done}건을 내려받았습니다.${guide}\n${results.map(describeResult).join('\n')}`;
}

/** 완료된 파일은 경로 링크(열기)와 폴더 열기 링크로, 나머지는 상태와 사유로 한 줄을 만든다. */
export function describeResult(result: AttachmentDownloadResult): string {
  const name = escapeMarkdownText(result.name);
  if (result.downloadId !== undefined && result.status === 'complete') {
    const path = escapeMarkdownText(result.path ?? result.name);
    return `- ${name}: ${STATUS_LABEL.complete}\n  [${path}](${downloadLink('open', result.downloadId)}) · [폴더 열기](${downloadLink('show', result.downloadId)})`;
  }
  const folder = result.downloadId !== undefined && result.status === 'in_progress'
    ? ` · [폴더 열기](${downloadLink('show', result.downloadId)})` : '';
  return `- ${name}: ${STATUS_LABEL[result.status]}${result.message ? ` (${escapeMarkdownText(result.message)})` : ''}${folder}`;
}
