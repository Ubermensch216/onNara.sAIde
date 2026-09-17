/**
 * 스트림 파서 테스트. 계획서 §9
 *
 * "청크가 줄 중간에서 잘리는 케이스는 실사용에서 간헐적으로만 재현되어
 *  디버깅이 어렵다. 고정 픽스처로 잘림 위치를 바이트 단위로 옮겨가며 검증한다."
 *
 * 여기서 쓰는 픽스처는 2026-08-19에 gemma4:e2b가 실제로 돌려준 응답 모양이다.
 */

import { describe, expect, it, vi } from 'vitest';
import { consumeLine, streamChat, toPerfSample } from './stream';
import type { DoneChunk, StreamChunk } from '@/types/ollama';

/* ── 실측 픽스처 ───────────────────────────────────────── */

const line = (c: Partial<StreamChunk>) =>
  JSON.stringify({ model: 'gemma4:e2b', created_at: '2026-08-19T02:00:00Z', done: false, ...c });

const NDJSON = [
  line({ message: { role: 'assistant', thinking: 'Thinking Process:\n1. ' } }),
  line({ message: { role: 'assistant', thinking: 'Analyze the request.' } }),
  line({ message: { role: 'assistant', content: '하늘이 ' } }),
  line({ message: { role: 'assistant', content: '파란 이유는' } }),
  line({
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 3182,
    prompt_eval_duration: 19_727_000_000,
    eval_count: 114,
    eval_duration: 5_428_000_000,
    total_duration: 45_480_000_000,
  }),
].join('\n');

function collector() {
  const tokens: string[] = [];
  const thinking: string[] = [];
  const toolCalls: unknown[] = [];
  let done: DoneChunk | null = null;
  return {
    tokens,
    thinking,
    toolCalls,
    get done() {
      return done;
    },
    handlers: {
      onToken: (t: string) => tokens.push(t),
      onThinking: (t: string) => thinking.push(t),
      onToolCall: (c: unknown) => toolCalls.push(c),
      onDone: (d: DoneChunk) => {
        done = d;
      },
    },
  };
}

/** 임의 크기로 쪼갠 바이트 스트림을 주는 가짜 Response */
function mockResponse(body: string, chunkSize: number): Response {
  const bytes = new TextEncoder().encode(body);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Response(stream, { status: 200 });
}

/* ── consumeLine — 필드 분기 ───────────────────────────── */

describe('consumeLine', () => {
  it('thinking과 content를 서로 다른 핸들러로 보낸다', () => {
    const c = collector();
    consumeLine(line({ message: { thinking: '생각', content: '답변' } }), c.handlers, () => {});
    expect(c.thinking).toEqual(['생각']);
    expect(c.tokens).toEqual(['답변']);
  });

  it('tool_calls의 arguments를 객체 그대로 넘긴다 (JSON 문자열이 아니다)', () => {
    const c = collector();
    consumeLine(
      line({
        message: {
          tool_calls: [
            { id: 'call_xz7pgw03', function: { index: 0, name: 'list_tabs', arguments: {} } },
          ],
        },
      }),
      c.handlers,
      () => {},
    );
    expect(c.toolCalls).toHaveLength(1);
    expect(c.toolCalls[0]).toMatchObject({
      id: 'call_xz7pgw03',
      function: { name: 'list_tabs', arguments: {} },
    });
  });

  it('빈 줄을 무시한다', () => {
    const c = collector();
    consumeLine('', c.handlers, () => {});
    consumeLine('   ', c.handlers, () => {});
    expect(c.tokens).toEqual([]);
  });

  it('깨진 JSON을 성공한 응답으로 취급하지 않는다', () => {
    const c = collector();
    expect(() => consumeLine('{"message":{"cont', c.handlers, () => {})).toThrow();
    expect(c.tokens).toEqual([]);
  });
});

/* ── streamChat — 잘림 처리 ────────────────────────────── */

