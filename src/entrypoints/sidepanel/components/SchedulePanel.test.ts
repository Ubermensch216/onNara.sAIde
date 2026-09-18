// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SchedulePanel } from './SchedulePanel';
import { db } from '@/lib/storage/db';
import { addTask, useSchedule } from '@/lib/schedule/store';

let root: Root;

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  await db.tasks.clear();
  useSchedule.setState({ tasks: [], loaded: false });
  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });

async function settle() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function isoIn(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function render(mode: 'month' | 'week' | 'day' | 'list' = 'list') {
  // 보기 방식은 브라우저에 기억된다. 테스트는 볼 화면을 먼저 정해 둔다.
  localStorage.setItem('saide.scheduleMode', mode);
  await act(() => root.render(createElement(SchedulePanel)));
  await settle();
}

/**
 * 격자에서 그 날의 칸을 찾는다.
 *
 * ★ 날짜 숫자로 찾지 않는다. 달 끝자락에 테스트를 돌리면 대상 날짜가 다음 달 칸(.other)에 있어
 *   숫자만으로는 못 찾거나 엉뚱한 칸을 집는다. 칸이 읽어 주는 전체 날짜로 찾는다.
 */
function pickCell(dateISO: string): HTMLButtonElement {
  const label = dateISO.replace(/-/g, '.');
  return [...document.querySelectorAll<HTMLButtonElement>('.cal-cell')]
    .find(cell => cell.getAttribute('aria-label')!.startsWith(`${label},`))!;
}

it('기한 지남·오늘·이번 주로 나눠 보이고, 지난 기한을 맨 위에 둔다', async () => {
  await addTask({ title: '지난 제출', status: 'todo', dueDate: '', due: { date: isoIn(-2), text: '지난주', yearInferred: false } });
  await addTask({ title: '오늘 회신', status: 'todo', dueDate: '', due: { date: isoIn(0), text: '오늘', yearInferred: false } });
  await addTask({ title: '이번 주 보고', status: 'todo', dueDate: '', due: { date: isoIn(3), text: '사흘 뒤', yearInferred: false } });
  await addTask({ title: '기한 없는 일', status: 'todo', dueDate: '' });
  await render();

  const sections = [...document.querySelectorAll('.sched-section')];
  expect(sections.map(section => section.querySelector('.sched-section-title')!.textContent))
    .toEqual(['기한 지남1', '오늘1', '이번 주1', '기한 미정1']);
  expect(document.querySelector('.sched-task .sched-task-title')!.textContent).toBe('지난 제출');
  expect(document.querySelector('.sched-dday')!.textContent).toBe('D+2');
});

it('★ 등록된 일정이 없으면 어디서 등록하는지 안내한다 — 달력 보기에서도 보인다', async () => {
  await render('month');
  expect(document.querySelector('.sched-empty-hint')!.textContent).toContain('/조치');
  // 안내가 있으면 하루 칸의 "일정이 없습니다"는 접는다. 같은 말을 두 번 하지 않는다.
  expect(document.querySelector('.cal-agenda-empty')).toBeNull();
});

it('완료 표시하면 완료 구간으로 내려가고, 되돌리면 원래 구간으로 돌아온다', async () => {
  await addTask({ title: '계획서 제출', status: 'todo', dueDate: '', due: { date: isoIn(1), text: '내일', yearInferred: false } });
  await render();

  await act(async () => document.querySelector<HTMLButtonElement>('.sched-check')!.click());
  await settle();
  // 완료 구간은 접혀 있다. 머리글에만 건수가 남고 목록은 펼쳐야 보인다 — 끝난 일이 자리를 차지하지 않는다.
  expect(document.querySelector('.sched-section.done .sched-section-toggle')!.textContent).toBe('완료1');
  expect(document.querySelector('.sched-section.done .sched-list')).toBeNull();
  expect(document.querySelectorAll('.sched-task')).toHaveLength(0);

  await act(async () => document.querySelector<HTMLButtonElement>('.sched-section-toggle')!.click());
  await settle();
  expect(document.querySelectorAll('.sched-task.done')).toHaveLength(1);
  await act(async () => document.querySelector<HTMLButtonElement>('.sched-section.done .sched-check')!.click());
  await settle();
  expect(document.querySelectorAll('.sched-task.done')).toHaveLength(0);
  expect((await db.tasks.toArray())[0]!.status).toBe('todo');
});

it('★ 공문에서 온 항목은 근거 문장과 검증 결과를 함께 보여 준다', async () => {
  await addTask({
    title: '사업계획서 제출', status: 'todo', dueDate: '',
    due: { date: isoIn(5), text: '9. 30.', yearInferred: true },
    evidence: '붙임 서식을 작성하여 9. 30.까지 제출하여 주시기 바랍니다.',
    evidenceVerified: true,
    deliverables: ['사업계획서'],
    contact: '기획예산과 홍길동',
    source: { docTitle: '공모사업 안내', docUrl: 'https://onnara.test/doc/1' },
  });
  await render();

  // 연도를 추론했다는 사실은 접지 않고 목록에서 바로 보인다.
  expect(document.querySelector('.sched-task-meta')!.textContent).toContain('연도 추정');

  await act(async () => document.querySelector<HTMLButtonElement>('.sched-task-main')!.click());
  await settle();
  const detail = document.querySelector('.sched-task-detail')!;
  expect(detail.textContent).toContain('붙임 서식을 작성하여');
  expect(detail.textContent).toContain('원문 확인');
  expect(detail.textContent).toContain('기획예산과 홍길동');

  const create = vi.fn();
  vi.stubGlobal('chrome', { tabs: { create } });
  document.querySelector<HTMLButtonElement>('.sched-link')!.click();
  expect(create).toHaveBeenCalledWith({ url: 'https://onnara.test/doc/1' });
});

it('직접 추가한 일정이 목록과 저장소에 함께 들어간다', async () => {
  await render();
  await act(async () => document.querySelector<HTMLButtonElement>('.sched-head .minibtn')!.click());
  await settle();

  const [title, date] = [...document.querySelectorAll<HTMLInputElement>('.sched-field input')];
  await act(async () => {
    setValue(title!, '부서 의견 취합');
    setValue(date!, isoIn(2));
  });
  await act(async () => document.querySelector<HTMLFormElement>('.sched-form')!.requestSubmit());
  await settle();

  expect(document.querySelector('.sched-task-title')!.textContent).toBe('부서 의견 취합');
  const stored = await db.tasks.toArray();
  expect(stored[0]!.dueDate).toBe(isoIn(2));
  // 사용자가 고른 날짜는 추론이 아니다.
  expect(stored[0]!.due?.yearInferred).toBe(false);
});

it('할 일을 비운 채로는 저장하지 않는다', async () => {
  await render();
  await act(async () => document.querySelector<HTMLButtonElement>('.sched-head .minibtn')!.click());
  await settle();
  await act(async () => document.querySelector<HTMLFormElement>('.sched-form')!.requestSubmit());
  await settle();

  expect(document.querySelector('.sched-form-error')!.textContent).toBe('할 일을 적어 주세요.');
  expect(await db.tasks.count()).toBe(0);
});

it('삭제는 확인을 받고, 취소하면 지우지 않는다', async () => {
  await addTask({ title: '지울 일', status: 'todo', dueDate: '' });
  await render();

  vi.stubGlobal('confirm', vi.fn(() => false));
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.sched-icon')][1]!.click());
  await settle();
  expect(await db.tasks.count()).toBe(1);

  vi.stubGlobal('confirm', vi.fn(() => true));
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.sched-icon')][1]!.click());
  await settle();
  expect(await db.tasks.count()).toBe(0);
});

it('내보내기 버튼이 CSV·ICS 파일을 만들어 준다', async () => {
  await addTask({
    title: '사업계획서 제출', status: 'todo', dueDate: '',
    due: { date: isoIn(3), text: '9. 30.', yearInferred: false },
  });
  await render();

  const blobs: Blob[] = [];
  vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { blobs.push(blob); return 'blob:x'; }, revokeObjectURL: vi.fn() });
  const [csv, ics] = [...document.querySelectorAll<HTMLButtonElement>('.sched-foot .auto-link')];
  csv!.click();
  ics!.click();

  expect(blobs).toHaveLength(2);
  expect(blobs[0]!.type).toContain('text/csv');
  expect(await blobs[0]!.text()).toContain('사업계획서 제출');
  expect(await blobs[1]!.text()).toContain('BEGIN:VCALENDAR');
});

