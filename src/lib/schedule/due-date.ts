/**
 * 공문식 기한 표기 → 달력 날짜(계획서 S07 · P4-4).
 *
 * ★ 공문은 연도를 자주 생략한다("9. 30.(수)까지"). 그래서 파서가 연도를 지어내는 대신
 *   **무엇을 근거로 몇 년으로 보았는지**를 함께 돌려준다. 화면은 그 사실을 배지로 보이고,
 *   최종 판단은 사람이 한다 — 핵심·조치사항 카드가 "원문에서 찾지 못함"을 지우지 않는 것과 같은 규칙이다.
 *
 * ★ 기준일은 문서의 보고일자가 있으면 그것이다. 오늘이 아니다.
 *   지난달에 받은 공문을 오늘 정리하면, 오늘을 기준으로 삼는 순간 기한이 한 해 뒤로 밀린다.
 */

import { findDates } from '@/lib/ai/action-card';

export interface TaskDue {
  /** 로컬 날짜 YYYY-MM-DD. 색인·정렬의 기준이다. */
  date: string;
  /** 원문에 시각이 있을 때만. HH:mm */
  time?: string;
  /** 원문에 적힌 표기 그대로. 사용자가 원문과 대조할 수 있어야 한다. */
  text: string;
  /** 원문에 연도가 없어 기준일로 추론했는가. */
  yearInferred: boolean;
}

/**
 * 연도가 없을 때, 기준일보다 이만큼 이상 과거인 날짜는 "내년 기한"으로 본다.
 *
 * ★ 0일로 하면 어제 마감된 기한이 내년으로 밀려 지난 기한을 놓친다.
 *   1년으로 하면 연말에 받은 "1. 15.까지"가 늘 작년이 된다. 60일은 그 사이의 절충이다.
 */
const PAST_TOLERANCE_DAYS = 60;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toISO(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 실제로 있는 날짜인가. 2월 30일, 4월 31일을 걸러낸다. */
function realDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** "14:00", "18시", "오후 2시 30분"에서 시각을 뽑는다. 없으면 undefined. */
export function findTime(text: string): string | undefined {
  const colon = /(^|[^\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/.exec(text);
  if (colon) return `${pad(Number(colon[2]))}:${colon[3]}`;

  const korean = /(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/.exec(text);
  if (!korean) return undefined;
  let hour = Number(korean[2]);
  const minute = Number(korean[3] ?? 0);
  if (hour > 24 || minute > 59) return undefined;
  // 오후 2시 = 14시. 오후 12시는 정오 그대로, 오전 12시는 자정이다.
  if (korean[1] === '오후' && hour < 12) hour += 12;
  if (korean[1] === '오전' && hour === 12) hour = 0;
  if (hour === 24) hour = 0;
  return `${pad(hour)}:${pad(minute)}`;
}

/**
 * 기한 문구 하나를 달력 날짜로 바꾼다. 날짜를 찾지 못하면 null — 지어내지 않는다.
 *
 * @param text 원문 표기("2026. 9. 30.(수)", "9월 30일 18:00까지")
 * @param reference 연도 추론의 기준일(문서 보고일자 → 없으면 오늘)
 */
export function normalizeDueDate(text: string, reference: Date = new Date()): TaskDue | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  // 한 문구에 날짜가 여럿이면(기간 표기) 마지막이 기한이다. "9. 1. ~ 9. 30."의 마감은 9. 30.
  const found = findDates(raw).at(-1);
  if (!found) return null;

  const time = findTime(raw.slice(raw.indexOf(found.text) + found.text.length) || raw);

  if (found.year !== undefined) {
    if (!realDate(found.year, found.month, found.day)) return null;
    return { date: toISO(found.year, found.month, found.day), ...(time ? { time } : {}), text: found.text, yearInferred: false };
  }

  for (const year of [reference.getFullYear(), reference.getFullYear() + 1]) {
    if (!realDate(year, found.month, found.day)) continue;
    const candidate = new Date(year, found.month - 1, found.day);
    // 기준일보다 한참 지난 날짜는 올해가 아니라 내년 기한으로 본다(다음 후보로 넘긴다).
    if (daysBetween(reference, candidate) < -PAST_TOLERANCE_DAYS) continue;
    return { date: toISO(year, found.month, found.day), ...(time ? { time } : {}), text: found.text, yearInferred: true };
  }
  // 윤날(2. 29.)처럼 기준 연도에 없는 날짜만 남은 경우.
  return null;
}

/**
 * 온나라 목록의 보고일자를 연도 추론의 기준일로 바꾼다.
 *
 * 목록 셀은 "2026-09-18", "2026.09.18", "2026. 9. 18." 등 화면마다 다르다.
 * 읽어내지 못하면 null을 주고, 호출부가 오늘을 기준일로 쓴다.
 */
export function parseReferenceDate(value: string | undefined): Date | null {
  const found = findDates(String(value ?? ''))[0];
  if (!found?.year || !realDate(found.year, found.month, found.day)) return null;
  return new Date(found.year, found.month - 1, found.day);
}
