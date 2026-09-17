/**
 * 대화 저장 테스트. 계획서 §9
 *
 * ★ 핵심은 "빈 대화가 생기지 않는가"다.
 *   사이드패널은 탭이 열릴 때마다 함께 열린다. 그때 대화 레코드를 만들면
 *   말 한마디 오가지 않은 방이 탭 수만큼 쌓인다. 이 회귀는 즉시 눈에 띄지
 *   않고 며칠 뒤 목록이 지저분해져서야 드러나므로 테스트로 고정한다.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addMessage,
  createConversation,
  db,
  deleteConversation,
  findForTab,
  listConversations,
  listMessages,
  pruneEmptyConversations,
  titleFrom,
} from './db';

beforeEach(async () => {
  await db.messages.clear();
  await db.conversations.clear();
});

describe('findForTab', () => {
  it('★ 대화가 없으면 만들지 않고 null을 준다', async () => {
    const found = await findForTab(1, 'https://example.com/a');

    expect(found).toBeNull();
    // 조회만으로 레코드가 생기면 안 된다 — 이게 빈 방의 원인이었다
    expect(await db.conversations.count()).toBe(0);
  });

  it('같은 문서면 대화를 이어준다', async () => {
    const id = await createConversation(1, 'https://example.com/a', '기존');
    expect((await findForTab(1, 'https://example.com/a'))?.id).toBe(id);
  });

  it('해시만 다르면 같은 문서로 본다 (문서 내 이동)', async () => {
    const id = await createConversation(1, 'https://example.com/a', '기존');
    expect((await findForTab(1, 'https://example.com/a#section2'))?.id).toBe(id);
  });

  it('★ 같은 호스트라도 다른 글이면 이어가지 않는다', async () => {
    // 이것이 "기사 A를 요약한 뒤 기사 B를 물으면 A 기준으로 답하던" 버그의 원인이었다.
    // 붙은 본문은 B로 바뀌는데 대화 이력에는 A에 대한 답이 남아 모델이 그쪽에 이끌린다.
    await createConversation(1, 'https://news.example.com/article/1', '기사 A');
    expect(await findForTab(1, 'https://news.example.com/article/2')).toBeNull();
  });

  it('쿼리로만 구분되는 글도 다른 문서로 본다', async () => {
    // 뉴스 사이트에서 흔한 형태: articleView.html?idxno=214086
    await createConversation(1, 'https://a.com/view.html?id=1', '기사 A');
    expect(await findForTab(1, 'https://a.com/view.html?id=2')).toBeNull();
  });

  it('호스트가 다르면 이어가지 않는다', async () => {
    await createConversation(1, 'https://example.com/a', '기존');
    expect(await findForTab(1, 'https://other.com/x')).toBeNull();
  });

  it('다른 탭의 대화를 가져오지 않는다', async () => {
    await createConversation(1, 'https://example.com/a', '탭1');
    expect(await findForTab(2, 'https://example.com/a')).toBeNull();
  });

  it('같은 탭에 여러 대화가 있으면 가장 최근 것을 준다', async () => {
    await createConversation(1, 'https://example.com/a', '오래된');
    await new Promise((r) => setTimeout(r, 5));
    const recent = await createConversation(1, 'https://example.com/a', '최근');

    expect((await findForTab(1, 'https://example.com/a'))?.id).toBe(recent);
  });

  it('다른 페이지에서 대화한 뒤 돌아와도 해당 문서의 최신 대화를 찾는다', async () => {
    const old = await createConversation(1, 'https://example.com/a', '이전 A');
    const recent = await createConversation(1, 'https://example.com/a', '최근 A');
    const other = await createConversation(1, 'https://example.com/b', 'B');
    await db.conversations.update(old, { updatedAt: 100 });
    await db.conversations.update(recent, { updatedAt: 200 });
    await db.conversations.update(other, { updatedAt: 300 });

    expect((await findForTab(1, 'https://example.com/a#list'))?.id).toBe(recent);
    expect((await findForTab(1, 'https://example.com/b'))?.id).toBe(other);
  });
});

describe('pruneEmptyConversations', () => {
  it('메시지 없는 대화를 지운다', async () => {
    const empty1 = await createConversation(1, 'https://a.com', '빈방1');
    const empty2 = await createConversation(2, 'https://b.com', '빈방2');
    const real = await createConversation(3, 'https://c.com', '진짜');
    await addMessage({ conversationId: real, role: 'user', content: '안녕' });

    const removed = await pruneEmptyConversations();

    expect(removed).toBe(2);
    const left = await listConversations();
    expect(left.map((c) => c.id)).toEqual([real]);
    expect(await db.conversations.get(empty1)).toBeUndefined();
    expect(await db.conversations.get(empty2)).toBeUndefined();
  });

  it('메시지가 하나라도 있으면 남긴다', async () => {
    const id = await createConversation(1, 'https://a.com', '유저만 말함');
    // 생성이 실패해 사용자 메시지만 남은 경우도 진짜 대화다
    await addMessage({ conversationId: id, role: 'user', content: '질문' });

    expect(await pruneEmptyConversations()).toBe(0);
    expect(await db.conversations.count()).toBe(1);
  });

  it('빈 DB에서 터지지 않는다', async () => {
    expect(await pruneEmptyConversations()).toBe(0);
  });
});

describe('deleteConversation', () => {
  it('메시지까지 함께 지운다 (고아 레코드 방지)', async () => {
    const id = await createConversation(1, 'https://a.com', '삭제 대상');
    await addMessage({ conversationId: id, role: 'user', content: 'a' });
    await addMessage({ conversationId: id, role: 'assistant', content: 'b' });

    await deleteConversation(id);

    expect(await db.conversations.count()).toBe(0);
    expect(await db.messages.count()).toBe(0);
  });
});

describe('listMessages', () => {
  it('시간순으로 돌려준다', async () => {
    const id = await createConversation(1, 'https://a.com');
    await addMessage({ conversationId: id, role: 'user', content: '1', createdAt: 300 });
    await addMessage({ conversationId: id, role: 'assistant', content: '2', createdAt: 100 });
    await addMessage({ conversationId: id, role: 'user', content: '3', createdAt: 200 });

    const msgs = await listMessages(id);
    expect(msgs.map((m) => m.content)).toEqual(['2', '3', '1']);
  });
});

describe('titleFrom', () => {
  it('짧은 문장은 그대로 쓴다', () => {
    expect(titleFrom('이 페이지 요약해줘')).toBe('이 페이지 요약해줘');
  });

  it('긴 문장은 줄인다', () => {
    const t = titleFrom('가'.repeat(80));
    expect(t.length).toBeLessThanOrEqual(29);
    expect(t.endsWith('…')).toBe(true);
  });

  it('공백을 정리한다', () => {
    expect(titleFrom('  여러   공백\n줄바꿈  ')).toBe('여러 공백 줄바꿈');
  });

  it('빈 입력에 기본 제목을 준다', () => {
    expect(titleFrom('   ')).toBe('새 대화');
  });
});