it('패널을 열면 저장소에서 목록을 읽어 온다', async () => {
  await addTask({ title: '저장돼 있던 일', status: 'todo', dueDate: '' });
  useSchedule.setState({ tasks: [], loaded: false });
  await render();
  expect(document.querySelector('.sched-task-title')!.textContent).toBe('저장돼 있던 일');
});

/* ── 달력 보기(월·주·일) ── */

it('월 보기는 6주 42칸을 그리고 오늘 칸을 표시한다', async () => {
  await render('month');

  expect(document.querySelectorAll('.cal-cell')).toHaveLength(42);
  expect(document.querySelectorAll('.cal-wd')).toHaveLength(7);
  expect(document.querySelectorAll('.cal-cell.today')).toHaveLength(1);
  expect(pickCell(isoIn(0)).classList.contains('today')).toBe(true);
});

it('★ 일정이 있는 날은 칸에서 바로 보이고, 지난 기한은 따로 표시한다', async () => {
  await addTask({ title: '계획서 제출', status: 'todo', dueDate: '', due: { date: isoIn(0), text: '오늘', yearInferred: false } });
  await addTask({ title: '지난 회신', status: 'todo', dueDate: '', due: { date: isoIn(-1), text: '어제', yearInferred: false } });
  await render('month');

  expect(pickCell(isoIn(0)).querySelector('.cal-chip')!.textContent).toBe('계획서 제출');
  expect(pickCell(isoIn(-1)).querySelector('.cal-chip.overdue')).not.toBeNull();
  expect(pickCell(isoIn(-1)).querySelector('.cal-dot')).not.toBeNull();
  // 일정이 없는 날에는 아무 표시도 없다.
  expect(pickCell(isoIn(2)).querySelector('.cal-chip')).toBeNull();
});

