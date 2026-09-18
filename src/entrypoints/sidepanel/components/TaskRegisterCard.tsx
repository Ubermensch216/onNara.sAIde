/**
 * 핵심·조치사항 답변 아래의 "일정으로 등록" 카드(계획서 S07).
 *
 * ★ 자동으로 등록하지 않는다. AI가 뽑은 후보를 그대로 넣으면 일정 탭이 곧 못 믿을 목록이 된다.
 *   사용자가 후보를 보고 체크한 것만 들어간다.
 *
 * ★ 원문에서 근거를 찾지 못한 후보는 기본으로 체크하지 않는다. 지우지도 않는다 —
 *   사용자가 원문을 보고 직접 체크할 수 있어야 한다(핵심·조치사항 카드와 같은 태도).
 *
 * ★ 이미 등록한 후보는 "등록됨"으로만 표시한다. 같은 공문을 다시 분석해도 중복이 쌓이지 않는다.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import type { TaskCandidate } from '@/lib/schedule/candidates';
import { addTasks, useSchedule } from '@/lib/schedule/store';
import { ddayLabel, daysUntil, dedupeKeyOf, type NewScheduleTask } from '@/lib/schedule/task';

interface Props {
  candidates: TaskCandidate[];
  source: { title: string; url?: string };
  conversationId: number;
  /** 등록 후 일정 탭으로 넘어가는 길. 없으면 버튼을 보이지 않는다. */
  onOpenSchedule?: () => void;
}

export function TaskRegisterCard({ candidates, source, conversationId, onOpenSchedule }: Props) {
  const t = useT();
  const registered = useSchedule(state => state.tasks);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const keys = useMemo(() => candidates.map(candidate => dedupeKeyOf(source.title, candidate.title)), [candidates, source.title]);
  const done = useMemo(() => new Set(registered.map(task => task.dedupeKey).filter(Boolean)), [registered]);

  // 처음 펼칠 때의 기본 체크: 원문에서 근거를 확인했고 아직 등록하지 않은 후보.
  const checked = chosen ?? new Set(candidates.flatMap((candidate, index) =>
    candidate.evidenceVerified && !done.has(keys[index]!) ? [index] : []));

  const toggle = (index: number) => {
    const next = new Set(checked);
    if (next.has(index)) next.delete(index); else next.add(index);
    setChosen(next);
  };

  const pending = [...checked].filter(index => !done.has(keys[index]!));

  const submit = async () => {
    if (!pending.length) return;
    setSaving(true);
    try {
      const inputs: NewScheduleTask[] = pending.map(index => {
        const candidate = candidates[index]!;
        return {
          title: candidate.title,
          status: 'todo',
          dueDate: candidate.due?.date ?? '',
          ...(candidate.due ? { due: candidate.due } : {}),
          ...(candidate.evidence ? { evidence: candidate.evidence } : {}),
          evidenceVerified: candidate.evidenceVerified,
          ...(candidate.deliverables?.length ? { deliverables: candidate.deliverables } : {}),
          ...(candidate.contact ? { contact: candidate.contact } : {}),
          source: { docTitle: source.title, ...(source.url ? { docUrl: source.url } : {}), conversationId },
          dedupeKey: keys[index]!,
        };
      });
      const outcome = await addTasks(inputs);
      setResult({ added: outcome.added.length, skipped: outcome.skipped });
      setChosen(new Set());
    } finally { setSaving(false); }
  };

  if (!open) {
    return (
      <div className="task-register">
        <button type="button" className="minibtn" onClick={() => setOpen(true)}>
          <CalendarIcon />{t('sched.registerCount', { n: candidates.length })}
        </button>
        {result && <span className="task-register-done">{t('sched.registerDone', { n: result.added })}</span>}
      </div>
    );
  }

  return (
    <div className="task-register open">
      <h4 className="task-register-title">{t('sched.registerTitle')}</h4>
      <p className="task-register-hint">{t('sched.registerHint')}</p>

      <ul className="task-register-list">
        {candidates.map((candidate, index) => {
          const already = done.has(keys[index]!);
          const days = candidate.due ? daysUntil(candidate.due.date) : null;
          return (
            <li key={`${keys[index]}-${index}`} className={`task-candidate ${already ? 'already' : ''}`}>
              <label className="task-candidate-main">
                <input type="checkbox" checked={already || checked.has(index)} disabled={already || saving} onChange={() => toggle(index)} />
                <span className="task-candidate-text">
                  <span className="task-candidate-title">{candidate.title}</span>
                  <span className="task-candidate-meta">
                    {candidate.due
                      ? <>
                          {days !== null && <span className="sched-dday">{ddayLabel(days)}</span>}
                          <span className="sched-due">{candidate.due.text}{candidate.due.time ? ` ${candidate.due.time}` : ''}</span>
                        </>
                      : <span className="sched-nodue">{t('sched.noDue')}</span>}
                    {candidate.due?.yearInferred && <span className="sched-badge warn">{t('sched.yearInferred')}</span>}
                    <span className={`sched-badge ${candidate.evidenceVerified ? 'ok' : 'warn'}`}>
                      {candidate.evidenceVerified ? t('sched.verified') : t('sched.unverified')}
                    </span>
                    {candidate.foundByCode && <span className="sched-badge ok">{t('sched.foundByCode')}</span>}
                    {already && <span className="sched-badge">{t('sched.bucket.done')}</span>}
                  </span>
                  {candidate.evidence && <span className="task-candidate-evidence">{candidate.evidence}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {result && (
        <p className="task-register-result" role="status">
          {result.added > 0 ? t('sched.registerDone', { n: result.added }) : t('sched.registerAllSkipped')}
          {result.skipped > 0 && ` ${t('sched.registerSkipped', { n: result.skipped })}`}
        </p>
      )}

      <div className="task-register-actions">
        {result && onOpenSchedule && (
          <button type="button" className="auto-link" onClick={onOpenSchedule}>{t('view.schedule')}</button>
        )}
        <button type="button" className="minibtn" onClick={() => setOpen(false)}>{t('ui.close')}</button>
        <button type="button" className="minibtn primary" onClick={() => void submit()} disabled={!pending.length || saving}>
          {pending.length ? t('sched.registerSubmit', { n: pending.length }) : t('sched.registerNone')}
        </button>
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ) as ReactNode;
}
