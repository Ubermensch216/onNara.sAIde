import { afterEach, expect, it } from 'vitest';
import { decideTabChange, forgetPanelSpawn, isReportedPanelTab, notePanelSpawn, panelOpener, rememberPanelTab, resetPanelSpawns } from './panel-sync';
import type { TabSummary } from '@/lib/messaging/protocol';

afterEach(() => resetPanelSpawns());

const summary = (tab: Partial<TabSummary> & { tabId: number; url: string }): TabSummary => ({
  title: '', active: true, ...tab,
});

const list = summary({ tabId: 1, url: 'https://onnara.test/list', windowId: 10 });

it('다른 창에서 일어난 탭 전환은 패널을 흔들지 않는다', () => {
  const other = summary({ tabId: 5, url: 'https://news.test/article', windowId: 99 });
  expect(decideTabChange({ windowId: 10, tab: list }, other)).toBe('ignore');
});

it('목록 탭이 새 창으로 띄운 문서 팝업은 대화를 유지한 채 따라간다', () => {
  const popup = summary({ tabId: 7, url: 'https://onnara.test/doc/123', windowId: 42, openedFrom: 1 });
  expect(decideTabChange({ windowId: 10, tab: list }, popup)).toBe('follow');
});

it('문서 팝업을 닫고 목록 탭으로 돌아와도 대화를 새로 열지 않는다', () => {
  const popup = summary({ tabId: 7, url: 'https://onnara.test/doc/123', windowId: 42, openedFrom: 1 });
  expect(decideTabChange({ windowId: 10, tab: popup }, list)).toBe('follow');
});

it('팝업 체인(문서 → 첨부 뷰어)도 한 단계씩 이어서 따라간다', () => {
  const popup = summary({ tabId: 7, url: 'https://onnara.test/doc/123', windowId: 42, openedFrom: 1 });
  const viewer = summary({ tabId: 8, url: 'https://onnara.test/viewer', windowId: 43, openedFrom: 7 });
  expect(decideTabChange({ windowId: 10, tab: popup }, viewer)).toBe('follow');
});

it('출처가 같아도 주소가 다른 사이트면 따라가지 않는다', () => {
  const external = summary({ tabId: 7, url: 'https://other.test/doc', windowId: 42, openedFrom: 1 });
  expect(decideTabChange({ windowId: 10, tab: list }, external)).toBe('ignore');
});

it('같은 창에서 다른 문서로 옮기면 그 문서의 대화로 갈아끼운다', () => {
  const another = summary({ tabId: 2, url: 'https://onnara.test/other', windowId: 10 });
  expect(decideTabChange({ windowId: 10, tab: list }, another)).toBe('switch');
});

it('같은 탭·같은 문서의 반복 이벤트는 요약만 갱신한다', () => {
  const again = summary({ tabId: 1, url: 'https://onnara.test/list#top', windowId: 10 });
  expect(decideTabChange({ windowId: 10, tab: list }, again)).toBe('follow');
});

it('같은 탭이 다른 주소로 이동하면 갈아끼운다', () => {
  const moved = summary({ tabId: 1, url: 'https://onnara.test/other', windowId: 10 });
  expect(decideTabChange({ windowId: 10, tab: list }, moved)).toBe('switch');
});

it('창을 아직 모르거나 상대 창을 모르면 창 조건으로 무시하지 않는다', () => {
  const unknown = summary({ tabId: 5, url: 'https://onnara.test/other' });
  expect(decideTabChange({ windowId: null, tab: list }, unknown)).toBe('switch');
  expect(decideTabChange({ windowId: 10, tab: list }, unknown)).toBe('switch');
});

it('새 창 팝업의 출처는 webNavigation 기록으로 찾고, 탭이 닫히면 잊는다', () => {
  notePanelSpawn({ sourceTabId: 1, tabId: 7 });
  notePanelSpawn({ sourceTabId: 7, tabId: 8 });
  expect(panelOpener(7)).toBe(1);
  expect(panelOpener(8)).toBe(7);
  forgetPanelSpawn(7);
  expect(panelOpener(7)).toBeUndefined();
  // 부모가 사라지면 그 아래 팝업 기록도 남기지 않는다.
  expect(panelOpener(8)).toBeUndefined();
});

it('팝업 기록이 무한히 쌓이지 않는다', () => {
  for (let tabId = 0; tabId < 500; tabId++) notePanelSpawn({ sourceTabId: 1, tabId });
  expect(panelOpener(499)).toBe(1);
  expect(panelOpener(0)).toBeUndefined();
});

it('화면 변화 알림은 패널이 보고 있는 탭에만 보낸다', () => {
  // 아직 아무것도 모르면(워커가 방금 깨어난 경우) 거르지 않는다.
  expect(isReportedPanelTab(3)).toBe(true);

  rememberPanelTab({ tabId: 1, windowId: 10 });
  expect(isReportedPanelTab(1)).toBe(true);
  expect(isReportedPanelTab(3)).toBe(false);

  // 창마다 따로 본다. 두 창에서 각각 패널을 열어도 서로를 지우지 않는다.
  rememberPanelTab({ tabId: 4, windowId: 20 });
  expect(isReportedPanelTab(1)).toBe(true);
  expect(isReportedPanelTab(4)).toBe(true);

  forgetPanelSpawn(1);
  expect(isReportedPanelTab(1)).toBe(false);
});