it('한 칸에 세 건 이상이면 두 건만 펼치고 나머지는 +n으로 접는다', async () => {
  for (const title of ['첫째', '둘째', '셋째', '넷째']) {
    await addTask({ title, status: 'todo', dueDate: '', due: { date: isoIn(1), text: '내일', yearInferred: false } });
  }
  await render('month');

  const cell = pickCell(isoIn(1));
  expect(cell.querySelectorAll('.cal-chip')).toHaveLength(2);
  expect(cell.querySelector('.cal-more')!.textContent).toBe('+2');
});

it('★ 날짜를 누르면 그 날 일정이 격자 아래에 펼쳐진다 — 좁은 칸에서 읽으려 애쓰지 않는다', async () => {
  await addTask({ title: '사업계획서 제출', status: 'todo', dueDate: '', due: { date: isoIn(4), text: '나흘 뒤', yearInferred: false } });
  await render('month');
  expect(document.querySelector('.cal-agenda .sched-task-title')).toBeNull();

  await act(async () => pickCell(isoIn(4)).click());
  await settle();
  expect(pickCell(isoIn(4)).getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('.cal-agenda .sched-task-title')!.textContent).toBe('사업계획서 제출');
});

it('고른 날짜로 바로 일정을 추가한다', async () => {
  await render('month');
  await act(async () => pickCell(isoIn(6)).click());
  await settle();
  await act(async () => document.querySelector<HTMLButtonElement>('.cal-agenda .auto-link')!.click());
  await settle();

  const [title, date] = [...document.querySelectorAll<HTMLInputElement>('.sched-field input')];
  // 누른 날짜가 기한 칸에 미리 들어가 있다.
  expect(date!.value).toBe(isoIn(6));

  await act(async () => setValue(title!, '현장 점검'));
  await act(async () => document.querySelector<HTMLFormElement>('.sched-form')!.requestSubmit());
  await settle();
  expect((await db.tasks.toArray())[0]!.dueDate).toBe(isoIn(6));
});

