/**
 * 브리핑 갈래 분류 — 모델 편(문서 전체에 대해 1회).
 *
 * ★ **보강일 뿐이다.** 규칙 분류([classify-rules.ts])가 이미 끝난 뒤에 불리고, 모델을 부르지
 *   못하면 규칙 결과가 그대로 남는다. Ollama가 꺼져 있어도 브리핑은 나와야 한다.
 *
 * ★ 모델은 **제목만** 본다. 본문을 열지 않는다 — 그것이 미열람을 지키는 조건이다.
 *
 * ★ 기한 날짜는 모델에게 묻지 않는다. `기한 임박` 갈래는 코드가 제목에서 날짜를 읽어낸
 *   경우에만 붙으며, 모델이 그 갈래로 올리는 것을 허용하지 않는다(원칙 2 — 사실은 코드가 만든다).
 *
 * ★ 한 번에 보낸다. 문서마다 부르면 20건에 5분이 걸리고, 그만큼 KV 캐시도 갈린다.
 */

import { requireCapabilities } from '@/lib/ollama/client';
import { streamChat } from '@/lib/ollama/stream';
import type { Settings } from '@/lib/storage/settings';
import type { InboxCategory, InboxDoc } from './types';
import { retrieveInboxFeedback, strongPersonalMatch, type RetrievedExample } from './personalize';

/**
 * 분류에 쓸 컨텍스트 길이 상한.
 *
 * ★ 설정값을 그대로 쓰지 않는다. 보내는 것은 지시문과 제목 목록뿐이고, 큰 num_ctx는
 *   그만큼 KV 캐시를 잡아 공문 대화용 캐시를 밀어낸다([schedule/classify.ts]와 같은 규칙).
 */
const CLASSIFY_NUM_CTX = 4096;
/** 한 번에 물어볼 제목 수. 넘치면 앞에서 자른다 — 급한 갈래가 앞에 오도록 정렬된 뒤다. */
export const MAX_CLASSIFY_TITLES = 40;
/** 제목 한 개를 자를 길이. 공문 제목은 대개 이 안에 들어간다. */
const MAX_TITLE_LENGTH = 120;

/** 모델이 고를 수 있는 갈래. `deadline`은 없다 — 기한은 코드가 정한다. */
export type ModelCategory = Extract<InboxCategory, 'mine' | 'notice'>;

export const INBOX_CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          category: { type: 'string', enum: ['mine', 'notice'] },
        },
        required: ['index', 'category'],
      },
    },
  },
  required: ['items'],
} as const;

export function buildClassifyPrompt(interests: string[] = []): string {
  return [
    '너는 공공기관 공문 목록을 분류하는 도구다. 각 줄은 "번호. 제목 | 발신 | 부서" 형식이다.',
    '각 문서를 다음 둘 중 하나로만 분류한다.',
    '- mine: 이 사용자의 담당 업무나 관심 분야와 관련되어 직접 챙길 문서',
    '- notice: 이 사용자에게 단순 공유·공람으로 보이는 문서',
    '회신·제출·협조 같은 일반적인 요청 표현만으로 mine이라고 판단하지 않는다.',
    ...(interests.length ? [`사용자 관심 키워드: ${interests.slice(0, 12).map(value => value.slice(0, 30)).join(', ')}`] : []),
    '제목에 없는 내용을 지어내지 않는다. 판단이 서지 않으면 notice로 둔다.',
    '각 번호에 붙은 사용자 확인 사례는 개인 업무의 단서다. 유사성만 참고하고 문서 자체를 판단한다.',
    'JSON만 출력한다. 모든 번호에 대해 한 항목씩 낸다.',
  ].join('\n');
}

export function buildClassifyInput(
  docs: Pick<InboxDoc, 'title' | 'sender' | 'department' | 'key'>[],
  examples: Map<string, RetrievedExample[]> = new Map(),
): string {
  return docs
    .map((doc, index) => {
      const prior = (examples.get(doc.key) ?? [])
        .map(hit => `사용자 확인: "${hit.example.title.replace(/\s+/g, ' ').slice(0, 70)}" → ${hit.example.category}`)
        .join('; ');
      return `${index + 1}. ${doc.title.slice(0, MAX_TITLE_LENGTH)} | ${doc.sender} | ${doc.department}${prior ? `\n   ${prior}` : ''}`;
    })
    .join('\n');
}

