/**
 * 자연어 날짜 해석 테스트.
 *
 * 기준일은 2026-09-19(토)로 고정한다. "이번 주"가 일요일에 시작하므로 토요일 기준은
 * 주 경계가 가장 잘 드러나는 날이다.
 */

import { describe, expect, it } from 'vitest';
import { extractDateRange, isListRequest, monthRange, weekRange } from './nl-date';

/** 2026-09-19 (토) */
const BASE = new Date(2026, 8, 19);
const range = (text: string) => extractDateRange(text, BASE);

describe('extractDateRange — 하루', () => {
  it('오늘·내일·모레·어제', () => {
    expect(range('오늘 일정 보여줘')).toEqual({ from: '2026-09-19', to: '2026-09-19' });
    expect(range('내일 일정')).toEqual({ from: '2026-09-20', to: '2026-09-20' });
    expect(range('모레 뭐 있지')).toEqual({ from: '2026-09-21', to: '2026-09-21' });
    expect(range('어제 일정')).toEqual({ from: '2026-09-18', to: '2026-09-18' });
  });

  it('★ "5월 14일"은 5월 전체가 아니라 그 하루다', () => {
    expect(range('5월 14일 일정')).toEqual({ from: '2026-05-14', to: '2026-05-14' });
    expect(range('2027년 3월 2일 일정')).toEqual({ from: '2027-03-02', to: '2027-03-02' });
  });

  it('적어 준 ISO 날짜도 읽는다', () => {
    expect(range('2026-09-30 일정')).toEqual({ from: '2026-09-30', to: '2026-09-30' });
    expect(range('2026.9.30 일정')).toEqual({ from: '2026-09-30', to: '2026-09-30' });
  });

  it('없는 날짜는 하루로 읽지 않는다', () => {
    // 2월 30일은 날짜가 아니다. 달 범위로 물러난다.
    expect(range('2월 30일 일정')).toEqual(monthRange(2026, 2));
  });
});

describe('extractDateRange — 주·달·해', () => {
  it('이번 주는 일요일에 시작한다', () => {
    expect(range('이번 주 일정')).toEqual({ from: '2026-09-13', to: '2026-09-19' });
    expect(range('다음 주 일정')).toEqual({ from: '2026-09-20', to: '2026-09-26' });
    expect(range('지난주 일정')).toEqual({ from: '2026-09-06', to: '2026-09-12' });
  });

  it('이번 달·다음 달·지난 달', () => {
    expect(range('이번 달 일정')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(range('다음 달 일정')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(range('지난달 일정')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('★ "5월 전체 일정"은 이번 주가 아니라 5월 한 달이다', () => {
    expect(range('5월 전체 일정 보고해')).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    // 말일이 달마다 다르다.
    expect(range('2월 일정')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('여러 달에 걸친 범위', () => {
    expect(range('6월부터 12월까지 일정')).toEqual({ from: '2026-06-01', to: '2026-12-31' });
    expect(range('11월~2월 일정')).toEqual({ from: '2026-11-01', to: '2027-02-28' });
  });

  it('★ "2026년"은 해 전체지만 "2026년 5월"은 그 달이다', () => {
    expect(range('2026년도 일정 모두')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(range('2026년 5월 일정')).toEqual({ from: '2026-05-01', to: '2026-05-31' });
  });

  it('기준일이 해를 넘겨도 어긋나지 않는다', () => {
    const 연말 = new Date(2026, 11, 31);
    expect(extractDateRange('다음 달 일정', 연말)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
    expect(extractDateRange('내일 일정', 연말)).toEqual({ from: '2027-01-01', to: '2027-01-01' });
  });
});

describe('extractDateRange — 못 찾았을 때', () => {
  it('★ 날짜가 없으면 오늘로 때우지 않고 null', () => {
    // 오늘로 때우면 "예산안 일정 보여줘"가 조용히 오늘 일정이 되어,
    // 사용자는 등록해 둔 일정이 사라졌다고 생각한다.
    expect(range('예산안 일정 보여줘')).toBeNull();
    expect(range('')).toBeNull();
    expect(range('   ')).toBeNull();
  });

  it('달이 아닌 숫자는 달로 읽지 않는다', () => {
    expect(range('13월 일정')).toBeNull();
    expect(range('0월 일정')).toBeNull();
  });
});

describe('isListRequest', () => {
  it('조회를 부탁한 문장만 참', () => {
    expect(isListRequest('5월 일정 보여줘')).toBe(true);
    expect(isListRequest('이번 주 기한 알려줘')).toBe(true);
    expect(isListRequest('할 일 목록')).toBe(true);
  });

  it('등록·삭제는 조회가 아니다', () => {
    expect(isListRequest('내일 예산안 제출 등록해줘')).toBe(false);
    expect(isListRequest('영업팀 회의 삭제해')).toBe(false);
    expect(isListRequest('안녕하세요')).toBe(false);
  });
});

describe('보조 함수', () => {
  it('monthRange는 말일까지 채운다', () => {
    expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange(2026, 12)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('weekRange는 일요일~토요일', () => {
    expect(weekRange('2026-09-19')).toEqual({ from: '2026-09-13', to: '2026-09-19' });
    expect(weekRange('2026-09-13')).toEqual({ from: '2026-09-13', to: '2026-09-19' });
  });
});
