import { sendToSW, type AppError, type AttachmentDownloadResult, type AttachmentNaming, type DownloadTargetMode, type ExtractedPage } from '@/lib/messaging/protocol';
import { loadSettings } from '@/lib/storage/settings';
import { downloadLink, escapeMarkdownText } from '@/lib/downloads/links';
import { panelLink } from '@/lib/panel/links';
import { cancelAutomation, enqueueAutomation, workTabLock, type AutomationJob } from '@/lib/automation/jobs';
import { buildPackage, describePackage, newRunId, packageRoot, PACKAGE_FILE, rowIdOf, type ListRow } from '@/lib/nunchi/package';
import { announcePackage, knownDocuments } from '@/lib/nunchi/client';
import { isNunchiPaired, loadNunchi, type NunchiConnection } from '@/lib/nunchi/connection';

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
  origin: 'automation' | 'chat'; mode?: DownloadTargetMode; signal?: AbortSignal;
  onFinished?: (job: AutomationJob, index: number) => Promise<void> | void;
  /** 눈치코치 꾸러미 폴더(다운로드 폴더 기준). 주면 파일명 설정과 무관하게 그 아래 문서별 폴더에 모은다. */
  packageRoot?: string;
}): Promise<AutomationJob[]> {
  const { tabId, page, titles, origin, mode = 'attachments', signal, onFinished, packageRoot } = options;
  const keepWorkTab = titles.filter(Boolean).length > 1;
  const naming = await namingPlans(page, titles, packageRoot);
  const jobKind = mode === 'body' ? 'download-body' : mode === 'all' ? 'download-all' : 'download-attachments';
  // 앞 문서의 파일이 아직 내려받는 중이면 동시 다운로드를 피하려고 뒤 문서는 실행하지 않는다.
  let stalled = false;
  const pending = titles.map((title, index) => enqueueAutomation({
    kind: jobKind, label: title ?? page.title, origin,
    run: async jobSignal => {
      if (stalled) return { error: { code: 'UNKNOWN', message: '앞 문서의 다운로드가 아직 끝나지 않아 실행하지 않았습니다. 다운로드가 끝난 뒤 다시 요청하세요.' } };
      const response = await sendToSW({
        type: 'DOWNLOAD_ATTACHMENTS', tabId, mode, ...(title ? { title, keepWorkTab } : {}),
        ...(naming[index] ? { naming: naming[index]! } : {}),
        control: { id: '', deadline: 0, expectedUrl: page.url },
      }, jobSignal, DOCUMENT_DOWNLOAD_TIMEOUT_MS);
      if (response.type === 'ERROR') return { error: response.error };
      if (response.type !== 'ATTACHMENTS_DOWNLOADED') return { error: { code: 'UNKNOWN', message: '다운로드 결과를 받지 못했습니다.' } };
      if (response.results.some(result => result.status === 'in_progress')) stalled = true;
      return {
        files: response.results,
        ...(response.results.length === 0 ? { summary: mode === 'body' ? '본문 PDF를 내려받지 못했습니다.' : '다운로드할 파일이 없습니다.' } : {}),
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
 * ★ 설정이 'browser'이고 하위 폴더도 끄면 아무 계획도 만들지 않는다 — 브라우저가 정한 이름 그대로다.
 *   'browser'에 하위 폴더만 켜면 `rename: false`로 이름은 두고 폴더만 나눈다.
 */
async function namingPlans(page: ExtractedPage, titles: Array<string | undefined>, packageRoot?: string): Promise<Array<AttachmentNaming | null>> {
  if (packageRoot) {
    // ★ 꾸러미는 사용자의 파일명 설정을 따르지 않는다. 눈치코치가 꾸러미 폴더 안의 파일만 읽으므로
    //   반드시 그 아래에 모이고, 원래 이름을 지켜야 어느 붙임인지 대조할 수 있다.
    const rows = page.structuredData?.rows ?? [];
    return titles.map(title => {
      const reportDate = title ? rows.find(row => row.title === title)?.reportDate : undefined;
      return { docTitle: (title ?? page.title).trim() || '문서', ...(reportDate ? { reportDate } : {}), folder: true, rename: false, root: packageRoot };
    });
  }
  const settings = await loadSettings().catch(() => null);
  if (!settings) return titles.map(() => null);
  const rename = settings.attachmentNaming === 'normalized';
  if (!rename && !settings.attachmentFolder) return titles.map(() => null);
  const rows = page.structuredData?.rows ?? [];
  return titles.map(title => {
    const docTitle = title ?? page.title;
    if (!docTitle.trim()) return null;
    const reportDate = title ? rows.find(row => row.title === title)?.reportDate : undefined;
    return {
      docTitle,
      ...(reportDate ? { reportDate } : {}),
      ...(settings.attachmentFolder ? { folder: true } : {}),
      ...(rename ? {} : { rename: false }),
    };
  });
}

/**
 * 체크한 문서를 본문+첨부로 받아 눈치코치 꾸러미로 묶는다.
 *
 * ★ 문서마다 받는 작업 뒤에 `package.json`을 쓰는 작업 하나를 대기열에 더 넣는다.
 *   그래야 도구 탭의 기록에 꾸러미 폴더로 가는 길(폴더 열기)이 남는다.
 * ★ 받은 파일이 하나도 없으면 꾸러미를 만들지 않는다. 빈 꾸러미는 눈치코치에서 거절된다.
 */
export async function exportNunchiPackage(options: {
  tabId: number; page: ExtractedPage; titles: Array<string | undefined>; signal?: AbortSignal;
  save?: (json: string, filename: string) => Promise<AttachmentDownloadResult>;
}): Promise<AutomationJob | null> {
  const { tabId, page, save = savePackageFile, signal } = options;
  if (!options.titles.length) return null;
  const runId = newRunId();
  const root = packageRoot(runId);
  const rows = page.structuredData?.rows ?? [];
  const label = page.structuredData?.listName ?? page.title;
  const rowOf = (title: string | undefined) => (title ? rows.find(row => row.title === title) : undefined);

  // 눈치코치와 연결돼 있으면 이미 온전히 가진 문서는 다시 받지 않는다(문서를 다시 열지도 않는다).
  const nunchi = await loadNunchi().catch(() => null);
  const already = await alreadyInNunchi(nunchi, page, options.titles, rowOf, signal);
  const titles = options.titles.filter((_, index) => !already.has(index));
  const skipped = already.size ? `이미 눈치코치에 있는 문서 ${already.size}건은 받지 않았습니다.` : '';
  if (!titles.length) {
    return enqueueAutomation({ kind: 'export-package', label, origin: 'automation', lock: false,
      run: async () => ({ summary: `${skipped} 내보낼 새 문서가 없습니다.` }) }).finished;
  }

  const jobs = await queueAttachmentDownloads({ tabId, page, titles, mode: 'all', origin: 'automation', packageRoot: root, ...(signal ? { signal } : {}) });
  if (!jobs.some(job => job.files?.some(file => file.status === 'complete'))) return null;

  const { finished } = enqueueAutomation({
    kind: 'export-package', label, origin: 'automation', lock: false,
    run: async () => {
      const pkg = await buildPackage({
        runId, root, pageUrl: page.url, listName: page.structuredData?.listName ?? '',
        extensionVersion: chrome.runtime.getManifest?.().version ?? '',
        documents: jobs.map((job, index) => {
          const title = titles[index];
          return { title: title ?? page.title, row: rowOf(title), files: job.files, error: job.error };
        }),
      });
      const file = await save(JSON.stringify(pkg, null, 2), `${root}/${PACKAGE_FILE}`);
      const notice = await announceToNunchi(nunchi, runId, file);
      return { files: [file], summary: [describePackage(pkg), skipped, notice].filter(Boolean).join(' · ') };
    },
  });
  return finished;
}

/**
 * 고른 문서 중 눈치코치가 이미 온전히 가진 것의 순번.
 *
 * ★ 묻지 못하면(연결 안 됨·꺼짐·오류) 아무것도 빼지 않는다. 연결은 편의일 뿐 내보내기의 조건이 아니다.
 * ★ 같은 날 같은 제목의 문서가 둘 이상 골라졌으면 그 문서들은 빼지 않는다. 목록 행으로 만든
 *   식별자로는 둘을 가를 수 없어, 하나만 가진 경우에 나머지를 놓친다.
 */
async function alreadyInNunchi(
  nunchi: NunchiConnection | null, page: ExtractedPage, titles: Array<string | undefined>,
  rowOf: (title: string | undefined) => ListRow | undefined, signal?: AbortSignal,
): Promise<Set<number>> {
  const none = new Set<number>();
  if (!nunchi || !isNunchiPaired(nunchi) || !nunchi.scopes.includes('read')) return none;
  try {
    const ids = await Promise.all(titles.map(title => rowIdOf(title ?? page.title, rowOf(title))));
    const unique = ids.filter(id => ids.indexOf(id) === ids.lastIndexOf(id));
    if (!unique.length) return none;
    const known = await knownDocuments(nunchi, { origin: new URL(page.url).origin, ids: unique }, signal);
    return new Set(ids.flatMap((id, index) => (unique.includes(id) && known.has(id) ? [index] : [])));
  } catch {
    return none;
  }
}

/** 꾸러미가 준비됐다고 눈치코치에 알리고, 그 결과를 한 줄로 돌려준다. 연결이 없으면 빈 문자열이다. */
async function announceToNunchi(nunchi: NunchiConnection | null, runId: string, file: AttachmentDownloadResult): Promise<string> {
  if (!nunchi || !isNunchiPaired(nunchi)) return '';
  const manual = '눈치코치 설정 › 자료 폴더 › 온나라 자료 가져오기에서 꾸러미 폴더를 직접 고르세요.';
  if (file.status !== 'complete' || !file.path) return '';
  if (!nunchi.scopes.includes('write')) return `눈치코치에 알리지 못했습니다(이 연결에는 알림 권한이 없습니다. 다시 연결하세요). ${manual}`;
  try {
    const result = await announcePackage(nunchi, { runId, path: file.path.replace(/[\\/][^\\/]+$/, '') });
    return result.state === 'imported' ? '눈치코치에 이미 등록된 꾸러미입니다.'
      : `눈치코치에 알렸습니다${result.project ? `(${result.project})` : ''}. 눈치코치 창에서 등록 여부를 정하세요.`;
  } catch (error) {
    return `눈치코치에 알리지 못했습니다(${error instanceof Error ? error.message : String(error)}) ${manual}`;
  }
}

/** `package.json`을 꾸러미 폴더에 저장하고 저장된 경로를 돌려준다. */
async function savePackageFile(json: string, filename: string): Promise<AttachmentDownloadResult> {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  try {
    const downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false });
    if (downloadId === undefined) return { name: PACKAGE_FILE, status: 'not_started', message: '꾸러미 파일을 저장하지 못했습니다.' };
    for (let attempt = 0; attempt < 40; attempt++) {
      const [item] = await chrome.downloads.search({ id: downloadId });
      if (item?.state === 'complete') return { name: PACKAGE_FILE, status: 'complete', downloadId, ...(item.filename ? { path: item.filename } : {}) };
      if (item?.state === 'interrupted') return { name: PACKAGE_FILE, status: 'failed', message: item.error || '저장이 중단되었습니다.' };
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { name: PACKAGE_FILE, status: 'in_progress', downloadId };
  } finally {
    URL.revokeObjectURL(url);
  }
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
