/**
 * 공유/공람 탭 — 공유/공람 브리핑(N1 · 계획서 S09).
 *
 * ★ 이 탭은 **본문을 열지 않는다.** 온나라 `공유/공람 > 받은문서` 목록 표만 읽는다.
 *   그래서 확인해도 문서가 `미열람` 그대로 남는다. 그 사실을 머리말에 수치로 보인다 —
 *   모델의 주장이 아니라 코드가 목록의 열람 칸을 대조해 센 값이다.
 *
 * ★ 보여 주는 것은 "이번에 새로 들어온 것"이 아니라 **아직 처리하지 않은 것**이다.
 *   새 문서만 보이면 아침에 알림을 못 본 날 화면이 비어 있다.
 */

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { AppError, TabSummary } from '@/lib/messaging/protocol';
import type { Settings } from '@/lib/storage/settings';
import { isRestrictedUrl } from '@/lib/messaging/protocol';
import type { ErrorPresentation } from '@/lib/errors/describe';
import { requestAccessForError, requestAllUrls } from '@/lib/permissions';
import {
  clearInboxError, clearInboxFocus, collectAndBrief, designateInbox, dismissDoc,
  groupDocs, loadInbox, openTaskDraft, pendingDocs, useInbox, type TaskDraftSession,
} from '@/lib/inbox/panel';
import type { InboxCategory, InboxDoc } from '@/lib/inbox/types';
import { ErrorBanner } from './ErrorBanner';
import { InboxTaskDraft } from './InboxTaskDraft';
import { FeedbackButtons } from './FeedbackButtons';
import { loadFeedbackMap, type FeedbackVerdict } from '@/lib/feedback/store';

interface Props {
  tab: TabSummary | null;
  settings: Settings;
  /** 일정으로 등록한 뒤 "일정 탭에서 보기"를 눌렀을 때. */
  onOpenSchedule: (taskId: number) => void;
}

