import { beforeEach, expect, it, vi } from 'vitest';
import { clearHandoff, HANDOFF_TTL_MS, loadHandoff, onHandoffChanged, sendHandoff, WORK_PLAN_HANDOFF_KEY } from './work-plan-handoff';
import type { WorkPlanHandoff } from '@/lib/ai/work-plan';

let store: Record<string, unknown>;
let listeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>;

beforeEach(() => {
  store = {};
  listeners = [];
  vi.stubGlobal('chrome', { storage: {
    local: {
      get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          const oldValue = store[key];
          store[key] = value;
          for (const listener of listeners) listener({ [key]: { oldValue, newValue: value } }, 'local');
        }
      }),
      remove: vi.fn(async (key: string) => { delete store[key]; }),
    },
    onChanged: {
      addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
      removeListener: (listener: (typeof listeners)[number]) => { listeners = listeners.filter(item => item !== listener); },
    },
  } });
});

const handoff: WorkPlanHandoff = {
  source: { title: '수요조사 회신 요청' },
  requestType: '회신·제출',
  summary: '요지',
  requirements: [{ text: '별지 제2호 서식', verified: true }],
  deliverables: [],
  deadlines: [],
  conditions: [],
};

it('보낸 묶음을 읽고, 새로 보내면 앞의 것을 대신한다', async () => {
  await sendHandoff(handoff, 1_000);
  await sendHandoff({ ...handoff, summary: '새 요지' }, 2_000);
  expect(await loadHandoff(3_000)).toMatchObject({ summary: '새 요지', sentAt: 2_000 });
});

it('사흘이 지난 묶음은 읽지 않고 지운다', async () => {
  await sendHandoff(handoff, 0);
  expect(await loadHandoff(HANDOFF_TTL_MS + 1)).toBeNull();
  expect(store[WORK_PLAN_HANDOFF_KEY]).toBeUndefined();
});

it('형식이 어긋난 값은 없는 것으로 본다', async () => {
  store[WORK_PLAN_HANDOFF_KEY] = { sentAt: Date.now(), source: {} };
  expect(await loadHandoff()).toBeNull();
});

it('열려 있는 드로어는 새로 보낸 묶음을 곧바로 받는다', async () => {
  const seen: Array<string | null> = [];
  const stop = onHandoffChanged(value => seen.push(value?.summary ?? null));
  await sendHandoff(handoff);
  stop();
  await sendHandoff({ ...handoff, summary: '안 받음' });
  expect(seen).toEqual(['요지']);
  await clearHandoff();
  expect(await loadHandoff()).toBeNull();
});
