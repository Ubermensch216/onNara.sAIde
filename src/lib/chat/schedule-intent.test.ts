/**
 * `@일정` 실행 경로 테스트 (분류 → 계획 → 확인 → 저장).
 *
 * ★ 여기서 지키려는 것은 한 가지다 — **누르기 전에는 아무것도 저장되지 않는다.**
 *   모델이 무엇을 뱉든, 확인 카드를 거치지 않은 쓰기가 생기면 이 파일이 실패해야 한다.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createChatSession } from './store';
import { createChatSessions } from './sessions';
import * as storage from '@/lib/storage/db';
import * as stream from '@/lib/ollama/stream';
import * as client from '@/lib/ollama/client';
import { addTask, deleteAllTasks, listTasks, refreshTasks, useSchedule } from '@/lib/schedule/store';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import { parsePanelLink } from '@/lib/panel/links';

let useChat: ReturnType<typeof createChatSessions>;

/** 분류기가 이 JSON을 뱉었다고 둔다. */
function classifierReturns(json: unknown) {
  return vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.(JSON.stringify(json));
    return null;
  });
}

const answers = () => useChat.getState().messages.filter(message => message.role === 'assistant');
const lastAnswer = () => answers().at(-1)?.content ?? '';

beforeEach(async () => {
  await storage.deleteAllConversations();
  await deleteAllTasks();
  vi.spyOn(client, 'requireCapabilities').mockResolvedValue(undefined);
  useChat = createChatSessions(createChatSession);
  await useChat.getState().openForTab(1, 'https://onnara.test/list');
});

afterEach(() => {
  useChat.dispose();
  useSchedule.setState({ focus: null });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('조회는 확인 없이 바로 답하고, 저장소를 건드리지 않는다', async () => {
  await addTask({ title: '예산안 제출', status: 'todo', dueDate: '2026-09-20' });
  await addTask({ title: '지난 일', status: 'todo', dueDate: '2026-01-05' });
  classifierReturns({ intent: 'schedule.list', payload: { from: '2026-09-01', to: '2026-09-30' } });

  await useChat.getState().runSchedule('9월 일정 보여줘', DEFAULT_SETTINGS);

  expect(useChat.getState().pendingSchedule).toBeNull();
  expect(lastAnswer()).toContain('예산안 제출');
  expect(lastAnswer()).not.toContain('지난 일');
  expect(await listTasks()).toHaveLength(2);
});

/*
 * ★ 실행했다고 화면을 옮기지 않는다. 사용자는 지시한 자리에서 결과를 읽고 다음 지시를
 *   잇는 중이다. 갈지 말지는 답변 안의 링크를 누르는 사람이 정한다.
 */
it('★ 조회해도 화면을 옮기지 않고, 답변 안에 갈 길만 남긴다', async () => {
  await addTask({ title: '예산안 제출', status: 'todo', dueDate: '2026-09-20' });
  classifierReturns({ intent: 'schedule.list', payload: { from: '2026-09-01', to: '2026-09-30' } });

  await useChat.getState().runSchedule('9월 일정 보여줘', DEFAULT_SETTINGS);

  expect(useSchedule.getState().focus).toBeNull();
  expect(parsePanelLink(/\[일정 탭에서 보기\]\((.+?)\)/.exec(lastAnswer())![1]))
    .toEqual({ tab: 'schedule', cursor: '2026-09-01', mode: 'month' });
});

it('★ 등록은 카드에 걸릴 뿐, 누르기 전에는 저장되지 않는다', async () => {
  classifierReturns({ intent: 'schedule.create', payload: { title: '예산안 제출', date: '2026-09-20' } });

  await useChat.getState().runSchedule('내일까지 예산안 제출', DEFAULT_SETTINGS);

  expect(useChat.getState().pendingSchedule?.plan).toMatchObject({ kind: 'create' });
  expect(await listTasks()).toHaveLength(0);
  expect(useChat.getState().streaming).toBe(false);
});

it('취소하면 저장하지 않고 그 사실을 기록에 남긴다', async () => {
  classifierReturns({ intent: 'schedule.create', payload: { title: '예산안 제출', date: '2026-09-20' } });
  await useChat.getState().runSchedule('내일까지 예산안 제출', DEFAULT_SETTINGS);

  await useChat.getState().commitSchedule(null);

  expect(await listTasks()).toHaveLength(0);
  expect(useChat.getState().pendingSchedule).toBeNull();
  expect(lastAnswer()).toContain('등록하지 않았습니다');
});

it('확인하면 저장하고, 그 항목으로 가는 링크를 남긴다', async () => {
  classifierReturns({ intent: 'schedule.create', payload: { title: '예산안 제출', date: '2026-09-20', time: '18:00' } });
  await useChat.getState().runSchedule('내일 18시까지 예산안 제출', DEFAULT_SETTINGS);

  await useChat.getState().commitSchedule([0]);

  const saved = await listTasks();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ title: '예산안 제출', dueDate: '2026-09-20', status: 'todo' });
  // 사용자가 친 문장을 기한 표기로 남긴다.
  expect(saved[0]!.due).toMatchObject({ time: '18:00', text: '내일 18시까지 예산안 제출', yearInferred: false });
  expect(saved[0]!.dedupeKey).toBeUndefined();
  expect(lastAnswer()).toContain('1건을 등록했습니다');
  // 화면은 그대로 두고 길만 놓는다.
  expect(useSchedule.getState().focus).toBeNull();
  expect(parsePanelLink(/\]\((.+?)\)/.exec(lastAnswer())![1]))
    .toEqual({ tab: 'schedule', taskId: saved[0]!.id });
});

