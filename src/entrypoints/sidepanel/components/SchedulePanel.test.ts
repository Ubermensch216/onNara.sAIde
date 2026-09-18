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

async function render() {
  await act(() => root.render(createElement(SchedulePanel)));
  await settle();
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

it('★ 등록된 일정이 없으면 어디서 등록하는지 안내한다', async () => {
  await render();
  expect(document.querySelector('.sched-empty-hint')!.textContent).toContain('/조치');
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

/** React가 제어하는 입력에 값을 넣는다. value를 직접 대입하면 React가 변화를 알아채지 못한다. */
function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
