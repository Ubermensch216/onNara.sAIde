/**
 * 대화 영속화 — Dexie(IndexedDB). 계획서 §4.3 / Phase 2-4
 *
 * 설정은 chrome.storage.local(settings.ts), 대화는 여기다. 대화는 양이
 * 커지고 인덱스 조회가 필요하므로 IndexedDB가 맞다.
 */

import Dexie, { type EntityTable } from 'dexie';
import type { PerfSample } from '@/types/ollama';
import type { AgentStep } from '@/lib/agent/loop';
import { sameDocument } from '@/lib/messaging/protocol';

export interface Conversation {
  id: number;
  /** ★ 탭별 세션 분리(Phase 2-5)의 키. -1이면 탭에 묶이지 않은 대화. */
  tabId: number;
  title: string;
  /** 이 대화가 시작된 페이지. 탭이 다른 곳으로 이동하면 새 대화를 연다. */
  originUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 모델의 추론 텍스트. 접이식으로 보여주고, 다음 턴 컨텍스트에는 넣지 않는다. */
  thinking?: string;
  /** 페이지 본문을 절단했을 때의 고지. 메시지에 붙여 영구 보존한다. */
  notice?: string;
  /** 성능 계측. 계획서 §6 목표 대조와 Phase 7-1 대시보드에 쓴다. */
  perf?: PerfSample;
  /** 생성이 중단되었는가 */
  aborted?: boolean;
  error?: string;
  /**
   * Phase 5. 에이전트가 실제로 무엇을 했는지의 기록.
   *
   * ★ 저장하는 이유는 감사(監査)다. 승인해서 클릭·입력이 일어난 대화라면,
   *   나중에 "무엇을 눌렀는지"를 사용자가 되짚을 수 있어야 한다.
   *   스키마 버전을 올리지 않아도 되는 비인덱스 필드다.
   */
  steps?: AgentStep[];
  createdAt: number;
}

class SaideDB extends Dexie {
  conversations!: EntityTable<Conversation, 'id'>;
  messages!: EntityTable<StoredMessage, 'id'>;

  constructor() {
    super('saide');
    this.version(1).stores({
      conversations: '++id, tabId, createdAt, updatedAt, title',
      messages: '++id, conversationId, createdAt',
      // Phase 6 (선택) — bge-m3 임베딩 1024-dim
      pageVectors: '++id, url, visitedAt',
    });
    this.version(2).stores({ memoryControl: 'id' });
  }
}

export const db = new SaideDB();

/* ── 대화 ──────────────────────────────────────────────── */

export async function createConversation(
  tabId: number,
  originUrl: string,
  title = '새 대화',
): Promise<number> {
  const now = Date.now();
  return db.conversations.add({ tabId, originUrl, title, createdAt: now, updatedAt: now });
}

/**
 * 해당 탭의 이어갈 만한 대화를 찾는다. **없으면 만들지 않고 null을 준다.**
 *
 * ★ 여기서 대화를 만들면 안 된다.
 *   사이드패널은 탭이 열릴 때마다 함께 열리므로, 열자마자 레코드를 만들면
 *   말 한마디 오가지 않은 빈 대화방이 탭 수만큼 쌓인다. 실제 저장은 첫
 *   메시지를 보내는 순간에만 한다(store.ts의 ensureConversation).
 *
 * ★ 이어가는 조건은 **같은 문서**다. 호스트가 아니다.
 *
 *   호스트로 판정하면 뉴스 사이트에서 기사 A를 요약한 뒤 기사 B로 넘어갈 때
 *   같은 대화가 이어진다. 붙어 있는 페이지 본문은 B로 바뀌는데 대화 이력에는
 *   A에 대한 요약이 그대로 남아, 모델이 자기가 방금 한 A 얘기에 이끌려
 *   B를 묻는 질문에도 A 기준으로 답하게 된다.
 *
 *   해시(#)만 다른 것은 같은 문서로 본다 — 문서 내 이동일 뿐이다.
 */
