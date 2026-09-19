/**
 * 일정 탭 — 기한·후속조치 보드(계획서 S07 · P4-4).
 *
 * ★ 달력(월·주·일)과 D-day 목록을 함께 둔다. 달력은 "이번 달에 무엇이 몰려 있는가"를 보고,
 *   목록은 "지금 급한 것이 무엇인가"를 본다. 사이드패널은 폭이 400px 남짓이라 월 격자의 칸이
 *   좁으므로, 칸에는 밀도만 보이고 고른 날의 일정은 격자 아래에 제대로 편다.
 *
 * ★ 지난 기한을 숨기지 않는다. 달력 칸에서는 붉게, 목록에서는 맨 위에 `D+n`으로 남긴다.
 *
 * ★ 기한 미정 항목을 달력 칸에 넣지 않는다. 대신 어느 보기에서나 건수를 띠로 보여 준다 —
 *   달력에 놓으면 없는 기한이 생기고, 안 보이면 잊힌다.
 *
 * ★ 근거와 검증 결과를 항목에 붙여 보인다(원문 확인 / 연도 추정). 계획서 §9.1 "근거와 범위를 숨기지 않는다".
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT, type MessageKey } from '@/lib/i18n';
import { clearScheduleFocus, refreshTasks, addTask, clearDoneTasks, deleteTask, setTaskDone, updateTask, useSchedule } from '@/lib/schedule/store';
import { downloadText, exportFileName, tasksToCsv, tasksToIcs } from '@/lib/schedule/export';
import {
  isCalendarMode, monthGrid, monthOf, shiftCursor, shortDate, tasksByDate, undatedTasks, weekDates, weekday,
  type CalendarMode,
} from '@/lib/schedule/calendar';
import { bucketOf, daysUntil, ddayLabel, groupTasks, todayISO, type ScheduleTask, type TaskBucket } from '@/lib/schedule/task';

const BUCKETS: TaskBucket[] = ['overdue', 'today', 'soon', 'later', 'someday'];
const MODES: CalendarMode[] = ['month', 'week', 'day', 'list'];
const MODE_KEY = 'saide.scheduleMode';
/** 월 격자 한 칸에 펼쳐 보일 일정 수. 나머지는 "+n"으로 접는다. */
const CELL_CHIPS = 2;

/** 수정 중인 항목. `{ newOn }`이면 그 날짜로 새로 만드는 중이다. */
type Editing = ScheduleTask | { newOn: string } | null;

function initialMode(): CalendarMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    return isCalendarMode(stored) ? stored : 'month';
  } catch { return 'month'; }
}

