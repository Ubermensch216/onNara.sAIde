/**
 * `@일정` 자연어 의도 분류(참조 프로젝트 myAI의 `server/calendarAgent.js`를 이식).
 *
 * ★ 모델은 **분류만** 한다. 답변 문장도, 목록 내용도 모델이 쓰지 않는다. 참조 프로젝트가
 *   주석으로 남긴 교훈이 그것이다 — 대화 모델에게는 저장된 일정이 보이지 않으므로,
 *   "이번 주 일정 알려줘"를 그대로 넘기면 없는 일정을 지어낸다. 여기서 뽑는 것은
 *   `무엇을 하려는가`와 `어떤 값으로`뿐이고, 결과 문장은 코드가 IndexedDB를 읽어 만든다.
 *
 * ★ 참조 프로젝트는 서버(Node)에서 분류했지만 확장에는 서버가 없다. 패널에서 Ollama를
 *   직접 부른다. 대신 `format: "json"`(자유 JSON)이 아니라 **JSON 스키마**로 구속한다 —
 *   이 저장소가 핵심·조치사항 카드에서 이미 쓰는 방식이고, 파싱 실패가 훨씬 적다.
 *
 * ★ 참조 프로젝트의 키워드 선별기(`hasCalendarKeyword` 등 200여 줄)는 가져오지 않았다.
 *   그쪽은 **모든** 대화문에서 일정 의도를 추측해야 해서 과탐지를 막을 장치가 필요했다.
 *   여기서는 사용자가 `@일정`이라고 먼저 선언하므로 과탐지가 구조적으로 없다.
 *
 * ★ 일정 모델이 다르다. 참조 프로젝트는 시작·종료가 있는 **약속**이고, 여기는 기한 하나와
 *   완료 여부를 가진 **업무 항목**이다(task.ts). 그래서 end·allDay·장소·색·반복·알림을
 *   버리고 `기한 날짜 + 시각`만 받는다.
 */

import type { TaskStatus } from './task';
import { extractDateRange, isListRequest } from './nl-date';

/* ── 명령 이름 ─────────────────────────────────────────── */

/** 이 기능을 가리키는 명령 id. 프리셋이 아니므로 presets.ts의 build()를 타지 않는다. */
export const SCHEDULE_PRESET_ID = 'schedule-nl';
/** `@` 그룹이다 — 주화면이 일정 탭이기 때문이다. */
export const SCHEDULE_SLASH = '@일정';
export const SCHEDULE_ALIASES = ['@schedule', '@task'];

export type ScheduleIntentKind =
  | 'schedule.create'
  | 'schedule.list'
  | 'schedule.update'
  | 'schedule.delete'
  | 'chat';

export interface CreatePayload {
  title: string;
  /** `YYYY-MM-DD`. 빈 문자열이면 기한 미정이다(이 저장소에서는 정상 상태다). */
  date: string;
  /** `HH:mm`. 원문에 시각이 있을 때만. */
  time?: string;
  notes?: string;
}

export interface ListPayload {
  from?: string;
  to?: string;
  /** 제목에서 찾을 말. 범위와 함께 쓰면 둘 다 만족하는 것만 본다. */
  query?: string;
}

export interface DeletePayload {
  matchTitle?: string;
  from?: string;
  to?: string;
}

export interface TaskChanges {
  title?: string;
  /** 빈 문자열이면 기한을 지운다. */
  date?: string;
  time?: string;
  notes?: string;
  status?: TaskStatus;
}

export interface UpdatePayload {
  matchTitle: string;
  changes: TaskChanges;
}

export type ScheduleIntent =
  | { intent: 'schedule.create'; payload: CreatePayload }
  | { intent: 'schedule.list'; payload: ListPayload }
  | { intent: 'schedule.update'; payload: UpdatePayload }
  | { intent: 'schedule.delete'; payload: DeletePayload }
  /** 일정 명령으로 읽지 못했다. `reason`은 왜 그런지 — 화면 안내와 점검에 쓴다. */
  | { intent: 'chat'; payload: Record<string, never>; reason?: string };