it('★ 여럿이 걸린 삭제는 고른 것만 지운다', async () => {
  const keep = await addTask({ title: '실적보고서 검토', status: 'todo', dueDate: '2026-10-05' });
  const drop = await addTask({ title: '실적보고서 제출', status: 'todo', dueDate: '2026-09-30' });
  await refreshTasks();
  classifierReturns({ intent: 'schedule.delete', payload: { matchTitle: '실적보고서' } });

  await useChat.getState().runSchedule('실적보고서 지워줘', DEFAULT_SETTINGS);

  const pending = useChat.getState().pendingSchedule?.plan;
  expect(pending).toMatchObject({ kind: 'delete' });
  // 둘이 걸렸으므로 하나도 미리 체크돼 있지 않다.
  if (pending?.kind !== 'delete') throw new Error('delete여야 한다');
  expect(pending.targets).toHaveLength(2);
  expect(pending.preselected).toEqual([]);

  await useChat.getState().commitSchedule([drop]);

  expect((await listTasks()).map(task => task.id)).toEqual([keep]);
  expect(lastAnswer()).toContain('실적보고서 제출');
});

it('완료 표시는 완료 시각까지 남긴다', async () => {
  const id = await addTask({ title: '예산안 제출', status: 'todo', dueDate: '2026-09-20' });
  await refreshTasks();
  classifierReturns({ intent: 'schedule.update', payload: { matchTitle: '예산안', changes: { done: true } } });

  await useChat.getState().runSchedule('예산안 제출 완료했어', DEFAULT_SETTINGS);
  await useChat.getState().commitSchedule([id]);

  const [saved] = await listTasks();
  expect(saved).toMatchObject({ status: 'done' });
  expect(saved!.completedAt).toBeGreaterThan(0);
});

it('★ 대상을 말하지 않은 삭제는 계획조차 세우지 않는다', async () => {
  await addTask({ title: '예산안 제출', status: 'todo', dueDate: '2026-09-20' });
  await refreshTasks();
  // 모델이 "전부 지워"로 읽어 버린 경우.
  classifierReturns({ intent: 'schedule.delete', payload: {} });

  await useChat.getState().runSchedule('지워줘', DEFAULT_SETTINGS);

  expect(useChat.getState().pendingSchedule).toBeNull();
  expect(await listTasks()).toHaveLength(1);
  expect(lastAnswer()).toContain('일정 명령으로 이해하지 못했습니다');
});

it('분류에 실패하면 예문을 보여 주고 아무것도 하지 않는다', async () => {
  vi.spyOn(stream, 'streamChat').mockImplementation(async (_endpoint, _request, handlers) => {
    handlers.onToken?.('무슨 말씀이신지 모르겠습니다');
    return null;
  });

  await useChat.getState().runSchedule('음', DEFAULT_SETTINGS);

  expect(useChat.getState().pendingSchedule).toBeNull();
  expect(lastAnswer()).toContain('@일정 내일까지');
  expect(useChat.getState().error).toBeNull();
});

it('★ 분류기에는 이 한 문장만 보낸다 (공문 대화 문맥을 섞지 않는다)', async () => {
  const spy = classifierReturns({ intent: 'schedule.list', payload: {} });
  await useChat.getState().runSchedule('일정 보여줘', DEFAULT_SETTINGS);

  const request = spy.mock.calls.at(-1)![1];
  expect(request.messages).toHaveLength(2);
  expect(request.messages[0]!.role).toBe('system');
  expect(request.messages[1]).toEqual({ role: 'user', content: '일정 보여줘' });
  // 분류는 사실 판정이다. 같은 문장이 매번 같은 의도로 읽혀야 한다.
  expect(request.options?.temperature).toBe(0);
  expect(request.format).toBeTruthy();
});

it('새 지시는 앞서 걸어 둔 계획을 대신한다', async () => {
  classifierReturns({ intent: 'schedule.create', payload: { title: '첫 번째', date: '2026-09-20' } });
  await useChat.getState().runSchedule('첫 번째 등록', DEFAULT_SETTINGS);
  expect(useChat.getState().pendingSchedule?.typed).toBe('첫 번째 등록');

  classifierReturns({ intent: 'schedule.create', payload: { title: '두 번째', date: '2026-09-21' } });
  await useChat.getState().runSchedule('두 번째 등록', DEFAULT_SETTINGS);

  expect(useChat.getState().pendingSchedule?.typed).toBe('두 번째 등록');
  await useChat.getState().commitSchedule([0]);
  expect((await listTasks()).map(task => task.title)).toEqual(['두 번째']);
});
