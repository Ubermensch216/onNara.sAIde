/**
 * 대한민국 공휴일 정보 서비스 (하이브리드: API 우선 + 정적 내장 Fallback).
 *
 * ★ 설계 원칙:
 * 1. 1차 (API 우선): 최신 대체공휴일 및 관공서 공휴일을 가져오기 위해 외부 API를 비동기 호출한다.
 * 2. 2차 (내장 Fallback): 공무원 폐쇄망/오프라인 환경, 네트워크 오류, 타임아웃(3초) 시에는
 *    2024~2030년 대한민국 관공서 공휴일 규정 및 선거일이 망라된 내장 데이터로 즉시 Fallback한다.
 * 3. 캐싱: 조회된 연도별 공휴일은 로컬 스토리지에 캐시하여 불필요한 반복 네트워크 요청을 방지한다.
 */

import { useEffect, useState } from 'react';

/** 2024~2030 대한민국 관공서 공휴일 및 대체공휴일, 선거일 정적 맵 */
export const KR_HOLIDAYS_FALLBACK: Record<string, string> = {
  // 2024년
  '2024-01-01': '신정',
  '2024-02-09': '설날 연휴',
  '2024-02-10': '설날',
  '2024-02-11': '설날 연휴',
  '2024-02-12': '대체공휴일',
  '2024-03-01': '3·1절',
  '2024-04-10': '제22대 국회의원선거',
  '2024-05-05': '어린이날',
  '2024-05-06': '대체공휴일',
  '2024-05-15': '부처님오신날',
  '2024-06-06': '현충일',
  '2024-08-15': '광복절',
  '2024-09-16': '추석 연휴',
  '2024-09-17': '추석',
  '2024-09-18': '추석 연휴',
  '2024-10-01': '국군의 날(임시공휴일)',
  '2024-10-03': '개천절',
  '2024-10-09': '한글날',
  '2024-12-25': '성탄절',

  // 2025년
  '2025-01-01': '신정',
  '2025-01-28': '설날 연휴',
  '2025-01-29': '설날',
  '2025-01-30': '설날 연휴',
  '2025-03-01': '3·1절',
  '2025-03-03': '대체공휴일',
  '2025-05-05': '어린이날',
  '2025-05-06': '부처님오신날(대체공휴일)',
  '2025-06-06': '현충일',
  '2025-08-15': '광복절',
  '2025-10-03': '개천절',
  '2025-10-05': '추석 연휴',
  '2025-10-06': '추석',
  '2025-10-07': '추석 연휴',
  '2025-10-08': '대체공휴일',
  '2025-10-09': '한글날',
  '2025-12-25': '성탄절',

  // 2026년
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '3·1절',
  '2026-03-02': '대체공휴일',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '대체공휴일',
  '2026-06-03': '제9회 지방선거',
  '2026-06-06': '현충일',
  '2026-08-15': '광복절',
  '2026-08-17': '대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',

  // 2027년
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-02-09': '대체공휴일',
  '2027-03-01': '3·1절',
  '2027-03-03': '제21대 대통령선거',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-08-15': '광복절',
  '2027-08-16': '대체공휴일',
  '2027-09-14': '추석 연휴',
  '2027-09-15': '추석',
  '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절',
  '2027-10-04': '대체공휴일',
  '2027-10-09': '한글날',
  '2027-10-11': '대체공휴일',
  '2027-12-25': '성탄절',

  // 2028년
  '2028-01-01': '신정',
  '2028-01-26': '설날 연휴',
  '2028-01-27': '설날',
  '2028-01-28': '설날 연휴',
  '2028-03-01': '3·1절',
  '2028-04-12': '제23대 국회의원선거',
  '2028-05-02': '부처님오신날',
  '2028-05-05': '어린이날',
  '2028-06-06': '현충일',
  '2028-08-15': '광복절',
  '2028-10-02': '추석 연휴',
  '2028-10-03': '추석·개천절',
  '2028-10-04': '추석 연휴',
  '2028-10-05': '대체공휴일',
  '2028-10-09': '한글날',
  '2028-12-25': '성탄절',

  // 2029년
  '2029-01-01': '신정',
  '2029-02-12': '설날 연휴',
  '2029-02-13': '설날',
  '2029-02-14': '설날 연휴',
  '2029-03-01': '3·1절',
  '2029-05-05': '어린이날',
  '2029-05-07': '대체공휴일',
  '2029-05-20': '부처님오신날',
  '2029-06-06': '현충일',
  '2029-08-15': '광복절',
  '2029-09-21': '추석 연휴',
  '2029-09-22': '추석',
  '2029-09-23': '추석 연휴',
  '2029-09-24': '대체공휴일',
  '2029-10-03': '개천절',
  '2029-10-09': '한글날',
  '2029-12-25': '성탄절',

  // 2030년
  '2030-01-01': '신정',
  '2030-02-02': '설날 연휴',
  '2030-02-03': '설날',
  '2030-02-04': '설날 연휴',
  '2030-03-01': '3·1절',
  '2030-05-05': '어린이날',
  '2030-05-06': '대체공휴일',
  '2030-05-09': '부처님오신날',
  '2030-06-06': '현충일',
  '2030-08-15': '광복절',
  '2030-09-11': '추석 연휴',
  '2030-09-12': '추석',
  '2030-09-13': '추석 연휴',
  '2030-10-03': '개천절',
  '2030-10-09': '한글날',
  '2030-12-25': '성탄절',
};

