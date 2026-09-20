// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TaskRegisterCard } from './TaskRegisterCard';
import { db } from '@/lib/storage/db';
import { refreshTasks, useSchedule } from '@/lib/schedule/store';
import type { TaskCandidate } from '@/lib/schedule/candidates';

let root: Root;
const source = { title: '공모사업 안내', url: 'https://onnara.test/doc/1' };

const CANDIDATES: TaskCandidate[] = [
  {
    title: '사업계획서 제출',
    evidence: '붙임 서식을 작성하여 2026. 9. 30.까지 제출하여 주시기 바랍니다.',
    evidenceVerified: true,
    due: { date: '2026-09-30', text: '2026. 9. 30.', yearInferred: false },
    dueVerified: true,
    deliverables: ['사업계획서'],
    contact: '기획예산과 홍길동',
  },
  { title: '전 직원 교육 이수', evidence: '원문에 없는 문장이다.', evidenceVerified: false },
];

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await db.tasks.clear();
  useSchedule.setState({ tasks: [], loaded: true });
  document.body.innerHTML = '<div id="fixture"></div>';
  root = createRoot(document.getElementById('fixture')!);
});
afterEach(async () => { await act(() => root.unmount()); vi.unstubAllGlobals(); });

async function settle() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

async function open(props: Partial<Parameters<typeof TaskRegisterCard>[0]> = {}) {
  await act(() => root.render(createElement(TaskRegisterCard, { candidates: CANDIDATES, source, conversationId: 1, model: 'm', ...props })));
  await settle();
  await act(async () => document.querySelector<HTMLButtonElement>('.task-register .minibtn')!.click());
  await settle();
}

const boxes = () => [...document.querySelectorAll<HTMLInputElement>('.task-candidate-main input')];
const submitButton = () => document.querySelector<HTMLButtonElement>('.minibtn.primary')!;

it('★ 펼치기 전에는 아무것도 저장하지 않는다 — 등록은 사용자가 시작한다', async () => {
  await act(() => root.render(createElement(TaskRegisterCard, { candidates: CANDIDATES, source, conversationId: 1, model: 'm' })));
  await settle();
  expect(document.querySelector('.minibtn')!.textContent).toContain('일정으로 등록 (2건)');
  expect(await db.tasks.count()).toBe(0);
});

it('★ 원문에서 근거를 찾지 못한 후보는 기본으로 체크하지 않는다', async () => {
  await open();
  expect(boxes().map(box => box.checked)).toEqual([true, false]);
  expect(document.querySelectorAll('.sched-badge')[1]!.textContent).toBe('원문에서 찾지 못함');
  expect(submitButton().textContent).toBe('1건 등록');
});

it('체크한 항목만, 근거와 출처까지 함께 저장한다', async () => {
  await open();
  await act(async () => submitButton().click());
  await settle();

  const stored = await db.tasks.toArray();
  expect(stored.map(task => task.title)).toEqual(['사업계획서 제출']);
  expect(stored[0]).toMatchObject({
    dueDate: '2026-09-30',
    evidenceVerified: true,
    deliverables: ['사업계획서'],
    contact: '기획예산과 홍길동',
    source: { docTitle: '공모사업 안내', docUrl: 'https://onnara.test/doc/1', conversationId: 1 },
  });
  expect(document.querySelector('.task-register-result')!.textContent).toContain('1건을 일정에 등록했습니다');
});

it('사용자가 직접 체크하면 근거 미확인 후보도 등록된다 — 판단은 사용자가 한다', async () => {
  await open();
  await act(async () => boxes()[1]!.click());
  await settle();
  await act(async () => submitButton().click());
  await settle();

  expect((await db.tasks.toArray()).map(task => task.title)).toEqual(['사업계획서 제출', '전 직원 교육 이수']);
});

it('★ 이미 등록한 후보는 체크할 수 없고 중복으로 쌓이지 않는다', async () => {
  await open();
  await act(async () => submitButton().click());
  await settle();
  await act(async () => refreshTasks());
  await settle();

  const [first] = boxes();
  expect(first!.disabled).toBe(true);
  expect(document.querySelector('.task-candidate.already')).not.toBeNull();
  expect(submitButton().textContent).toBe('고른 항목이 없습니다.');
  expect(await db.tasks.count()).toBe(1);
});

it('등록한 뒤 일정 탭으로 넘어갈 수 있다', async () => {
  const onOpenSchedule = vi.fn();
  await open({ onOpenSchedule });
  await act(async () => submitButton().click());
  await settle();

  document.querySelector<HTMLButtonElement>('.task-register-actions .auto-link')!.click();
  expect(onOpenSchedule).toHaveBeenCalled();
});
