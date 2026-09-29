/** 사용자가 확인한 공유/공람 분류 사례를 로컬에서 검색해 다음 AI 분류에 제공한다. */
import { db } from '@/lib/storage/db';
import { embed } from '@/lib/ollama/client';
import { tokenize } from '@/lib/memory/keyword';
import type { Settings } from '@/lib/storage/settings';
import type { InboxDoc } from './types';
import { classifyByRules } from './classify-rules';

export type LearnedCategory = 'mine' | 'notice';
const MAX_EXAMPLES = 500;

export interface InboxFeedbackExample {
  key: string;
  title: string;
  sender: string;
  department: string;
  /** 사용자가 확인한 갈래. 틀림을 누른 경우 사용자가 고른 갈래다. */
  category: LearnedCategory;
  verdict: 'good' | 'bad';
  at: number;
  vector?: Float32Array;
  embedModel?: string;
}

export function feedbackText(doc: Pick<InboxDoc, 'title' | 'sender' | 'department'>): string {
  return `${doc.title} | ${doc.sender} | ${doc.department}`.slice(0, 240);
}

function normalized(values: number[]): Float32Array {
  const length = Math.hypot(...values);
  if (!Number.isFinite(length) || length === 0) return new Float32Array(values.length);
  return Float32Array.from(values.map(value => value / length));
}

function score(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function words(value: string): Set<string> {
  return new Set(tokenize(value));
}

function lexicalScore(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap++;
  return overlap / Math.max(left.size, right.size);
}

export interface RetrievedExample { example: InboxFeedbackExample; score: number; source: 'semantic' | 'keyword' }

/** 벡터가 있으면 의미 유사도, 임베딩을 쓸 수 없으면 보수적인 어휘 일치로 찾는다. */
export function rankInboxExamples(
  doc: InboxDoc,
  examples: InboxFeedbackExample[],
  vector?: Float32Array,
  model?: string,
): RetrievedExample[] {
  return examples
    .filter(example => example.key !== doc.key)
    .map(example => {
      const semantic = vector && example.vector && example.embedModel === model
        ? score(vector, example.vector) : 0;
      const lexical = lexicalScore(doc.title, example.title);
      const source = semantic >= 0.78 ? 'semantic' as const : 'keyword' as const;
      const rank = source === 'semantic' ? semantic : lexical >= 0.5 ? lexical : 0;
      return { example, score: rank, source };
    })
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.example.at - a.example.at)
    .slice(0, 2);
}

/** 서로 다른 답의 근거가 비슷하게 강하면 자동 분류하지 않고 모델에 맡긴다. */
export function strongPersonalMatch(hits: RetrievedExample[]): RetrievedExample | undefined {
  const first = hits[0];
  if (!first || first.score < (first.source === 'semantic' ? 0.9 : 0.85)) return undefined;
  const other = hits.find(hit => hit.example.category !== first.example.category);
  return other && first.score - other.score < 0.08 ? undefined : first;
}

export async function loadInboxFeedbackMap(): Promise<Map<string, InboxFeedbackExample>> {
  try {
    const result = new Map((await db.inboxFeedback.toArray()).map(row => [row.key, row]));
    // 이전 판본의 '맞음'에는 제목이 없었다. 원장에 문서가 남아 있으면 사례로 옮긴다.
    const old = (await db.feedback.where('kind').equals('inbox-relevance')
      .filter(row => row.verdict === 'good' && Boolean(row.targetKey) && !result.has(row.targetKey)).toArray())
      .sort((a, b) => b.at - a.at).slice(0, Math.max(0, MAX_EXAMPLES - result.size));
    if (old.length) {
      const docs = await db.inboxDocs.bulkGet(old.map(row => row.targetKey));
      const recovered: InboxFeedbackExample[] = [];
      old.forEach((row, index) => {
        const doc = docs[index];
        if (!doc || (doc.category !== 'mine' && doc.category !== 'notice')) return;
        recovered.push({
          key: doc.key, title: doc.title, sender: doc.sender, department: doc.department,
          category: doc.category, verdict: 'good', at: row.at,
        });
      });
      if (recovered.length) {
        await db.inboxFeedback.bulkPut(recovered);
        recovered.forEach(example => result.set(example.key, example));
      }
    }
    return result;
  }
  catch { return new Map(); }
}

