import { sendToSW, type AppError, type AttachmentDownloadResult, type AttachmentNaming, type ExtractedPage } from '@/lib/messaging/protocol';
import { loadSettings } from '@/lib/storage/settings';
import { downloadLink, escapeMarkdownText } from '@/lib/downloads/links';
import { panelLink } from '@/lib/panel/links';
import { cancelAutomation, enqueueAutomation, workTabLock, type AutomationJob } from '@/lib/automation/jobs';

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
 * AI 대화에서 요청하든 자동화 탭에서 누르든 같은 작업 대기열을 거친다.
 */
export async function downloadDocumentAttachments(options: {
  /** 대상 문서 제목. 상세 화면 한 건이면 [undefined]다. */
  tabId: number; page: ExtractedPage; titles: Array<string | undefined>; signal: AbortSignal;
  progress: (message: string) => void;
  report: (message: string) => Promise<void>;
}): Promise<void> {
  const { tabId, page, titles, signal, progress, report } = options;
  if (!titles.length) throw new Error('첨부를 받을 문서를 온나라 목록에서 체크하세요.');
  progress(`첨부 파일을 찾아 내려받는 중 · 문서 ${titles.length}건 (진행 상황은 도구 탭에서도 볼 수 있습니다)`);
  await queueAttachmentDownloads({ tabId, page, titles, origin: 'chat', signal,
    onFinished: async (job, index) => {
      progress(`${index + 1}/${titles.length}번째 문서 첨부 처리 완료 · ${job.label}`);
      await report(formatAttachmentReport(job.label, { results: job.files, error: job.error, jobId: job.id }));
    } });
}

/**
 * 문서마다 첨부 다운로드 작업을 대기열에 넣고 순서대로 끝날 때까지 기다린다.
 * 여러 문서면 복제한 목록 탭을 이어서 쓰고, 모두 끝나면(취소 포함) 닫는다.
 */
export async function queueAttachmentDownloads(options: {
  tabId: number; page: ExtractedPage; titles: Array<string | undefined>;
  origin: 'automation' | 'chat'; signal?: AbortSignal;
  onFinished?: (job: AutomationJob, index: number) => Promise<void> | void;
}): Promise<AutomationJob[]> {
  const { tabId, page, titles, origin, signal, onFinished } = options;
  const keepWorkTab = titles.filter(Boolean).length > 1;
  const naming = await namingPlans(page, titles);
  // 앞 문서의 파일이 아직 내려받는 중이면 동시 다운로드를 피하려고 뒤 문서는 실행하지 않는다.
  let stalled = false;
  const pending = titles.map((title, index) => enqueueAutomation({
    kind: 'download-attachments', label: title ?? page.title, origin,
    run: async jobSignal => {
      if (stalled) return { error: { code: 'UNKNOWN', message: '앞 문서의 다운로드가 아직 끝나지 않아 실행하지 않았습니다. 다운로드가 끝난 뒤 다시 요청하세요.' } };
      const response = await sendToSW({
        type: 'DOWNLOAD_ATTACHMENTS', tabId, ...(title ? { title, keepWorkTab } : {}),
        ...(naming[index] ? { naming: naming[index]! } : {}),
        control: { id: '', deadline: 0, expectedUrl: page.url },
      }, jobSignal, DOCUMENT_DOWNLOAD_TIMEOUT_MS);
      if (response.type === 'ERROR') return { error: response.error };
      if (response.type !== 'ATTACHMENTS_DOWNLOADED') return { error: { code: 'UNKNOWN', message: '첨부 다운로드 결과를 받지 못했습니다.' } };
      if (response.results.some(result => result.status === 'in_progress')) stalled = true;
      return {
        files: response.results,
        ...(response.results.length === 0 ? { summary: '첨부 파일이 없습니다.' } : {}),
      };
    },
  }));
  const cancel = () => { for (const { id } of pending) cancelAutomation(id); };
  signal?.addEventListener('abort', cancel, { once: true });
  const jobs: AutomationJob[] = [];
  try {
    for (const [index, { finished }] of pending.entries()) {
      const job = await finished;
      jobs.push(job);
      if (!signal?.aborted) await onFinished?.(job, index);
    }
    return jobs;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (keepWorkTab) await workTabLock(() => releaseWorkTab(tabId));
  }
}

/**
 * 문서마다 파일명 정규화 계획을 만든다 (B5).
 *
 * ★ 보고일자는 목록 행에서 읽는다. 상세 화면 한 건(title이 없는 경우)은 화면 제목만 쓴다.
 * ★ 설정이 'browser'면 아무 계획도 만들지 않는다 — 그때는 브라우저가 정한 이름 그대로다.
 */
async function namingPlans(page: ExtractedPage, titles: Array<string | undefined>): Promise<Array<AttachmentNaming | null>> {
  const settings = await loadSettings().catch(() => null);
  if (settings?.attachmentNaming !== 'normalized') return titles.map(() => null);
  const rows = page.structuredData?.rows ?? [];
  return titles.map(title => {
    const docTitle = title ?? page.title;
    if (!docTitle.trim()) return null;
    const reportDate = title ? rows.find(row => row.title === title)?.reportDate : undefined;
    return {
      docTitle,
      ...(reportDate ? { reportDate } : {}),
      ...(settings.attachmentFolder ? { folder: true } : {}),
    };
  });
}

/** 남겨 둔 작업 탭을 닫는다. 중단·오류 뒤에도 탭이 남지 않게 요청 취소 신호와 무관하게 보낸다. */
export async function releaseWorkTab(tabId: number): Promise<void> {
  await sendToSW({ type: 'RELEASE_WORK_TAB', tabId, control: { id: '', deadline: 0 } }).catch(() => undefined);
}

/**
 * 한 문서의 첨부 다운로드 결과를 답변 문구로 만든다. 요약과 함께 받을 때도 같은 형식을 쓴다.
 *
 * ★ `jobId`를 주면 도구 탭의 그 작업으로 가는 길을 끝에 붙인다. 실행했다고 화면을 옮기지
 *   않으므로(lib/panel/links.ts), 진행 과정을 보려는 사람에게는 길이 있어야 한다.
 */
export function formatAttachmentReport(
  label: string,
  outcome: { results?: AttachmentDownloadResult[]; error?: AppError; jobId?: string },
): string {
  const goto = outcome.jobId ? `\n\n[도구 탭에서 보기](${panelLink({ tab: 'automation', jobId: outcome.jobId })})` : '';
  if (outcome.error) return `${label}\n첨부 다운로드 실패: ${outcome.error.message}${outcome.error.hint ? `\n${outcome.error.hint}` : ''}${goto}`;
  const results = outcome.results ?? [];
  if (results.length === 0) return `${label}\n첨부 파일이 없습니다.${goto}`;
  const done = results.filter(result => result.status === 'complete').length;
  const guide = done ? ' 경로를 누르면 파일이 열리고, "폴더 열기"를 누르면 저장 위치가 탐색기로 열립니다.' : '';
  return `${label}\n첨부 ${results.length}건 중 ${done}건을 내려받았습니다.${guide}\n${results.map(describeResult).join('\n')}${goto}`;
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