/** Ollama `format`에 넘기는 JSON 스키마. */
export const SCHEDULE_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: ['schedule.create', 'schedule.list', 'schedule.update', 'schedule.delete', 'chat'],
    },
    payload: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string' },
        time: { type: 'string' },
        notes: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        query: { type: 'string' },
        matchTitle: { type: 'string' },
        changes: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            date: { type: 'string' },
            time: { type: 'string' },
            notes: { type: 'string' },
            done: { type: 'boolean' },
          },
        },
      },
    },
  },
  required: ['intent', 'payload'],
} as const;

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 분류기 시스템 프롬프트.
 *
 * ★ 지시는 영어, 예시는 한국어다. 참조 프로젝트에서 그렇게 검증된 형태이고, 소형 모델은
 *   지시를 영어로 받을 때 형식을 덜 흐트러뜨린다. 판단 대상인 예시는 사용자가 실제로
 *   치는 말이어야 하므로 한국어 그대로 둔다.
 */
export function buildIntentPrompt(now: Date = new Date()): string {
  const today = iso(now);
  const weekday = WEEKDAYS[now.getDay()];
  const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const weekStart = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()));
  const weekEnd = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 6));
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const monthEnd = pad(new Date(year, now.getMonth() + 1, 0).getDate());

  return [
    'You classify a Korean public-servant\'s request about their personal task-deadline board.',
    `Today is ${today} (${weekday}요일). Time zone: Asia/Seoul.`,
    '',
    'IMPORTANT: items on this board are TASK DEADLINES, not appointments.',
    'There is no end time, no location, no all-day flag. Each item has a title, one due date,',
    'an optional due time, optional notes, and a done flag.',
    '',
    'Intents:',
    '- schedule.create: add a new task/deadline',
    '- schedule.list: view or search existing tasks',
    '- schedule.update: change a field of an existing task, or mark it done/undone',
    '- schedule.delete: remove an existing task',
    '- chat: anything else, or too vague to act on',
    '',
    'Output STRICTLY this JSON object and nothing else:',
    '{"intent":"<one of above>","payload":{...}}',
    '',
    'Payload fields by intent:',
    '- schedule.create: { title (required, short verb phrase), date ("YYYY-MM-DD", "" if no deadline was stated), time ("HH:mm", omit if no time was stated), notes (optional) }',
    '- schedule.list: { from ("YYYY-MM-DD", optional), to ("YYYY-MM-DD", optional), query (optional words to find in the title) }',
    '- schedule.update: { matchTitle (required, words from the existing task title), changes ({ title?, date?, time?, notes?, done? }) }',
    '- schedule.delete: { matchTitle (optional; OMIT when no specific task is named), from (optional), to (optional) }. At least one of the three MUST be present.',
    '- chat: {}',
    '',
    'Date rules:',
    `- "오늘" -> ${today}`,
    `- "내일" -> ${tomorrow}`,
    `- "이번 주" -> from ${weekStart} to ${weekEnd} (weeks start on Sunday)`,
    `- "이번 달" -> from ${year}-${month}-01 to ${year}-${month}-${monthEnd}`,
    '- "N월 전체 일정" means the whole calendar month, not the current week.',
    '- Korean weekday names: 일요일=Sun, 월요일=Mon, ... 토요일=Sat.',
    '- "~까지", "~한", "마감" all mark a deadline date.',
    '- Only set time when an explicit clock time was stated ("18시까지" -> "18:00", "오후 2시" -> "14:00").',
    '- If no deadline at all was stated for a new task, use date "" instead of guessing today.',
    '',
    'Examples:',
    `User: "내일까지 예산안 제출"`,
    `→ {"intent":"schedule.create","payload":{"title":"예산안 제출","date":"${tomorrow}"}}`,
    '',
    `User: "9월 30일 18시까지 실적보고서 내야 해"`,
    `→ {"intent":"schedule.create","payload":{"title":"실적보고서 제출","date":"${year}-09-30","time":"18:00"}}`,
    '',
    `User: "교육 신청 접수하기 (기한은 아직 몰라)"`,
    `→ {"intent":"schedule.create","payload":{"title":"교육 신청 접수","date":""}}`,
    '',
    `User: "이번 주 일정 보여줘"`,
    `→ {"intent":"schedule.list","payload":{"from":"${weekStart}","to":"${weekEnd}"}}`,
    '',
    `User: "5월 전체 일정 보고해"`,
    `→ {"intent":"schedule.list","payload":{"from":"${year}-05-01","to":"${year}-05-31"}}`,
    '',
    `User: "예산 관련해서 뭐 남았지?"`,
    `→ {"intent":"schedule.list","payload":{"query":"예산"}}`,
    '',
    `User: "실적보고서 기한을 10월 2일로 미뤄줘"`,
    `→ {"intent":"schedule.update","payload":{"matchTitle":"실적보고서","changes":{"date":"${year}-10-02"}}}`,
    '',
    `User: "예산안 제출 완료했어"`,
    `→ {"intent":"schedule.update","payload":{"matchTitle":"예산안 제출","changes":{"done":true}}}`,
    '',
    `User: "교육 신청 일정 지워줘"`,
    `→ {"intent":"schedule.delete","payload":{"matchTitle":"교육 신청"}}`,
    '',
    `User: "${tomorrow.slice(5).replace('-', '월 ')}일 일정 전부 취소해"`,
    `→ {"intent":"schedule.delete","payload":{"from":"${tomorrow}","to":"${tomorrow}"}}`,
    '',
    `User: "고마워"`,
    '→ {"intent":"chat","payload":{}}',
    '',
    'If the request is ambiguous or not about managing tasks, return chat.',
  ].join('\n');
}

