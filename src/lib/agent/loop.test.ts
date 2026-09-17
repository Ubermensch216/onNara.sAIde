/**
 * 실행 루프의 **멈춤 보장**을 고정하는 테스트. 계획서 §5 Phase 5-2 / 5-3 / 5-4
 *
 * 여기서 검증하는 것은 답변 품질이 아니라 종료 조건이다. 소형 모델이
 * 폭주해도 루프가 반드시 끝나는지, 승인 없이는 부작용 액션이 절대 실행되지
 * 않는지 — 이 둘이 깨지면 사용자의 브라우저에서 사고가 난다.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  runAgentLoop,
  clampResult,
  type AgentDeps,
  type ToolOutcome,
  type TurnResult,
} from './loop';
import type { AgentAction } from './tools';
import type { ChatMessage, ToolCall } from '@/types/ollama';

function toolCall(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `call_${name}`, function: { index: 0, name, arguments: args } };
}

function turn(content: string, calls: ToolCall[] = []): TurnResult {
  return { content, thinking: '', toolCalls: calls, perf: null };
}

/** 대본대로 답하는 가짜 모델. 대본을 다 쓰면 마지막 응답을 반복한다. */
function scriptedChat(script: TurnResult[]) {
  const seen: ChatMessage[][] = [];
  const fn = vi.fn(async (messages: ChatMessage[]): Promise<TurnResult> => {
    seen.push(messages.map((m) => ({ ...m })));
    return script[Math.min(fn.mock.calls.length - 1, script.length - 1)]!;
  });
  return { fn, seen };
}

function deps(over: Partial<AgentDeps> & Pick<AgentDeps, 'chat'>): AgentDeps {
  return {
    execute: async (): Promise<ToolOutcome> => ({ ok: true, detail: '완료' }),
    approve: async () => true,
    ...over,
  };
}

const seed: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: '이 페이지 요약해줘' },
];

