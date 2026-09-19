/**
 * `@일정` 의도 분류 테스트.
 *
 * ★ 모델을 부르지 않는다. 입력은 모델이 뱉었을 법한 **원시 문자열**이고, 검사 대상은
 *   그 문자열을 얼마나 안전하게 읽어내느냐다. 소형 모델은 필드를 빠뜨리고, 형식을 흐리고,
 *   JSON 앞뒤에 말을 붙인다 — 그 모든 경우에 무엇이 실행되는지가 여기 고정된다.
 */

import { describe, expect, it } from 'vitest';
import { buildIntentPrompt, normalizeDate, normalizeTime, readIntent, SCHEDULE_INTENT_SCHEMA } from './intent';

/** 2026-09-19 (토) */
const NOW = new Date(2026, 8, 19);
const read = (raw: unknown, prompt = '') => readIntent(typeof raw === 'string' ? raw : JSON.stringify(raw), prompt, NOW);

describe('readIntent — 등록', () => {
  it('제목과 기한을 읽는다', () => {
    expect(read({ intent: 'schedule.create', payload: { title: '예산안 제출', date: '2026-09-20' } }))
      .toEqual({ intent: 'schedule.create', payload: { title: '예산안 제출', date: '2026-09-20' } });
  });

  it('시각이 있으면 함께 읽는다', () => {
    const hit = read({ intent: 'schedule.create', payload: { title: '실적보고서', date: '2026-09-30', time: '18:00' } });
    expect(hit).toMatchObject({ payload: { time: '18:00' } });
  });

  it('★ 기한을 못 읽어도 오늘로 때우지 않는다 (기한 미정은 정상 상태다)', () => {
    const hit = read({ intent: 'schedule.create', payload: { title: '교육 신청 접수' } });
    expect(hit).toEqual({ intent: 'schedule.create', payload: { title: '교육 신청 접수', date: '' } });
  });

  it('★ 제목이 없으면 등록하지 않는다', () => {
    expect(read({ intent: 'schedule.create', payload: { date: '2026-09-20' } }))
      .toEqual({ intent: 'chat', payload: {}, reason: 'create_missing_title' });
  });

  it('없는 날짜는 기한으로 쓰지 않는다', () => {
    expect(read({ intent: 'schedule.create', payload: { title: 'x', date: '2026-02-30' } }))
      .toMatchObject({ payload: { date: '' } });
  });

  it('기한이 없으면 시각도 버린다 (시각만 있는 기한은 달력에 놓을 수 없다)', () => {
    expect(read({ intent: 'schedule.create', payload: { title: 'x', time: '18:00' } }))
      .toEqual({ intent: 'schedule.create', payload: { title: 'x', date: '' } });
  });
});

describe('readIntent — 조회', () => {
  it('범위를 읽는다', () => {
    expect(read({ intent: 'schedule.list', payload: { from: '2026-09-13', to: '2026-09-19' } }))
      .toEqual({ intent: 'schedule.list', payload: { from: '2026-09-13', to: '2026-09-19' } });
  });

  it('제목 검색만 있는 조회도 있다', () => {
    expect(read({ intent: 'schedule.list', payload: { query: '예산' } }, '예산 관련 뭐 남았지'))
      .toEqual({ intent: 'schedule.list', payload: { query: '예산' } });
  });

  it('거꾸로 온 범위는 뒤집는다', () => {
    expect(read({ intent: 'schedule.list', payload: { from: '2026-12-31', to: '2026-01-01' } }))
      .toMatchObject({ payload: { from: '2026-01-01', to: '2026-12-31' } });
  });

  it('★ 모델이 줄여 놓은 범위를 코드 값으로 바로잡는다', () => {
    // 참조 프로젝트에서 실제로 잦았던 실패: "5월 전체"를 이번 주로 줄인다.
    const hit = read(
      { intent: 'schedule.list', payload: { from: '2026-09-13', to: '2026-09-19' } },
      '5월 전체 일정 보여줘',
    );
    expect(hit).toMatchObject({ payload: { from: '2026-05-01', to: '2026-05-31' } });
  });

  it('★ 명백한 조회를 chat으로 흘려보내면 되돌린다', () => {
    const hit = read({ intent: 'chat', payload: {} }, '이번 주 일정 알려줘');
    expect(hit).toEqual({ intent: 'schedule.list', payload: { from: '2026-09-13', to: '2026-09-19' } });
  });

  it('조회 문장이 아니면 되돌리지 않는다', () => {
    // 날짜가 들어 있다고 조회가 되지는 않는다.
    expect(read({ intent: 'chat', payload: {} }, '내일 날씨 어때')).toMatchObject({ intent: 'chat' });
  });
});

