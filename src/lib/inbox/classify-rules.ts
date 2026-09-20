/**
 * 브리핑 갈래 분류 — 규칙 편(모델 0회).
 *
 * ★ 이 기능은 모델 없이 성립해야 한다. Ollama가 꺼져 있어도, 패널이 닫혀 있어 모델을
 *   부를 수 없는 아침 알람에서도 브리핑은 나와야 한다(진단 ① · 계획 §4).
 *
 * ★ 날짜는 코드가 뽑는다. 모델에게 기한을 묻지 않는다 — 원칙 2. `/조치`가 쓰는
 *   [due-date.ts]를 그대로 쓰므로, 제목에서 읽어낸 기한의 정확도는 이미 검증된 것과 같다.
 *
 * ★ 판정 이유를 반드시 문장으로 남긴다. 왜 '내 업무로 보임'인지 모르는 분류는
 *   사용자가 신뢰하지 않고, 신뢰하지 않는 분류는 화면을 열 이유가 되지 못한다.
 */

import { normalizeForMatch } from '@/lib/onnara/document-list';
import { normalizeDueDate, parseReferenceDate, type TaskDue } from '@/lib/schedule/due-date';
import { daysUntil } from '@/lib/schedule/task';
import type { InboxCategory, InboxRow } from './types';

/**
 * 제목에 있으면 "내가 손댈 일"로 보는 말.
 *
 * ★ `보고`·`안내`는 넣지 않는다. 단순 공람 제목에 가장 흔한 말이라, 넣는 순간
 *   목록 대부분이 '내 업무로 보임'이 되어 갈래가 의미를 잃는다.
 */
const ACTION_WORDS = ['제출', '회신', '요청', '협조', '조치', '신청', '의견조회', '수요조사', '참석', '독촉', '이행', '정산', '점검'];

export interface ClassifyOptions {
  now?: Date;
  /** '내 업무로 보임' 판정에 쓸 관심 키워드. 설정 키워드가 그대로 들어온다. */
  interests?: string[];
  /** 며칠 앞까지를 `기한 임박`으로 볼 것인가. */
  deadlineWithinDays?: number;
  /** 며칠 지난 기한까지 `기한 임박`으로 볼 것인가. 그보다 오래된 날짜는 기한이 아니라 표기로 본다. */
  overdueWithinDays?: number;
}

export interface RuleVerdict {
  category: Exclude<InboxCategory, 'filtered'>;
  reason: string;
  /** 제목에서 읽어낸 기한. 갈래가 `deadline`이 아니어도 읽어냈으면 남긴다. */
  due?: TaskDue;
}

/**
 * 제목의 축약 기한 표기를 명시 표기로 바꾼다.
 *
 * ★ 본문 파서([action-card.ts]의 `findDates`)는 `9. 22.`처럼 연도도 월·일 글자도 없는 표기를
 *   **일부러 거른다.** 본문에는 "1. 2." 같은 항목 번호가 널려 있어 그러지 않으면 목차가 기한이 된다.
 *   그런데 공문 **제목**에는 `(9. 22.까지)`가 흔하다. 본문 파서를 느슨하게 푸는 대신,
 *   여기서 `까지`·`마감` 같은 기한 낱말이 바로 뒤에 붙은 경우에만 명시 표기로 고쳐 넘긴다.
 */
export function expandDeadlineNotation(title: string): string {
  return String(title ?? '').replace(
    /(?<![\d.])(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?(?=\s*(?:까지|마감|한|限))/g,
    '$1월 $2일',
  );
}

/**
 * 제목에서 기한을 읽는다. 기준일은 **보고일자**다.
 *
 * ★ 오늘이 아니다. 지난달 공문을 오늘 브리핑하면, 오늘을 기준으로 삼는 순간
 *   연도가 없는 기한("9. 30.까지")이 한 해 뒤로 밀린다.
 */
export function readTitleDue(row: InboxRow, now: Date): TaskDue | undefined {
  const reference = parseReferenceDate(row.reportDate) ?? now;
  return normalizeDueDate(expandDeadlineNotation(row.title), reference) ?? undefined;
}

export function classifyByRules(row: InboxRow, options: ClassifyOptions = {}): RuleVerdict {
  const now = options.now ?? new Date();
  const within = options.deadlineWithinDays ?? 7;
  const overdue = options.overdueWithinDays ?? 14;
  const due = readTitleDue(row, now);

  if (due) {
    const days = daysUntil(due.date, now);
    // 날짜가 있어도 한참 지났으면 기한이 아니라 제목에 박힌 표기다("2026. 3. 31. 기준 현황").
    if (days !== null && days <= within && days >= -overdue) {
      const label = days < 0 ? `기한 ${-days}일 지남` : days === 0 ? '오늘 기한' : `기한 D-${days}`;
      return { category: 'deadline', reason: `${label} · 제목의 "${due.text}"`, due };
    }
  }

  const text = normalizeForMatch(`${row.title} ${row.department}`);
  const interest = (options.interests ?? [])
    .filter(keyword => normalizeForMatch(keyword).length >= 2)
    .find(keyword => text.includes(normalizeForMatch(keyword)));
  if (interest) return { category: 'mine', reason: `관심 키워드 "${interest}"`, ...(due ? { due } : {}) };

  const action = ACTION_WORDS.find(word => text.includes(word));
  if (action) return { category: 'mine', reason: `조치를 요구하는 말 "${action}"`, ...(due ? { due } : {}) };

  return { category: 'notice', reason: '기한·조치 표현이 없습니다', ...(due ? { due } : {}) };
}
