import { abortable, deadlineSignal } from '@/lib/async';
/**
 * 에이전트 실행 루프. 계획서 §5 Phase 5-2 / 5-3 / 5-4
 *
 * ★ 이 루프의 설계 목표는 "똑똑함"이 아니라 **멈춤 보장**이다.
 *   2.3B 모델은 같은 도구를 무한히 반복하거나, 결과를 무시하고 같은 호출을
 *   되풀이하는 일이 흔하다. 한 턴이 25초인 하드웨어에서 8턴이면 이미 3분이다.
 *   그래서 종료 조건을 셋으로 못박는다(계획서 5-2).
 *
 *     MAX_TURNS      8    — 턴 수 상한
 *     IDLE_TIMEOUT   30초 — 한 턴이 이 시간 동안 아무것도 못 내놓으면 중단
 *     MAX_SAME_TOOL  3    — 동일 (도구, 인자) 조합이 3회면 강제 종료
 *
 * ★ 30초 타임아웃은 "총 턴 시간"이 아니라 **무응답 시간**으로 잰다.
 *   계획서 문구는 "턴당 30초"지만, 이 하드웨어에서 총 시간으로 재면 정상
 *   동작도 죽는다 — 툴 결과 700토큰이 붙은 턴은 프리필만 5초, thinking까지
 *   포함하면 30초를 넘기는 일이 흔하다(§6 목표도 에이전트 1턴 25초다).
 *   무응답 기준이면 "실제로 멈춘 경우"만 잡으면서 상한 정신은 지킨다.
 *   프리필 침묵의 최댓값은 2,600토큰 기준 약 20초라 30초 안에 들어온다.
 *
 * ★ 이 파일은 chrome API도 fetch도 직접 부르지 않는다. 전부 주입받는다.
 *   그래야 확장을 띄우지 않고 루프의 종료 조건을 단위 테스트할 수 있다.
 */

import type { ApprovalRequest } from '@/lib/messaging/protocol';
import { fitToBudget } from '@/lib/extract/budget';
import { SCREENSHOT_NOTE, toolFailure, wrapToolResult } from '@/lib/prompts/agent';
import type { ChatMessage, PerfSample, ToolCall } from '@/types/ollama';
import {
  actionRequiresApproval,
  describeAction,
  parseToolCall,
  recoverToolCall,
  shortLabel,
  signatureOf,
  type AgentAction,
  type ApprovableAction,
} from './tools';

/* ── 상수 (계획서 5-2) ─────────────────────────────────── */

export const MAX_TURNS = 8;
export const IDLE_TIMEOUT_MS = 30_000;
export const MAX_SAME_TOOL = 3;
/** 툴 실행 자체의 상한. DOM 조작은 즉시 끝나야 정상이다. */
export const TOOL_TIMEOUT_MS = 15_000;
/**
 * 툴 결과 1건에 허용할 토큰.
 * read_page가 2,000토큰을 그대로 물고 오면 남은 턴마다 15초씩 더 든다.
 */
export const TOOL_RESULT_TOKENS = 700;
/** 실패한 툴 호출을 되돌려 다시 시도하게 할 횟수 (계획서 5-4: 재시도 1회). */
export const MAX_RETRIES = 1;

/* ── 결과 타입 ─────────────────────────────────────────── */

export interface ToolOutcome {
  ok: boolean;
  /** 모델에게 돌려줄 텍스트. 실패면 실패 이유. */
  detail: string;
  /** screenshot 툴 전용. base64 PNG(프리픽스 제외). */
  image?: string;
}

/** 화면에 한 줄로 보여줄 실행 기록. 메시지와 함께 영구 저장된다. */
export interface AgentStep {
  turn: number;
  /** 파싱에 실패했으면 액션이 없다 — 모델이 부른 이름만 남는다. */
  tool: string;
  label: string;
  ok: boolean;
  detail: string;
  /** 승인 대상이었던 경우에만 존재. false면 사용자가 거부했다. */
  approved?: boolean;
  ms: number;
}

export type StopReason =
  /** 모델이 도구 없이 답을 내놓았다. 정상 종료. */
  | 'answered'
  | 'max-turns'
  | 'repeat-guard'
  | 'tool-failed'
  | 'timeout'
  | 'aborted'
  | 'error';

export interface AgentOutcome {
  content: string;
  thinking: string;
  steps: AgentStep[];
  stopReason: StopReason;
  turns: number;
  /** 마지막 턴의 성능 샘플. 계측은 턴 단위로만 의미가 있다. */
  perf: PerfSample | null;
  /** 정상 종료가 아닐 때 사용자에게 보여줄 한 줄. */
  notice?: string;
}

