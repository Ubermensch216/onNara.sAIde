/**
 * 일정 탭 — 기한·후속조치 보드(계획서 S07 · P4-4).
 *
 * ★ 달력 격자가 아니라 D-day 목록이다. 사이드패널은 폭이 400px 남짓이라 월간 격자에는
 *   제목이 거의 들어가지 않는다. 그리고 여기서 관리하는 것은 약속 시각이 아니라 처리 기한이다.
 *
 * ★ 지난 기한을 숨기지 않는다. 맨 위에 "기한 지남"으로 남긴다 — 놓친 것을 보이지 않게 하면
 *   보드를 둘 이유가 없다.
 *
 * ★ 근거와 검증 결과를 항목에 붙여 보인다(원문 확인 / 연도 추정). AI가 뽑았다는 사실이
 *   며칠 뒤에도 보여야 한다. 계획서 §9.1 "근거와 범위를 숨기지 않는다".
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { refreshTasks, addTask, clearDoneTasks, deleteTask, setTaskDone, updateTask, useSchedule } from '@/lib/schedule/store';
import { downloadText, exportFileName, tasksToCsv, tasksToIcs } from '@/lib/schedule/export';
import { bucketOf, daysUntil, ddayLabel, groupTasks, type ScheduleTask, type TaskBucket } from '@/lib/schedule/task';

const BUCKETS: TaskBucket[] = ['overdue', 'today', 'soon', 'later', 'someday'];

/** 수정 중인 항목. 'new'면 직접 추가다. */
type Editing = ScheduleTask | 'new' | null;

