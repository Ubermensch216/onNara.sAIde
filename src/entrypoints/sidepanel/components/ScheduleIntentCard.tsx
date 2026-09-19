/**
 * `@일정` 확인 카드 (S07 자연어 일정 관리).
 *
 * ★ 이 카드를 거치지 않는 쓰기 경로는 없다. 참조 프로젝트(myAI)는 시간 충돌만 없으면
 *   곧바로 일정을 기록했지만, 이 저장소의 규칙은 "AI 결과를 자동으로 저장하지 않는다"이다
 *   (schedule/store.ts). 모델이 문장을 잘못 읽어도 사용자가 보기 전에는 아무 일도 없다.
 *
 * ★ 하나만 걸렸을 때에만 미리 체크돼 있다(resolve.ts의 preselected). 여럿이 걸리면
 *   무엇을 고를지 정하는 것은 사용자다. 범위 삭제는 "전부 지워"라고 말했더라도 미리
 *   체크하지 않는다 — 되돌릴 수 없기 때문이다.
 *
 * ★ 모델이 쓴 설득 문구를 싣지 않는다. 카드에 보이는 글자는 저장된 값과 우리 문구뿐이다
 *   (승인 카드 ApprovalCard와 같은 원칙).
 */

import { useMemo, useRef, useState } from 'react';
import { useT, type MessageKey } from '@/lib/i18n';
import { useDialogFocus } from '@/lib/useDialogFocus';
import { changeLines, type SchedulePlan } from '@/lib/schedule/resolve';
import { daysUntil, ddayLabel, type ScheduleTask } from '@/lib/schedule/task';

/** 확인이 필요한 계획만 이 카드로 온다. 조회와 안내는 대화에 바로 답한다. */
export type ActionablePlan = Extract<SchedulePlan, { kind: 'create' | 'update' | 'delete' }>;

interface Props {
  plan: ActionablePlan;
  /** `null`이면 취소. 배열이면 그 항목만 실행한다. */
  onDecide: (ids: number[] | null) => void;
}

export function ScheduleIntentCard({ plan, onDecide }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDivElement>(null);
  // Esc는 취소다. 되돌릴 수 없는 동작의 기본값은 언제나 "하지 않음"이다.
  useDialogFocus(dialog, () => onDecide(null));

  const danger = plan.kind === 'delete';

  return (
    <div
      ref={dialog}
      className={`sint ${danger ? 'danger' : ''}`}
      role="alertdialog"
      aria-modal="true"
      aria-label={t(`sint.${plan.kind}.title` as MessageKey)}
    >
      <div className="sint-head">
        <CalendarIcon />
        <span>{t(`sint.${plan.kind}.title` as MessageKey)}</span>
      </div>

      {plan.kind === 'create'
        ? <CreateBody plan={plan} onDecide={onDecide} />
        : <TargetBody plan={plan} onDecide={onDecide} />}
    </div>
  );
}

/* ── 등록 ──────────────────────────────────────────────── */

function CreateBody({ plan, onDecide }: { plan: Extract<ActionablePlan, { kind: 'create' }>; onDecide: Props['onDecide'] }) {
  const t = useT();
  const { task, duplicate } = plan;
  const days = task.dueDate ? daysUntil(task.dueDate) : null;

  return (
    <>
      <p className="sint-what">{task.title}</p>

      <dl className="sint-detail">
        <dt>{t('sint.field.due')}</dt>
        <dd>
          {task.dueDate
            ? <>{task.dueDate}{task.due?.time ? ` ${task.due.time}` : ''}
                {days !== null && <span className="sched-dday">{ddayLabel(days)}</span>}</>
            : <span className="sched-nodue">{t('sched.noDue')}</span>}
        </dd>
        {task.notes && (<><dt>{t('sint.field.notes')}</dt><dd>{task.notes}</dd></>)}
      </dl>

      {/* 막지 않는다. 같은 일을 일부러 두 번 적을 수도 있으므로 알리고 사용자가 정한다. */}
      {duplicate && <p className="sint-warn">{t('sint.duplicate')}</p>}

      <p className="sint-note">{t('sint.aiNote')}</p>

      <div className="sint-actions">
        <button type="button" className="btn-deny" onClick={() => onDecide(null)}>{t('sint.cancel')}</button>
        <button type="button" className="btn-allow" onClick={() => onDecide([0])}>{t('sint.create.ok')}</button>
      </div>
    </>
  );
}

