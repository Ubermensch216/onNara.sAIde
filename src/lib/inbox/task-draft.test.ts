import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import * as stream from '@/lib/ollama/stream';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import { db } from '@/lib/storage/db';
import { clearInbox, saveInboxDocs } from './store';
import { openTaskDraft, registerTaskDraft, startTaskDraft, useInbox } from './panel';
import { draftFromDoc, draftTasksFromBody, rankCandidates, toNewTask } from './task-draft';
import type { InboxDoc } from './types';

const TAB = { tabId: 1, url: 'https://onnara.test/list', title: '온나라', active: true };

function doc(overrides: Partial<InboxDoc> = {}): InboxDoc {
  return {
    key: 'k1', group: 'g1', title: '2026년 정산자료 제출 협조',
    reportDate: '2026-09-18', sender: '부산광역시', department: '감사담당관',
    hasAttachment: true, readState: 'unread', category: 'mine', reason: '규칙',
    dueDate: '', classifier: 'rule', firstSeenAt: 1, lastSeenAt: 1, ...overrides,
  };
}

/** 본문 한 건을 읽어 주는 서비스 워커. */
function stubChrome(reply: unknown) {
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => reply) } });
}

const EVIDENCE = '정산자료는 2026. 9. 30.까지 제출하여 주시기 바랍니다.';

/** 모델이 스키마대로 답한 한 건. 기한 표기는 공문이 쓰는 그대로 연도를 붙인다. */
function cardJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: '정산자료 제출 요청',
    actions: [{ task: '정산자료 제출', evidence: EVIDENCE }],
    deliverables: ['정산자료'],
    deadlines: [{ date: '2026. 9. 30.', what: '정산자료 제출', evidence: EVIDENCE }],
    contact: '감사담당관 051-000-0000',
    ...overrides,
  });
}

const PAGE = {
  url: 'https://onnara.test/doc', title: '상세', text: '정산자료는 2026. 9. 30.까지 제출하여 주시기 바랍니다.',
  charCount: 40, truncated: false, keptRatio: 1, estimatedTokens: 20, method: 'innerText' as const, extractedAt: 1,
};

afterEach(async () => {
  useInbox.setState({ docs: [], draft: null });
  await clearInbox();
  await db.tasks.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('기한이 있고 원문에서 확인된 후보가 폼에 먼저 올라온다', () => {
  const ranked = rankCandidates([
    { title: '내부 검토', evidenceVerified: false },
    { title: '자료 제출', evidenceVerified: true, due: { date: '2026-09-30', text: '9. 30.', yearInferred: true } },
    { title: '결과 보고', evidenceVerified: true },
  ]);
  expect(ranked.map(candidate => candidate.title)).toEqual(['자료 제출', '결과 보고', '내부 검토']);
});

it('목록 값으로 만든 초안에는 지어낸 값이 없다', () => {
  const due = { date: '2026-09-30', text: '9. 30.', yearInferred: true };
  const draft = draftFromDoc(doc({ dueDate: '2026-09-30', due }));
  expect(draft).toMatchObject({ title: '2026년 정산자료 제출 협조', date: '2026-09-30', notes: '', origin: 'list', evidence: '9. 30.' });
});

it('사용자가 날짜를 고치면 원문 표기와 연도 추정 표시가 따라오지 않는다', () => {
  const source = doc();
  const draft = { ...draftFromDoc(source), title: '정산자료 제출', date: '2026-10-05', time: '18:00',
    due: { date: '2026-09-30', text: '9. 30.', yearInferred: true }, notes: ' 메모 ' };
  const task = toNewTask(source, draft);
  expect(task.due).toEqual({ date: '2026-10-05', time: '18:00', text: '2026-10-05', yearInferred: false });
  expect(task).toMatchObject({ dueDate: '2026-10-05', notes: '메모', dedupeKey: 'inbox:k1', source: { docTitle: source.title } });
});

it('고치지 않은 기한은 공문에 적힌 표기를 그대로 남긴다', () => {
  const source = doc();
  const due = { date: '2026-09-30', text: '9. 30.(수)까지', yearInferred: true };
  const task = toNewTask(source, { ...draftFromDoc(source), title: '제출', date: '2026-09-30', time: '', due });
  expect(task.due).toEqual(due);
});

it('본문에서 뽑은 초안의 기준일은 오늘이 아니라 문서의 보고일자다', async () => {
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.(cardJson());
    return null;
  });
  const outcome = await draftTasksFromBody(doc(), PAGE, DEFAULT_SETTINGS);
  expect(outcome.summary).toBe('정산자료 제출 요청');
  expect(outcome.drafts[0]).toMatchObject({ title: '정산자료 제출', date: '2026-09-30', origin: 'model', evidenceVerified: true });
  expect(outcome.drafts[0]!.deliverables).toEqual(['정산자료']);
});

