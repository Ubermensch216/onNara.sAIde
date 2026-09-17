import { describe, expect, it } from 'vitest';
import {
  actionRequiresApproval,
  AGENT_TOOLS,
  describeAction,
  isPageAction,
  normalizeUrl,
  parseToolCall,
  signatureOf,
  TOOL_NAMES,
  recoverToolCall,
} from './tools';
import type { ToolCall } from '@/types/ollama';

function call(name: string, args: unknown = {}): ToolCall {
  return { id: 'call_1', function: { index: 0, name, arguments: args as Record<string, unknown> } };
}

describe('AGENT_TOOLS 스키마 (Phase 5-1)', () => {
  it('계약대로 8종이며 이름이 TOOL_NAMES와 일치한다', () => {
    expect(AGENT_TOOLS).toHaveLength(8);
    expect(AGENT_TOOLS.map((t) => t.function.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  // 계획서 §5: 파라미터 3개 이하. 늘어날수록 소형 모델의 선택 정확도가 떨어진다.
  it('툴당 파라미터가 3개를 넘지 않는다', () => {
    for (const t of AGENT_TOOLS) {
      expect(Object.keys(t.function.parameters.properties).length).toBeLessThanOrEqual(3);
    }
  });

  it('required는 모두 properties에 존재한다', () => {
    for (const t of AGENT_TOOLS) {
      const props = Object.keys(t.function.parameters.properties);
      for (const r of t.function.parameters.required) expect(props).toContain(r);
    }
  });
});

describe('parseToolCall — 정상 경로', () => {
  it('인자 없는 툴 3종', () => {
    expect(parseToolCall(call('read_page'))).toEqual({ ok: true, action: { kind: 'read_page' } });
    expect(parseToolCall(call('list_tabs'))).toEqual({ ok: true, action: { kind: 'list_tabs' } });
    expect(parseToolCall(call('screenshot'))).toEqual({ ok: true, action: { kind: 'screenshot' } });
  });

  it('find_element / click / type_text / navigate', () => {
    expect(parseToolCall(call('find_element', { query: '로그인' }))).toEqual({
      ok: true,
      action: { kind: 'find_element', query: '로그인' },
    });
    expect(parseToolCall(call('click', { selector: '#submit' }))).toEqual({
      ok: true,
      action: { kind: 'click', selector: '#submit' },
    });
    expect(parseToolCall(call('type_text', { selector: '#q', text: '사이드' }))).toEqual({
      ok: true,
      action: { kind: 'type_text', selector: '#q', text: '사이드' },
    });
    expect(parseToolCall(call('navigate', { url: 'https://example.com/a' }))).toEqual({
      ok: true,
      action: { kind: 'navigate', url: 'https://example.com/a' },
    });
  });

  it('scroll은 amount가 없으면 필드를 만들지 않는다', () => {
    expect(parseToolCall(call('scroll', { direction: 'down' }))).toEqual({
      ok: true,
      action: { kind: 'scroll', direction: 'down' },
    });
    expect(parseToolCall(call('scroll', { direction: 'DOWN', amount: '400' }))).toEqual({
      ok: true,
      action: { kind: 'scroll', direction: 'down', amount: 400 },
    });
  });

  it('한국어 방향어를 받아준다 — 되묻는 턴 하나가 25초다', () => {
    const r = parseToolCall(call('scroll', { direction: '아래로' }));
    expect(r).toEqual({ ok: true, action: { kind: 'scroll', direction: 'down' } });
  });
});

describe('parseToolCall — 모델의 흔한 이탈 (Phase 5-4)', () => {
  it('없는 툴 이름이면 쓸 수 있는 목록을 알려준다', () => {
    const r = parseToolCall(call('open_tab', { url: 'https://a.com' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('open_tab');
      for (const n of TOOL_NAMES) expect(r.error).toContain(n);
    }
  });

  it('필수 인자가 없으면 어떤 인자인지 지목한다', () => {
    const r = parseToolCall(call('click', {}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('selector');
  });

  it('인자 이름을 바꿔 불러도 받아준다', () => {
    expect(parseToolCall(call('click', { element: '로그인 버튼' }))).toEqual({
      ok: true,
      action: { kind: 'click', selector: '로그인 버튼' },
    });
    expect(parseToolCall(call('type_text', { field: '#q', value: 'abc' }))).toEqual({
      ok: true,
      action: { kind: 'type_text', selector: '#q', text: 'abc' },
    });
  });

  it('arguments가 JSON 문자열로 와도 파싱한다', () => {
    const r = parseToolCall(call('find_element', '{"query":"구매"}'));
    expect(r).toEqual({ ok: true, action: { kind: 'find_element', query: '구매' } });
  });

  it('빈 문자열 입력은 유효한 값으로 본다 (입력칸 비우기)', () => {
    expect(parseToolCall(call('type_text', { selector: '#q', text: '' }))).toEqual({
      ok: true,
      action: { kind: 'type_text', selector: '#q', text: '' },
    });
  });

  it('scroll 방향이 엉뚱하면 허용값을 알려준다', () => {
    const r = parseToolCall(call('scroll', { direction: 'sideways' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('up, down, top, bottom');
  });
});

describe('URL 정규화 — 스킴 차단 (§7)', () => {
  it('javascript:, data:, file: 을 거부한다', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('data:text/html,<h1>x')).toBeNull();
    expect(normalizeUrl('file:///C:/secret.txt')).toBeNull();
  });

  it('스킴이 없으면 https를 붙인다', () => {
    expect(normalizeUrl('example.com/path')).toBe('https://example.com/path');
  });

  it('navigate가 거부된 스킴을 자연어로 되돌린다', () => {
    const r = parseToolCall(call('navigate', { url: 'javascript:alert(1)' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('http');
  });
});

describe('승인 대상 판정 (Phase 5-3)', () => {
  it('부작용 3종만 승인을 요구한다', () => {
    expect(actionRequiresApproval({ kind: 'click', selector: 'a' })).toBe(true);
    expect(actionRequiresApproval({ kind: 'type_text', selector: 'a', text: 'b' })).toBe(true);
    expect(actionRequiresApproval({ kind: 'navigate', url: 'https://a.com/' })).toBe(true);

    expect(actionRequiresApproval({ kind: 'read_page' })).toBe(false);
    expect(actionRequiresApproval({ kind: 'find_element', query: 'a' })).toBe(false);
    expect(actionRequiresApproval({ kind: 'list_tabs' })).toBe(false);
    expect(actionRequiresApproval({ kind: 'screenshot' })).toBe(false);
    expect(actionRequiresApproval({ kind: 'scroll', direction: 'down' })).toBe(false);
  });

  it('서비스 워커가 처리하는 두 가지는 페이지 액션이 아니다', () => {
    expect(isPageAction({ kind: 'list_tabs' })).toBe(false);
    expect(isPageAction({ kind: 'screenshot' })).toBe(false);
    expect(isPageAction({ kind: 'click', selector: '#a' })).toBe(true);
  });
});

describe('승인 카드 문구', () => {
  it('대상 라벨이 있으면 선택자 대신 사람이 읽는 이름을 쓴다', () => {
    const withLabel = describeAction({ kind: 'click', selector: '#s' }, '<button> "제출"');
    expect(withLabel).toContain('제출');
    expect(withLabel).not.toContain('#s');
  });

  it('라벨이 없으면 선택자를 그대로 보여준다 — 무엇을 누르는지 감추지 않는다', () => {
    expect(describeAction({ kind: 'click', selector: '#s' })).toContain('#s');
  });
});

describe('signatureOf — 무한루프 판정 기준', () => {
  it('인자가 다르면 다른 동작으로 센다', () => {
    expect(signatureOf({ kind: 'click', selector: '#a' })).not.toBe(
      signatureOf({ kind: 'click', selector: '#b' }),
    );
  });

  it('같은 호출은 같은 지문이다', () => {
    expect(signatureOf({ kind: 'scroll', direction: 'down', amount: 100 })).toBe(
      signatureOf({ kind: 'scroll', direction: 'down', amount: 100 }),
    );
  });
});

describe('recoverToolCall — 본문에 흘린 호출 되살리기', () => {
  it('gemma가 따옴표 토큰째 흘린 호출을 읽는다 (실측 사례)', () => {
    const call = recoverToolCall('type_text{selector:<|"|>#q<|"|>,text:<|"|>hello<|"|>}');
    expect(call).not.toBeNull();
    expect(parseToolCall(call!)).toEqual({
      ok: true,
      action: { kind: 'type_text', selector: '#q', text: 'hello' },
    });
  });

  it('괄호와 등호로 쓴 형태도 읽는다', () => {
    const call = recoverToolCall('먼저 scroll(direction="up") 하겠습니다.');
    expect(parseToolCall(call!)).toEqual({
      ok: true,
      action: { kind: 'scroll', direction: 'up' },
    });
  });

  it('JSON 형태도 읽는다', () => {
    const call = recoverToolCall('navigate({"url": "https://example.com"})');
    expect(parseToolCall(call!)).toEqual({
      ok: true,
      action: { kind: 'navigate', url: 'https://example.com/' },
    });
  });

  it('인자 없는 도구도 읽는다', () => {
    expect(recoverToolCall('read_page()')?.function.name).toBe('read_page');
  });

  it('숫자 인자는 숫자로 읽는다', () => {
    expect(parseToolCall(recoverToolCall('scroll(direction=down, amount=500)')!)).toEqual({
      ok: true,
      action: { kind: 'scroll', direction: 'down', amount: 500 },
    });
  });

  // ★ 여기서 과하게 주우면 평범한 설명문이 동작으로 바뀐다. 승인 카드가 있어도
  //   사용자에게 뜬금없는 카드를 띄우는 것 자체가 게이트를 무디게 만든다.
  it('도구 이름을 언급만 한 문장은 호출로 보지 않는다', () => {
    expect(recoverToolCall('read_page 도구로 본문을 읽어보겠습니다.')).toBeNull();
    expect(recoverToolCall('클릭하려면 click 도구가 필요합니다')).toBeNull();
  });

  it('없는 도구 이름은 줍지 않는다', () => {
    expect(recoverToolCall('open_tab({"url":"https://x.com"})')).toBeNull();
  });
});