it('signal을 무시하는 도구도 시간 초과 후 재시도 상한에서 끝난다', async () => {
  vi.useFakeTimers();
  try {
    const { fn } = scriptedChat([turn('', [toolCall('read_page')])]);
    const execute = vi.fn(() => new Promise<ToolOutcome>(() => {}));
    const running = runAgentLoop(seed, deps({ chat: fn, execute }), { toolTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(250);
    expect((await running).stopReason).toBe('tool-failed');
    expect(execute).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('대상 설명이 영원히 대기해도 승인이나 실행으로 넘어가지 않는다', async () => {
  vi.useFakeTimers();
  try {
    const { fn } = scriptedChat([turn('', [toolCall('click', { selector: '#go' })])]);
    const approve = vi.fn(); const execute = vi.fn();
    const running = runAgentLoop(seed, deps({ chat: fn, approve, execute, describeTarget: () => new Promise(() => {}) }));
    await vi.advanceTimersByTimeAsync(15001);
    expect((await running).stopReason).toBe('tool-failed');
    expect(approve).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

describe('정상 종료', () => {
  it('도구를 부르지 않으면 1턴으로 끝난다', async () => {
    const { fn } = scriptedChat([turn('바로 답합니다')]);
    const out = await runAgentLoop(seed, deps({ chat: fn }));

    expect(out.stopReason).toBe('answered');
    expect(out.turns).toBe(1);
    expect(out.content).toBe('바로 답합니다');
    expect(out.steps).toHaveLength(0);
  });

  it('도구 한 번 → 답변', async () => {
    const { fn, seen } = scriptedChat([
      turn('', [toolCall('read_page')]),
      turn('요약: 사이드 확장 소개 글입니다'),
    ]);
    const execute = vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, detail: '본문입니다' }));

    const out = await runAgentLoop(seed, deps({ chat: fn, execute }));

    expect(out.stopReason).toBe('answered');
    expect(out.turns).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out.steps).toEqual([
      expect.objectContaining({ tool: 'read_page', ok: true, turn: 1 }),
    ]);

    // 두 번째 턴에는 툴 결과가 데이터 태그로 감싸여 들어가야 한다(§7 ①).
    const second = seen[1]!;
    const toolMsg = second.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('<tool_result>');
    expect(toolMsg?.content).toContain('본문입니다');
    expect(toolMsg?.tool_name).toBe('read_page');
  });

  it('앞 턴의 중간 발화가 최종 답변에 섞이지 않는다', async () => {
    const { fn } = scriptedChat([
      turn('확인해 보겠습니다', [toolCall('read_page')]),
      turn('요약입니다'),
    ]);
    const out = await runAgentLoop(seed, deps({ chat: fn }));
    expect(out.content).toBe('요약입니다');
  });
});

describe('멈춤 보장 (Phase 5-2)', () => {
  it('같은 도구·같은 인자를 반복하면 3회에서 끊는다', async () => {
    const { fn } = scriptedChat([turn('', [toolCall('find_element', { query: '구매' })])]);
    const execute = vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, detail: '찾음' }));

    const out = await runAgentLoop(seed, deps({ chat: fn, execute }));

    expect(out.stopReason).toBe('repeat-guard');
    expect(execute).toHaveBeenCalledTimes(3); // 4번째에서 차단
    expect(out.notice).toContain('반복');
  });

  it('턴 상한에 걸리면 멈춘다', async () => {
    // 매번 다른 인자를 써서 반복 차단을 피하는 최악의 경우.
    let n = 0;
    const chat = vi.fn(async () => turn('', [toolCall('find_element', { query: `q${n++}` })]));
    const out = await runAgentLoop(seed, deps({ chat }), { maxTurns: 4 });

    expect(out.stopReason).toBe('max-turns');
    expect(out.turns).toBe(4);
    expect(out.steps).toHaveLength(4);
  });

  it('무응답이 이어지면 시간 상한으로 끊는다', async () => {
    // 토큰도 못 내놓고 응답도 없는 모델. 실제로는 프리필에서 멈춘 상태.
    const chat = vi.fn(
      (_m: ChatMessage[], _h: unknown, signal: AbortSignal) =>
        new Promise<TurnResult>((_res, rej) => {
          signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
        }),
    );

    const out = await runAgentLoop(seed, deps({ chat }), { idleTimeoutMs: 40 });

    expect(out.stopReason).toBe('timeout');
    expect(out.notice).toContain('응답이 없어');
  });

  it('토큰이 흐르는 동안에는 시간 상한이 되감긴다', async () => {
    // 30ms마다 토큰을 흘리는 느린 생성. 무응답 상한 50ms보다 총 시간이 길다.
    const chat = vi.fn(async (_m: ChatMessage[], h: { onToken?: (t: string) => void }) => {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 30));
        h.onToken?.('가');
      }
      return turn('가가가가가');
    });

    const out = await runAgentLoop(seed, deps({ chat }), { idleTimeoutMs: 50 });
    expect(out.stopReason).toBe('answered');
  });

  it('사용자가 중단하면 aborted로 끝난다', async () => {
    const ac = new AbortController();
    const chat = vi.fn(async () => {
      ac.abort();
      return turn('', [toolCall('read_page')]);
    });

    const out = await runAgentLoop(seed, deps({ chat }), { signal: ac.signal });
    expect(out.stopReason).toBe('aborted');
  });
});

