/**
 * 자연어 날짜·기간 해석(`@일정`).
 *
 * ★ 이것은 [due-date.ts]와 하는 일이 다르다. 그쪽은 **공문에 적힌** 기한 표기를 읽고,
 *   여기는 **사람이 입력창에 친** 말("내일", "이번 주", "5월")을 읽는다. 공문에는
 *   "이번 주"가 없고, 사람은 "2026. 9. 30.(수)"라고 치지 않는다.
 *
 * ★ 모델에게만 맡기지 않는다. 참조 프로젝트(myAI)가 남긴 교훈이 이것이다 — 소형 모델은
 *   "5월 전체 일정"을 이번 주로, "6월부터 12월까지"를 6월로 줄여 놓는 일이 잦았다.
 *   그래서 코드가 먼저 뽑을 수 있는 범위는 코드가 뽑고, 모델의 답을 그 값으로 덮는다.
 *
 * ★ 검사 순서가 곧 규칙이다. "5월 14일"은 월 범위가 아니라 하루이므로 월 검사보다 먼저
 *   보아야 하고, "2026년 5월"은 해 전체가 아니라 그 달이므로 연도 검사에서 걸러야 한다.
 *   순서를 바꾸면 조용히 다른 범위가 나온다.
 */

import { addDays, parseDateISO, startOfWeek, toISO } from './calendar';

/** 닫힌 구간. `from === to`면 하루다. */
export interface DateRange {
  from: string;
  to: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 그 달의 1일부터 말일까지. */
export function monthRange(year: number, month: number): DateRange {
  const lastDay = new Date(year, month, 0).getDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

/** 일요일부터 토요일까지. 공문·업무 달력의 관례이자 달력 격자와 같은 규칙이다. */
export function weekRange(dateISO: string): DateRange {
  const start = startOfWeek(dateISO);
  return { from: start, to: addDays(start, 6) };
}

function day(dateISO: string): DateRange {
  return { from: dateISO, to: dateISO };
}

/** 기준일을 로컬 Date로. 못 읽으면 오늘. */
function baseOf(base: Date | string): Date {
  const date = typeof base === 'string' ? new Date(base) : base;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
}

/**
 * 사람이 친 문장에서 날짜 범위를 뽑는다. 찾지 못하면 null.
 *
 * ★ 못 찾은 것과 "오늘"을 구분해 null로 돌려준다. 못 찾았을 때 오늘로 때우면
 *   "예산안 일정 보여줘"가 조용히 "오늘 일정"이 되어, 사용자는 등록해 둔 일정이
 *   사라졌다고 생각한다.
 */
export function extractDateRange(prompt: string, base: Date | string = new Date()): DateRange | null {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const today = baseOf(base);
  const todayISO = toISO(today);
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  /* ── 하루 ── */
  if (/(그저께|그제)/.test(text)) return day(addDays(todayISO, -2));
  if (/(어제|전일)/.test(text)) return day(addDays(todayISO, -1));
  if (/(오늘|금일)/.test(text)) return day(todayISO);
  if (/(내일|명일)/.test(text)) return day(addDays(todayISO, 1));
  if (/(모레|내일모레)/.test(text)) return day(addDays(todayISO, 2));

  /* ── 주 ── */
  if (/(이번\s*주|금주)/.test(text)) return weekRange(todayISO);
  if (/(다음\s*주|담주|차주)/.test(text)) return weekRange(addDays(todayISO, 7));
  if (/(지난\s*주|저번\s*주|전주)/.test(text)) return weekRange(addDays(todayISO, -7));

  /* ── 달 ── */
  if (/(이번\s*달|이달|금월)/.test(text)) return monthRange(year, month);
  if (/(다음\s*달|내달|익월)/.test(text)) {
    const next = new Date(year, month, 1);
    return monthRange(next.getFullYear(), next.getMonth() + 1);
  }
  if (/(지난\s*달|저번\s*달|전월)/.test(text)) {
    const prev = new Date(year, month - 2, 1);
    return monthRange(prev.getFullYear(), prev.getMonth() + 1);
  }

  /* ── 적어 준 날짜 ── */

  // `2026-09-30`, `2026.9.30`을 그대로 쓴 경우.
  const iso = /(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/.exec(text);
  if (iso) {
    const hit = validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (hit) return day(hit);
  }

  // ★ 월 검사보다 먼저다. "5월 14일"은 5월 전체가 아니라 그 하루다.
  const specific = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(text);
  if (specific) {
    const hit = validDay(specific[1] ? Number(specific[1]) : year, Number(specific[2]), Number(specific[3]));
    if (hit) return day(hit);
  }

  // "6월부터 12월까지", "6월~12월". 끝 달이 더 앞이면 해를 넘긴 것으로 본다.
  const span = /(\d{1,2})\s*월\s*(?:부터|에서|~|-)\s*(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월/.exec(text);
  if (span) {
    const from = Number(span[1]);
    const to = Number(span[3]);
    if (inMonthRange(from) && inMonthRange(to)) {
      const toYear = span[2] ? Number(span[2]) : to < from ? year + 1 : year;
      return { from: monthRange(year, from).from, to: monthRange(toYear, to).to };
    }
  }

  // ★ "2026년"은 해 전체지만 "2026년 5월"은 그 달이다. 뒤에 월이 붙으면 넘긴다.
  const yearOnly = /(\d{4})\s*년(?:도)?/.exec(text);
  if (yearOnly) {
    const value = Number(yearOnly[1]);
    const after = text.slice(yearOnly.index + yearOnly[0].length);
    if (value >= 2000 && value <= 2100 && !/^\s*\d{1,2}\s*월/.test(after)) {
      return { from: `${value}-01-01`, to: `${value}-12-31` };
    }
  }

  const only = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월/.exec(text);
  if (only) {
    const value = Number(only[2]);
    if (inMonthRange(value)) return monthRange(only[1] ? Number(only[1]) : year, value);
  }

  return null;
}

function inMonthRange(month: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

/** 실제로 있는 날짜일 때만 ISO로. 2월 30일, 4월 31일을 걸러낸다. */
function validDay(year: number, month: number, date: number): string | null {
  if (!inMonthRange(month) || !Number.isInteger(date) || date < 1 || date > 31) return null;
  const iso = `${year}-${pad(month)}-${pad(date)}`;
  const parsed = parseDateISO(iso);
  return parsed && parsed.getDate() === date && parsed.getMonth() === month - 1 ? iso : null;
}

/**
 * 조회를 명시적으로 부탁한 문장인가.
 *
 * ★ 모델이 `chat`으로 흘려보낸 조회 요청을 코드가 되돌릴 때 쓴다. 등록·수정·삭제에는
 *   쓰지 않는다 — 조회는 틀려도 목록을 한 번 더 보여 줄 뿐이지만, 쓰기를 코드가
 *   추측으로 되살리면 사용자가 말하지 않은 일이 일어난다.
 */
export function isListRequest(prompt: string): boolean {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  return /(일정|스케줄|캘린더|기한|할\s*일|schedule|calendar)/i.test(text)
    && /(보여|알려|보고|조회|검색|목록|확인|뭐\s*(있|였)|무엇|list|show|view)/i.test(text);
}