/* ── 주입받는 것들 ─────────────────────────────────────── */

export interface TurnHandlers {
  onToken?: (text: string) => void;
  onThinking?: (text: string) => void;
}

export interface TurnResult {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
  perf: PerfSample | null;
}

export interface AgentDeps {
  /** 한 턴의 모델 호출. 툴 스키마는 구현 쪽에서 붙인다. */
  chat: (
    messages: ChatMessage[],
    handlers: TurnHandlers,
    signal: AbortSignal,
  ) => Promise<TurnResult>;
  /** 실제 액션 수행. 승인이 필요한 액션은 승인 후에만 호출된다. */
  execute: (action: AgentAction, signal: AbortSignal) => Promise<ToolOutcome>;
  /** 승인 카드. true를 돌려주기 전에는 절대 execute를 부르지 않는다. */
  approve: (request: ApprovalRequest) => Promise<boolean>;
  /**
   * 승인 카드에 넣을 대상 요소 설명을 미리 확인한다(부작용 없음).
   * 실패하거나 시간 초과이면 승인과 실행을 중단한다.
   */
  describeTarget?: (action: AgentAction, signal: AbortSignal) => Promise<string | undefined>;
  /** 현재 페이지. 승인 카드에 "어느 페이지에서 일어나는 일인지" 띄운다. */
  currentPage?: () => { url: string; title: string };
  onEvent?: (e: AgentEvent) => void;
}

export type AgentEvent =
  | { type: 'turn-start'; turn: number }
  | { type: 'step'; step: AgentStep }
  | { type: 'approval-start'; request: ApprovalRequest }
  | { type: 'approval-end'; approved: boolean };

export interface AgentOptions {
  maxTurns?: number;
  idleTimeoutMs?: number;
  maxSameTool?: number;
  toolTimeoutMs?: number;
  toolResultTokens?: number;
  signal?: AbortSignal;
}

/* ── 루프 ──────────────────────────────────────────────── */