const CATEGORY_KEY: Record<InboxCategory, 'inbox.cat.deadline' | 'inbox.cat.mine' | 'inbox.cat.notice' | 'inbox.cat.filtered'> = {
  deadline: 'inbox.cat.deadline',
  mine: 'inbox.cat.mine',
  notice: 'inbox.cat.notice',
  filtered: 'inbox.cat.filtered',
};

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function InboxPanel({ tab, settings, onOpenSchedule }: Props) {
  const t = useT();
  const { docs, briefing, lastRun, location, loaded, running, error, focus, draft } = useInbox();
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [showFiltered, setShowFiltered] = useState(false);
  /** 이미 눌러 둔 관심도 평가. 한 번에 읽어 카드에 나눠 준다(B4). */
  const [verdicts, setVerdicts] = useState<Map<string, FeedbackVerdict>>(new Map());

  useEffect(() => { void loadInbox(); }, []);
  useEffect(() => { void loadFeedbackMap('inbox-relevance').then(setVerdicts); }, []);

  useEffect(() => {
    if (!focus || !loaded) return;
    setSpotlight(focus.key);
    clearInboxFocus();
  }, [focus, loaded]);

  const pending = useMemo(() => pendingDocs(docs), [docs]);
  const groups = useMemo(() => groupDocs(pending), [pending]);
  const filtered = useMemo(() => docs.filter(doc => doc.category === 'filtered' && !doc.dismissedAt), [docs]);

  const canDesignate = Boolean(tab && !isRestrictedUrl(tab.url));

  /** 오류 배너가 알려 온 동작을 실제로 실행한다. 실패한 일을 다시 해 주는 데까지가 한 벌이다. */
  const retryFailedWork = () => {
    clearInboxError();
    if (!location) { if (tab) void designateInbox(tab); return; }
    void collectAndBrief(tab, settings, 'manual');
  };

  /**
   * 오류 배너의 해결 버튼.
   *
   * ★ 권한 요청이 이 핸들러의 **첫 동작**이어야 한다. 앞에 await가 끼면 사용자 제스처가
   *   소실돼 크롬이 요청을 거부한다(permissions.ts).
   *
   * ★ 목록이 다른 주소의 iframe에 실려 오면 탭 주소만 허용해서는 풀리지 않는다.
   *   오류가 지목한 주소(`origins`)까지 함께 요청한다.
   */
  const handleErrorAction = (action: NonNullable<ErrorPresentation['action']>) => {
    switch (action) {
      case 'grant-host':
        void requestAccessForError(error, tab?.url).then(granted => { if (granted) retryFailedWork(); });
        break;
      case 'grant-all':
        void requestAllUrls().then(granted => { if (granted) retryFailedWork(); });
        break;
      case 'open-settings':
        chrome.runtime.openOptionsPage();
        break;
      case 'retry':
        retryFailedWork();
        break;
    }
  };

  return (
    <div className="inbox">
      {error && <ErrorBanner error={error} model={settings.model} onClose={clearInboxError} onAction={handleErrorAction} />}

      <section className="inbox-head" aria-busy={running}>
        <div className="inbox-head-row">
          <strong>{t('inbox.title')}</strong>
          <span className="spacer" />
          <button type="button" className={`inbox-btn primary inbox-check${running ? ' is-checking' : ''}`} disabled={running || !location}
            onClick={() => void collectAndBrief(tab, settings, 'manual')}>
            {running && <span className="inbox-check-dot" aria-hidden="true" />}
            <span>{running ? t('inbox.checking') : t('inbox.checkNow')}</span>
          </button>
        </div>

        {!location && (
          <div className="inbox-setup">
            <strong>{t('inbox.notSet')}</strong>
            <p>{t('inbox.notSetBody')}</p>
            <button type="button" className="inbox-btn primary" disabled={!canDesignate || running}
              onClick={() => { if (tab) void designateInbox(tab); }}>
              {t('inbox.designate')}
            </button>
          </div>
        )}

        {/* ★ 열람 상태는 바뀐 때만 말한다. 그대로인 것은 머리말을 차지할 이유가 없다. */}
        {briefing ? (
          <div className="inbox-stats">
            <span>{t('inbox.lastRun', { time: clock(briefing.at), n: briefing.scanned })}</span>
            <span className="inbox-new">{t('inbox.newCount', { n: briefing.groups.reduce((sum, group) => sum + group.docs.length, 0) })}</span>
            {Boolean(briefing.readState.changed) && (
              <span className="inbox-warn">{t('inbox.readChanged', { n: briefing.readState.changed })}</span>
            )}
            {Boolean(briefing.markedRead) && <span className="inbox-warn">{t('inbox.markedRead', { n: briefing.markedRead! })}</span>}
          </div>
        ) : (
          <div className="inbox-stats">
            <span>{lastRun ? t('inbox.lastRun', { time: clock(lastRun.at), n: lastRun.scanned }) : t('inbox.never')}</span>
            <span className="auto-muted">{t('inbox.readOnlyList')}</span>
          </div>
        )}

        {lastRun?.error && <p className="inbox-skipped">{t('inbox.skipped', { reason: lastRun.error })}</p>}
      </section>

      {loaded && !pending.length && (
        <section className="inbox-empty">
          <strong>{t('inbox.empty')}</strong>
          <p>{t('inbox.emptyHint')}</p>
        </section>
      )}

      {groups.map(group => (
        <section className="auto-section" key={group.category}>
          <div className="auto-section-head">
            <span className="auto-section-title">{t(CATEGORY_KEY[group.category])}</span>
            <span className="auto-section-count">{group.docs.length}</span>
          </div>
          <ul className="inbox-list">
            {group.docs.map(doc => (
              <InboxCard key={doc.key} doc={doc} lit={spotlight === doc.key} model={settings.model}
                verdict={verdicts.get(doc.key)} onOpenSchedule={onOpenSchedule}
                tab={tab} settings={settings} draft={draft?.key === doc.key ? draft : null} />
            ))}
          </ul>
        </section>
      ))}

      {filtered.length > 0 && (
        <section className="auto-section">
          <button type="button" className="inbox-fold" onClick={() => setShowFiltered(value => !value)}>
            {t('inbox.filtered', { n: filtered.length })}
          </button>
          {showFiltered && (
            <ul className="inbox-list">
              {filtered.slice(0, 50).map(doc => (
                <InboxCard key={doc.key} doc={doc} lit={false} model={settings.model}
                  verdict={verdicts.get(doc.key)} onOpenSchedule={onOpenSchedule}
                  tab={tab} settings={settings} draft={draft?.key === doc.key ? draft : null} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

interface CardProps {
  doc: InboxDoc;
  lit: boolean;
  model: string;
  verdict?: FeedbackVerdict | undefined;
  onOpenSchedule: (taskId: number) => void;
  /** 본문을 읽을 때 쓸 탭. 받은문서 목록을 보고 있어야 한다. */
  tab: TabSummary | null;
  settings: Settings;
  /** 이 문서를 일정으로 옮기는 중이면 그 진행 상태. */
  draft: TaskDraftSession | null;
}

function InboxCard({ doc, lit, model, verdict, onOpenSchedule, tab, settings, draft }: CardProps) {
  const t = useT();
  const dismissing = useInbox(state => state.dismissing);
  const meta = [doc.department, doc.sender, doc.reportDate].filter(Boolean);
  return (
    <li className={`inbox-item ${doc.category} ${lit ? 'lit' : ''}`}>
      <div className="inbox-item-head">
        <span className="inbox-item-title">{doc.title}</span>
        {doc.dueDate && <span className="inbox-due">{doc.dueDate.slice(5)}</span>}
      </div>
      <div className="inbox-item-meta">
        {meta.map(value => <span key={value}>{value}</span>)}
        {doc.hasAttachment && <span>{t('inbox.attachment')}</span>}
        {doc.readState === 'unread' && <span className="inbox-unread">●</span>}
      </div>
      {/* ★ 왜 이 갈래인지 반드시 보인다. 이유를 모르는 분류는 아무도 믿지 않는다. */}
      <p className="inbox-reason">{doc.reason}</p>
      <div className="inbox-actions">
        {doc.taskId ? (
          <button type="button" className="inbox-link" onClick={() => onOpenSchedule(doc.taskId!)}>{t('inbox.registered')}</button>
        ) : (
          /* ★ 누르는 순간 등록되지 않는다. 본문을 열면 열람 기록이 남으므로 먼저 그 사실을 알린다. */
          <button type="button" className="inbox-btn" title={t('inbox.registerHint')}
            aria-expanded={Boolean(draft)} onClick={() => openTaskDraft(doc)}>
            {t('inbox.register')}
          </button>
        )}
        {/* ★ 분류가 맞았는지 한 번 누르는 것으로 받는다(B4). 이 수치가 관심도 학습의 표본이 된다. */}
        <FeedbackButtons kind="inbox-relevance" targetKey={doc.key} model={model} initial={verdict} compact />
        <span className="spacer" />
        {/* ★ 넘기면 목록에서 읽기처리를 누른다. 되돌릴 수 없으므로 제목 풍선에 적어 둔다. */}
        <button type="button" className="inbox-link" disabled={Boolean(dismissing)}
          title={t('inbox.dismissHint')}
          onClick={() => void dismissDoc(doc, tab)}>
          {dismissing === doc.key ? t('inbox.dismissing') : t('inbox.dismiss')}
        </button>
      </div>
      {draft && <InboxTaskDraft doc={doc} session={draft} tab={tab} settings={settings} />}
    </li>
  );
}
