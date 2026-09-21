/**
 * 공유/공람 카드의 "일정 등록" — 본문을 읽고 폼을 채워 확인받는 자리(N1 · S07).
 *
 * ★ 이 화면이 존재하는 이유는 **되돌릴 수 없는 일을 먼저 알리기 위해서**다. 일정을 잘
 *   만들려면 본문을 읽어야 하고, 본문을 여는 순간 온나라에 열람 기록이 남는다. 그래서
 *   첫 걸음은 언제나 경고이고, 그 자리에 "열지 않고 등록하는 길"을 나란히 둔다.
 *
 * ★ AI가 채운 값이 곧 등록이 아니다. 폼에 올려 두고, 저장은 사용자가 누를 때 한다.
 *   근거 문장과 원문 대조 결과를 함께 보여 준다 — 고칠지 말지는 그것을 보고 정한다.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useT } from '@/lib/i18n';
import { isRestrictedUrl, type TabSummary } from '@/lib/messaging/protocol';
import type { Settings } from '@/lib/storage/settings';
import {
  chooseTaskDraft, closeTaskDraft, editTaskDraft, registerDocTask, registerTaskDraft,
  startTaskDraft, type TaskDraftSession,
} from '@/lib/inbox/panel';
import type { InboxDoc } from '@/lib/inbox/types';
import { ddayLabel, daysUntil } from '@/lib/schedule/task';

interface Props {
  doc: InboxDoc;
  session: TaskDraftSession;
  tab: TabSummary | null;
  settings: Settings;
}

export function InboxTaskDraft({ doc, session, tab, settings }: Props) {
  const t = useT();
  const canRead = Boolean(tab && !isRestrictedUrl(tab.url));

  /** 열람 기록을 감수하지 않는 길. 목록에서 읽은 값만으로 등록한다. */
  const registerFromList = async () => {
    await registerDocTask(doc);
    closeTaskDraft();
  };

  if (session.stage === 'confirm' || session.stage === 'failed') {
    return (
      <div className="inbox-draft">
        <strong className="inbox-draft-title">{t('inbox.draft.title')}</strong>
        {session.stage === 'failed' ? (
          <p className="inbox-draft-error" role="alert">
            {session.error?.message}
            {session.error?.hint ? ` ${session.error.hint}` : ''}
          </p>
        ) : (
          <p className="inbox-draft-warn">{t('inbox.draft.readWarn')}</p>
        )}
        {/* 문서가 이미 열린 뒤에 실패했을 수도 있다. 열렸다면 그 사실부터 말한다. */}
        {session.readAt && <p className="inbox-draft-opened">{t('inbox.draft.opened')}</p>}
        {!canRead && <p className="inbox-draft-note">{t('inbox.draft.noTab')}</p>}
        <div className="inbox-draft-actions">
          <button type="button" className="inbox-link" onClick={closeTaskDraft}>{t('sched.form.cancel')}</button>
          <span className="spacer" />
          <button type="button" className="inbox-btn" onClick={() => void registerFromList()}>
            {t('inbox.draft.listOnly')}
          </button>
          <button type="button" className="inbox-btn primary" disabled={!canRead}
            onClick={() => { if (tab) void startTaskDraft(doc, tab, settings); }}>
            {t(session.stage === 'failed' ? 'inbox.draft.retry' : 'inbox.draft.read')}
          </button>
        </div>
      </div>
    );
  }

  if (session.stage === 'working') return <ReadingProgress session={session} />;

  return <DraftForm doc={doc} session={session} />;
}

/* ── 읽는 중 ───────────────────────────────────────────── */

/**
 * 본문을 여는 동안의 진행 표시.
 *
 * ★ 움직이는 것이 있어야 한다. CPU 추론에서는 이 걸음이 수 분까지 가고, 화면이 멎어
 *   있으면 사용자는 고장으로 보고 패널을 닫는다(계획서 §6 — 무반응 스피너 금지).
 *
 * ★ 다만 **옅게** 움직인다. 카드 안에서 벌어지는 일이라 브리핑 목록 전체가 들썩이면
 *   안 된다. 숨 쉬는 점 하나, 가는 막대 하나, 그리고 흘러간 초다.
 *
 * ★ 초를 함께 센다. 애니메이션을 끈 사용자(prefers-reduced-motion)에게는 이 숫자가
 *   유일하게 움직이는 것이고, 실제로 얼마나 걸렸는지 말해 주는 것도 이 값뿐이다.
 */
function ReadingProgress({ session }: { session: TaskDraftSession }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const sec = session.startedAt ? Math.max(0, (now - session.startedAt) / 1000) : 0;

  return (
    <div className="inbox-draft" aria-busy="true">
      <p className="inbox-draft-progress" role="status">
        <span className="inbox-check-dot" aria-hidden="true" />
        <span>{t(session.step === 'analyze' ? 'inbox.draft.analyzing' : 'inbox.draft.reading')}</span>
      </p>
      <div className="inbox-draft-track" aria-hidden="true"><span className="inbox-draft-fill" /></div>
      {session.readAt && <p className="inbox-draft-opened">{t('inbox.draft.opened')}</p>}
      <div className="inbox-draft-actions">
        <span className="inbox-draft-elapsed">{t('panel.elapsedSec', { sec: sec.toFixed(1) })}</span>
        <span className="spacer" />
        <button type="button" className="inbox-btn" onClick={closeTaskDraft}>{t('inbox.draft.stop')}</button>
      </div>
    </div>
  );
}

