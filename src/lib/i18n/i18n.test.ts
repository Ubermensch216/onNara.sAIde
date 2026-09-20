/**
 * 다국어 테스트. 계획서 §9 / Phase 7-4
 *
 * ★ 번역 누락은 화면에 키 이름이 그대로 뜨는 형태로만 드러난다.
 *   영어 화면을 매번 눈으로 훑을 수는 없으므로 테스트로 고정한다.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { MESSAGES, type MessageKey } from './catalog';
import { detectLocale, getLocale, setLocale, t, translate, LOCALES } from './index';

beforeEach(() => setLocale('ko'));

describe('카탈로그 완결성', () => {
  it('★ 모든 로케일이 같은 키 집합을 갖는다', () => {
    const koKeys = Object.keys(MESSAGES.ko).sort();
    for (const l of LOCALES) {
      expect(Object.keys(MESSAGES[l]).sort(), l).toEqual(koKeys);
    }
  });

  it('빈 문자열인 번역이 없다', () => {
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(MESSAGES[l])) {
        expect(v.trim().length, `${l}:${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('★ 자리표시자가 로케일 간에 일치한다', () => {
    // {sec}를 한쪽에서만 쓰면 그 언어에서 숫자가 통째로 사라진다.
    const holders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(MESSAGES.ko) as MessageKey[]) {
      for (const l of LOCALES) {
        expect(holders(MESSAGES[l][k]), `${l}:${k}`).toBe(holders(MESSAGES.ko[k]));
      }
    }
  });

  it('한국어 카탈로그에 영어만 있는 항목이 없다', () => {
    // 번역을 깜빡하고 영어를 그대로 둔 항목을 잡는다. 고유명사와, 한국어 화면에서도 'AI'로 쓰기로 정한 탭 이름은 예외.
    // 'view.due'는 탭 배지의 숫자만 넣는 자리라 어느 언어에서도 낱말이 없다(읽어 주는 문장은 view.dueLabel).
    // 'cal.weekLabel'은 "2026.09.13 ~ 2026.09.19"처럼 날짜 범위만 적는 자리라 번역할 낱말이 없다.
    // 'onboard.step'은 "2 / 3"처럼 쪽 번호만 적는 자리다.
    const allowLatin = new Set<MessageKey>(['msg.coldStart', 'view.ai', 'view.due', 'cal.weekLabel', 'onboard.step']);
    for (const k of Object.keys(MESSAGES.ko) as MessageKey[]) {
      if (allowLatin.has(k)) continue;
      expect(/[가-힣]/.test(MESSAGES.ko[k]), k).toBe(true);
    }
  });

  it('영어 카탈로그에 한글이 남아 있지 않다', () => {
    // 언어 선택 항목만 예외다. 지금 화면의 언어를 못 읽는 사람이 바로 그
    // 항목을 찾아야 하므로, 양쪽 카탈로그 모두 두 언어를 함께 적는다.
    const allowHangul = new Set<MessageKey>(['opt.display.locale']);
    for (const k of Object.keys(MESSAGES.en) as MessageKey[]) {
      if (allowHangul.has(k)) continue;
      expect(/[가-힣]/.test(MESSAGES.en[k]), k).toBe(false);
    }
  });
});

describe('translate', () => {
  it('로케일에 맞는 문자열을 준다', () => {
    expect(translate('ko', 'ui.close')).toBe('닫기');
    expect(translate('en', 'ui.close')).toBe('Close');
  });

  it('자리표시자를 채운다', () => {
    expect(translate('ko', 'conv.minAgo', { n: 5 })).toBe('5분 전');
    expect(translate('en', 'conv.minAgo', { n: 5 })).toBe('5 min ago');
  });

  it('같은 자리표시자가 여러 번 나와도 모두 채운다', () => {
    expect(translate('ko', 'agent.turn', { turn: 2, max: 8 })).toBe('에이전트 2/8턴');
  });

  it('값이 없는 자리표시자는 그대로 남긴다 (조용히 사라지지 않게)', () => {
    expect(translate('ko', 'conv.minAgo')).toContain('{n}');
  });

  it('모델 이름처럼 따옴표가 든 값도 넣는다', () => {
    expect(translate('ko', 'err.model.title', { model: 'gemma4:e2b' })).toContain('gemma4:e2b');
  });
});

describe('현재 로케일', () => {
  it('setLocale/getLocale이 맞물린다', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('ui.close')).toBe('Close');
  });

  it('t는 현재 로케일을 따른다', () => {
    setLocale('ko');
    expect(t('ui.copy')).toBe('복사');
    setLocale('en');
    expect(t('ui.copy')).toBe('Copy');
  });
});

describe('detectLocale', () => {
  it('브라우저 언어에서 고른다', () => {
    expect(['ko', 'en']).toContain(detectLocale());
  });
});

/* ── 프롬프트 로케일 (Phase 7-4) ─────────────────────── */

describe('시스템 프롬프트 로케일', () => {
  it('로케일에 따라 응답 언어 지시가 바뀐다', async () => {
    const { buildSystemPrompt } = await import('@/lib/prompts/system');
    setLocale('ko');
    expect(buildSystemPrompt()).toContain('한국어');
    setLocale('en');
    expect(buildSystemPrompt()).toContain('English');
  });

  it('★ 같은 로케일 안에서는 상수다 (KV 캐시 접두사)', async () => {
    const { buildSystemPrompt } = await import('@/lib/prompts/system');
    setLocale('ko');
    expect(buildSystemPrompt()).toBe(buildSystemPrompt());
    setLocale('en');
    expect(buildSystemPrompt()).toBe(buildSystemPrompt());
  });

  it('두 언어 모두 인젝션 가드를 담고 있다', async () => {
    const { SYSTEM_PROMPT_KO, SYSTEM_PROMPT_EN } = await import('@/lib/prompts/system');
    // 가드가 한쪽에만 있으면 그 언어 사용자만 무방비가 된다
    expect(SYSTEM_PROMPT_KO).toContain('<page_content>');
    expect(SYSTEM_PROMPT_EN).toContain('<page_content>');
  });
});
