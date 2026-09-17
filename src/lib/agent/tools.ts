/**
 * 툴 스키마와 인자 검증. 계획서 §5 Phase 5-1 / 5-4
 *
 * ★ 상대는 2.3B 모델이다. 이 파일의 전제는 "모델이 스키마를 자주 어긴다"이다.
 *   실제로 자주 나오는 이탈은 셋이다.
 *     ① 없는 툴 이름을 지어낸다 (`open_tab`, `search` …)
 *     ② 필수 인자를 빼먹거나 이름을 바꾼다 (`selector` → `element`)
 *     ③ CSS 선택자 자리에 사람 말을 넣는다 ("로그인 버튼")
 *
 *   ①②는 여기서 잡아 **자연어 오류 문장**으로 되돌린다(5-4). 모델이 읽고
 *   고칠 수 있는 문장이어야 하므로 스택 트레이스가 아니라 지시문으로 쓴다.
 *   ③은 오류로 처리하지 않는다 — injected.ts가 선택자 실패 시 텍스트 검색으로
 *   대신 찾아준다. 소형 모델에게 정확한 CSS를 요구하는 편이 비현실적이다.
 *
 * ★ 툴은 8종을 넘기지 않고, 파라미터는 툴당 3개 이하로 유지한다(계획서 §5).
 *   목록이 길어질수록 선택 정확도가 떨어지고 프리필도 비싸진다.
 */

import type { PageAction } from '@/lib/messaging/protocol';
import { SIDE_EFFECT_ACTIONS } from '@/lib/messaging/protocol';
import type { ToolCall, ToolSchema } from '@/types/ollama';

/**
 * 에이전트가 쓸 수 있는 액션.
 *
 * PageAction(주입 스크립트가 페이지에서 수행)에 서비스 워커가 처리하는
 * 두 가지를 더한 것이다. describe_target은 승인 카드 준비용이라 모델에게
 * 노출하지 않는다.
 */
export type AgentAction =
  | Exclude<PageAction, { kind: 'describe_target' }>
  | { kind: 'list_tabs' }
  | { kind: 'screenshot' };

export type ToolName = AgentAction['kind'];

/** 모델에게 노출하는 툴 이름 8종. 이 배열이 곧 계약이다. */
export const TOOL_NAMES = [
  'read_page',
  'find_element',
  'list_tabs',
  'screenshot',
  'scroll',
  'click',
  'type_text',
  'navigate',
] as const satisfies readonly ToolName[];

const SCROLL_DIRECTIONS = ['up', 'down', 'top', 'bottom'] as const;
type ScrollDirection = (typeof SCROLL_DIRECTIONS)[number];

/**
 * /api/chat에 그대로 실어 보내는 스키마.
 *
 * 설명문은 짧게 쓴다. 툴 8종의 설명이 통째로 매 턴 프리필에 들어가므로,
 * 한 줄이 길어질수록 모든 턴이 느려진다(131 tok/s).
 */
export const AGENT_TOOLS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'read_page',
      description:
        '페이지에 적힌 글의 내용을 읽는다. 무슨 내용인지 묻거나 요약이 필요할 때 쓴다. 버튼·링크를 찾는 용도가 아니다.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_element',
      description:
        '버튼·링크·입력칸이 화면에 있는지 찾는다. "~버튼 있어?", "~창 어디 있어?", "~링크 찾아줘"에는 이 도구를 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '찾을 요소의 표시 텍스트. 예: "로그인"' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: '현재 창에 열려 있는 탭 목록(제목과 주소)을 가져온다.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description:
        '지금 화면을 캡처해 이미지로 본다. 차트·그림처럼 글로 읽히지 않는 내용을 확인할 때 쓴다.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: '페이지를 위아래로 스크롤한다.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            description: '스크롤 방향',
            enum: [...SCROLL_DIRECTIONS],
          },
          amount: { type: 'integer', description: '이동할 픽셀 수. 생략하면 한 화면.' },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: '페이지의 요소를 클릭한다. 사용자 승인을 받은 뒤에만 실행된다.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS 선택자. 모르면 버튼에 적힌 글자를 그대로 써도 된다.',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: '입력칸에 글자를 넣는다. 사용자 승인을 받은 뒤에만 실행된다.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS 선택자. 모르면 입력칸을 가리키는 말을 그대로 써도 된다. 예: "검색창"',
          },
          text: { type: 'string', description: '입력할 내용' },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: '현재 탭을 다른 주소로 이동한다. 사용자 승인을 받은 뒤에만 실행된다.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http 또는 https 주소' },
        },
        required: ['url'],
      },
    },
  },
];

