import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/storage/db';
import { addTask, addTasks, clearDoneTasks, deleteTask, listTasks, setTaskDone, updateTask } from './store';
import { dedupeKeyOf, type NewScheduleTask } from './task';

function input(patch: Partial<NewScheduleTask> = {}): NewScheduleTask {
  return { title: '계획서 제출', status: 'todo', dueDate: '', ...patch };
}

beforeEach(async () => {
  await db.tasks.clear();
});

describe('addTask', () => {
  it('기한을 넣으면 색인 필드가 함께 채워진다', async () => {
    const id = await addTask(input({ due: { date: '2026-09-30', text: '9. 30.', yearInferred: true } }));
    expect((await db.tasks.get(id))?.dueDate).toBe('2026-09-30');
  });

  it('★ 기한이 없으면 빈 문자열이다 — undefined면 색인에서 빠져 조회되지 않는다', async () => {
    const id = await addTask(input());
    expect((await db.tasks.get(id))?.dueDate).toBe('');
  });
});

describe('addTasks', () => {
  it('★ 같은 공문을 다시 분석해도 같은 할 일이 두 번 쌓이지 않는다', async () => {
    const key = dedupeKeyOf('공모전 안내', '계획서 제출');
    const first = await addTasks([input({ dedupeKey: key })]);
    expect(first.added).toHaveLength(1);

    const second = await addTasks([input({ dedupeKey: key })]);
    expect(second).toEqual({ added: [], skipped: 1 });
    expect(await db.tasks.count()).toBe(1);
  });

  it('★ 이미 있는 항목을 덮어쓰지 않는다 — 사용자가 적어 둔 메모가 사라지면 안 된다', async () => {
    const key = dedupeKeyOf('공모전 안내', '계획서 제출');
    const id = await addTask(input({ dedupeKey: key, notes: '담당자와 통화함' }));
    await addTasks([input({ dedupeKey: key, notes: '' })]);
    expect((await db.tasks.get(id))?.notes).toBe('담당자와 통화함');
  });

  it('한 번에 보낸 목록 안의 중복도 한 건만 등록한다', async () => {
    const key = dedupeKeyOf('공문', '제출');
    const result = await addTasks([input({ dedupeKey: key }), input({ dedupeKey: key })]);
    expect(result.added).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(await db.tasks.count()).toBe(1);
  });

  it('직접 만든 항목(중복 키 없음)은 같은 제목이어도 따로 등록된다', async () => {
    await addTasks([input(), input()]);
    expect(await db.tasks.count()).toBe(2);
  });
});

describe('updateTask', () => {
  it('기한을 고치면 색인 필드도 따라 바뀐다', async () => {
    const id = await addTask(input({ due: { date: '2026-09-30', text: '9. 30.', yearInferred: true } }));
    await updateTask(id, { due: { date: '2026-10-05', text: '10. 5.', yearInferred: false } });
    expect((await db.tasks.get(id))?.dueDate).toBe('2026-10-05');
  });

  it('기한을 지우면 기한 미정으로 돌아간다', async () => {
    const id = await addTask(input({ due: { date: '2026-09-30', text: '9. 30.', yearInferred: true } }));
    await updateTask(id, { due: undefined });
    expect((await db.tasks.get(id))?.dueDate).toBe('');
  });
});

describe('setTaskDone', () => {
  it('완료하면 완료 시각이 남고, 되돌리면 지워진다', async () => {
    const id = await addTask(input());
    await setTaskDone(id, true);
    expect((await db.tasks.get(id))?.completedAt).toBeTypeOf('number');

    await setTaskDone(id, false);
    const task = await db.tasks.get(id);
    expect(task?.status).toBe('todo');
    expect(task?.completedAt).toBeUndefined();
  });
});

describe('삭제', () => {
  it('완료한 항목만 비운다', async () => {
    const done = await addTask(input());
    await addTask(input({ title: '남을 항목' }));
    await setTaskDone(done, true);

    expect(await clearDoneTasks()).toBe(1);
    expect((await listTasks()).map(task => task.title)).toEqual(['남을 항목']);
  });

  it('한 건 삭제', async () => {
    const id = await addTask(input());
    await deleteTask(id);
    expect(await db.tasks.count()).toBe(0);
  });
});

describe('listTasks', () => {
  it('급한 순서로 준다', async () => {
    await addTask(input({ title: '기한 없음' }));
    await addTask(input({ title: '이달 말', due: { date: '2026-09-30', text: '9. 30.', yearInferred: false } }));
    await addTask(input({ title: '내일', due: { date: '2026-09-19', text: '9. 19.', yearInferred: false } }));
    expect((await listTasks()).map(task => task.title)).toEqual(['내일', '이달 말', '기한 없음']);
  });
});