export async function runAgentLoop(
  seed: ChatMessage[],
  deps: AgentDeps,
  opts: AgentOptions = {},
): Promise<AgentOutcome> {
  const maxTurns = opts.maxTurns ?? MAX_TURNS;
  const idleMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const maxSame = opts.maxSameTool ?? MAX_SAME_TOOL;
  const toolMs = opts.toolTimeoutMs ?? TOOL_TIMEOUT_MS;
  const resultTokens = opts.toolResultTokens ?? TOOL_RESULT_TOKENS;

  const messages = [...seed];
  const steps: AgentStep[] = [];
  const seen = new Map<string, number>();
  /** 사용자가 이미 거부한 동작. 두 번 묻지 않는다. */
  const denied = new Set<string>();

  let content = '';
  let thinking = '';
  let perf: PerfSample | null = null;
  let failures = 0;
  let turn = 0;

  const done = (stopReason: StopReason, notice?: string): AgentOutcome => ({
    content,
    thinking,
    steps,
    stopReason,
    turns: turn,
    perf,
    notice,
  });

  while (turn < maxTurns) {
    turn += 1;
    deps.onEvent?.({ type: 'turn-start', turn });

    // ── 모델 호출 (무응답 30초 감시) ──
    //
    // ★ content는 턴마다 새로 받는다. 누적하면 도구를 부르기 전에 흘린
    //   "확인해 보겠습니다" 같은 문장이 최종 답변 앞에 붙어 남는다.
    //   thinking은 반대로 누적한다 — 사용자가 접이식 UI에서 전 과정을 본다.
    let turnContent = '';
    let turnThinking = '';

    const guard = idleGuard(idleMs, opts.signal);
    let result: TurnResult;
    try {
      result = await abortable(deps.chat(
        messages,
        {
          onToken: (t) => {
            guard.bump();
            turnContent += t;
          },
          onThinking: (t) => {
            guard.bump();
            turnThinking += t;
          },
        },
        guard.signal,
      ), guard.signal);
    } catch (e) {
      if (opts.signal?.aborted) return done('aborted');
      content = turnContent || content;
      thinking = joinThinking(thinking, turnThinking);
      if (guard.timedOut) {
        return done(
          'timeout',
          `${Math.round(idleMs / 1000)}초 동안 응답이 없어 중단했습니다.`,
        );
      }
      throw e;
    } finally {
      guard.dispose();
    }

    perf = result.perf ?? perf;
    // 스트리밍으로 받은 값과 반환값 중 더 완전한 쪽을 쓴다.
    content = result.content || turnContent;
    thinking = joinThinking(thinking, result.thinking || turnThinking);

    if (opts.signal?.aborted) return done('aborted');

    // ── 도구를 부르지 않았다 = 답변 완료 ──
    //
    // ★ 다만 본문에 호출문을 써 버린 경우는 한 번 주워 담는다(tools.ts 참조).
    //   `#q 에 hello 를 입력해`처럼 모델의 판단은 맞았는데 형식만 깨진 사례가
    //   실측에서 반복됐다. 되살린 호출도 승인 게이트를 똑같이 지난다.
    const recovered =
      result.toolCalls.length === 0 ? recoverToolCall(content) : null;
    if (result.toolCalls.length === 0 && !recovered) return done('answered');

    // ★ 한 턴 한 액션(계획서 §5). 모델이 여러 개를 뱉어도 첫 번째만 쓴다.
    //   여러 액션을 한꺼번에 실행하면 승인 카드가 겹치고, 실패 시 어디까지
    //   진행됐는지 사용자에게 설명할 수 없게 된다.
    const call = result.toolCalls[0] ?? recovered!;
    // 본문에서 되살렸다면 그 호출문은 답변이 아니다. 화면에 남기지 않는다.
    if (recovered) content = '';
    const startedAt = Date.now();

    // 모델의 호출을 이력에 남겨야 다음 턴에서 자기가 뭘 했는지 안다.
    messages.push({
      role: 'assistant',
      content: result.content,
      tool_calls: [call],
    });

    const parsed = parseToolCall(call);
    if (!parsed.ok) {
      failures += 1;
      const step: AgentStep = {
        turn,
        tool: call.function?.name ?? '(이름 없음)',
        label: `잘못된 호출 · ${call.function?.name ?? ''}`,
        ok: false,
        detail: parsed.error,
        ms: Date.now() - startedAt,
      };
      steps.push(step);
      deps.onEvent?.({ type: 'step', step });

      if (failures > MAX_RETRIES) {
        return done('tool-failed', '도구 호출이 계속 실패해 중단했습니다.');
      }
      messages.push(toolMessage(call, parsed.error));
      continue;
    }

    const action = parsed.action;
    const signature = signatureOf(action);

    // ── 무한루프 차단 ──
    const count = (seen.get(signature) ?? 0) + 1;
    seen.set(signature, count);
    if (count > maxSame) {
      return done(
        'repeat-guard',
        `같은 동작(${shortLabel(action)})을 ${maxSame}번 넘게 반복해 중단했습니다.`,
      );
    }

    // ── 승인 게이트 (계획서 5-3 / §7) ──
    // ★ 자동 승인도, "이 세션에서 다시 묻지 않기"도 없다. 여기가 마지막 방어선이다.
    let approved: boolean | undefined;
    if (actionRequiresApproval(action)) {
      if (denied.has(signature)) {
        // 이미 거부한 동작이다. 다시 묻는 것은 사용자를 지치게 만드는 일이고,
        // 지친 사용자는 승인 버튼을 습관적으로 누르게 된다.
        const step = mkStep(turn, action, false, '사용자가 이미 거부한 동작입니다.', startedAt, false);
        steps.push(step);
        deps.onEvent?.({ type: 'step', step });
        messages.push(
          toolMessage(call, '사용자가 이미 거부한 동작이다. 다시 시도하지 말고 지금까지 결과로 답한다.'),
        );
        continue;
      }

      let request: ApprovalRequest;
      try { request = await buildApproval(action, deps, opts.signal); }
      catch (error) {
        return done(opts.signal?.aborted ? 'aborted' : 'tool-failed', String(error));
      }
      deps.onEvent?.({ type: 'approval-start', request });
      try { approved = await abortable(deps.approve(request), opts.signal); }
      catch (error) { if (opts.signal?.aborted) return done('aborted'); throw error; }
      deps.onEvent?.({ type: 'approval-end', approved });

      if (opts.signal?.aborted) return done('aborted');

      if (!approved) {
        denied.add(signature);
        const step = mkStep(turn, action, false, '사용자가 거부했습니다.', startedAt, false);
        steps.push(step);
        deps.onEvent?.({ type: 'step', step });
        messages.push(
          toolMessage(call, '사용자가 이 동작을 거부했다. 실행하지 않았다. 다른 방법을 찾거나 여기서 멈추고 설명한다.'),
        );
        continue;
      }
    }

    // ── 실행 ──
    let outcome: ToolOutcome;
    const exec = idleGuard(toolMs, opts.signal);
    try {
      exec.bump();
      outcome = await abortable(deps.execute(action, exec.signal), exec.signal);
    } catch (e) {
      if (opts.signal?.aborted) return done('aborted');
      outcome = {
        ok: false,
        detail: exec.timedOut ? `${Math.round(toolMs / 1000)}초 안에 끝나지 않았다.` : String(e),
      };
    } finally {
      exec.dispose();
    }

    const step = mkStep(turn, action, outcome.ok, outcome.detail, startedAt, approved);
    steps.push(step);
    deps.onEvent?.({ type: 'step', step });

    if (!outcome.ok) {
      failures += 1;
      if (failures > MAX_RETRIES) {
        return done('tool-failed', '도구 실행이 계속 실패해 중단했습니다.');
      }
      messages.push(toolMessage(call, toolFailure(outcome.detail)));
      continue;
    }

    failures = 0;
    messages.push(toolMessage(call, wrapToolResult(clampResult(outcome.detail, resultTokens))));

    // 이미지는 tool 역할로 보낼 수 없다. 바로 뒤에 user 메시지로 한 번 더 넣는다.
    if (outcome.image) {
      messages.push({ role: 'user', content: SCREENSHOT_NOTE, images: [outcome.image] });
    }
  }

  return done('max-turns', `${maxTurns}턴 안에 끝내지 못해 중단했습니다.`);
}