/* ── 인자 파싱 ─────────────────────────────────────────── */

export type ParseResult =
  | { ok: true; action: AgentAction }
  /** 모델에게 되돌릴 문장. 사람이 아니라 모델이 읽는다. */
  | { ok: false; error: string };

/**
 * ★ Ollama는 arguments를 **이미 파싱된 객체**로 준다. JSON.parse 하지 않는다.
 *   (계약 ① 주석 참조. 문자열로 오는 구현을 대비해 한 번만 방어한다.)
 */
export function parseToolCall(call: ToolCall): ParseResult {
  const name = call.function?.name?.trim();
  const args = normalizeArgs(call.function?.arguments);

  switch (name) {
    case 'read_page':
      return { ok: true, action: { kind: 'read_page' } };
    case 'list_tabs':
      return { ok: true, action: { kind: 'list_tabs' } };
    case 'screenshot':
      return { ok: true, action: { kind: 'screenshot' } };

    case 'find_element': {
      const query = str(args, 'query', 'text', 'label', 'element');
      if (!query) return missing('find_element', 'query');
      return { ok: true, action: { kind: 'find_element', query } };
    }

    case 'scroll': {
      const dir = normalizeDirection(str(args, 'direction', 'dir', 'to'));
      if (!dir) {
        return {
          ok: false,
          error:
            'scroll의 direction이 잘못되었다. up, down, top, bottom 중 하나를 써서 다시 호출한다.',
        };
      }
      const amount = int(args, 'amount', 'pixels', 'distance');
      return {
        ok: true,
        action:
          amount === null
            ? { kind: 'scroll', direction: dir }
            : { kind: 'scroll', direction: dir, amount },
      };
    }

    case 'click': {
      const selector = str(args, 'selector', 'element', 'target', 'query', 'text');
      if (!selector) return missing('click', 'selector');
      return { ok: true, action: { kind: 'click', selector } };
    }

    case 'type_text': {
      const selector = str(args, 'selector', 'element', 'target', 'field');
      if (!selector) return missing('type_text', 'selector');
      const text = str(args, 'text', 'value', 'content');
      if (text === null) return missing('type_text', 'text');
      return { ok: true, action: { kind: 'type_text', selector, text } };
    }

    case 'navigate': {
      const raw = str(args, 'url', 'href', 'address', 'link');
      if (!raw) return missing('navigate', 'url');
      const url = normalizeUrl(raw);
      if (!url) {
        return {
          ok: false,
          error: `navigate의 url '${raw}'는 이동할 수 없다. http 또는 https로 시작하는 주소만 쓸 수 있다.`,
        };
      }
      return { ok: true, action: { kind: 'navigate', url } };
    }

    default:
      return {
        ok: false,
        error:
          `'${name ?? ''}'는 없는 도구다. 쓸 수 있는 도구는 ${TOOL_NAMES.join(', ')}뿐이다.` +
          ' 이 중에서 다시 고르거나, 도구 없이 답한다.',
      };
  }
}

function missing(tool: string, param: string): ParseResult {
  return {
    ok: false,
    error: `${tool} 호출에 필수 인자 '${param}'가 없다. '${param}' 값을 넣어 다시 호출한다.`,
  };
}

function normalizeArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(raw) ? raw : {};
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 키 후보를 순서대로 찾는다. 모델이 인자 이름을 바꿔 부르는 일이 잦다.
 * 빈 문자열도 유효한 값으로 본다(입력칸 비우기).
 */
