import { abortable, idleSignal } from '@/lib/async';
import { estimateTokens } from '@/lib/extract/budget';
/**
 * NDJSON 스트리밍 파서. 계획서 §5 Phase 2-1
 *
 * v2 골격에 두 가지를 추가했다:
 *   ① `message.thinking` — gemma4:e2b가 추론 텍스트를 content와 별도 필드로 보낸다.
 *      분기하지 않으면 사고 과정이 답변에 섞여 화면이 오염된다.
 *   ② `message.tool_calls` — Phase 5에서 쓴다.
 *
 * 잘림 처리가 이 파일의 핵심이다. 청크 경계는 줄 경계와 무관하게 떨어지므로
 * 마지막 불완전한 줄을 buffer에 남겨야 한다. 실사용에서 간헐적으로만
 * 재현되는 버그라 반드시 유닛 테스트로 고정한다 (stream.test.ts).
 */

import type {
  ChatRequest,
  DoneChunk,
  PerfSample,
  StreamChunk,
  ToolCall,
} from '@/types/ollama';
import { OllamaError, classifyFetchError, classifyResponse } from './errors';

export interface StreamHandlers {
  /** 답변 본문 토큰 */
  onToken?: (text: string) => void;
  /** ★ 추론 텍스트. 접이식 UI에 따로 렌더한다. */
  onThinking?: (text: string) => void;
  /** ★ 툴 호출. arguments는 이미 객체다 — JSON.parse 하지 말 것. */
  onToolCall?: (call: ToolCall) => void;
  onDone?: (done: DoneChunk, perf: PerfSample) => void;
}

/**
 * 한 줄(NDJSON)을 소비해 핸들러로 분배한다.
 * 파서 본체와 분리해 두어 테스트에서 잘림 위치를 자유롭게 조작할 수 있다.
 */
export function consumeLine(
  line: string,
  handlers: StreamHandlers,
  onDoneChunk: (c: StreamChunk) => void,
): void {
  if (!line.trim()) return;

  let chunk: StreamChunk;
  try {
    chunk = JSON.parse(line) as StreamChunk;
  } catch {
    throw new OllamaError('UNKNOWN', '서버에서 올바르지 않은 JSON 응답을 받았습니다.');
  }

  if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) throw new OllamaError('UNKNOWN', '올바르지 않은 스트림 응답입니다.');
  if ('error' in chunk && typeof chunk.error === 'string') throw new OllamaError('UNKNOWN', chunk.error);
  const msg = chunk.message;
  if (msg?.thinking) handlers.onThinking?.(msg.thinking);
  if (msg?.content) handlers.onToken?.(msg.content);
  if (msg?.tool_calls?.length) {
    for (const call of msg.tool_calls) handlers.onToolCall?.(call);
  }
  if (chunk.done) onDoneChunk(chunk);
}

/** DoneChunk의 나노초 필드를 사람이 읽는 단위로 환산한다. */
export function toPerfSample(done: DoneChunk, ttfbMs: number): PerfSample {
  const nsToSec = (ns: number) => ns / 1e9;
  const safeDiv = (n: number, d: number) => (d > 0 ? Math.round(n / d) : 0);

  return {
    ttfbMs,
    prefillTokPerSec: safeDiv(
      done.prompt_eval_count,
      nsToSec(done.prompt_eval_duration),
    ),
    decodeTokPerSec: safeDiv(done.eval_count, nsToSec(done.eval_duration)),
    promptTokens: done.prompt_eval_count ?? 0,
    outputTokens: done.eval_count ?? 0,
    totalMs: Math.round(nsToSec(done.total_duration ?? 0) * 1000),
    // load_duration이 유의미하면 모델을 새로 올린 것 — 콜드 스타트다.
    wasCold: (done.load_duration ?? 0) > 1e9,
  };
}

