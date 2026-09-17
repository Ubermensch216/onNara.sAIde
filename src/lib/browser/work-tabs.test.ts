import { afterEach, expect, it, vi } from 'vitest';
import { duplicateWorkTab, panelTab, workTabs } from './work-tabs';

afterEach(() => { workTabs.clear(); vi.unstubAllGlobals(); });

it('duplicate 응답보다 먼저 발생한 활성화 이벤트도 패널에 전달하지 않는다', async () => {
  let finish!: (tab: chrome.tabs.Tab) => void;
  vi.stubGlobal('chrome', { tabs: {
    duplicate: vi.fn(() => new Promise(resolve => { finish = resolve; })),
    get: vi.fn(async (id: number) => ({ id, active: true })),
  } });
  const duplicate = duplicateWorkTab(1);
  const activation = panelTab(20);
  finish({ id: 20 } as chrome.tabs.Tab);
  await duplicate;
  expect(await activation).toBeNull();
  expect(await panelTab(1)).toMatchObject({ id: 1 });
});

it('임시 탭의 팝업은 무시하고 사용자가 연 다른 탭은 전달한다', async () => {
  workTabs.add(20);
  vi.stubGlobal('chrome', { tabs: {
    get: vi.fn(async (id: number) => ({ id, openerTabId: id === 21 ? 20 : 1 })),
  } });
  expect(await panelTab(21)).toBeNull();
  expect(await panelTab(30)).toMatchObject({ id: 30 });
});

it('복제가 실패해도 탭 이벤트 처리를 재개한다', async () => {
  vi.stubGlobal('chrome', { tabs: {
    duplicate: vi.fn(async () => { throw new Error('duplicate failed'); }),
    get: vi.fn(async (id: number) => ({ id })),
  } });
  await expect(duplicateWorkTab(1)).rejects.toThrow('duplicate failed');
  expect(await panelTab(1)).toMatchObject({ id: 1 });
});