function str(args: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string') return v.trim() ? v.trim() : v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return null;
}

function int(args: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v, 10);
  }
  return null;
}

function normalizeDirection(v: string | null): ScrollDirection | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if ((SCROLL_DIRECTIONS as readonly string[]).includes(s)) return s as ScrollDirection;
  // 한국어와 흔한 변형을 받아준다. 여기서 막아 봐야 되묻는 턴만 25초 더 든다.
  if (['아래', '아래로', '밑', 'downward', 'forward'].includes(s)) return 'down';
  if (['위', '위로', 'upward', 'back'].includes(s)) return 'up';
  if (['맨위', '맨 위', 'start', 'beginning'].includes(s)) return 'top';
  if (['맨아래', '맨 아래', 'end'].includes(s)) return 'bottom';
  return null;
}

/**
 * 모델이 만든 URL을 정규화한다.
 *
 * ★ javascript:, data:, file: 은 여기서 끊는다. 승인 카드가 있더라도
 *   사용자가 스킴의 의미까지 판단하리라 기대하면 안 된다(§7).
 *   최종 관문은 background.ts에도 한 번 더 있다 — 이중으로 막는다.
 */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.href;
}

/* ── 본문에 흘린 호출 복구 ─────────────────────────────── */

/**
 * 모델이 **도구를 부르는 대신 본문에 호출문을 써 버린 경우**를 되살린다.
 *
 * ★ 실측(2026-08-20, type_text 10건 · scroll 10건)에서 나온 실패 유형이다.
 *   `#q 에 hello 를 입력해` → 도구 호출 0건, 본문에 이렇게 나왔다.
 *
 *     type_text{selector:<|"|>#q<|"|>,text:<|"|>hello<|"|>}
 *
 *   `<|"|>`는 gemma 계열의 따옴표 토큰이 그대로 새어 나온 것이다. 모델은
 *   호출을 했는데 템플릿이 그것을 도구 호출로 파싱하지 못했다. 즉 모델의
 *   판단은 맞았고 형식만 깨졌다 — 여기서 주워 담는다.
 *
 * ★ 되살린 호출도 승인 게이트를 그대로 지난다(§7). 본문에서 왔다는 이유로
 *   더 신뢰하지 않는다. 오히려 공격자가 페이지 본문으로 모델에게 이 문장을
 *   쓰게 만들 수 있으므로, 승인 없이 실행되는 일이 없어야 한다.
 *
 * ★ 도구 이름이 실제로 호출 형태(`이름{…}` 또는 `이름(…)`)로 쓰였을 때만
 *   인정한다. "read_page로 읽어보겠습니다" 같은 문장은 건드리지 않는다.
 */