/**
 * /api/chat 스트리밍 호출.
 *
 * ★ 기본값 주의: think:false 와 keep_alive 를 여기서 씌우고, 호출자가
 *   명시적으로 넘긴 값이 이를 덮도록 스프레드 순서를 잡았다.
 */
export async function streamChat(
  endpoint: string,
  req: ChatRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<PerfSample | null> {
  assertRequestBudget(req);
  signal?.throwIfAborted();
  const guard = idleSignal(180_000, signal);
  try {
    return await readChat(endpoint, req, handlers, guard.signal, guard.touch);
  } catch (error) {
    if (guard.signal.aborted) throw new OllamaError(signal?.aborted ? 'ABORTED' : 'TIMEOUT', signal?.aborted ? '생성을 중단했습니다.' : '서버에서 180초 동안 응답을 받지 못했습니다.');
    throw error;
  } finally { guard.dispose(); }
}

async function readChat(endpoint: string, req: ChatRequest, handlers: StreamHandlers, signal: AbortSignal, touch: () => void): Promise<PerfSample | null> {
  const body: ChatRequest = {
    think: false,
    keep_alive: '10m',
    ...req,
    stream: true,
  };

  const startedAt = performance.now();
  let res: Response;
  try {
    res = await abortable(fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }), signal);
  } catch (e) {
    throw classifyFetchError(e);
  }

  if (!res.ok || !res.body) throw await abortable(classifyResponse(res), signal);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ttfbMs: number | null = null;
  let perf: PerfSample | null = null;

  const markFirst = () => {
    if (ttfbMs === null) ttfbMs = Math.round(performance.now() - startedAt);
  };

  const wrapped: StreamHandlers = {
    onToken: (t) => {
      markFirst();
      handlers.onToken?.(t);
    },
    onThinking: (t) => {
      markFirst();
      handlers.onThinking?.(t);
    },
    onToolCall: call => { markFirst(); handlers.onToolCall?.(call); },
  };

  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      touch();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // ★ 불완전한 마지막 줄을 다음 청크로 넘긴다

      for (const line of lines) {
        consumeLine(line, wrapped, (c) => {
          perf = toPerfSample(c as unknown as DoneChunk, ttfbMs ?? 0);
          handlers.onDone?.(c as unknown as DoneChunk, perf);
        });
        if (perf) break;
      }
      if (perf) { buffer = ''; break; }
      if (buffer.length > 2_000_000) throw new OllamaError('UNKNOWN', '서버 응답 한 줄이 허용 크기를 초과했습니다.');
    }

    // 스트림이 개행 없이 끝나는 경우 버퍼에 마지막 줄이 남는다.
    if (buffer.trim()) {
      consumeLine(buffer, wrapped, (c) => {
        perf = toPerfSample(c as unknown as DoneChunk, ttfbMs ?? 0);
        handlers.onDone?.(c as unknown as DoneChunk, perf);
      });
    }
    if (!perf) throw new OllamaError('UNKNOWN', '응답이 완료되기 전에 연결이 종료되었습니다. 다시 시도하세요.');
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return perf;
}

/** Conservative estimate, not a tokenizer guarantee. Reject oversized requests before HTTP. */
export function assertRequestBudget(req: ChatRequest): void {
  const limit = req.options?.num_ctx;
  if (!limit) return;
  const tokens = req.messages.reduce((sum, m) => sum + estimateTokens(m.content) + (m.images?.length ?? 0) * 1024 +
    (m.tool_calls ? estimateTokens(JSON.stringify(m.tool_calls)) : 0) + 8, 0) +
    (req.tools ? estimateTokens(JSON.stringify(req.tools)) : 0);
  if (tokens > Math.floor(limit * 0.7)) {
    throw new OllamaError('UNKNOWN', '질문·본문·도구 결과가 입력 예산을 초과했습니다.', '본문을 분리하거나 질문을 나누고, 필요한 경우 컨텍스트 크기를 늘려주세요.');
  }
}
