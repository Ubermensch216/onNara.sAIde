import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/storage/db';
import { addTask, setTaskDone } from './store';
import { ALERT_STATE_KEY, alertText, digestCount, dueSoon, maybeNotify } from './alerts';
import type { ScheduleTask } from './task';

const NOW = new Date(2026, 8, 18, 10, 0); // 2026-09-18 10:00

function task(patch: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id: 1, title: '할 일', status: 'todo', dueDate: '', createdAt: 1, updatedAt: 1, ...patch };
}

describe('dueSoon', () => {
  const tasks = [
    task({ id: 1, title: '지난 제출', dueDate: '2026-09-16' }),
    task({ id: 2, title: '오늘 회신', dueDate: '2026-09-18' }),
    task({ id: 3, title: '내일 보고', dueDate: '2026-09-19' }),
    task({ id: 4, title: '이번 주 후반', dueDate: '2026-09-23' }),
    task({ id: 5, title: '기한 없음' }),
    task({ id: 6, title: '끝난 일', dueDate: '2026-09-18', status: 'done' }),
  ];

  it('★ 지난 기한·오늘·내일만 알린다 — 이번 주까지 넣으면 같은 항목을 이레 내리 알린다', () => {
    const digest = dueSoon(tasks, NOW);
    expect(digest.overdue.map(item => item.id)).toEqual([1]);
    expect(digest.today.map(item => item.id)).toEqual([2]);
    expect(digest.tomorrow.map(item => item.id)).toEqual([3]);
    expect(digestCount(digest)).toBe(3);
  });

  it('완료했거나 기한이 없는 항목은 알리지 않는다', () => {
    const digest = dueSoon(tasks, NOW);
    const ids = [...digest.overdue, ...digest.today, ...digest.tomorrow].map(item => item.id);
    expect(ids).not.toContain(5);
    expect(ids).not.toContain(6);
  });
});

describe('alertText', () => {
  it('건수와 함께 급한 항목의 제목을 보여 준다', () => {
    const text = alertText(dueSoon([
      task({ id: 1, title: '지난 제출', dueDate: '2026-09-16' }),
      task({ id: 2, title: '오늘 회신', dueDate: '2026-09-18' }),
    ], NOW))!;
    expect(text.title).toBe('기한 임박 2건');
    expect(text.message).toBe('지남 1건 · 오늘 1건\n· 지난 제출\n· 오늘 회신');
  });

  it('알릴 것이 없으면 null', () => {
    expect(alertText(dueSoon([task({ dueDate: '2026-12-01' })], NOW))).toBeNull();
  });
});

describe('maybeNotify', () => {
  let stored: Record<string, unknown>;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await db.tasks.clear();
    stored = { 'saide.settings': { taskAlerts: true, taskAlertHour: 9 } };
    create = vi.fn(async () => 'id');
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})),
          set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(stored, patch); }),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      notifications: { create },
      runtime: { getURL: (path: string) => `chrome-extension://x/${path}` },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('기한이 임박한 항목이 있으면 알리고, 알린 날짜를 남긴다', async () => {
    await addTask({ title: '계획서 제출', status: 'todo', dueDate: '', due: { date: '2026-09-18', text: '9. 18.', yearInferred: false } });

    expect(await maybeNotify(NOW)).toBe(true);
    expect(create.mock.calls[0]![1]).toMatchObject({ title: '기한 임박 1건' });
    expect(stored[ALERT_STATE_KEY]).toBe('2026-09-18');
  });

  it('★ 하루에 한 번만 알린다', async () => {
    await addTask({ title: '계획서 제출', status: 'todo', dueDate: '', due: { date: '2026-09-18', text: '9. 18.', yearInferred: false } });
    await maybeNotify(NOW);
    expect(await maybeNotify(new Date(2026, 8, 18, 17, 0))).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);

    // 다음 날이 되면 다시 알린다.
    await addTask({ title: '회신', status: 'todo', dueDate: '', due: { date: '2026-09-19', text: '9. 19.', yearInferred: false } });
    expect(await maybeNotify(new Date(2026, 8, 19, 9, 30))).toBe(true);
  });

  it('정해진 시각 전에는 알리지 않는다', async () => {
    await addTask({ title: '계획서 제출', status: 'todo', dueDate: '', due: { date: '2026-09-18', text: '9. 18.', yearInferred: false } });
    expect(await maybeNotify(new Date(2026, 8, 18, 7, 0))).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('설정에서 끄면 알리지 않는다', async () => {
    stored['saide.settings'] = { taskAlerts: false };
    await addTask({ title: '계획서 제출', status: 'todo', dueDate: '', due: { date: '2026-09-18', text: '9. 18.', yearInferred: false } });
    expect(await maybeNotify(NOW)).toBe(false);
  });

  it('★ 알릴 것이 없는 날은 표시를 남기지 않는다 — 오후에 생긴 기한도 그날 알려야 한다', async () => {
    expect(await maybeNotify(NOW)).toBe(false);
    expect(stored[ALERT_STATE_KEY]).toBeUndefined();

    await addTask({ title: '급히 생긴 일', status: 'todo', dueDate: '', due: { date: '2026-09-18', text: '9. 18.', yearInferred: false } });
    expect(await maybeNotify(new Date(2026, 8, 18, 15, 0))).toBe(true);
  });

  it('완료한 항목만 남으면 알리지 않는다', async () => {
    const id = await addTask({ title: '계획서 제출', status: 'todo', dueDate: '', due: { date: '2026-09-18', text: '9. 18.', yearInferred: false } });
    await setTaskDone(id, true);
    expect(await maybeNotify(NOW)).toBe(false);
  });
});
