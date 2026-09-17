/**
 * 자동화(RPA) 탭.
 *
 * ★ 대화창이 아니다. AI 모델 없이 온나라 화면에서 정해진 동작을 실행하고,
 *   그 결과를 작업 단위로 남긴다. Ollama가 꺼져 있어도 동작해야 한다.
 *
 * ★ 대상은 사용자가 온나라 목록에서 체크한 문서다. 상세 화면이면 지금 연 문서 한 건이다.
 *   실행 직전에 화면을 다시 읽어, 그사이 바뀐 체크 상태를 따른다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { t as translate, useT } from '@/lib/i18n';
import { isRestrictedUrl, sendToSW, type AppError, type ExtractedPage, type TabSummary } from '@/lib/messaging/protocol';
import { requestHostAccess } from '@/lib/permissions';
import {
  cancelAutomation,
  clearAutomationHistory,
  enqueueAutomation,
  loadAutomationHistory,
  useAutomation,
  type AutomationJob,
} from '@/lib/automation/jobs';
import { queueAttachmentDownloads } from '@/lib/onnara/download';
import { exportDocumentList } from '@/lib/automation/export-list';
import type { DownloadLinkAction } from '@/lib/downloads/links';

type Screen =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; page: ExtractedPage }
  | { state: 'error'; error: AppError };

interface Props {
  tab: TabSummary | null;
  onDownloadLink: (action: DownloadLinkAction, downloadId: number) => void;
  /** 다시 찾은 탭이 패널이 알던 탭과 다르면 알린다. 패널 전체(AI 탭 포함)를 그 탭으로 맞춘다. */
  onTabChange?: (tab: TabSummary) => void;
}

/**
 * 지금 읽을 탭을 찾는다.
 *
 * ★ 패널이 기억한 탭 ID만 믿으면, 탭을 닫았다 다시 열거나 다른 창으로 옮긴 뒤에는
 *   "다시 읽기"를 몇 번 눌러도 같은 없는 탭을 읽으려다 실패한다.
 *   패널이 열린 창에서 사용자가 지금 보고 있는 탭을 먼저 찾고, 찾지 못할 때만 기억한 탭을 쓴다.
 */
async function currentTab(known: TabSummary | null): Promise<TabSummary | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return known;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => [] as chrome.tabs.Tab[]);
  if (typeof active?.id === 'number' && active.id >= 0 && active.url && !isRestrictedUrl(active.url)) {
    return { tabId: active.id, url: active.url, title: active.title ?? '', active: true };
  }
  if (!known) return null;
  const alive = await chrome.tabs.get(known.tabId).catch(() => null);
  return alive ? { ...known, url: alive.url ?? known.url, title: alive.title ?? known.title } : null;
}