export async function findForTab(
  tabId: number,
  url: string,
): Promise<Conversation | null> {
  const existing = await db.conversations
    .where('tabId')
    .equals(tabId)
    .reverse()
    .sortBy('updatedAt');

  const prev = existing[0];
  return prev && sameDocument(prev.originUrl, url) ? prev : null;
}

/**
 * 메시지가 하나도 없는 대화를 지운다.
 *
 * 이전 버전이 탭을 열 때마다 빈 대화를 만들어 두었기 때문에 그 잔재를
 * 청소한다. 지금 로직에서는 생기지 않지만, 생성 직후 실패 같은 경로가
 * 남아 있을 수 있어 패널을 열 때마다 한 번씩 돌린다.
 */
export async function pruneEmptyConversations(): Promise<number> {
  const all = await db.conversations.toArray();
  if (all.length === 0) return 0;

  const withMessages = new Set<number>();
  await db.messages.each((m) => withMessages.add(m.conversationId));

  const empty = all.filter((c) => !withMessages.has(c.id)).map((c) => c.id);
  if (empty.length > 0) await db.conversations.bulkDelete(empty);
  return empty.length;
}

export async function listConversations(limit = 50): Promise<Conversation[]> {
  return db.conversations.orderBy('updatedAt').reverse().limit(limit).toArray();
}

export async function renameConversation(id: number, title: string): Promise<void> {
  await db.conversations.update(id, { title, updatedAt: Date.now() });
}

export async function deleteConversation(id: number): Promise<void> {
  // 메시지를 먼저 지운다. 순서가 반대면 고아 레코드가 남는다.
  await db.transaction('rw', db.messages, db.conversations, async () => {
    await db.messages.where('conversationId').equals(id).delete();
    await db.conversations.delete(id);
  });
}

export async function deleteAllConversations(): Promise<void> {
  await db.transaction('rw', db.messages, db.conversations, async () => {
    await db.messages.clear();
    await db.conversations.clear();
  });
}

/* ── 메시지 ────────────────────────────────────────────── */

export async function listMessages(conversationId: number): Promise<StoredMessage[]> {
  return db.messages.where('conversationId').equals(conversationId).sortBy('createdAt');
}

export async function addMessage(
  msg: Omit<StoredMessage, 'id' | 'createdAt'> & { createdAt?: number },
): Promise<number> {
  return db.transaction('rw', db.messages, db.conversations, async () => {
    if (!(await db.conversations.get(msg.conversationId))) throw new Error('삭제된 대화에는 메시지를 저장할 수 없습니다.');
    const id = await db.messages.add({ ...msg, createdAt: msg.createdAt ?? Date.now() });
    await db.conversations.update(msg.conversationId, { updatedAt: Date.now() });
    return id;
  });
}

export async function updateMessage(
  id: number,
  patch: Partial<StoredMessage>,
): Promise<void> {
  await db.messages.update(id, patch);
}

export async function deleteMessagesFrom(
  conversationId: number,
  createdAtInclusive: number,
): Promise<void> {
  // 재생성: 해당 시점 이후 메시지를 걷어낸다.
  await db.messages
    .where('conversationId')
    .equals(conversationId)
    .filter((m) => m.createdAt >= createdAtInclusive)
    .delete();
}

/**
 * 성능 계측 표본을 모은다. 계획서 Phase 7-1
 *
 * 별도 테이블을 두지 않는 이유: 계측치는 이미 메시지마다 `perf`로 저장되고
 * 있고, 대화를 지우면 그 계측도 함께 사라지는 편이 사용자 기대에 맞는다.
 * (설정의 "모든 대화 삭제"가 곧 계측 초기화다.)
 */
export async function listPerfSamples(limit = 500): Promise<PerfSample[]> {
  const rows = await db.messages.orderBy('createdAt').reverse().limit(limit).toArray();
  return rows.map((m) => m.perf).filter((p): p is PerfSample => Boolean(p));
}

/** 첫 사용자 메시지로 대화 제목을 만든다. 별도 LLM 호출은 낭비다(21 tok/s). */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= 28 ? clean || '새 대화' : `${clean.slice(0, 28)}…`;
}
