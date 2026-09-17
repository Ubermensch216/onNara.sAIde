/**
 * 자동화(RPA) 탭.
 *
 * ★ 대화창이 아니다. AI 모델 없이 온나라 화면에서 정해진 동작을 실행하고,
 *   그 결과를 작업 단위로 남긴다. Ollama가 꺼져 있어도 동작해야 한다.
 *
 * ★ 대상은 사용자가 온나라 목록에서 체크한 문서다. 상세 화면이면 지금 연 문서 한 건이다.
 *   실행 직전에 화면을 다시 읽어, 그사이 바뀐 체크 상태를 따른다.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t as translate, useT } from '@/lib/i18n';
import { isRestrictedUrl, sendToSW, type AppError, type ExtractedPage, type TabSummary } from '@/lib/messaging/protocol';
import { requestHostAccess } from '@/lib/permissions';
import {
  cancelAutomation,
  clearAutomationHistory,
  loadAutomationHistory,
  useAutomation,
  type AutomationJob,
} from '@/lib/automation/jobs';
import { queueAttachmentDownloads } from '@/lib/onnara/download';
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

  const grantAccess = () => {
    // 권한 요청은 클릭 핸들러의 첫 동작이어야 한다.
    const target = readTab.current ?? tab;
    if (target) void requestHostAccess(target.url).then(ok => { if (ok) void readScreen(); });
  };

  const active = jobs.filter(job => job.status === 'queued' || job.status === 'running');
  const history = jobs.filter(job => job.status !== 'queued' && job.status !== 'running');
  const permissionNeeded = screen.state === 'error' && screen.error.code === 'HOST_PERMISSION_REQUIRED';

  return (
    <div className="auto">
      {/* 1. 무엇을 대상으로 실행하는지 — 작업 버튼보다 먼저 확인한다. */}
      <section className={`auto-target ${screen.state}`} aria-live="polite">
        <div className="auto-section-head">
          <h2 className="auto-section-title">{t('auto.currentScreen')}</h2>
          {permissionNeeded
            ? <button type="button" className="minibtn" onClick={grantAccess}>{t('ui.grantPermission')}</button>
            : (
              <button type="button" className="minibtn" onClick={() => void readScreen()} disabled={screen.state === 'loading'}>
                <RefreshIcon />{t('auto.refresh')}
              </button>
            )}
        </div>
        <div className="auto-target-body">
          <span className="auto-target-icon" aria-hidden="true">
            {screen.state === 'error' ? <AlertIcon /> : list ? <ListIcon /> : <DocumentIcon />}
          </span>
          <div className="auto-target-text">
            {(screen.state === 'loading' || screen.state === 'idle') && <strong className="auto-muted">{t('auto.reading')}</strong>}
            {screen.state === 'error' && <strong className="auto-error">{screen.error.message}</strong>}
            {page && (list
              ? (
                <>
                  <strong className="auto-ellipsis" title={list.listName}>{list.listName}</strong>
                  <span className="auto-count">
                    <b className={selected.length ? 'on' : ''}>{t('auto.selected', { n: selected.length })}</b>
                    <span> / {t('auto.total', { n: list.rows.length })}</span>
                  </span>
                </>
              )
              : (
                <>
                  <strong>{t('auto.detailScreen')}</strong>
                  <span className="auto-ellipsis" title={page.title}>{page.title}</span>
                </>
              ))}
          </div>
        </div>
      </section>

      {/* 2. 실행할 작업 */}
      <section className="auto-section">
        <h2 className="auto-section-title">{t('auto.actions')}</h2>
        <button type="button" className="auto-card" onClick={() => void downloadAttachments()} disabled={!canDownload}>
          <span className="auto-card-icon" aria-hidden="true"><DownloadIcon /></span>
          <span className="auto-card-text">
            <span className="auto-card-title">{t('auto.downloadAttachments')}</span>
            <span className={`auto-card-desc ${list && !selected.length ? 'hint' : ''}`}>
              {list && !selected.length ? t('auto.selectDocuments') : t('auto.downloadAttachmentsDesc')}
            </span>
          </span>
          {canDownload && <span className="auto-card-badge">{t('auto.docCount', { n: list ? selected.length : 1 })}</span>}
        </button>
      </section>

      {/* 3. 진행 중인 작업은 기록과 나눠 눈에 띄게 둔다. */}
      {active.length > 0 && (
        <section className="auto-section">
          <div className="auto-section-head">
            <h2 className="auto-section-title">{t('auto.queue')}<span className="auto-section-count running">{active.length}</span></h2>
          </div>
          <ul className="auto-job-list">
            {active.map(job => <JobRow key={job.id} job={job} onDownloadLink={onDownloadLink} />)}
          </ul>
        </section>
      )}

      {(history.length > 0 || !active.length) && (
        <section className="auto-section">
          <div className="auto-section-head">
            <h2 className="auto-section-title">
              {t('auto.history')}
              {history.length > 0 && <span className="auto-section-count">{history.length}</span>}
            </h2>
            {history.length > 0 && (
              <button type="button" className="auto-link" onClick={() => void clearAutomationHistory()}>{t('auto.clearHistory')}</button>
            )}
          </div>
          {history.length
            ? (
              <ul className="auto-job-list">
                {history.map(job => <JobRow key={job.id} job={job} onDownloadLink={onDownloadLink} />)}
              </ul>
            )
            : <p className="auto-empty">{t('auto.empty')}</p>}
        </section>
      )}

      <p className="auto-foot"><InfoIcon />{t('auto.noModel')}</p>
    </div>
  );
}

