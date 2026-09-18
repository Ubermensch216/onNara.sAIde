import { describe, expect, it } from 'vitest';
import { findTime, normalizeDueDate, parseReferenceDate } from './due-date';

const REPORT_DAY = new Date(2026, 8, 18); // 2026-09-18

describe('normalizeDueDate', () => {
  it('연도가 적힌 공문식 날짜를 그대로 읽는다', () => {
    expect(normalizeDueDate('2026. 9. 30.(수)', REPORT_DAY))
      .toEqual({ date: '2026-09-30', text: '2026. 9. 30.(수)', yearInferred: false });
  });

  it('하이픈 표기도 읽는다', () => {
    expect(normalizeDueDate('2026-09-30', REPORT_DAY)?.date).toBe('2026-09-30');
  });

  it('★ 연도가 없으면 기준일의 연도로 보고, 추론했다는 사실을 남긴다', () => {
    const due = normalizeDueDate('9월 30일', REPORT_DAY);
    expect(due).toMatchObject({ date: '2026-09-30', yearInferred: true });
  });

  it('★ 기준일보다 한참 지난 날짜는 내년 기한으로 본다', () => {
    // 9월에 받은 공문의 "1. 15.까지"는 지난 1월이 아니라 다음 1월이다.
    expect(normalizeDueDate('1월 15일', REPORT_DAY)?.date).toBe('2027-01-15');
  });

  it('★ 며칠 지난 기한은 올해로 남긴다 — 내년으로 밀면 놓친 기한이 보이지 않는다', () => {
    expect(normalizeDueDate('9월 10일', REPORT_DAY)?.date).toBe('2026-09-10');
  });

  it('★ 기준일은 오늘이 아니라 문서 보고일자다', () => {
    // 작년 12월 공문을 오늘 정리해도 "1. 5.까지"는 그 다음 1월이어야 한다.
    expect(normalizeDueDate('1월 5일', new Date(2025, 11, 20))?.date).toBe('2026-01-05');
  });

  it('없는 날짜는 만들지 않는다', () => {
    expect(normalizeDueDate('2026. 2. 30.', REPORT_DAY)).toBeNull();
  });

  it('날짜가 없으면 null이다 — 지어내지 않는다', () => {
    expect(normalizeDueDate('접수 즉시', REPORT_DAY)).toBeNull();
    expect(normalizeDueDate('', REPORT_DAY)).toBeNull();
  });

  it('기간 표기는 끝 날짜가 기한이다', () => {
    expect(normalizeDueDate('2026. 9. 1. ~ 2026. 9. 30.', REPORT_DAY)?.date).toBe('2026-09-30');
  });

  it('날짜 뒤의 시각을 함께 읽는다', () => {
    expect(normalizeDueDate('2026. 9. 30. 18:00까지', REPORT_DAY)).toMatchObject({ date: '2026-09-30', time: '18:00' });
    expect(normalizeDueDate('9월 30일 오후 2시', REPORT_DAY)?.time).toBe('14:00');
  });

  it('항목 번호를 날짜로 오인하지 않는다', () => {
    // "1. 2." 같은 공문 항목 번호. findDates가 걸러 낸다.
    expect(normalizeDueDate('1. 2.', REPORT_DAY)).toBeNull();
  });
});

describe('findTime', () => {
  it.each([
    ['18:00까지', '18:00'],
    ['오후 2시', '14:00'],
    ['오전 9시 30분', '09:30'],
    ['오후 12시', '12:00'],
    ['오전 12시', '00:00'],
    ['24시', '00:00'],
  ])('%s → %s', (text, expected) => {
    expect(findTime(text)).toBe(expected);
  });

  it('시각이 없으면 undefined', () => {
    expect(findTime('2026. 9. 30.')).toBeUndefined();
  });
});

describe('parseReferenceDate', () => {
  it('목록의 보고일자를 기준일로 바꾼다', () => {
    expect(parseReferenceDate('2026-09-18')?.getMonth()).toBe(8);
    expect(parseReferenceDate('2026. 9. 18.')?.getDate()).toBe(18);
  });

  it('연도가 없거나 읽지 못하면 null — 호출부가 오늘을 쓴다', () => {
    expect(parseReferenceDate('9월 18일')).toBeNull();
    expect(parseReferenceDate(undefined)).toBeNull();
  });
});