it('본문을 읽으면 원장의 열람 상태를 사실대로 바꾼다 — 되돌릴 수 없는 일이기 때문이다', async () => {
  const target = doc();
  await saveInboxDocs([target]);
  useInbox.setState({ docs: [target] });
  stubChrome({ type: 'DOCUMENT_READ', requestedTitle: target.title, payload: PAGE });
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.(cardJson());
    return null;
  });

  openTaskDraft(target);
  expect(useInbox.getState().draft).toMatchObject({ stage: 'confirm', readAt: null });
  await startTaskDraft(target, TAB, DEFAULT_SETTINGS);

  const session = useInbox.getState().draft!;
  expect(session.stage).toBe('ready');
  expect(session.readAt).not.toBeNull();
  expect(session.drafts[0]).toMatchObject({ title: '정산자료 제출', origin: 'model' });
  const stored = (await db.inboxDocs.get(target.key))!;
  expect(stored.readState).toBe('read');
  expect(stored.taskReadAt).toBeGreaterThan(0);
});

it('모델을 부르지 못해도 목록 값으로 폼을 채운다 — 이미 문서를 연 뒤다', async () => {
  const target = doc({ dueDate: '2026-09-30', due: { date: '2026-09-30', text: '9. 30.', yearInferred: true } });
  await saveInboxDocs([target]);
  useInbox.setState({ docs: [target] });
  stubChrome({ type: 'DOCUMENT_READ', requestedTitle: target.title, payload: PAGE });
  vi.spyOn(stream, 'streamChat').mockRejectedValue(new Error('Ollama가 실행 중이 아닙니다'));

  openTaskDraft(target);
  await startTaskDraft(target, TAB, DEFAULT_SETTINGS);

  const session = useInbox.getState().draft!;
  expect(session.stage).toBe('ready');
  expect(session.fallback).toBe(true);
  expect(session.fallbackReason).toContain('Ollama');
  expect(session.drafts[0]).toMatchObject({ title: target.title, date: '2026-09-30', origin: 'list' });
});

it('본문을 읽지 못하면 초안도 만들지 않고 이유를 남긴다', async () => {
  const target = doc();
  await saveInboxDocs([target]);
  useInbox.setState({ docs: [target] });
  stubChrome({ type: 'ERROR', error: { code: 'UNKNOWN', message: '현재 목록에서 요청한 문서를 찾을 수 없습니다.' } });

  openTaskDraft(target);
  await startTaskDraft(target, TAB, DEFAULT_SETTINGS);

  const session = useInbox.getState().draft!;
  expect(session.stage).toBe('failed');
  expect(session.readAt).toBeNull();
  expect(session.error?.message).toContain('찾을 수 없습니다');
  // 열지 못했으므로 열람 상태도 그대로다.
  expect((await db.inboxDocs.get(target.key))!.readState).toBe('unread');
});

it('등록은 사용자가 폼에서 누를 때만 일어나고, 문서에 그 일정이 붙는다', async () => {
  const target = doc();
  await saveInboxDocs([target]);
  useInbox.setState({ docs: [target] });
  stubChrome({ type: 'DOCUMENT_READ', requestedTitle: target.title, payload: PAGE });
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.(cardJson());
    return null;
  });

  openTaskDraft(target);
  await startTaskDraft(target, TAB, DEFAULT_SETTINGS);
  expect(await db.tasks.count()).toBe(0);

  const id = await registerTaskDraft(target);
  expect(id).toBeTruthy();
  expect((await db.tasks.get(id!))!.title).toBe('정산자료 제출');
  expect((await db.inboxDocs.get(target.key))!.taskId).toBe(id);
  // 폼은 닫힌다. 같은 문서를 두 번 등록할 자리가 남지 않는다.
  expect(useInbox.getState().draft).toBeNull();
});