describe('승인 게이트 (Phase 5-3 / §7)', () => {
  it('승인 전에는 execute가 절대 불리지 않는다', async () => {
    const { fn } = scriptedChat([turn('', [toolCall('click', { selector: '#buy' })])]);
    const execute = vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, detail: '클릭' }));
    const order: string[] = [];

    await runAgentLoop(
      seed,
      deps({
        chat: fn,
        execute: async () => {
          order.push('execute');
          return execute();
        },
        approve: async () => {
          order.push('approve');
          return true;
        },
      }),
      { maxTurns: 1 },
    );

    expect(order).toEqual(['approve', 'execute']);
  });

  it('거부하면 실행하지 않고, 같은 동작을 다시 묻지 않는다', async () => {
    // 모델이 거부당한 뒤에도 같은 클릭을 고집하는 경우.
    const { fn } = scriptedChat([turn('', [toolCall('click', { selector: '#buy' })])]);
    const execute = vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, detail: '클릭' }));
    const approve = vi.fn(async () => false);

    const out = await runAgentLoop(seed, deps({ chat: fn, execute, approve }), { maxTurns: 3 });

    expect(execute).not.toHaveBeenCalled();
    expect(approve).toHaveBeenCalledTimes(1); // 두 번째부터는 묻지 않는다
    expect(out.steps[0]).toMatchObject({ tool: 'click', ok: false, approved: false });
  });

  it('승인 카드에는 우리가 만든 설명과 페이지 정보가 들어간다', async () => {
    const { fn } = scriptedChat([turn('', [toolCall('click', { selector: '#buy' })])]);
    const approve = vi.fn(async () => false);

    await runAgentLoop(
      seed,
      deps({
        chat: fn,
        approve,
        describeTarget: async () => '<button> "구매하기"',
        currentPage: () => ({ url: 'https://shop.example/item', title: '상품' }),
      }),
      { maxTurns: 1 },
    );

    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        humanDescription: expect.stringContaining('구매하기'),
        targetLabel: '<button> "구매하기"',
        pageUrl: 'https://shop.example/item',
        pageTitle: '상품',
      }),
    );
  });

  it('대상 확인이 실패하면 승인과 실행을 진행하지 않는다', async () => {
    const { fn } = scriptedChat([turn('', [toolCall('click', { selector: '#x' })])]);
    const approve = vi.fn(async () => false);

    const result = await runAgentLoop(
      seed,
      deps({
        chat: fn,
        approve,
        describeTarget: async () => {
          throw new Error('페이지 접근 실패');
        },
      }),
      { maxTurns: 1 },
    );

    expect(approve).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('tool-failed');
  });

  it('부작용이 없는 도구는 묻지 않는다', async () => {
    const { fn } = scriptedChat([turn('', [toolCall('read_page')]), turn('끝')]);
    const approve = vi.fn(async () => true);

    await runAgentLoop(seed, deps({ chat: fn, approve }));
    expect(approve).not.toHaveBeenCalled();
  });
});

describe('오류 되돌리기 (Phase 5-4)', () => {
  it('잘못된 호출은 자연어로 되돌리고 한 번 더 기회를 준다', async () => {
    const { fn, seen } = scriptedChat([
      turn('', [toolCall('click', {})]), // selector 없음
      turn('', [toolCall('read_page')]),
      turn('다 했습니다'),
    ]);

    const out = await runAgentLoop(seed, deps({ chat: fn }));

    expect(out.stopReason).toBe('answered');
    const retryMsg = seen[1]!.find((m) => m.role === 'tool');
    expect(retryMsg?.content).toContain('selector');
    expect(out.steps[0]).toMatchObject({ ok: false });
  });

  it('연속 실패가 재시도 한도를 넘으면 멈춘다', async () => {
    const { fn } = scriptedChat([turn('', [toolCall('click_button', {})])]);
    const out = await runAgentLoop(seed, deps({ chat: fn }));

    expect(out.stopReason).toBe('tool-failed');
    expect(out.turns).toBe(2); // 최초 + 재시도 1회
  });

  it('실행 실패도 이유를 그대로 모델에게 돌려준다', async () => {
    const { fn, seen } = scriptedChat([
      turn('', [toolCall('find_element', { query: '없는버튼' })]),
      turn('해당 버튼을 찾지 못했습니다'),
    ]);
    const execute = async (): Promise<ToolOutcome> => ({
      ok: false,
      detail: "'없는버튼'에 해당하는 요소를 찾지 못했습니다.",
    });

    const out = await runAgentLoop(seed, deps({ chat: fn, execute }));

    expect(out.stopReason).toBe('answered');
    expect(seen[1]!.find((m) => m.role === 'tool')?.content).toContain('없는버튼');
  });

  it('중간에 성공하면 실패 횟수가 초기화된다', async () => {
    const script = [
      turn('', [toolCall('click', {})]), // 실패 1
      turn('', [toolCall('read_page')]), // 성공
      turn('', [toolCall('type_text', {})]), // 실패 1 (누적 아님)
      turn('', [toolCall('list_tabs')]), // 성공
      turn('끝'),
    ];
    let i = 0;
    const chat = vi.fn(async () => script[Math.min(i++, script.length - 1)]!);

    const out = await runAgentLoop(seed, deps({ chat }));
    expect(out.stopReason).toBe('answered');
  });
});

