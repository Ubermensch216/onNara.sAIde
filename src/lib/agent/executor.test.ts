/**
 * 액션 결과 렌더링. 계획서 §5 Phase 5-2 / 7-4
 *
 * 주입 스크립트는 페이지 컨텍스트에서 돌아 설정 저장소에 닿지 않는다. 그래서
 * 문구를 만들지 않고 코드만 돌려주고, 여기서 사용자의 언어로 편다.
 * 이 파일이 지키는 것은 **번역 지점이 하나라는 것**과 **페이지에서 온 값이
 * 문구로 오해되지 않는다는 것**이다.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { setLocale } from '@/lib/i18n';
import { MESSAGES } from '@/lib/i18n/catalog';
import type { ActionResult, ActionResultCode } from '@/lib/messaging/protocol';
import { renderResult } from './executor';

beforeEach(() => setLocale('ko'));

/** 코드마다 최소한의 vars. 실제 주입 스크립트가 채우는 것과 같은 모양이다. */
const SAMPLES: Record<ActionResultCode, ActionResult> = {
  read: { ok: true, code: 'read', text: '본문입니다' },
  described: { ok: true, code: 'described', vars: { target: '<button> "제출"' } },
  found: { ok: true, code: 'found', vars: { target: '<button> "로그인"' } },
  scrolled: { ok: true, code: 'scrolled', vars: { direction: 'down' } },
  clicked: { ok: true, code: 'clicked', vars: { target: '<button> "구매"' } },
  typed: { ok: true, code: 'typed', vars: { target: '<input> "검색"' } },
  navigated: { ok: true, code: 'navigated', vars: { url: 'https://example.com/' } },
  notFound: { ok: false, code: 'notFound', vars: { query: '로그인' } },
  noElement: { ok: false, code: 'noElement', vars: { selector: '#none' } },
  notTextInput: { ok: false, code: 'notTextInput', vars: { target: '<div>' } },
  wrongRoute: { ok: false, code: 'wrongRoute' },
};

describe('renderResult', () => {
  it('모든 코드가 두 로케일에서 문장이 된다 — 키 이름이 새지 않는다', () => {
    for (const locale of ['ko', 'en'] as const) {
      setLocale(locale);
      for (const [code, sample] of Object.entries(SAMPLES)) {
        const text = renderResult(sample);
        expect(text, `${locale}/${code}`).not.toBe('');
        // 번역이 빠지면 translate가 키를 그대로 돌려준다. 그것을 잡는다.
        expect(text, `${locale}/${code}`).not.toBe(`act.${code}`);
      }
    }
  });

  it('로케일을 바꾸면 문구가 따라 바뀐다', () => {
    const r = SAMPLES.clicked;
    setLocale('ko');
    const ko = renderResult(r);
    setLocale('en');
    expect(renderResult(r)).not.toBe(ko);
  });

  it('자리표시자가 값으로 채워진다', () => {
    expect(renderResult(SAMPLES.noElement)).toContain('#none');
    expect(renderResult(SAMPLES.navigated)).toContain('https://example.com/');
  });

  // ★ read_page 본문은 페이지에서 읽어온 데이터다. 번역 대상이 아니고,
  //   문장으로 감싸서도 안 된다 — 모델이 그 문장을 본문의 일부로 읽는다.
  it('본문은 그대로 돌려준다', () => {
    expect(renderResult(SAMPLES.read)).toBe('본문입니다');
    setLocale('en');
    expect(renderResult(SAMPLES.read)).toBe('본문입니다');
  });

  // ★ 승인 카드는 "무엇을 클릭하는지"를 보여주는 근거다(§7). 여기에 우리가
  //   만든 문장이 섞이면 사용자가 요소 이름과 설명을 구분할 수 없다.
  it('승인 카드용 대상 설명은 문장으로 감싸지 않는다', () => {
    expect(renderResult(SAMPLES.described)).toBe('<button> "제출"');
  });

  it('본문·대상이 비어 있어도 터지지 않는다', () => {
    expect(renderResult({ ok: true, code: 'read' })).toBe('');
    expect(renderResult({ ok: true, code: 'described' })).toBe('');
  });
});

describe('액션 결과 카탈로그', () => {
  /**
   * ★ 이 검사는 사실 타입 시스템이 이미 하고 있다. renderResult가 read와
   *   described를 먼저 걸러내면 TS가 나머지 코드를 좁혀 `act.${code}`를
   *   MessageKey와 대조하므로, 키를 빠뜨리면 컴파일이 깨진다.
   *   그래도 남겨 둔다 — 누군가 그 early return을 지우면 타입 검사가 조용히
   *   느슨해지는데, 이 테스트는 그때도 실패한다.
   */
  it('코드마다 ko/en 문구가 있다', () => {
    const needsMessage = (Object.keys(SAMPLES) as ActionResultCode[]).filter(
      (c) => c !== 'read' && c !== 'described',
    );
    for (const code of needsMessage) {
      const key = `act.${code}` as keyof typeof MESSAGES.ko;
      expect(MESSAGES.ko[key], `ko/${code}`).toBeTruthy();
      expect(MESSAGES.en[key], `en/${code}`).toBeTruthy();
    }
  });
});