function JobRow({ job, onDownloadLink }: { job: AutomationJob; onDownloadLink: Props['onDownloadLink'] }) {
  const t = useT();
  const running = job.status === 'queued' || job.status === 'running';
  const files = job.files ?? [];
  return (
    <li className={`auto-job ${job.status}`}>
      <div className="auto-job-head">
        <span className="auto-status">{t(`auto.status.${job.status}`)}</span>
        <span className="auto-job-title" title={job.label}>{job.label}</span>
        {running
          ? <button type="button" className="auto-link" onClick={() => cancelAutomation(job.id)}>{t('auto.cancel')}</button>
          : <time className="auto-time" dateTime={new Date(job.finishedAt ?? job.createdAt).toISOString()}>{formatTime(job.finishedAt ?? job.createdAt)}</time>}
      </div>
      <div className="auto-job-meta">
        <span>{t(`auto.kind.${job.kind}`)}</span>
        {files.length > 0 && <span>{t('auto.fileCount', { n: files.length })}</span>}
        {job.origin === 'chat' && <span className="auto-origin">{t('auto.fromChat')}</span>}
      </div>
      {job.status === 'running' && <div className="auto-progress" aria-hidden="true"><span /></div>}
      {job.error && <div className="auto-job-error">{job.error.message}{job.error.hint ? ` ${job.error.hint}` : ''}</div>}
      {job.summary && <div className="auto-job-summary">{job.summary}</div>}
      {files.length > 0 && (
        <ul className="auto-files">
          {files.map((file, index) => (
            <li key={`${file.downloadId ?? file.name}-${index}`} className={`auto-file ${file.status}`}>
              <FileIcon />
              {file.status === 'complete' && file.downloadId !== undefined ? (
                <>
                  {/* 긴 저장 경로는 앞부분만 보여 무슨 파일인지 알 수 없다. 파일 이름을 보이고 전체 경로는 툴팁으로 둔다. */}
                  <button type="button" className="auto-path" title={`${t('auto.openFile')}: ${file.path ?? file.name}`}
                    onClick={() => onDownloadLink('open', file.downloadId!)}>{fileName(file.path) ?? file.name}</button>
                  <button type="button" className="minibtn" onClick={() => onDownloadLink('show', file.downloadId!)}>{t('auto.openFolder')}</button>
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

/** 오늘 끝난 작업은 시각만, 그 전 작업은 날짜까지 보인다. */
function formatTime(at: number, now = new Date()): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.toDateString() === now.toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

/* ── 아이콘 ── */

function Svg({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const RefreshIcon = () => <Svg size={13}><path d="M20 11a8 8 0 0 0-14.9-4M4 4v4h4M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4" /></Svg>;
const ListIcon = () => <Svg size={18}><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2" /><circle cx="5" cy="18" r="1" /></Svg>;
const DocumentIcon = () => <Svg size={18}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></Svg>;
const AlertIcon = () => <Svg size={18}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></Svg>;
const DownloadIcon = () => <Svg size={20}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>;
const FileIcon = () => <Svg size={14}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Svg>;
const InfoIcon = () => <Svg size={13}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