it('이전·다음으로 달을 넘기고, 범위 이름을 누르면 오늘로 돌아온다', async () => {
  await render('month');
  const label = () => document.querySelector('.cal-range')!.textContent;
  const thisMonth = label();

  await act(async () => document.querySelector<HTMLButtonElement>('.cal-step')!.click());
  await settle();
  expect(label()).not.toBe(thisMonth);
  expect(document.querySelectorAll('.cal-cell')).toHaveLength(42);

  await act(async () => document.querySelector<HTMLButtonElement>('.cal-range')!.click());
  await settle();
  expect(label()).toBe(thisMonth);
});

it('주 보기는 이레를 하루씩 쌓아 보여 준다', async () => {
  await addTask({ title: '오늘 회신', status: 'todo', dueDate: '', due: { date: isoIn(0), text: '오늘', yearInferred: false } });
  await render('week');

  expect(document.querySelectorAll('.cal-agenda')).toHaveLength(7);
  expect(document.querySelectorAll('.cal-agenda.today')).toHaveLength(1);
  expect(document.querySelector('.cal-agenda.today .sched-task-title')!.textContent).toBe('오늘 회신');
});

it('일 보기는 하루만 보여 주고, 비어 있으면 그렇다고 말한다', async () => {
  await addTask({ title: '오늘 회신', status: 'todo', dueDate: '', due: { date: isoIn(0), text: '오늘', yearInferred: false } });
  await render('day');

  expect(document.querySelectorAll('.cal-agenda')).toHaveLength(1);
  expect(document.querySelector('.sched-task-title')!.textContent).toBe('오늘 회신');

  // 다음 날로 넘기면 빈 날이다.
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.cal-step')][1]!.click());
  await settle();
  expect(document.querySelector('.cal-agenda-empty')!.textContent).toBe('이 날짜에는 일정이 없습니다.');
});

it('★ 기한 미정 항목은 달력 칸에 넣지 않고 건수로 남긴다 — 누르면 목록으로 넘어간다', async () => {
  await addTask({ title: '기한 없는 일', status: 'todo', dueDate: '' });
  await render('month');

  expect(document.querySelectorAll('.cal-chip')).toHaveLength(0);
  const strip = document.querySelector<HTMLButtonElement>('.cal-undated')!;
  expect(strip.textContent).toBe('기한 미정 1건 보기');

  await act(async () => strip.click());
  await settle();
  expect(document.querySelector('.cal-grid')).toBeNull();
  expect(document.querySelector('.sched-section.someday .sched-task-title')!.textContent).toBe('기한 없는 일');
});

it('고른 보기 방식은 다음에 열 때도 유지된다', async () => {
  await render('month');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.cal-mode')][1]!.click());
  await settle();
  expect(localStorage.getItem('saide.scheduleMode')).toBe('week');

  await act(() => root.unmount());
  root = createRoot(document.getElementById('fixture')!);
  await act(() => root.render(createElement(SchedulePanel)));
  await settle();
  expect(document.querySelectorAll('.cal-agenda')).toHaveLength(7);
});

/** React가 제어하는 입력에 값을 넣는다. value를 직접 대입하면 React가 변화를 알아채지 못한다. */
function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