export function AutomationPanel({ tab, onDownloadLink, onTabChange }: Props) {
  const t = useT();
  const jobs = useAutomation(state => state.jobs);
  const [screen, setScreen] = useState<Screen>({ state: 'idle' });

  useEffect(() => { void loadAutomationHistory(); }, []);

  const tabId = tab?.tabId;
  const tabUrl = tab?.url;
  const known = useRef(tab);
  known.current = tab;
  const tabChanged = useRef(onTabChange);
  tabChanged.current = onTabChange;
  // 실제로 읽은 탭. 첨부 받기는 패널이 알던 탭이 아니라 방금 읽은 탭을 대상으로 한다.
  const readTab = useRef<TabSummary | null>(null);

  // useT()는 렌더마다 새 함수라 의존성에 넣으면 화면을 끝없이 다시 읽는다. 탭이 바뀔 때만 다시 만든다.
  const readScreen = useCallback(async (): Promise<ExtractedPage | null> => {
    setScreen({ state: 'loading' });
    const target = await currentTab(known.current);
    readTab.current = target;
    if (!target || isRestrictedUrl(target.url)) {
      setScreen({ state: 'error', error: { code: 'TAB_RESTRICTED', message: translate('auto.noScreen') } });
      return null;
    }
    if (target.tabId !== known.current?.tabId || target.url !== known.current?.url) tabChanged.current?.(target);
    const response = await sendToSW({
      type: 'EXTRACT_PAGE', tabId: target.tabId, budgetTokens: 1000,
      control: { id: '', deadline: 0, expectedUrl: target.url },
    }).catch((error: unknown) => ({ type: 'ERROR' as const, error: { code: 'UNKNOWN' as const, message: String(error) } }));
    if (response.type === 'PAGE_EXTRACTED') {
      setScreen({ state: 'ready', page: response.payload });
      return response.payload;
    }
    setScreen({ state: 'error', error: response.type === 'ERROR' ? response.error : { code: 'UNKNOWN', message: translate('auto.readFailed') } });
    return null;
  }, [tabId, tabUrl]);

  useEffect(() => { void readScreen(); }, [readScreen]);

  const page = screen.state === 'ready' ? screen.page : null;
  const list = page?.structuredData;
  const selected = list?.selectedTitles ?? [];
  const canDownload = Boolean(page && (!list || selected.length));

  const downloadAttachments = async () => {
    // 목록 체크는 패널 밖에서 바뀌므로 실행 직전에 다시 읽는다.
    const fresh = await readScreen();
    const target = readTab.current;
    if (!fresh || !target) return;
    const titles = fresh.structuredData ? fresh.structuredData.selectedTitles ?? [] : [undefined];
    if (!titles.length) return;
    void queueAttachmentDownloads({ tabId: target.tabId, page: fresh, titles, origin: 'automation' });
  };

  const exportList = async () => {
    // 체크 표시(선택 열)도 함께 저장하므로 실행 직전 화면을 쓴다.
    const fresh = await readScreen();
    if (!fresh?.structuredData) return;
    enqueueAutomation({ kind: 'export-list', label: fresh.structuredData.listName, run: signal => exportDocumentList(fresh, signal) });
  };

  const grantAccess = () => {
    // 권한 요청은 클릭 핸들러의 첫 동작이어야 한다.
    const target = readTab.current ?? tab;
    if (target) void requestHostAccess(target.url).then(ok => { if (ok) void readScreen(); });
  };

  const active = jobs.filter(job => job.status === 'queued' || job.status === 'running');
  const history = jobs.filter(job => job.status !== 'queued' && job.status !== 'running');

  return (
    <div className="auto">
      <section className="auto-target" aria-live="polite">
        <div className="auto-target-text">
          {screen.state === 'loading' && <span>{t('auto.reading')}</span>}
          {screen.state === 'error' && <span className="auto-error">{screen.error.message}</span>}
          {page && (list
            ? <><strong>{list.listName}</strong><span>{t('auto.selectedCount', { selected: selected.length, total: list.rows.length })}</span></>
            : <><strong>{t('auto.detailScreen')}</strong><span className="auto-ellipsis">{page.title}</span></>)}
        </div>
        {screen.state === 'error' && screen.error.code === 'HOST_PERMISSION_REQUIRED'
          ? <button type="button" className="minibtn" onClick={grantAccess}>{t('ui.grantPermission')}</button>
          : <button type="button" className="minibtn" onClick={() => void readScreen()} disabled={screen.state === 'loading'}>{t('auto.refresh')}</button>}
      </section>

      <section className="auto-actions" aria-label={t('auto.actions')}>
        <button type="button" className="auto-card" onClick={() => void downloadAttachments()} disabled={!canDownload}>
          <span className="auto-card-title">{t('auto.downloadAttachments')}</span>
          <span className="auto-card-desc">
            {list && !selected.length ? t('auto.selectDocuments') : t('auto.downloadAttachmentsDesc')}
          </span>
        </button>
        <button type="button" className="auto-card" onClick={() => void exportList()} disabled={!list}>
          <span className="auto-card-title">{t('auto.exportList')}</span>
          <span className="auto-card-desc">{list ? t('auto.exportListDesc') : t('auto.exportListNeedsList')}</span>
        </button>
      </section>

      <section className="auto-jobs">
        <div className="auto-jobs-head">
          <span>{active.length ? t('auto.queue', { n: active.length }) : t('auto.history')}</span>
          {history.length > 0 && (
            <button type="button" className="auto-link" onClick={() => void clearAutomationHistory()}>{t('auto.clearHistory')}</button>
          )}
        </div>
        {!jobs.length && <p className="auto-empty">{t('auto.empty')}</p>}
        <ul className="auto-job-list">
          {[...active, ...history].map(job => (
            <JobRow key={job.id} job={job} onDownloadLink={onDownloadLink} />
          ))}
        </ul>
        <p className="auto-foot">{t('auto.noModel')}</p>
      </section>
    </div>
  );
}

function JobRow({ job, onDownloadLink }: { job: AutomationJob; onDownloadLink: Props['onDownloadLink'] }) {
  const t = useT();
  const running = job.status === 'queued' || job.status === 'running';
  return (
    <li className={`auto-job ${job.status}`}>
      <div className="auto-job-head">
        <span className="auto-status">{t(`auto.status.${job.status}`)}</span>
        <span className="auto-job-title">
          {t(`auto.kind.${job.kind}`)} · {job.label}
        </span>
        {job.origin === 'chat' && <span className="auto-origin">{t('auto.fromChat')}</span>}
        {running && (
          <button type="button" className="auto-link" onClick={() => cancelAutomation(job.id)}>{t('auto.cancel')}</button>
        )}
      </div>
      {job.error && <div className="auto-job-error">{job.error.message}{job.error.hint ? ` ${job.error.hint}` : ''}</div>}
      {job.summary && <div className="auto-job-summary">{job.summary}</div>}
      {job.files && job.files.length > 0 && (
        <ul className="auto-files">
          {job.files.map((file, index) => (
            <li key={`${file.downloadId ?? file.name}-${index}`} className="auto-file">
              {file.status === 'complete' && file.downloadId !== undefined ? (
                <>
                  {/* 긴 저장 경로는 앞부분만 보여 무슨 파일인지 알 수 없다. 파일 이름을 보이고 전체 경로는 툴팁으로 둔다. */}
                  <button type="button" className="auto-path" title={`${t('auto.openFile')}: ${file.path ?? file.name}`}
                    onClick={() => onDownloadLink('open', file.downloadId!)}>{fileName(file.path) ?? file.name}</button>
                  <button type="button" className="auto-link" onClick={() => onDownloadLink('show', file.downloadId!)}>{t('auto.openFolder')}</button>
                </>
              ) : (
                <span className="auto-file-failed">{file.name} · {t(`auto.file.${file.status}`)}{file.message ? ` (${file.message})` : ''}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** 저장 경로에서 파일 이름만 뽑는다. Windows·POSIX 구분자를 모두 처리한다. */
function fileName(path: string | undefined): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).at(-1);
}
