/**
 * `@일정` 문장을 모델에게 분류시킨다.
 *
 * ★ [intent.ts]와 갈라 둔 이유는 시험 가능성이다. 저쪽은 네트워크가 없어 모든 규칙을
 *   단위 테스트로 못 박을 수 있고, 여기에는 HTTP 한 번만 남는다.
 *
 * ★ 문맥을 싣지 않는다. 지금 친 한 문장과 분류 지시만 보낸다. 공문 대화 문맥을 함께
 *   보내면 KV 캐시 접두사가 깨져 다음 공문 질문의 프리필이 통째로 다시 돌고, 앞 문서
 *   이야기가 일정 분류에 섞인다.
 */

import { streamChat } from '@/lib/ollama/stream';
import { requireCapabilities } from '@/lib/ollama/client';
import type { Settings } from '@/lib/storage/settings';
import { buildIntentPrompt, readIntent, SCHEDULE_INTENT_SCHEMA, type ScheduleIntent } from './intent';

/**
 * 분류에 쓸 컨텍스트 길이 상한.
 *
 * ★ 설정값(대개 8k 이상)을 그대로 쓰지 않는다. 보내는 것은 지시문과 한 문장뿐이라
 *   더 잡아 둘 이유가 없고, 큰 num_ctx는 그만큼 KV 캐시를 잡아 공문 대화용 캐시를 밀어낸다.
 */
const CLASSIFY_NUM_CTX = 4096;

export async function classifyScheduleIntent(
  settings: Settings,
  prompt: string,
  signal?: AbortSignal,
  now: Date = new Date(),
): Promise<ScheduleIntent> {
  const text = prompt.trim();
  if (!text) return { intent: 'chat', payload: {}, reason: 'empty' };

  await requireCapabilities(settings.endpoint, settings.model, [], signal);

  let raw = '';
  await streamChat(
    settings.endpoint,
    {
      model: settings.model,
      messages: [
        { role: 'system', content: buildIntentPrompt(now) },
        { role: 'user', content: text },
      ],
      stream: true,
      think: false,
      keep_alive: settings.keepAlive,
      format: SCHEDULE_INTENT_SCHEMA as unknown as Record<string, unknown>,
      // 분류는 사실 판정이다. 같은 문장이 매번 같은 의도로 읽혀야 한다.
      options: { temperature: 0, num_ctx: Math.min(CLASSIFY_NUM_CTX, settings.numCtx) },
    },
    { onToken: token => { raw += token; } },
    signal,
  );

  signal?.throwIfAborted();
  return readIntent(raw, text, now);
}