describe('화면 캡처 결과', () => {
  it('이미지는 tool 메시지가 아니라 user 메시지로 붙는다', async () => {
    const { fn, seen } = scriptedChat([turn('', [toolCall('screenshot')]), turn('차트입니다')]);
    const execute = async (): Promise<ToolOutcome> => ({
      ok: true,
      detail: '화면을 캡처했다.',
      image: 'BASE64PNG',
    });

    await runAgentLoop(seed, deps({ chat: fn, execute }));

    const withImage = seen[1]!.find((m) => m.images?.length);
    expect(withImage?.role).toBe('user');
    expect(withImage?.images).toEqual(['BASE64PNG']);
  });
});

describe('툴 결과 절단', () => {
  it('긴 결과는 예산 안으로 자르고 그 사실을 알린다', () => {
    const long = '가'.repeat(5000);
    const clamped = clampResult(long, 100);

    expect(clamped.length).toBeLessThan(long.length);
    expect(clamped).toContain('앞부분만');
  });

  it('짧은 결과는 그대로 둔다', () => {
    expect(clampResult('짧다', 700)).toBe('짧다');
  });
});

describe('실행 액션 전달', () => {
  it('파싱된 액션이 그대로 executor에 전달된다', async () => {
    const { fn } = scriptedChat([
      turn('', [toolCall('scroll', { direction: '아래로', amount: 300 })]),
      turn('끝'),
    ]);
    const seenActions: AgentAction[] = [];

    await runAgentLoop(
      seed,
      deps({
        chat: fn,
        execute: async (a) => {
          seenActions.push(a);
          return { ok: true, detail: '스크롤함' };
        },
      }),
    );

    expect(seenActions).toEqual([{ kind: 'scroll', direction: 'down', amount: 300 }]);
  });
});

/**
 * 본문에 흘린 호출 되살리기. 파서 자체는 tools.test.ts가 잡고, 여기서는
 * **루프가 그것을 승인 게이트에 태우는지**를 고정한다 — 되살렸다고 해서
 * 승인 없이 실행되면 §7의 마지막 방어선이 뚫린다.
 */
describe('본문에 흘린 호출 복구', () => {
  it('도구 호출이 0건이어도 본문의 호출문을 실행한다', async () => {
    const { fn } = scriptedChat([
      turn('scroll(direction="down")'),
      turn('내렸습니다'),
    ]);
    const out = await runAgentLoop(seed, deps({ chat: fn }));

    expect(out.steps.map((s) => s.tool)).toEqual(['scroll']);
    expect(out.content).toBe('내렸습니다');
  });

  it('되살린 호출도 승인 없이는 실행되지 않는다', async () => {
    const execute = vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, detail: '' }));
    const { fn } = scriptedChat([turn('click(selector="#buy")'), turn('멈췄습니다')]);
    const out = await runAgentLoop(
      seed,
      deps({ chat: fn, execute, approve: async () => false }),
    );

    expect(execute).not.toHaveBeenCalled();
    expect(out.steps[0]!.approved).toBe(false);
  });

  it('호출문은 답변으로 남기지 않는다 — 사용자에게 보일 문장이 아니다', async () => {
    const { fn } = scriptedChat([turn('read_page()'), turn('요약입니다')]);
    const out = await runAgentLoop(seed, deps({ chat: fn }));
    expect(out.content).not.toContain('read_page()');
  });
});