export function SchedulePanel() {
  const t = useT();
  const tasks = useSchedule(state => state.tasks);
  const loaded = useSchedule(state => state.loaded);
  const [editing, setEditing] = useState<Editing>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => { void refreshTasks(); }, []);

  // 자정을 넘겨도 D-day가 갱신되도록 화면을 열 때의 날짜를 기준으로 삼되, 목록이 바뀌면 다시 계산한다.
  const groups = useMemo(() => groupTasks(tasks, new Date()), [tasks]);
  const done = groups.done;

  const remove = async (task: ScheduleTask) => {
    if (!window.confirm(t('sched.deleteConfirm'))) return;
    await deleteTask(task.id);
  };

  const clearDone = async () => {
    if (!done.length || !window.confirm(t('sched.clearDoneConfirm', { n: done.length }))) return;
    await clearDoneTasks();
  };

  return (
    <div className="sched">
      <section className="sched-head">
        <h2 className="sched-title">{t('view.schedule')}<span className="sched-count">{t('sched.count', { n: tasks.length - done.length })}</span></h2>
        <button type="button" className="minibtn" onClick={() => setEditing('new')}><PlusIcon />{t('sched.add')}</button>
      </section>

      {editing && (
        // key를 주어 다른 항목을 고르면 폼을 새로 만든다. 없으면 앞 항목의 입력이 남는다.
        <TaskForm
          key={editing === 'new' ? 'new' : editing.id}
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {!loaded && <p className="sched-empty">{t('sched.loading')}</p>}

      {loaded && tasks.length === 0 && (
        <div className="sched-empty-box">
          <p className="sched-empty">{t('sched.empty')}</p>
          <p className="sched-empty-hint">{t('sched.emptyHint')}</p>
        </div>
      )}

      {BUCKETS.map(bucket => groups[bucket].length > 0 && (
        <section key={bucket} className={`sched-section ${bucket}`}>
          <h3 className="sched-section-title">
            {t(`sched.bucket.${bucket}`)}
            <span className="sched-section-count">{groups[bucket].length}</span>
          </h3>
          <ul className="sched-list">
            {groups[bucket].map(task => (
              <TaskRow key={task.id} task={task} onEdit={() => setEditing(task)} onDelete={() => void remove(task)} />
            ))}
          </ul>
        </section>
      ))}

      {tasks.length > 0 && (
        <p className="sched-foot">
          <span>{t('sched.export')}</span>
          <button type="button" className="auto-link" onClick={() => downloadText(exportFileName('csv'), tasksToCsv(tasks), 'text/csv')}>
            {t('sched.exportCsv')}
          </button>
          <button type="button" className="auto-link" onClick={() => downloadText(exportFileName('ics'), tasksToIcs(tasks), 'text/calendar')}>
            {t('sched.exportIcs')}
          </button>
        </p>
      )}

      {done.length > 0 && (
        <section className="sched-section done">
          <div className="sched-section-head">
            <button type="button" className="sched-section-toggle" aria-expanded={showDone} onClick={() => setShowDone(value => !value)}>
              <ChevronIcon open={showDone} />
              {t('sched.bucket.done')}
              <span className="sched-section-count">{done.length}</span>
            </button>
            {showDone && <button type="button" className="auto-link" onClick={() => void clearDone()}>{t('sched.clearDone')}</button>}
          </div>
          {showDone && (
            <ul className="sched-list">
              {done.map(task => (
                <TaskRow key={task.id} task={task} onEdit={() => setEditing(task)} onDelete={() => void remove(task)} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function TaskRow({ task, onEdit, onDelete }: { task: ScheduleTask; onEdit: () => void; onDelete: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const days = task.dueDate ? daysUntil(task.dueDate) : null;
  const bucket = bucketOf(task);
  const detail = Boolean(task.evidence || task.notes || task.deliverables?.length || task.contact || task.source);

  return (
    <li className={`sched-task ${task.status}`}>
      <div className="sched-task-head">
        <button
          type="button"
          className="sched-check"
          aria-label={task.status === 'done' ? t('sched.undone') : t('sched.done')}
          aria-pressed={task.status === 'done'}
          onClick={() => void setTaskDone(task.id, task.status !== 'done')}
        >
          {task.status === 'done' ? <CheckedIcon /> : <UncheckedIcon />}
        </button>
        <button type="button" className="sched-task-main" onClick={() => detail ? setOpen(value => !value) : onEdit()}>
          <span className="sched-task-title">{task.title}</span>
          <span className="sched-task-meta">
            {days === null
              ? <span className="sched-nodue">{t('sched.noDue')}</span>
              : <><span className={`sched-dday ${bucket}`}>{ddayLabel(days)}</span><span className="sched-due">{task.due?.text ?? task.dueDate}{task.due?.time ? ` ${task.due.time}` : ''}</span></>}
            {task.due?.yearInferred && <span className="sched-badge warn">{t('sched.yearInferred')}</span>}
            {task.evidenceVerified === false && <span className="sched-badge warn">{t('sched.unverified')}</span>}
          </span>
        </button>
        <button type="button" className="icon-btn sched-icon" title={t('sched.edit')} aria-label={t('sched.edit')} onClick={onEdit}><PencilIcon /></button>
        <button type="button" className="icon-btn sched-icon" title={t('ui.delete')} aria-label={t('ui.delete')} onClick={onDelete}><TrashIcon /></button>
      </div>

      {open && detail && (
        <div className="sched-task-detail">
          {task.source && (
            <p className="sched-detail-row">
              <span className="sched-detail-label">{t('sched.openDoc')}</span>
              {task.source.docUrl
                ? <button type="button" className="sched-link" onClick={() => openDocument(task.source!.docUrl!)}>{task.source.docTitle}</button>
                : <span>{task.source.docTitle}</span>}
            </p>
          )}
          {task.deliverables?.length ? (
            <p className="sched-detail-row"><span className="sched-detail-label">{t('sched.deliverables')}</span>{task.deliverables.join(', ')}</p>
          ) : null}
          {task.contact && <p className="sched-detail-row"><span className="sched-detail-label">{t('sched.contact')}</span>{task.contact}</p>}
          {task.notes && <p className="sched-detail-row"><span className="sched-detail-label">{t('sched.form.notes')}</span>{task.notes}</p>}
          {task.evidence && (
            <blockquote className="sched-evidence">
              {task.evidence}
              <span className={`sched-badge ${task.evidenceVerified ? 'ok' : 'warn'}`}>
                {task.evidenceVerified ? t('sched.verified') : t('sched.unverified')}
              </span>
            </blockquote>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * 추가·수정 폼.
 *
 * ★ 날짜는 <input type="date">로 받는다. 직접 적는 칸으로 두면 "9/30", "9.30" 같은
 *   표기가 섞여 들어와 정렬이 깨진다. 공문에서 읽어 온 원문 표기는 due.text에 그대로 남는다.
 */
function TaskForm({ task, onClose }: { task: ScheduleTask | null; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(task?.title ?? '');
  const [date, setDate] = useState(task?.dueDate ?? '');
  const [time, setTime] = useState(task?.due?.time ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) { setError(t('sched.form.taskRequired')); return; }
    // 사용자가 고른 날짜는 추론이 아니다. 원문 표기도 사용자가 고친 값으로 맞춘다.
    const due = date ? { date, ...(time ? { time } : {}), text: task?.due?.date === date ? task.due.text : date, yearInferred: false } : undefined;
    const patch = { title: title.trim(), ...(due ? { due } : { due: undefined }), notes: notes.trim() };
    if (task) await updateTask(task.id, patch);
    else await addTask({ ...patch, status: 'todo', dueDate: due?.date ?? '' });
    onClose();
  };

  return (
    <form className="sched-form" onSubmit={submit}>
      <h3 className="sched-form-title">{task ? t('sched.form.editTitle') : t('sched.form.new')}</h3>
      <label className="sched-field">
        <span>{t('sched.form.task')}</span>
        <input value={title} onChange={event => setTitle(event.target.value)} placeholder={t('sched.form.taskPlaceholder')} autoFocus />
      </label>
      <div className="sched-field-row">
        <label className="sched-field">
          <span>{t('sched.form.due')}</span>
          <input type="date" value={date} onChange={event => setDate(event.target.value)} />
        </label>
        <label className="sched-field">
          <span>{t('sched.form.time')}</span>
          <input type="time" value={time} onChange={event => setTime(event.target.value)} disabled={!date} />
        </label>
      </div>
      <label className="sched-field">
        <span>{t('sched.form.notes')}</span>
        <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} />
      </label>
      {error && <p className="sched-form-error">{error}</p>}
      <div className="sched-form-actions">
        <button type="button" className="minibtn" onClick={onClose}>{t('sched.form.cancel')}</button>
        <button type="submit" className="minibtn primary">{t('sched.form.save')}</button>
      </div>
    </form>
  );
}

/** 공문을 새 탭에서 연다. 온나라는 세션이 끊기면 목록으로 되돌아갈 수 있어 참고용이다. */
function openDocument(url: string): void {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) void chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener');
}

/* ── 아이콘 ── */

function Svg({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const PlusIcon = () => <Svg size={13}><path d="M12 5v14M5 12h14" /></Svg>;
const PencilIcon = () => <Svg size={14}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
const TrashIcon = () => <Svg size={14}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></Svg>;
const UncheckedIcon = () => <Svg size={17}><circle cx="12" cy="12" r="9" /></Svg>;
const CheckedIcon = () => <Svg size={17}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></Svg>;
const ChevronIcon = ({ open }: { open: boolean }) => <Svg size={13}>{open ? <path d="m6 9 6 6 6-6" /> : <path d="m9 6 6 6-6 6" />}</Svg>;