/* ── 확인 폼 ───────────────────────────────────────────── */

/**
 * ★ 여기에는 "목록 값으로만 등록"이 없다. 이미 본문을 연 뒤라 미열람으로 되돌릴 수
 *   없고, 없는 선택지를 내놓는 것은 사실이 아니다. 그 길은 앞 걸음에만 있다.
 */
function DraftForm({ doc, session }: { doc: InboxDoc; session: TaskDraftSession }) {
  const t = useT();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const draft = session.drafts[session.chosen];
  if (!draft) return null;

  const days = draft.date ? daysUntil(draft.date) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) { setError(t('sched.form.taskRequired')); return; }
    setSaving(true);
    try { await registerTaskDraft(doc); } finally { setSaving(false); }
  };

  return (
    <div className="inbox-draft">
      {session.readAt && <p className="inbox-draft-opened">{t('inbox.draft.opened')}</p>}
      <p className="inbox-draft-note">
        {t(draft.origin === 'model' ? 'inbox.draft.ready' : 'inbox.draft.fromList')}
      </p>
      {session.fallback && (
        <p className="inbox-draft-note">
          {t('inbox.draft.fallback')}{session.fallbackReason ? ` (${session.fallbackReason})` : ''}
        </p>
      )}
      {session.summary && (
        <p className="inbox-draft-summary">
          <span>{t('inbox.draft.summary')}</span> {session.summary}
        </p>
      )}

      {/* ★ 다른 후보를 버리지 않는다. 한 공문에 조치가 둘인 경우가 흔하다. */}
      {session.drafts.length > 1 && (
        <div className="inbox-draft-alts" role="group" aria-label={t('inbox.draft.others', { n: session.drafts.length - 1 })}>
          {session.drafts.map((item, index) => (
            <button key={`${item.title}-${index}`} type="button"
              className={`inbox-draft-alt${index === session.chosen ? ' is-on' : ''}`}
              aria-pressed={index === session.chosen}
              onClick={() => { setError(''); chooseTaskDraft(index); }}>
              {item.date ? `${item.date.slice(5)} · ` : ''}{item.title}
            </button>
          ))}
        </div>
      )}

      <form className="sched-form" onSubmit={submit}>
        <label className="sched-field">
          <span>{t('sched.form.task')}</span>
          <input value={draft.title} onChange={event => editTaskDraft({ title: event.target.value })}
            placeholder={t('sched.form.taskPlaceholder')} />
        </label>
        <div className="sched-field-row">
          <label className="sched-field">
            <span>{t('sched.form.due')}</span>
            <input type="date" value={draft.date} onChange={event => editTaskDraft({ date: event.target.value })} />
          </label>
          <label className="sched-field">
            <span>{t('sched.form.time')}</span>
            <input type="time" value={draft.time} disabled={!draft.date}
              onChange={event => editTaskDraft({ time: event.target.value })} />
          </label>
        </div>

        {/* ★ 원문에서 확인한 값인지 반드시 보인다. 확인하지 못한 값도 지우지 않는다. */}
        <div className="inbox-draft-badges">
          {days !== null && <span className="sched-dday">{ddayLabel(days)}</span>}
          {draft.date
            ? draft.due?.date === draft.date && <span className="sched-due">{draft.due.text}</span>
            : <span className="sched-nodue">{t('sched.noDue')}</span>}
          {draft.due?.date === draft.date && draft.due?.yearInferred && (
            <span className="sched-badge warn">{t('sched.yearInferred')}</span>
          )}
          <span className={`sched-badge ${draft.evidenceVerified ? 'ok' : 'warn'}`}>
            {draft.evidenceVerified ? t('sched.verified') : t('sched.unverified')}
          </span>
          {draft.foundByCode && <span className="sched-badge ok">{t('sched.foundByCode')}</span>}
        </div>

        {draft.evidence && <p className="task-candidate-evidence">{draft.evidence}</p>}
        {draft.deliverables?.length ? (
          <p className="inbox-draft-meta">{t('sched.deliverables')}: {draft.deliverables.join(', ')}</p>
        ) : null}
        {draft.contact && <p className="inbox-draft-meta">{t('sched.contact')}: {draft.contact}</p>}

        <label className="sched-field">
          <span>{t('sched.form.notes')}</span>
          <textarea value={draft.notes} rows={2} onChange={event => editTaskDraft({ notes: event.target.value })} />
        </label>

        {error && <p className="sched-form-error">{error}</p>}

        <div className="sched-form-actions">
          <button type="button" className="minibtn" onClick={closeTaskDraft} disabled={saving}>{t('sched.form.cancel')}</button>
          <button type="submit" className="minibtn primary" disabled={saving}>{t('inbox.draft.submit')}</button>
        </div>
      </form>
    </div>
  );
}