/** 기록은 즉시 남긴다. 임베딩 서버가 꺼져 있어도 피드백은 잃지 않는다. */
export async function saveInboxFeedback(
  doc: InboxDoc,
  category: LearnedCategory,
  verdict: 'good' | 'bad',
  settings: Settings,
): Promise<void> {
  const at = Date.now();
  const example: InboxFeedbackExample = {
    key: doc.key, title: doc.title, sender: doc.sender, department: doc.department,
    category, verdict, at,
  };
  await db.inboxFeedback.put(example);
  const oldKeys = await db.inboxFeedback.orderBy('at').reverse().offset(MAX_EXAMPLES).primaryKeys();
  if (oldKeys.length) await db.inboxFeedback.bulkDelete(oldKeys as string[]);
  void embed(settings.endpoint, settings.embedModel, feedbackText(doc), '0', AbortSignal.timeout(45_000))
    .then(async ([values]) => {
      if (!values?.length || values.some(value => !Number.isFinite(value))) return;
      const current = await db.inboxFeedback.get(doc.key);
      if (current?.at === at && current.category === category) {
        await db.inboxFeedback.update(doc.key, { vector: normalized(values), embedModel: settings.embedModel });
      }
    }).catch(() => undefined);
}

export async function deleteInboxFeedback(key: string): Promise<void> {
  await db.transaction('rw', db.inboxFeedback, db.feedback, async () => {
    await db.inboxFeedback.delete(key);
    await db.feedback.where('kind').equals('inbox-relevance').filter(row => row.targetKey === key).delete();
  });
}

/** 같은 문서에 대한 명시적 교정은 모델 판단보다 우선한다. */
export async function applyInboxFeedback(docs: InboxDoc[], interests: string[], now: Date): Promise<InboxDoc[]> {
  const examples = await loadInboxFeedbackMap();
  const samples = [...examples.values()];
  return docs.map(doc => {
    const example = examples.get(doc.key);
    if (doc.category === 'filtered') return doc;
    if (example) return { ...doc, category: example.category, reason: '내 피드백으로 분류', classifier: 'feedback' as const };
    if (doc.category !== 'deadline' && (doc.classifier === 'rule' || doc.classifier === 'personalized')) {
      const match = strongPersonalMatch(rankInboxExamples(doc, samples));
      if (match) return {
        ...doc, category: match.example.category,
        reason: `유사 피드백 "${match.example.title.slice(0, 40)}" 참고`,
        classifier: 'personalized' as const,
      };
    }
    if (doc.classifier === 'feedback' || doc.classifier === 'personalized') {
      const rule = classifyByRules(doc, { now, interests });
      return { ...doc, category: rule.category, reason: rule.reason, classifier: 'rule' as const };
    }
    return doc;
  });
}

/** 각 문서에 연관된 피드백만 검색한다. 임베딩 실패 시 어휘 검색으로 계속 진행한다. */
export async function retrieveInboxFeedback(
  docs: InboxDoc[], settings: Settings, signal?: AbortSignal,
): Promise<Map<string, RetrievedExample[]>> {
  const examples = [...(await loadInboxFeedbackMap()).values()].sort((a, b) => b.at - a.at).slice(0, 300);
  if (!examples.length || !docs.length) return new Map();
  const missing = examples.filter(example => !example.vector || example.embedModel !== settings.embedModel).slice(0, 30);
  const inputs = [...missing.map(feedbackText), ...docs.map(feedbackText)];
  const timedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const vectors = await embed(settings.endpoint, settings.embedModel, inputs, '0', timedSignal)
    .catch(() => [] as number[][]);
  if (vectors.length === inputs.length) {
    await Promise.allSettled(missing.map(async (example, index) => {
      const values = vectors[index];
      if (!values?.length || values.some(value => !Number.isFinite(value))) return;
      const current = await db.inboxFeedback.get(example.key);
      if (current?.at !== example.at || current.category !== example.category) return;
      example.vector = normalized(values);
      example.embedModel = settings.embedModel;
      await db.inboxFeedback.update(example.key, { vector: example.vector, embedModel: example.embedModel });
    }));
  }
  const result = new Map<string, RetrievedExample[]>();
  docs.forEach((doc, index) => {
    const values = vectors.length === inputs.length ? vectors[missing.length + index] : undefined;
    const hits = rankInboxExamples(doc, examples,
      values?.length ? normalized(values) : undefined, settings.embedModel);
    if (hits.length) result.set(doc.key, hits);
  });
  return result;
}