const CACHE_PREFIX = 'saide.holidays.';
const memoryHolidayCache = new Map<number, Record<string, string>>();

/** 테스트용 메모리 캐시 초기화 */
export function clearHolidayMemoryCache(): void {
  memoryHolidayCache.clear();
}

function safeGetStorage(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    // 무시
  }
  return null;
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {
    // 무시
  }
}

/** 특정 연도의 내장 정적 공휴일만 뽑아낸다 */
export function getHolidaysFallbackForYear(year: number): Record<string, string> {
  const prefix = `${year}-`;
  const result: Record<string, string> = {};
  for (const [date, name] of Object.entries(KR_HOLIDAYS_FALLBACK)) {
    if (date.startsWith(prefix)) {
      result[date] = name;
    }
  }
  return result;
}

/** 캐시에서 연도 공휴일 읽기 */
export function getCachedHolidays(year: number): Record<string, string> | null {
  if (memoryHolidayCache.has(year)) {
    return memoryHolidayCache.get(year)!;
  }
  const raw = safeGetStorage(`${CACHE_PREFIX}${year}`);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === 'object') {
        memoryHolidayCache.set(year, parsed);
        return parsed;
      }
    } catch {
      // 무시
    }
  }
  return null;
}

/** 캐시에 연도 공휴일 저장 */
export function setCachedHolidays(year: number, holidays: Record<string, string>): void {
  memoryHolidayCache.set(year, holidays);
  safeSetStorage(`${CACHE_PREFIX}${year}`, JSON.stringify(holidays));
}

interface PublicHolidayApiResponse {
  date: string;
  localName: string;
  name: string;
}

/** 외부 공휴일 API 비동기 호출 (타임아웃 3초) */
export async function fetchHolidaysFromApi(year: number, timeoutMs = 3000): Promise<Record<string, string> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) return null;
    const items = (await response.json()) as PublicHolidayApiResponse[];
    if (!Array.isArray(items) || items.length === 0) return null;

    const holidays: Record<string, string> = {};
    for (const item of items) {
      if (item.date && item.localName) {
        holidays[item.date] = item.localName;
      }
    }
    return holidays;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * 하이브리드 공휴일 로더:
 * 1. 캐시 확인
 * 2. API 호출 시도
 * 3. 실패 시 내장 정적 Fallback 반환
 */
export async function loadHolidaysForYear(year: number): Promise<Record<string, string>> {
  const cached = getCachedHolidays(year);
  if (cached && Object.keys(cached).length > 0) {
    return cached;
  }

  // 1차: API 우선
  const apiHolidays = await fetchHolidaysFromApi(year);
  if (apiHolidays && Object.keys(apiHolidays).length > 0) {
    // API 데이터와 선거일 등 내장 특수 데이터를 안전하게 병합 (누락 방지)
    const fallback = getHolidaysFallbackForYear(year);
    const merged = { ...fallback, ...apiHolidays };
    setCachedHolidays(year, merged);
    return merged;
  }

  // 2차: 내장 정적 Fallback
  const fallback = getHolidaysFallbackForYear(year);
  if (Object.keys(fallback).length > 0) {
    setCachedHolidays(year, fallback);
  }
  return fallback;
}

/** 특정 날짜(YYYY-MM-DD)의 공휴일명 동기 조회 */
export function getHolidaySync(dateISO: string): string | null {
  const year = Number(dateISO.slice(0, 4));
  if (Number.isNaN(year)) return null;

  const cached = getCachedHolidays(year);
  if (cached && cached[dateISO]) {
    return cached[dateISO] ?? null;
  }
  return KR_HOLIDAYS_FALLBACK[dateISO] ?? null;
}

/**
 * React 캘린더용 공휴일 훅.
 * 화면에 표시되는 연도(및 인접 연도)의 공휴일을 불러오며,
 * 비동기 로딩 전이라도 내장 Fallback 데이터로 즉시 초기 렌더링을 보장한다.
 */
export function useHolidays(cursorISO: string): Record<string, string> {
  const currentYear = Number(cursorISO.slice(0, 4)) || new Date().getFullYear();

  // 초기 상태: 내장 데이터 + 캐시로 즉각 렌더링 (화면 깜빡임 없음)
  const [holidays, setHolidays] = useState<Record<string, string>>(() => {
    const prev = getCachedHolidays(currentYear - 1) ?? getHolidaysFallbackForYear(currentYear - 1);
    const curr = getCachedHolidays(currentYear) ?? getHolidaysFallbackForYear(currentYear);
    const next = getCachedHolidays(currentYear + 1) ?? getHolidaysFallbackForYear(currentYear + 1);
    return { ...prev, ...curr, ...next };
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [prev, curr, next] = await Promise.all([
        loadHolidaysForYear(currentYear - 1),
        loadHolidaysForYear(currentYear),
        loadHolidaysForYear(currentYear + 1),
      ]);
      if (!cancelled) {
        setHolidays({ ...prev, ...curr, ...next });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [currentYear]);

  return holidays;
}
