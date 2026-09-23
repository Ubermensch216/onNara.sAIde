// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHolidayMemoryCache,
  fetchHolidaysFromApi,
  getCachedHolidays,
  getHolidaysFallbackForYear,
  getHolidaySync,
  KR_HOLIDAYS_FALLBACK,
  loadHolidaysForYear,
  setCachedHolidays,
} from './holidays';

describe('공휴일 정적 Fallback 데이터', () => {
  it('2026년 공휴일 및 대체공휴일이 정상 정의되어 있다', () => {
    expect(KR_HOLIDAYS_FALLBACK['2026-01-01']).toBe('신정');
    expect(KR_HOLIDAYS_FALLBACK['2026-03-01']).toBe('3·1절');
    expect(KR_HOLIDAYS_FALLBACK['2026-03-02']).toBe('대체공휴일');
    expect(KR_HOLIDAYS_FALLBACK['2026-05-05']).toBe('어린이날');
    expect(KR_HOLIDAYS_FALLBACK['2026-08-15']).toBe('광복절');
    expect(KR_HOLIDAYS_FALLBACK['2026-08-17']).toBe('대체공휴일');
    expect(KR_HOLIDAYS_FALLBACK['2026-09-25']).toBe('추석');
    expect(KR_HOLIDAYS_FALLBACK['2026-10-09']).toBe('한글날');
    expect(KR_HOLIDAYS_FALLBACK['2026-12-25']).toBe('성탄절');
  });

  it('2025년 공휴일 및 대체공휴일이 정상 정의되어 있다', () => {
    expect(KR_HOLIDAYS_FALLBACK['2025-01-01']).toBe('신정');
    expect(KR_HOLIDAYS_FALLBACK['2025-01-29']).toBe('설날');
    expect(KR_HOLIDAYS_FALLBACK['2025-03-03']).toBe('대체공휴일');
    expect(KR_HOLIDAYS_FALLBACK['2025-10-06']).toBe('추석');
  });

  it('연도별 공휴일 필터링이 정확하다', () => {
    const holidays2026 = getHolidaysFallbackForYear(2026);
    expect(Object.keys(holidays2026).length).toBeGreaterThan(10);
    for (const date of Object.keys(holidays2026)) {
      expect(date.startsWith('2026-')).toBe(true);
    }
  });

  it('getHolidaySync로 특정 날짜의 공휴일을 즉시 조회할 수 있다', () => {
    expect(getHolidaySync('2026-08-15')).toBe('광복절');
    expect(getHolidaySync('2026-08-16')).toBeNull();
  });
});

describe('하이브리드 공휴일 로딩 및 캐싱', () => {
  beforeEach(() => {
    localStorage.clear();
    clearHolidayMemoryCache();
    vi.restoreAllMocks();
  });

  it('캐시 저장 및 조회가 정상 동작한다', () => {
    setCachedHolidays(2099, { '2099-01-01': '미래신정' });
    const cached = getCachedHolidays(2099);
    expect(cached).toEqual({ '2099-01-01': '미래신정' });
  });

  it('API 호출 성공 시 최신 데이터를 반환하고 캐시에 저장한다', async () => {
    const mockApiResponse = [
      { date: '2026-01-01', localName: '신정', name: "New Year's Day" },
      { date: '2026-05-05', localName: '어린이날', name: "Children's Day" },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    } as Response);

    const apiResult = await fetchHolidaysFromApi(2026);
    expect(apiResult).toEqual({
      '2026-01-01': '신정',
      '2026-05-05': '어린이날',
    });
  });

  it('★ API 호출 실패 시 내장 정적 Fallback 데이터로 안전하게 복구된다', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error (폐쇄망/오프라인)'));

    const result = await loadHolidaysForYear(2026);
    // API 실패해도 2026년 공휴일이 누락 없이 반환되어야 함
    expect(result['2026-08-15']).toBe('광복절');
    expect(result['2026-09-25']).toBe('추석');
  });

  it('★ API 응답이 500 오류일 때도 내장 정적 데이터로 안전하게 반환된다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const result = await loadHolidaysForYear(2026);
    expect(result['2026-03-01']).toBe('3·1절');
  });
});