/**
 * 모델 응답을 번호 → 갈래로 읽는다. 읽지 못한 항목은 넣지 않는다.
 *
 * ★ 느슨하게 읽지 않는다. 범위 밖 번호와 모르는 갈래는 버린다 — 모델이 헛짚은 항목까지
 *   받아들이면 규칙이 옳게 매긴 갈래를 덮어쓴다.
 */
export function readClassification(raw: string, count: number): Map<number, ModelCategory> {
  const result = new Map<number, ModelCategory>();
  try {
    const parsed = JSON.parse(raw) as { items?: Array<{ index?: unknown; category?: unknown }> };
    for (const item of parsed.items ?? []) {
      const index = Number(item.index);
      const category = String(item.category);
      if (!Number.isInteger(index) || index < 1 || index > count) continue;
      if (category !== 'mine' && category !== 'notice') continue;
      result.set(index - 1, category);
    }
  } catch { /* 형식이 어긋나면 규칙 결과를 그대로 쓴다 */ }
  return result;
}

/**
 * 규칙이 매긴 갈래를 모델 판단으로 보강한다. **새 배열을 돌려주고 원본은 건드리지 않는다.**
 *
 * ★ `deadline`은 손대지 않는다. 코드가 제목에서 날짜를 읽어낸 문서이고, 그 사실을
 *   모델의 의견으로 뒤집는 것은 이 제품이 지켜 온 원칙에 어긋난다.
 */
export async function classifyWithModel(
  docs: InboxDoc[],
  settings: Settings,
  signal?: AbortSignal,
): Promise<InboxDoc[]> {
  const targets = docs.filter(doc => (doc.category === 'mine' || doc.category === 'notice') && doc.classifier !== 'feedback' && doc.classifier !== 'personalized').slice(0, MAX_CLASSIFY_TITLES);
  if (!targets.length) return docs;

  const examples = await retrieveInboxFeedback(targets, settings, signal);
  signal?.throwIfAborted();
  const direct = new Map(targets.map(doc => [doc.key, strongPersonalMatch(examples.get(doc.key) ?? [])] as const)
    .filter((pair): pair is readonly [string, NonNullable<typeof pair[1]>] => Boolean(pair[1])));
  const personalized = docs.map(doc => {
    const hit = direct.get(doc.key);
    return hit ? {
      ...doc, category: hit.example.category,
      reason: `유사 피드백 "${hit.example.title.slice(0, 40)}" 참고`,
      classifier: 'personalized' as const,
    } : doc;
  });
  const remaining = targets.filter(doc => !direct.has(doc.key));
  if (!remaining.length) return personalized;

  try { await requireCapabilities(settings.endpoint, settings.model, [], signal); }
  catch { return personalized; }

  let raw = '';
  try { await streamChat(
    settings.endpoint,
    {
      model: settings.model,
      messages: [
        { role: 'system', content: buildClassifyPrompt(settings.briefingKeywords) },
        { role: 'user', content: buildClassifyInput(remaining, examples) },
      ],
      stream: true,
      think: false,
      keep_alive: settings.keepAlive,
      format: INBOX_CLASSIFY_SCHEMA as unknown as Record<string, unknown>,
      // 분류는 사실 판정이다. 같은 목록이 매번 같은 갈래로 읽혀야 한다.
      options: { temperature: 0, num_ctx: Math.min(CLASSIFY_NUM_CTX, settings.numCtx) },
    },
    { onToken: token => { raw += token; } },
    signal,
  ); } catch { return personalized; }
  signal?.throwIfAborted();

  const verdicts = readClassification(raw, remaining.length);
  if (!verdicts.size) return personalized;

  const checked = new Map<string, ModelCategory>();
  remaining.forEach((doc, index) => {
    const category = verdicts.get(index);
    if (category) checked.set(doc.key, category);
  });
  if (!checked.size) return personalized;

  return personalized.map(doc => {
    const category = checked.get(doc.key);
    const cited = examples.get(doc.key)?.[0]?.example.title;
    return category
      ? { ...doc, category, reason: category === doc.category && !cited ? doc.reason : `${cited ? `유사 피드백 "${cited.slice(0, 40)}" 참고 · ` : ''}모델이 ${category === 'mine' ? '내 업무' : '단순 공람'}으로 봄`, classifier: 'model' as const }
      : doc;
  });
}
