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

export function buildClassifyPrompt(): string {
  return [
    '너는 공공기관 공문 목록을 분류하는 도구다. 각 줄은 "번호. 제목 | 발신 | 부서" 형식이다.',
    '각 문서를 다음 둘 중 하나로만 분류한다.',
    '- mine: 받은 사람이 회신·제출·참석·협조·조치 같은 행동을 해야 할 것으로 보이는 문서',
    '- notice: 알리거나 공유하는 것이 목적이고 받은 사람이 할 일이 없는 문서',
    '제목에 없는 내용을 지어내지 않는다. 판단이 서지 않으면 notice로 둔다.',
    'JSON만 출력한다. 모든 번호에 대해 한 항목씩 낸다.',
  ].join('\n');
}

export function buildClassifyInput(docs: Pick<InboxDoc, 'title' | 'sender' | 'department'>[]): string {
  return docs
    .map((doc, index) => `${index + 1}. ${doc.title.slice(0, MAX_TITLE_LENGTH)} | ${doc.sender} | ${doc.department}`)
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
  const targets = docs.filter(doc => doc.category === 'mine' || doc.category === 'notice').slice(0, MAX_CLASSIFY_TITLES);
  if (!targets.length) return docs;

  await requireCapabilities(settings.endpoint, settings.model, [], signal);

  let raw = '';
  await streamChat(
    settings.endpoint,
    {
      model: settings.model,
      messages: [
        { role: 'system', content: buildClassifyPrompt() },
        { role: 'user', content: buildClassifyInput(targets) },
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
  );
  signal?.throwIfAborted();

  const verdicts = readClassification(raw, targets.length);
  if (!verdicts.size) return docs;

  const changed = new Map<string, ModelCategory>();
  targets.forEach((doc, index) => {
    const category = verdicts.get(index);
    if (category && category !== doc.category) changed.set(doc.key, category);
  });
  if (!changed.size) return docs;

  return docs.map(doc => {
    const category = changed.get(doc.key);
    return category
      ? { ...doc, category, reason: `${doc.reason} · 모델이 ${category === 'mine' ? '내 업무' : '단순 공람'}으로 봄`, classifier: 'model' as const }
      : doc;
  });
}