describe('streamChat 청크 경계', () => {
  // 1바이트부터 전체 길이까지 훑는다. 어떤 잘림 위치에서도 결과가 같아야 한다.
  const sizes = [1, 2, 3, 5, 7, 13, 31, 64, 127, 256, 1024, NDJSON.length];

  it.each(sizes)('청크 크기 %i바이트에서도 동일하게 파싱한다', async (size) => {
    const c = collector();
    vi.stubGlobal('fetch', async () => mockResponse(NDJSON, size));

    await streamChat(
      'http://localhost:11434',
      { model: 'gemma4:e2b', messages: [], stream: true },
      c.handlers,
    );

    expect(c.tokens.join('')).toBe('하늘이 파란 이유는');
    expect(c.thinking.join('')).toBe('Thinking Process:\n1. Analyze the request.');
    expect(c.done?.done_reason).toBe('stop');
    expect(c.done?.prompt_eval_count).toBe(3182);

    vi.unstubAllGlobals();
  });

  it('멀티바이트 한글이 청크 경계에 걸려도 깨지지 않는다', async () => {
    // '하'는 UTF-8로 3바이트다. 1바이트씩 흘리면 문자 중간에서 잘린다.
    const c = collector();
    vi.stubGlobal('fetch', async () => mockResponse(NDJSON, 1));

    await streamChat(
      'http://localhost:11434',
      { model: 'gemma4:e2b', messages: [], stream: true },
      c.handlers,
    );

    expect(c.tokens.join('')).toBe('하늘이 파란 이유는');
    expect(c.tokens.join('')).not.toContain('�'); // 대체 문자가 없어야 한다
    vi.unstubAllGlobals();
  });

  it('마지막 줄에 개행이 없어도 done을 놓치지 않는다', async () => {
    const c = collector();
    vi.stubGlobal('fetch', async () => mockResponse(NDJSON, 8)); // 끝에 \n 없음
    await streamChat(
      'http://localhost:11434',
      { model: 'gemma4:e2b', messages: [], stream: true },
      c.handlers,
    );
    expect(c.done).not.toBeNull();
    vi.unstubAllGlobals();
  });
});

/* ── 기본값 ────────────────────────────────────────────── */

describe('streamChat 기본값', () => {
  it('think:false와 keep_alive를 기본으로 씌운다', async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return mockResponse(NDJSON, 64);
    });

    await streamChat(
      'http://localhost:11434',
      { model: 'gemma4:e2b', messages: [], stream: true },
      {},
    );

    // 실측: think ON이면 같은 답변에 6.4배가 걸린다.
    expect(sent.think).toBe(false);
    expect(sent.keep_alive).toBe('10m');
    vi.unstubAllGlobals();
  });

  it('호출자가 넘긴 think:true가 기본값을 이긴다 (에이전트용)', async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string);
      return mockResponse(NDJSON, 64);
    });

    await streamChat(
      'http://localhost:11434',
      { model: 'gemma4:e2b', messages: [], stream: true, think: true },
      {},
    );

    expect(sent.think).toBe(true);
    vi.unstubAllGlobals();
  });
});

/* ── 성능 환산 ─────────────────────────────────────────── */

describe('toPerfSample', () => {
  it('실측값을 tok/s로 환산한다', () => {
    const done = {
      done: true,
      done_reason: 'stop',
      model: 'gemma4:e2b',
      prompt_eval_count: 3182,
      prompt_eval_duration: 19_727_000_000, // 19.727초
      eval_count: 114,
      eval_duration: 5_428_000_000, // 5.428초
      total_duration: 45_480_000_000,
    } satisfies DoneChunk;

    const p = toPerfSample(done, 39_497);

    expect(p.prefillTokPerSec).toBe(161); // 3182 / 19.727 ≈ 161 — 실측 상한과 일치
    expect(p.decodeTokPerSec).toBe(21); // 114 / 5.428 ≈ 21 — 실측과 일치
    expect(p.ttfbMs).toBe(39_497);
    expect(p.totalMs).toBe(45_480);
  });

  it('0으로 나누지 않는다', () => {
    const p = toPerfSample(
      {
        done: true,
        done_reason: 'stop',
        model: 'm',
        prompt_eval_count: 0,
        prompt_eval_duration: 0,
        eval_count: 0,
        eval_duration: 0,
        total_duration: 0,
      },
      0,
    );
    expect(p.prefillTokPerSec).toBe(0);
    expect(p.decodeTokPerSec).toBe(0);
  });

  it('load_duration이 크면 콜드 스타트로 표시한다', () => {
    const base = {
      done: true as const,
      done_reason: 'stop' as const,
      model: 'm',
      prompt_eval_count: 10,
      prompt_eval_duration: 1e9,
      eval_count: 10,
      eval_duration: 1e9,
      total_duration: 25e9,
    };
    expect(toPerfSample({ ...base, load_duration: 21.5e9 }, 0).wasCold).toBe(true);
    expect(toPerfSample({ ...base, load_duration: 1e6 }, 0).wasCold).toBe(false);
  });
});