export function SchedulePanel() {
  const t = useT();
  const tasks = useSchedule(state => state.tasks);
  const loaded = useSchedule(state => state.loaded);
  const focus = useSchedule(state => state.focus);
  const [mode, setMode] = useState<CalendarMode>(initialMode);
  const [cursor, setCursor] = useState<string>(todayISO);
  const [editing, setEditing] = useState<Editing>(null);
  const [showDone, setShowDone] = useState(false);
  /** 링크로 찾아온 항목. 잠깐 강조했다가 스스로 꺼진다. */
  const [spotlight, setSpotlight] = useState<number | null>(null);

  useEffect(() => { void refreshTasks(); }, []);
  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* 기억하지 못해도 동작에는 지장 없다 */ }
  }, [mode]);

  /**
   * 답변 안의 링크로 찾아온 자리로 옮긴다.
   *
   * ★ `focus.at`으로 구분한다. 같은 항목을 두 번 눌러도 화면이 반응해야 하고,
   *   반대로 이 효과가 매 렌더마다 돌면 사용자가 손으로 넘겨 둔 달이 자꾸 되돌아온다.
   *
   * ★ 목록을 아직 못 읽었으면 기다린다. 링크가 짚은 항목을 찾지 못한 채 초점을 비우면
   *   눌러도 아무 일이 없는 것처럼 보인다.
   */
  useEffect(() => {
    if (!focus || !loaded) return;
    const target = focus.taskId === undefined ? null : tasks.find(item => item.id === focus.taskId);
    if (target) {
      // 기한 미정 항목은 달력 격자에 자리가 없다. 목록 보기로 보내야 화면에 보인다.
      setMode(target.dueDate ? 'day' : 'list');
      if (target.dueDate) setCursor(target.dueDate);
      setSpotlight(target.id);
    } else if (focus.taskId !== undefined) {
      // 그 사이에 지워졌다. 목록으로 보내 무엇이 남았는지 보이게 한다.
      setMode('list');
    } else {
      if (focus.cursor) setCursor(focus.cursor);
      if (focus.mode) setMode(focus.mode);
    }
    clearScheduleFocus();
  }, [focus?.at, loaded]);

  // 강조는 "여기다"라고 알리는 것이지 선택 상태가 아니다. 잠깐 뒤 스스로 꺼진다.
  useEffect(() => {
    if (spotlight === null) return;
    const timer = setTimeout(() => setSpotlight(null), 4000);
    return () => clearTimeout(timer);
  }, [spotlight]);

  const today = todayISO();
  const byDate = useMemo(() => tasksByDate(tasks), [tasks]);
  const undated = useMemo(() => undatedTasks(tasks), [tasks]);
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

  const rowProps = { spotlight, onEdit: setEditing, onDelete: (task: ScheduleTask) => void remove(task) };

  return (
    <div className="sched">
      <section className="sched-head">
        <h2 className="sched-title">{t('view.schedule')}<span className="sched-count">{t('sched.count', { n: tasks.length - done.length })}</span></h2>
        <button type="button" className="minibtn" onClick={() => setEditing({ newOn: mode === 'list' ? '' : cursor })}>
          <PlusIcon />{t('sched.add')}
        </button>
      </section>

      <div className="cal-modes" role="tablist" aria-label={t('sched.viewMode')}>
        {MODES.map(item => (
          <button key={item} type="button" role="tab" aria-selected={mode === item}
            className={`cal-mode ${mode === item ? 'on' : ''}`} onClick={() => setMode(item)}>
            {t(`sched.view.${item}` as MessageKey)}
          </button>
        ))}
      </div>

      {mode !== 'list' && (
        <div className="cal-nav">
          <button type="button" className="icon-btn cal-step" onClick={() => setCursor(shiftCursor(cursor, mode, -1))}
            title={t('sched.prev')} aria-label={t('sched.prev')}><ChevronIcon dir="left" /></button>
          {/* 범위 이름을 누르면 오늘로 돌아온다. 좁은 줄에 버튼을 하나 더 두지 않으려는 것이다. */}
          <button type="button" className="cal-range" onClick={() => setCursor(today)} title={t('sched.today')}>
            {rangeLabel(t, cursor, mode)}
          </button>
          <button type="button" className="icon-btn cal-step" onClick={() => setCursor(shiftCursor(cursor, mode, 1))}
            title={t('sched.next')} aria-label={t('sched.next')}><ChevronIcon dir="right" /></button>
        </div>
      )}

      {editing && (
        // key를 주어 다른 항목을 고르면 폼을 새로 만든다. 없으면 앞 항목의 입력이 남는다.
        <TaskForm
          key={'newOn' in editing ? `new-${editing.newOn}` : editing.id}
          task={'newOn' in editing ? null : editing}
          defaultDate={'newOn' in editing ? editing.newOn : ''}
          onClose={() => setEditing(null)}
        />
      )}

      {!loaded && <p className="sched-empty">{t('sched.loading')}</p>}

      {/* 처음 쓰는 사람에게는 달력보다 "어디서 등록하는가"가 먼저다. 어느 보기에서나 보여 준다. */}
      {loaded && tasks.length === 0 && (
        <div className="sched-empty-box">
          <p className="sched-empty">{t('sched.empty')}</p>
          <p className="sched-empty-hint">{t('sched.emptyHint')}</p>
        </div>
      )}

      {mode === 'month' && (
        <>
          <MonthGrid cursor={cursor} today={today} byDate={byDate} onPick={setCursor} />
          <DayAgenda date={cursor} tasks={byDate.get(cursor) ?? []} today={today} quiet={!tasks.length}
            onAdd={() => setEditing({ newOn: cursor })} {...rowProps} />
        </>
      )}

      {mode === 'week' && weekDates(cursor).map(date => (
        <DayAgenda key={date} date={date} tasks={byDate.get(date) ?? []} today={today} compact
          onAdd={() => setEditing({ newOn: date })} {...rowProps} />
      ))}

      {mode === 'day' && (
        <DayAgenda date={cursor} tasks={byDate.get(cursor) ?? []} today={today} quiet={!tasks.length}
          onAdd={() => setEditing({ newOn: cursor })} {...rowProps} />
      )}

      {mode === 'list' && BUCKETS.map(bucket => groups[bucket].length > 0 && (
        <section key={bucket} className={`sched-section ${bucket}`}>
          <h3 className="sched-section-title">
            {t(`sched.bucket.${bucket}`)}
            <span className="sched-section-count">{groups[bucket].length}</span>
          </h3>
          <ul className="sched-list">
            {groups[bucket].map(task => <TaskRow key={task.id} task={task} {...rowProps} />)}
          </ul>
        </section>
      ))}

      {/* 달력에 놓을 수 없는 항목도 잊히지 않게 건수를 남긴다. 누르면 목록 보기로 넘어간다. */}
      {mode !== 'list' && undated.length > 0 && (
        <button type="button" className="cal-undated" onClick={() => setMode('list')}>
          {t('sched.undatedCount', { n: undated.length })}
        </button>
      )}

      {mode === 'list' && done.length > 0 && (
        <section className="sched-section done">
          <div className="sched-section-head">
            <button type="button" className="sched-section-toggle" aria-expanded={showDone} onClick={() => setShowDone(value => !value)}>
              <ChevronIcon dir={showDone ? 'down' : 'right'} />
              {t('sched.bucket.done')}
              <span className="sched-section-count">{done.length}</span>
            </button>
            {showDone && <button type="button" className="auto-link" onClick={() => void clearDone()}>{t('sched.clearDone')}</button>}
          </div>
          {showDone && (
            <ul className="sched-list">
              {done.map(task => <TaskRow key={task.id} task={task} {...rowProps} />)}
            </ul>
          )}
        </section>
      )}
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

    </div>
  );
}