/* ── 수정·삭제 ─────────────────────────────────────────── */

function TargetBody(
  { plan, onDecide }: { plan: Extract<ActionablePlan, { kind: 'update' | 'delete' }>; onDecide: Props['onDecide'] },
) {
  const t = useT();
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(plan.preselected));
  const all = useMemo(() => plan.targets.map(task => task.id), [plan.targets]);
  const allChosen = chosen.size === all.length;

  const toggle = (id: number) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const okKey: MessageKey = plan.kind === 'delete' ? 'sint.delete.ok' : 'sint.update.ok';

  return (
    <>
      {/* 여럿이 걸렸으면 고르라고 먼저 말한다. 카드가 왜 비어 보이는지 알 수 있어야 한다. */}
      <p className="sint-what">
        {plan.targets.length === 1
          ? t('sint.matchedOne')
          : t(plan.kind === 'delete' ? 'sint.pickToDelete' : 'sint.pickToUpdate', { n: plan.targets.length })}
      </p>

      {plan.targets.length > 1 && (
        <button type="button" className="minibtn sint-all" onClick={() => setChosen(allChosen ? new Set() : new Set(all))}>
          {t(allChosen ? 'sint.clearAll' : 'sint.selectAll')}
        </button>
      )}

      <ul className="sint-list">
        {plan.targets.map(task => (
          <li key={task.id} className="sint-item">
            <label className="sint-item-main">
              <input type="checkbox" checked={chosen.has(task.id)} onChange={() => toggle(task.id)} />
              <span className="sint-item-text">
                <span className="sint-item-title">{task.title}</span>
                <span className="sint-item-meta"><Due task={task} /></span>
                {plan.kind === 'update' && <Changes task={task} plan={plan} />}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <p className="sint-note">{t('sint.aiNote')}</p>

      <div className="sint-actions">
        <button type="button" className="btn-deny" onClick={() => onDecide(null)}>{t('sint.cancel')}</button>
        <button
          type="button"
          className={`btn-allow ${plan.kind === 'delete' ? 'danger' : ''}`}
          disabled={!chosen.size}
          onClick={() => onDecide([...chosen])}
        >
          {t(okKey, { n: chosen.size })}
        </button>
      </div>
    </>
  );
}

function Due({ task }: { task: ScheduleTask }) {
  const t = useT();
  if (!task.dueDate) return <span className="sched-nodue">{t('sched.noDue')}</span>;
  const days = daysUntil(task.dueDate);
  return (
    <>
      {days !== null && <span className="sched-dday">{ddayLabel(days)}</span>}
      <span className="sched-due">{task.dueDate}{task.due?.time ? ` ${task.due.time}` : ''}</span>
      {task.status === 'done' && <span className="sched-badge">{t('sched.bucket.done')}</span>}
    </>
  );
}

/** 무엇이 어떻게 바뀌는지 항목마다 보인다. 같은 지시라도 항목마다 결과가 다를 수 있다. */
function Changes({ task, plan }: { task: ScheduleTask; plan: Extract<ActionablePlan, { kind: 'update' }> }) {
  const t = useT();
  const lines = changeLines(task, plan.changes);
  if (!lines.length) return <span className="sint-nochange">{t('sint.noChange')}</span>;
  return (
    <span className="sint-change">
      {lines.map(line => (
        <span key={line.field} className="sint-change-line">
          <span className="sint-change-field">{t(`sint.field.${line.field}` as MessageKey)}</span>
          <span className="sint-change-before">{label(t, line.field, line.before)}</span>
          <ArrowIcon />
          <span className="sint-change-after">{label(t, line.field, line.after)}</span>
        </span>
      ))}
    </span>
  );
}

function label(t: ReturnType<typeof useT>, field: string, value: string): string {
  if (!value) return t('sint.none');
  if (field === 'status') return t(value === 'done' ? 'sched.bucket.done' : 'sint.status.todo');
  return value;
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