/* ── 보조 ──────────────────────────────────────────────── */

function mkStep(
  turn: number,
  action: AgentAction,
  ok: boolean,
  detail: string,
  startedAt: number,
  approved?: boolean,
): AgentStep {
  return {
    turn,
    tool: action.kind,
    label: shortLabel(action),
    ok,
    detail,
    approved,
    ms: Date.now() - startedAt,
  };
}

/** 턴별 추론 텍스트를 이어 붙인다. 사용자는 접이식 UI에서 전 과정을 본다. */
function joinThinking(prev: string, next: string): string {
  if (!next) return prev;
  return prev ? `${prev}\n\n${next}` : next;
}

function toolMessage(call: ToolCall, content: string): ChatMessage {
  return { role: 'tool', content, tool_name: call.function?.name ?? 'unknown' };
}

/** 툴 결과가 남은 턴 전부를 비싸게 만들지 않도록 자른다. */
export function clampResult(text: string, budgetTokens: number): string {
  const fitted = fitToBudget(text, budgetTokens);
  return fitted.truncated ? `${fitted.text}\n…(결과가 길어 앞부분만 전달함)` : fitted.text;
}

async function buildApproval(
  action: ApprovableAction,
  deps: AgentDeps,
  signal?: AbortSignal,
): Promise<ApprovalRequest> {
  let targetLabel: string | undefined;
  if (deps.describeTarget) {
    const guard = deadlineSignal(TOOL_TIMEOUT_MS, signal);
    try { targetLabel = await abortable(deps.describeTarget(action, guard.signal), guard.signal); }
    finally { guard.dispose(); }
  }

  const page = deps.currentPage?.() ?? { url: '', title: '' };
  return {
    action,
    humanDescription: describeAction(action, targetLabel),
    targetLabel,
    pageUrl: page.url,
    pageTitle: page.title,
  };
}

/**
 * 무응답 감시기.
 *
 * bump()가 불릴 때마다 시계를 되감는다. 정해진 시간 동안 한 번도 불리지
 * 않으면 signal을 끊는다. 바깥 중단(사용자의 '중단' 버튼)도 함께 전달한다.
 */
export function idleGuard(
  ms: number,
  outer?: AbortSignal,
): { signal: AbortSignal; bump: () => void; dispose: () => void; timedOut: boolean } {
  const ac = new AbortController();
  const state = { timedOut: false };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onOuter = () => {
    if (timer) clearTimeout(timer);
    ac.abort();
  };
  if (outer) {
    if (outer.aborted) ac.abort();
    else outer.addEventListener('abort', onOuter, { once: true });
  }

  const bump = () => {
    if (ac.signal.aborted) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      state.timedOut = true;
      ac.abort();
    }, ms);
  };
  bump();

  return {
    signal: ac.signal,
    bump,
    dispose: () => {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    },
    get timedOut() {
      return state.timedOut;
    },
  };
}