export function recoverToolCall(content: string): ToolCall | null {
  const text = content.replace(/<\|"\|>/g, '"').replace(/<\|[^|]*\|>/g, '');
  const names = TOOL_NAMES.join('|');
  const re = new RegExp(String.raw`\b(${names})\s*(\{[^{}]*\}|\([^()]*\))`, 'g');

  const m = re.exec(text);
  if (!m) return null;

  const name = m[1]!;
  const body = m[2]!.slice(1, -1).trim();
  // id는 Ollama가 붙여 주는 값이다. 우리가 만든 호출임을 알아볼 수 있게 표시한다.
  return {
    id: 'recovered',
    function: { index: 0, name, arguments: parseLooseArgs(body) },
  };
}

/**
 * `selector:"#q", text:"hello"` 같은 느슨한 인자 목록을 읽는다.
 * JSON이면 JSON으로 읽고, 아니면 키:값 쌍을 하나씩 줍는다 — 소형 모델이
 * 흘리는 형식은 따옴표도 구분자도 일정하지 않다.
 */
function parseLooseArgs(body: string): Record<string, unknown> {
  if (!body) return {};

  try {
    const parsed: unknown = JSON.parse(`{${body.replace(/^\{|\}$/g, '')}}`);
    if (isRecord(parsed)) return parsed;
  } catch {
    // JSON이 아니면 아래 규칙으로 줍는다.
  }

  const out: Record<string, unknown> = {};
  const pair = /(["'`]?)([A-Za-z_]\w*)\1\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = pair.exec(body)) !== null) {
    const key = m[2]!;
    const value = m[3] ?? m[4] ?? (m[5] ?? '').trim();
    out[key] = /^-?\d+$/.test(value) ? Number(value) : value;
  }
  return out;
}

/* ── 승인 · 표시 ───────────────────────────────────────── */

/** 승인을 거쳐야만 실행되는 액션. 전부 PageAction이기도 하다. */
export type ApprovableAction = Extract<
  AgentAction,
  { kind: 'click' | 'type_text' | 'navigate' }
>;

export function actionRequiresApproval(action: AgentAction): action is ApprovableAction {
  return (SIDE_EFFECT_ACTIONS as readonly string[]).includes(action.kind);
}

/** 주입 스크립트로 보낼 수 있는 액션인가(서비스 워커 자체 처리와 구분). */
export function isPageAction(
  action: AgentAction,
  // AgentAction은 describe_target을 제외하므로 좁히는 타입도 같은 형태여야 한다.
  // 전체 PageAction으로 좁히면 predicate 타입이 인자 타입에 속하지 않는다(TS2677).
): action is Exclude<PageAction, { kind: 'describe_target' }> {
  return action.kind !== 'list_tabs' && action.kind !== 'screenshot';
}

/**
 * 같은 동작인지 판정하는 지문.
 * 무한루프 차단(MAX_SAME_TOOL)과 "이미 거부된 동작" 판정에 함께 쓴다.
 */
export function signatureOf(action: AgentAction): string {
  switch (action.kind) {
    case 'find_element':
      return `find_element:${action.query}`;
    case 'scroll':
      return `scroll:${action.direction}:${action.amount ?? ''}`;
    case 'click':
      return `click:${action.selector}`;
    case 'type_text':
      return `type_text:${action.selector}:${action.text}`;
    case 'navigate':
      return `navigate:${action.url}`;
    default:
      return action.kind;
  }
}

/**
 * 승인 카드에 띄울 한 문장. **모델이 쓴 문장을 그대로 보여주지 않는다.**
 * 모델 출력에 설득 문구가 섞여 들어오면 승인 게이트가 무력해진다(§7).
 */
export function describeAction(action: AgentAction, targetLabel?: string): string {
  switch (action.kind) {
    case 'click':
      return targetLabel
        ? `${targetLabel} 를 클릭합니다`
        : `'${action.selector}' 요소를 클릭합니다`;
    case 'type_text':
      return targetLabel
        ? `${targetLabel} 에 "${clip(action.text)}" 를 입력합니다`
        : `'${action.selector}' 에 "${clip(action.text)}" 를 입력합니다`;
    case 'navigate':
      return `${action.url} 로 이동합니다`;
    case 'read_page':
      return '페이지 본문을 읽습니다';
    case 'find_element':
      return `'${action.query}' 요소를 찾습니다`;
    case 'list_tabs':
      return '열려 있는 탭 목록을 확인합니다';
    case 'screenshot':
      return '화면을 캡처합니다';
    case 'scroll':
      return `페이지를 ${action.direction} 방향으로 스크롤합니다`;
  }
}

/** 단계 목록에 한 줄로 표시할 짧은 이름. */
export function shortLabel(action: AgentAction): string {
  switch (action.kind) {
    case 'read_page':
      return '본문 읽기';
    case 'find_element':
      return `요소 찾기 · ${clip(action.query, 24)}`;
    case 'list_tabs':
      return '탭 목록';
    case 'screenshot':
      return '화면 캡처';
    case 'scroll':
      return `스크롤 · ${action.direction}`;
    case 'click':
      return `클릭 · ${clip(action.selector, 24)}`;
    case 'type_text':
      return `입력 · ${clip(action.text, 24)}`;
    case 'navigate':
      return `이동 · ${clip(action.url, 32)}`;
  }
}

function clip(s: string, max = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