/* ── 모델 응답 읽기 ────────────────────────────────────── */

function chat(reason: string): ScheduleIntent {
  return { intent: 'chat', payload: {}, reason };
}

/** 모델이 JSON 앞뒤에 말을 붙이는 경우가 있다. 첫 `{…}` 덩이를 건져 본다. */
function parseJson(text: string): unknown {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = /\{[\s\S]*\}/.exec(raw);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/** `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:mm`에서 날짜만. 형식이 아니면 null. */
export function normalizeDate(value: unknown): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // 2026-02-30처럼 형식만 맞는 값을 거른다.
  return date.getDate() === Number(match[3]) && date.getMonth() === Number(match[2]) - 1
    ? `${match[1]}-${match[2]}-${match[3]}`
    : null;
}

/** `HH:mm`. 날짜에 붙여 보낸 시각(`…T14:00`)도 받는다. */
export function normalizeTime(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const match = /(?:^|T)([01]?\d|2[0-3]):([0-5]\d)/.exec(text);
  return match ? `${pad(Number(match[1]))}:${match[2]}` : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
}

function normalizeCreate(payload: Raw): ScheduleIntent {
  const title = text(payload.title);
  if (!title) return chat('create_missing_title');

  // ★ 날짜를 못 읽었다고 오늘로 때우지 않는다. 기한 미정은 이 저장소에서 정상 상태이고,
  //   지어낸 기한은 사용자가 확인 카드에서 알아보기 어렵다.
  const date = normalizeDate(payload.date) ?? '';
  const time = date ? normalizeTime(payload.time) : undefined;
  const notes = text(payload.notes);
  return {
    intent: 'schedule.create',
    payload: { title, date, ...(time ? { time } : {}), ...(notes ? { notes } : {}) },
  };
}

function normalizeList(payload: Raw): ScheduleIntent {
  const from = normalizeDate(payload.from);
  const to = normalizeDate(payload.to);
  const query = text(payload.query);
  // 거꾸로 온 범위는 뒤집어 준다. 그대로 두면 한 건도 걸리지 않는다.
  const [start, end] = from && to && from > to ? [to, from] : [from, to];
  return {
    intent: 'schedule.list',
    payload: { ...(start ? { from: start } : {}), ...(end ? { to: end } : {}), ...(query ? { query } : {}) },
  };
}

