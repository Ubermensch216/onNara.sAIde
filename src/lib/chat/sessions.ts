import { create } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { ChatState } from './store';
import { db, type Conversation } from '@/lib/storage/db';
import { sameDocument } from '@/lib/messaging/protocol';

/** The panel displays one session; hidden sessions keep their own async work. */
export function createChatSessions(makeSession: () => StoreApi<ChatState>) {
  type Session = { tabId: number; url: string; store: StoreApi<ChatState>; ready: Promise<void> };
  const sessions: Session[] = [];
  let active = makeSession();
  let unsubscribe = () => {};
  let selection = 0;

  // Stable actions are necessary for event listeners installed when the panel mounts.
  const actions = {
    openForTab,
    openConversation,
    attachPage: (...args: Parameters<ChatState['attachPage']>) => active.getState().attachPage(...args),
    attachScreenshot: (...args: Parameters<ChatState['attachScreenshot']>) => active.getState().attachScreenshot(...args),
    detachPage: () => active.getState().detachPage(),
    detachScreenshot: () => active.getState().detachScreenshot(),
    send: (...args: Parameters<ChatState['send']>) => active.getState().send(...args),
    sendAgent: (...args: Parameters<ChatState['sendAgent']>) => active.getState().sendAgent(...args),
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
    const cached = sessions.find(s => s.tabId === tabId && sameDocument(s.url, url));
    const reusable = cached && await valid(cached);
    if (request !== selection) return;
    if (reusable) {
      show(cached.store);
      await cached.ready;
      return;
    }
    const store = makeSession();
    const session = { tabId, url, store, ready: store.getState().openForTab(tabId, url) };
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
    const session = { tabId: conversation.tabId, url: conversation.originUrl, store,
      ready: store.getState().openConversation(conversation) };
    sessions.unshift(session);
    show(store);
    await session.ready;
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
