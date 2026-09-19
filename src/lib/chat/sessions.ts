import { create } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { ChatState } from './store';
import { db, type Conversation } from '@/lib/storage/db';
import { sameDocument } from '@/lib/messaging/protocol';

/** The panel displays one session; hidden sessions keep their own async work. */
export function createChatSessions(makeSession: () => StoreApi<ChatState>) {
  /**
   * tabIds: 이 세션이 거쳐 온 탭들.
   *
   * ★ 문서 팝업을 따라가면 대상 탭이 바뀐다. 그때 원래 목록 탭을 잊으면,
   *   목록으로 돌아왔을 때 같은 대화를 찾지 못해 빈 대화가 새로 열린다.
   */
  type Session = { tabIds: number[]; url: string; store: StoreApi<ChatState>; ready: Promise<void> };
  const sessions: Session[] = [];
  let active = makeSession();
  let unsubscribe = () => {};
  let selection = 0;

  /**
   * 화면에 보일 세션을 고르는 중인지 알려 주는 약속.
   *
   * ★ 문서를 바꾸면 패널은 세션 선택을 기다리지 않고 다음 동작을 받는다. 저장소 조회가 끝나기 전에
   *   보낸 요청을 그대로 실행하면 직전 세션(화면에서 사라진 대화)으로 들어가, 사용자에게는
   *   "지시를 무시했다"로 보인다. 선택이 끝난 뒤 지금 보이는 세션에서 실행한다.
   */
  let switching: Promise<void> = Promise.resolve();
  function remember(work: Promise<void>): Promise<void> {
    switching = work.then(() => undefined, () => undefined);
    return work;
  }
  /**
   * 세션 선택이 끝나기를 기다린다.
   *
   * ★ 새 입력을 보내는 send 계열에만 쓴다. 첨부·삭제·초기화는 사용자가 지금 보고 누른 세션에서
   *   바로 실행해야 한다 — 기다리는 사이 세션이 바뀌면 엉뚱한 대화에 적용된다.
   */
  async function settled(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = switching;
      await current;
      if (switching === current) return;
    }
  }

  // Stable actions are necessary for event listeners installed when the panel mounts.
  const actions = {
    openForTab: (...args: Parameters<ChatState['openForTab']>) => remember(openForTab(...args)),
    openConversation: (...args: Parameters<ChatState['openConversation']>) => remember(openConversation(...args)),
    /**
     * 문서 팝업으로 대상 탭만 옮긴다. 세션은 그대로 두되, 그 세션이 기억하는 탭도 함께 옮긴다 —
     * 다시 목록 탭으로 돌아왔을 때 같은 세션을 찾을 수 있어야 한다.
     */
    followTab: async (tabId: number, url: string) => {
      const session = sessions.find(item => item.store === active);
      if (session && !session.tabIds.includes(tabId)) session.tabIds.push(tabId);
      await active.getState().followTab(tabId, url);
    },
    /** 화면 변화는 지금 보고 있는 세션에만 적용한다. 숨은 세션은 다시 열릴 때 제 화면을 다시 읽는다. */
    noteScreenChange: (frameId: number) => active.getState().noteScreenChange(frameId),
    attachPage: (...args: Parameters<ChatState['attachPage']>) => active.getState().attachPage(...args),
    attachScreenshot: (...args: Parameters<ChatState['attachScreenshot']>) => active.getState().attachScreenshot(...args),
    detachPage: () => active.getState().detachPage(),
    detachScreenshot: () => active.getState().detachScreenshot(),
    send: async (...args: Parameters<ChatState['send']>) => { await settled(); return active.getState().send(...args); },
    runCommand: async (...args: Parameters<ChatState['runCommand']>) => { await settled(); return active.getState().runCommand(...args); },
    sendAgent: async (...args: Parameters<ChatState['sendAgent']>) => { await settled(); return active.getState().sendAgent(...args); },
    resolveApproval: (approved: boolean) => active.getState().resolveApproval(approved),
    regenerate: (...args: Parameters<ChatState['regenerate']>) => active.getState().regenerate(...args),
    removeMessage: (id: Parameters<ChatState['removeMessage']>[0]) => active.getState().removeMessage(id),
    resetConversation: () => active.getState().resetConversation(),
    stop: () => active.getState().stop(),
    setError: (...args: Parameters<ChatState['setError']>) => active.getState().setError(...args),
    clearError: () => active.getState().clearError(),
  };
  const view = create<ChatState>(() => ({ ...active.getState(), ...actions }));

  function show(store: StoreApi<ChatState>) {
    unsubscribe();
    active = store;
    const index = sessions.findIndex(session => session.store === store);
    if (index > 0) sessions.unshift(sessions.splice(index, 1)[0]!);
    const publish = () => view.setState({ ...store.getState(), ...actions });
    unsubscribe = store.subscribe(publish);
    publish();
  }

  async function valid(session: Session): Promise<boolean> {
    const conversation = session.store.getState().conversation;
    if (!conversation || await db.conversations.get(conversation.id)) return true;
    forgetConversation(conversation.id);
    return false;
  }

  async function openForTab(tabId: number, url: string) {
    const request = ++selection;
    const cached = sessions.find(s => s.tabIds.includes(tabId) && sameDocument(s.url, url));
    const reusable = cached && await valid(cached);
    if (request !== selection) return;
    if (reusable) {
      show(cached.store);
      await cached.ready;
      return;
    }
    const store = makeSession();
    const session = { tabIds: [tabId], url, store, ready: store.getState().openForTab(tabId, url) };
    sessions.push(session);
    show(store);
    await session.ready;
  }

  async function openConversation(conversation: Conversation) {
    const request = ++selection;
    const cached = sessions.find(s => s.store.getState().conversation?.id === conversation.id);
    const reusable = cached && await valid(cached);
    if (request !== selection) return;
    if (reusable) {
      show(cached.store);
      await cached.ready;
      return;
    }
    // A history selection also becomes the session restored for this document.
    const store = makeSession();
    store.setState({ currentUrl: conversation.originUrl });
    const session = { tabIds: [conversation.tabId], url: conversation.originUrl, store,
      ready: store.getState().openConversation(conversation) };
    sessions.unshift(session);
    show(store);
    await session.ready;
  }

  /** 저장소에서 제목을 바꾼 뒤, 그 대화를 들고 있는 세션의 화면 표시도 맞춘다. */
  function renameConversation(id: number, title: string) {
    for (const { store } of sessions) {
      const conversation = store.getState().conversation;
      if (conversation?.id === id) store.setState({ conversation: { ...conversation, title } });
    }
  }

  function forgetConversation(id: number) {
    for (let index = sessions.length - 1; index >= 0; index--) {
      const session = sessions[index]!;
      if (session.store.getState().conversation?.id !== id) continue;
      session.store.getState().stop();
      // Invalidate pending extraction callbacks as well as generation callbacks.
      session.store.getState().detachPage();
      sessions.splice(index, 1);
      if (active === session.store) show(makeSession());
    }
  }

  show(active);
  return Object.assign(view, {
    forgetConversation,
    renameConversation,
    isBusy: () => sessions.some(({ store }) => store.getState().streaming || store.getState().extracting),
    dispose: () => {
      ++selection;
      unsubscribe();
      for (const { store } of sessions) {
        store.getState().stop();
        store.getState().detachPage();
      }
      sessions.length = 0;
    },
  });
}
