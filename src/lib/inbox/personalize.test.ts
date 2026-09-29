import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/lib/storage/db';
import { DEFAULT_SETTINGS } from '@/lib/storage/settings';
import * as client from '@/lib/ollama/client';
import { clearAllFeedback } from '@/lib/feedback/store';
import { buildClassifyInput, buildClassifyPrompt, classifyWithModel } from './classify';
import {
  applyInboxFeedback, deleteInboxFeedback, loadInboxFeedbackMap, rankInboxExamples,
  retrieveInboxFeedback, saveInboxFeedback, strongPersonalMatch, type InboxFeedbackExample,
} from './personalize';
import type { InboxDoc } from './types';

function doc(key: string, title: string, category: InboxDoc['category'] = 'notice'): InboxDoc {
  return {
    key, group: 'g', title, reportDate: '2026-09-29', sender: '총무과', department: '기획팀',
    hasAttachment: false, readState: 'unread', category, reason: '규칙', dueDate: '',
    classifier: 'rule', firstSeenAt: 1, lastSeenAt: 1,
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.inboxFeedback.clear();
  await db.feedback.clear();
  await db.inboxDocs.clear();
});

it('사용자의 올바른 갈래를 저장하고 같은 문서에 우선 적용하며 취소 시 규칙으로 돌아간다', async () => {
  vi.spyOn(client, 'embed').mockRejectedValue(new Error('offline'));
  const original = doc('one', '예산 집행내역 안내', 'mine');
  await saveInboxFeedback(original, 'notice', 'bad', DEFAULT_SETTINGS);
  const corrected = (await applyInboxFeedback([original], [], new Date('2026-09-29')))[0]!;
  expect(corrected.category).toBe('notice');
  expect(corrected.classifier).toBe('feedback');
  await deleteInboxFeedback(original.key);
  const restored = (await applyInboxFeedback([corrected], ['예산'], new Date('2026-09-29')))[0]!;
  expect(restored.category).toBe('mine');
  expect(restored.classifier).toBe('rule');
});

it('유사한 확인 사례만 검색해 해당 문서의 모델 입력에 붙인다', async () => {
  const example: InboxFeedbackExample = {
    key: 'past', title: '예산 집행내역 안내', sender: '총무과', department: '기획팀',
    category: 'mine', verdict: 'good', at: 1,
    vector: new Float32Array([1, 0]), embedModel: DEFAULT_SETTINGS.embedModel,
  };
  await db.inboxFeedback.put(example);
  vi.spyOn(client, 'embed').mockResolvedValue([[0.95, 0.05], [0, 1]]);
  const similar = doc('new', '예산 집행내역 회신');
  const unrelated = doc('other', '체육대회 사진 공유');
  const hits = await retrieveInboxFeedback([similar, unrelated], DEFAULT_SETTINGS);
  expect(hits.get(similar.key)?.[0]?.example.key).toBe('past');
  expect(hits.has(unrelated.key)).toBe(false);
  const input = buildClassifyInput([similar, unrelated], hits);
  expect(input).toContain('사용자 확인: "예산 집행내역 안내" → mine');
  expect(input.split('\n').at(-1)).toContain('체육대회 사진 공유');
  expect(buildClassifyPrompt(['예산'])).toContain('사용자 관심 키워드: 예산');
});

it('임베딩을 쓸 수 없어도 겹치는 제목으로 사례를 검색하고 전체 초기화 때 지운다', async () => {
  const example: InboxFeedbackExample = {
    key: 'past', title: '예산 집행내역 안내', sender: '총무과', department: '기획팀',
    category: 'mine', verdict: 'good', at: 1,
  };
  await db.inboxFeedback.put(example);
  vi.spyOn(client, 'embed').mockRejectedValue(new Error('offline'));
  const hits = rankInboxExamples(doc('new', '예산 집행내역 안내'), [example]);
  expect(hits[0]?.example.key).toBe('past');
  await clearAllFeedback();
  expect((await loadInboxFeedbackMap()).size).toBe(0);
});

it('이전 판본의 맞음 기록은 원장에 문서가 남아 있을 때만 개인화 사례로 옮긴다', async () => {
  const previous = doc('old', '예산 집행내역 안내', 'mine');
  await db.inboxDocs.put(previous);
  await db.feedback.add({ kind: 'inbox-relevance', targetKey: 'old', verdict: 'good', model: 'rule', at: 12 } as never);
  await db.feedback.add({ kind: 'inbox-relevance', targetKey: 'missing', verdict: 'bad', model: 'rule', at: 13 } as never);
  const examples = await loadInboxFeedbackMap();
  expect(examples.get('old')).toMatchObject({ title: previous.title, category: 'mine', at: 12 });
  expect(examples.has('missing')).toBe(false);
  await deleteInboxFeedback('old');
  expect((await loadInboxFeedbackMap()).has('old')).toBe(false);
});

it('강하게 유사한 사례는 새 문서에 자동 적용하고 상충하는 표본은 보류한다', async () => {
  const example: InboxFeedbackExample = {
    key: 'past', title: '예산 정산 보고', sender: '총무과', department: '기획팀',
    category: 'mine', verdict: 'good', at: 1,
    vector: new Float32Array([1, 0]), embedModel: DEFAULT_SETTINGS.embedModel,
  };
  await db.inboxFeedback.put(example);
  const sameTitle = (await applyInboxFeedback([doc('new', example.title)], [], new Date('2026-09-29')))[0]!;
  expect(sameTitle.category).toBe('mine');
  expect(sameTitle.classifier).toBe('personalized');

  vi.spyOn(client, 'embed').mockResolvedValue([[1, 0]]);
  const semantic = (await classifyWithModel([doc('semantic', '예산 관련 별도 제목')], DEFAULT_SETTINGS))[0]!;
  expect(semantic.category).toBe('mine');
  expect(semantic.classifier).toBe('personalized');

  expect(strongPersonalMatch([
    { example, score: 0.94, source: 'semantic' },
    { example: { ...example, key: 'other', category: 'notice' }, score: 0.91, source: 'semantic' },
  ])).toBeUndefined();
});