function normalizeDelete(payload: Raw): ScheduleIntent {
  const matchTitle = text(payload.matchTitle);
  const from = normalizeDate(payload.from);
  const to = normalizeDate(payload.to);
  // ★ 셋 다 없으면 "전부 지워"가 된다. 사용자가 말하지 않은 범위를 우리가 정하지 않는다.
  if (!matchTitle && !from && !to) return chat('delete_missing_match');
  const [start, end] = from && to && from > to ? [to, from] : [from, to];
  return {
    intent: 'schedule.delete',
    payload: {
      ...(matchTitle ? { matchTitle } : {}),
      ...(start ? { from: start } : {}),
      ...(end ? { to: end } : {}),
    },
  };
}

function normalizeUpdate(payload: Raw): ScheduleIntent {
  const matchTitle = text(payload.matchTitle);
  if (!matchTitle) return chat('update_missing_match');

  const raw = asObject(payload.changes);
  const changes: TaskChanges = {};

  const title = text(raw.title);
  if (title) changes.title = title;

  // 빈 문자열은 "기한을 지워라"라는 뜻이다. 값이 없는 것과 구분해야 한다.
  if (typeof raw.date === 'string') {
    const date = normalizeDate(raw.date);
    if (date) changes.date = date;
    else if (!raw.date.trim()) changes.date = '';
  }

  const time = normalizeTime(raw.time);
  if (time) changes.time = time;
  else if (typeof raw.time === 'string' && !raw.time.trim()) changes.time = '';

  if (typeof raw.notes === 'string') changes.notes = raw.notes.trim();
  if (typeof raw.done === 'boolean') changes.status = raw.done ? 'done' : 'todo';

  if (!Object.keys(changes).length) return chat('update_no_changes');
  return { intent: 'schedule.update', payload: { matchTitle, changes } };
}

function validate(raw: unknown): ScheduleIntent {
  const parsed = asObject(raw);
  const payload = asObject(parsed.payload);
  switch (parsed.intent) {
    case 'schedule.create': return normalizeCreate(payload);
    case 'schedule.list': return normalizeList(payload);
    case 'schedule.update': return normalizeUpdate(payload);
    case 'schedule.delete': return normalizeDelete(payload);
    case 'chat': return { intent: 'chat', payload: {} };
    default: return chat('unknown_intent');
  }
}

/**
 * 코드가 확실히 아는 것으로 모델의 답을 덮는다.
 *
 * ★ 조회에만 적용한다. 조회는 틀려도 목록을 한 번 더 보여 줄 뿐이지만, 쓰기를 코드가
 *   추측으로 되살리면 사용자가 말하지 않은 일이 일어난다. 참조 프로젝트도 등록 보정은
 *   반복 일정 한 가지로 좁혀 두었다.
 */
export function correctIntent(result: ScheduleIntent, prompt: string, now: Date): ScheduleIntent {
  const range = extractDateRange(prompt, now);
  if (!range) return result;

  // 모델이 조회로 읽었으면 범위만 코드 값으로 바로잡는다("5월 전체"를 이번 주로 줄이는 사례).
  if (result.intent === 'schedule.list') {
    return { intent: 'schedule.list', payload: { ...result.payload, from: range.from, to: range.to } };
  }

  // 명백한 조회 문장을 chat으로 흘려보냈으면 되돌린다.
  if (result.intent === 'chat' && isListRequest(prompt)) {
    return { intent: 'schedule.list', payload: { from: range.from, to: range.to } };
  }

  return result;
}

/** 모델 원시 응답 한 덩이 → 실행할 의도. */
export function readIntent(raw: string, prompt: string, now: Date = new Date()): ScheduleIntent {
  const parsed = parseJson(raw);
  if (parsed === null) return correctIntent(chat('parse_failure'), prompt, now);
  return correctIntent(validate(parsed), prompt, now);
}