/** 보기 범위의 이름. 달을 넘겼는지 한눈에 보여야 해서 늘 연도까지 적는다. */
function rangeLabel(t: (key: MessageKey, vars?: Record<string, string | number>) => string, cursor: string, mode: CalendarMode): string {
  const [year, month, day] = cursor.split('-');
  if (mode === 'day') {
    return t('cal.dayLabel', { year: Number(year), month: Number(month), day: Number(day), weekday: t(`cal.wd.${weekday(cursor)}` as MessageKey) });
  }
  if (mode === 'week') {
    const dates = weekDates(cursor);
    return t('cal.weekLabel', { from: shortDate(dates[0]!), to: shortDate(dates[6]!) });
  }
  return t('cal.monthLabel', { year: Number(year), month: Number(month) });
}

function MonthGrid({ cursor, today, byDate, onPick }: {
  cursor: string; today: string; byDate: Map<string, ScheduleTask[]>; onPick: (date: string) => void;
}) {
  const t = useT();
  const weeks = monthGrid(cursor);
  const month = monthOf(cursor);

  return (
    <div className="cal">
      <div className="cal-week-head" aria-hidden="true">
        {Array.from({ length: 7 }, (_, day) => (
          <span key={day} className={`cal-wd ${day === 0 ? 'sun' : day === 6 ? 'sat' : ''}`}>{t(`cal.wd.${day}` as MessageKey)}</span>
        ))}
      </div>
      <div className="cal-grid">
        {weeks.flat().map(date => {
          const items = byDate.get(date) ?? [];
          const open = items.filter(item => item.status !== 'done');
          const overdue = open.some(item => date < today);
          const day = weekday(date);
          return (
            <button
              key={date}
              type="button"
              className={[
                'cal-cell',
                monthOf(date) === month ? '' : 'other',
                date === today ? 'today' : '',
                date === cursor ? 'picked' : '',
                day === 0 ? 'sun' : day === 6 ? 'sat' : '',
              ].filter(Boolean).join(' ')}
              aria-pressed={date === cursor}
              aria-label={t('cal.cellLabel', { date: shortDate(date), n: open.length })}
              onClick={() => onPick(date)}
            >
              <span className="cal-day">{Number(date.slice(8))}</span>
              {items.slice(0, CELL_CHIPS).map(item => (
                <span key={item.id} className={`cal-chip ${item.status === 'done' ? 'done' : date < today ? 'overdue' : ''}`}>
                  {item.title}
                </span>
              ))}
              {items.length > CELL_CHIPS && <span className="cal-more">+{items.length - CELL_CHIPS}</span>}
              {overdue && <span className="cal-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 하루치 일정. 주 보기에서는 이것을 이레 쌓는다. */
function DayAgenda({ date, tasks, today, compact = false, quiet = false, spotlight = null, onAdd, onEdit, onDelete }: {
  date: string; tasks: ScheduleTask[]; today: string; compact?: boolean;
  /** 등록된 일정이 하나도 없을 때. 위의 안내와 겹치므로 빈 문구를 접는다. */
  quiet?: boolean;
  spotlight?: number | null;
  onAdd: () => void; onEdit: (task: ScheduleTask) => void; onDelete: (task: ScheduleTask) => void;
}) {
  const t = useT();
  const day = weekday(date);
  // 주 보기는 이레가 같은 달인 경우가 대부분이다. 연·월을 매 줄 반복하지 않고 날짜와 요일만 적는다.
  const label = compact
    ? t('cal.shortDayLabel', { month: Number(date.slice(5, 7)), day: Number(date.slice(8)), weekday: t(`cal.wd.${day}` as MessageKey) })
    : t('cal.dayLabel', { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8)), weekday: t(`cal.wd.${day}` as MessageKey) });

  return (
    <section className={`cal-agenda ${date === today ? 'today' : ''} ${compact ? 'compact' : ''}`}>
      <div className="sched-section-head">
        <h3 className={`sched-section-title ${day === 0 ? 'sun' : day === 6 ? 'sat' : ''}`}>
          {label}
          {date === today && <span className="cal-today-badge">{t('sched.today')}</span>}
          {tasks.length > 0 && <span className="sched-section-count">{tasks.length}</span>}
        </h3>
        <button type="button" className="auto-link" onClick={onAdd}>{t('sched.addOnDay')}</button>
      </div>
      {tasks.length
        ? <ul className="sched-list">{tasks.map(task => <TaskRow key={task.id} task={task} spotlight={spotlight} onEdit={onEdit} onDelete={onDelete} />)}</ul>
        : !compact && !quiet && <p className="cal-agenda-empty">{t('sched.noTaskOnDay')}</p>}
    </section>
  );
}

function TaskRow({ task, spotlight = null, onEdit, onDelete }: {
  task: ScheduleTask; spotlight?: number | null;
  onEdit: (task: ScheduleTask) => void; onDelete: (task: ScheduleTask) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const days = task.dueDate ? daysUntil(task.dueDate) : null;
  const bucket = bucketOf(task);
  const detail = Boolean(task.evidence || task.notes || task.deliverables?.length || task.contact || task.source);
  const lit = spotlight === task.id;

  // 링크로 찾아왔으면 화면 안으로 끌어온다. 강조만 해 두면 접힌 아래에 있을 때 보이지 않는다.
  useEffect(() => {
    if (lit) row.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [lit]);

  return (
    <li ref={row} className={`sched-task ${task.status} ${lit ? 'lit' : ''}`}>
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
        <button type="button" className="sched-task-main" onClick={() => detail ? setOpen(value => !value) : onEdit(task)}>
          <span className="sched-task-title">{task.title}</span>
          <span className="sched-task-meta">
            {days === null
              ? <span className="sched-nodue">{t('sched.noDue')}</span>
              : <><span className={`sched-dday ${bucket}`}>{ddayLabel(days)}</span><span className="sched-due">{task.due?.text ?? task.dueDate}{task.due?.time ? ` ${task.due.time}` : ''}</span></>}
            {task.due?.yearInferred && <span className="sched-badge warn">{t('sched.yearInferred')}</span>}
            {task.evidenceVerified === false && <span className="sched-badge warn">{t('sched.unverified')}</span>}
          </span>
        </button>
        <button type="button" className="icon-btn sched-icon" title={t('sched.edit')} aria-label={t('sched.edit')} onClick={() => onEdit(task)}><PencilIcon /></button>
        <button type="button" className="icon-btn sched-icon" title={t('ui.delete')} aria-label={t('ui.delete')} onClick={() => onDelete(task)}><TrashIcon /></button>
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
function TaskForm({ task, defaultDate, onClose }: { task: ScheduleTask | null; defaultDate: string; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(task?.title ?? '');
  const [date, setDate] = useState(task?.dueDate ?? defaultDate);
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

const ARROWS = { left: 'm15 6-6 6 6 6', right: 'm9 6 6 6-6 6', down: 'm6 9 6 6 6-6' } as const;
const ChevronIcon = ({ dir }: { dir: keyof typeof ARROWS }) => <Svg size={14}><path d={ARROWS[dir]} /></Svg>;