describe('readIntent — 수정', () => {
  it('기한 변경', () => {
    expect(read({ intent: 'schedule.update', payload: { matchTitle: '실적보고서', changes: { date: '2026-10-02' } } }))
      .toEqual({ intent: 'schedule.update', payload: { matchTitle: '실적보고서', changes: { date: '2026-10-02' } } });
  });

  it('완료 표시는 status로 바뀐다', () => {
    expect(read({ intent: 'schedule.update', payload: { matchTitle: '예산안', changes: { done: true } } }))
      .toMatchObject({ payload: { changes: { status: 'done' } } });
    expect(read({ intent: 'schedule.update', payload: { matchTitle: '예산안', changes: { done: false } } }))
      .toMatchObject({ payload: { changes: { status: 'todo' } } });
  });

  it('빈 문자열은 "지워라"는 뜻이다', () => {
    expect(read({ intent: 'schedule.update', payload: { matchTitle: 'x', changes: { date: '' } } }))
      .toMatchObject({ payload: { changes: { date: '' } } });
  });

  it('★ 대상이 없거나 바꿀 것이 없으면 아무것도 하지 않는다', () => {
    expect(read({ intent: 'schedule.update', payload: { changes: { date: '2026-10-02' } } }))
      .toMatchObject({ intent: 'chat', reason: 'update_missing_match' });
    expect(read({ intent: 'schedule.update', payload: { matchTitle: 'x', changes: {} } }))
      .toMatchObject({ intent: 'chat', reason: 'update_no_changes' });
  });
});

describe('readIntent — 삭제', () => {
  it('제목으로 지정', () => {
    expect(read({ intent: 'schedule.delete', payload: { matchTitle: '교육 신청' } }))
      .toEqual({ intent: 'schedule.delete', payload: { matchTitle: '교육 신청' } });
  });

  it('날짜 범위로 지정', () => {
    expect(read({ intent: 'schedule.delete', payload: { from: '2026-09-20', to: '2026-09-20' } }))
      .toEqual({ intent: 'schedule.delete', payload: { from: '2026-09-20', to: '2026-09-20' } });
  });

  it('★ 대상을 하나도 말하지 않았으면 삭제하지 않는다 ("전부 지워"가 되어 버린다)', () => {
    expect(read({ intent: 'schedule.delete', payload: {} }))
      .toEqual({ intent: 'chat', payload: {}, reason: 'delete_missing_match' });
  });
});

describe('readIntent — 망가진 응답', () => {
  it('JSON 앞뒤에 붙은 말을 건너뛴다', () => {
    const raw = '네, 알겠습니다.\n{"intent":"schedule.list","payload":{"query":"예산"}}\n도움이 되었길 바랍니다.';
    expect(read(raw)).toEqual({ intent: 'schedule.list', payload: { query: '예산' } });
  });

  it('JSON이 아니면 chat으로 물러난다', () => {
    expect(read('무슨 말씀이신지 모르겠어요')).toMatchObject({ intent: 'chat', reason: 'parse_failure' });
    expect(read('')).toMatchObject({ intent: 'chat', reason: 'parse_failure' });
  });

  it('모르는 intent는 실행하지 않는다', () => {
    expect(read({ intent: 'calendar.create', payload: { title: 'x' } }))
      .toMatchObject({ intent: 'chat', reason: 'unknown_intent' });
    expect(read({ payload: {} })).toMatchObject({ intent: 'chat', reason: 'unknown_intent' });
  });

  it('payload가 배열이나 null이어도 터지지 않는다', () => {
    expect(read({ intent: 'schedule.create', payload: [] })).toMatchObject({ intent: 'chat' });
    expect(read({ intent: 'schedule.list', payload: null })).toEqual({ intent: 'schedule.list', payload: {} });
  });

  it('★ 망가진 응답이어도 조회 보정은 살아 있다', () => {
    expect(read('그건 잘 모르겠습니다', '5월 일정 보여줘'))
      .toEqual({ intent: 'schedule.list', payload: { from: '2026-05-01', to: '2026-05-31' } });
  });
});

describe('값 정규화', () => {
  it('normalizeDate', () => {
    expect(normalizeDate('2026-09-30')).toBe('2026-09-30');
    expect(normalizeDate('2026-09-30T18:00')).toBe('2026-09-30');
    expect(normalizeDate('2026-02-30')).toBeNull();
    expect(normalizeDate('9월 30일')).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
  });

  it('normalizeTime', () => {
    expect(normalizeTime('18:00')).toBe('18:00');
    expect(normalizeTime('9:05')).toBe('09:05');
    expect(normalizeTime('2026-09-30T14:30')).toBe('14:30');
    expect(normalizeTime('25:00')).toBeUndefined();
    expect(normalizeTime('')).toBeUndefined();
  });
});

describe('분류기 프롬프트', () => {
  it('기준일과 요일을 박아 넣는다 (모델에게는 오늘이 없다)', () => {
    const prompt = buildIntentPrompt(NOW);
    expect(prompt).toContain('2026-09-19');
    expect(prompt).toContain('토요일');
    expect(prompt).toContain('2026-09-20'); // 내일
    expect(prompt).toContain('2026-09-13'); // 이번 주 일요일
  });

  it('스키마의 intent 값과 프롬프트가 어긋나지 않는다', () => {
    const prompt = buildIntentPrompt(NOW);
    for (const intent of SCHEDULE_INTENT_SCHEMA.properties.intent.enum) {
      expect(prompt).toContain(intent);
    }
  });
});
