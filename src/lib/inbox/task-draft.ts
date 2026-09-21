/**
 * 공유/공람 문서 한 건 → 일정 초안(N1 · 계획서 S07).
 *
 * ★ 브리핑의 다른 모든 길과 달리, 이 길은 **본문을 연다.** 여는 순간 온나라에 열람
 *   기록이 남고 확장은 그것을 되돌릴 수 없다. 그래서 이 파일이 불리는 지점은 단 하나,
 *   사용자가 경고를 읽고 "본문을 읽고 일정 제안"을 누른 뒤다([panel.ts]).
 *
 * ★ 모델이 만든 값이 곧바로 저장되지 않는다. 여기서 나오는 것은 **폼에 채울 초안**이고,
 *   저장은 사용자가 폼을 보고 누를 때 일어난다(일정 저장소의 규칙 — store.ts 머리말).
 *
 * ★ 모델을 부르지 못해도 길이 막히지 않는다. 그때는 목록에서 읽은 값(제목·제목에서
 *   뽑은 기한)으로 초안을 만든다. 이미 문서를 연 뒤인데 등록조차 못 하면 사용자는
 *   열람 기록만 내주고 아무것도 얻지 못한다.
 */

import { ACTION_CARD_SCHEMA, actionCardInstruction, parseActionCard } from '@/lib/ai/action-card';
import { buildContext, type AttachedPage } from '@/lib/chat/context';
import { streamChat } from '@/lib/ollama/stream';
import { buildTaskCandidates, type TaskCandidate } from '@/lib/schedule/candidates';
import { parseReferenceDate, type TaskDue } from '@/lib/schedule/due-date';
import type { NewScheduleTask } from '@/lib/schedule/task';
import type { Settings } from '@/lib/storage/settings';
import type { InboxDoc } from './types';

/**
 * 확인 폼이 그대로 그리는 값.
 *
 * ★ 폼의 칸(날짜·시각)과 같은 모양으로 둔다. 화면에서 `due` 객체를 풀었다 다시 묶으면
 *   사용자가 고친 값과 원문 표기가 어긋난다.
 */
export interface TaskDraft {
  title: string;
  /** YYYY-MM-DD. 없으면 빈 문자열 — tasks 테이블과 같은 규칙이다. */
  date: string;
  /** HH:mm. 기한 날짜가 없으면 비어 있다. */
  time: string;
  notes: string;
  /** 근거가 된 원문 문장. 사용자가 등록 전에 대조할 수 있어야 한다. */
  evidence?: string;
  evidenceVerified: boolean;
  /** 초안을 만들 때의 기한. 사용자가 날짜를 고치면 원문 표기는 따라오지 않는다. */
  due?: TaskDue;
  deliverables?: string[];
  contact?: string;
  /** AI가 빠뜨려 코드가 원문에서 직접 찾은 기한인가. */
  foundByCode: boolean;
  /** 목록에서 만든 값인가, 본문에서 모델이 뽑은 값인가. 화면이 그대로 밝힌다. */
  origin: 'list' | 'model';
}

/** 본문을 읽어 낸 결과. 초안이 비는 일은 없다 — 부르는 쪽이 목록 값으로 채운다. */
export interface TaskDraftOutcome {
  drafts: TaskDraft[];
  /** 모델이 읽은 문서 요지. 초안이 어디서 나왔는지 사용자가 가늠하는 한 줄이다. */
  summary: string;
}

/**
 * 목록에서 읽은 값만으로 만드는 초안.
 *
 * ★ 지어낸 값이 없다. 제목은 목록의 제목이고, 기한은 코드가 그 제목에서 읽어낸 것이다
 *   (classify-rules.ts). 모델을 부르지 못한 날에도 이 초안은 그대로 성립한다.
 */
export function draftFromDoc(doc: InboxDoc): TaskDraft {
  return {
    title: doc.title,
    date: doc.dueDate,
    time: doc.due?.time ?? '',
    notes: '',
    ...(doc.due ? { evidence: doc.due.text, due: doc.due } : {}),
    // 제목에서 코드가 직접 읽은 기한이다. 모델의 주장이 아니므로 확인된 값으로 둔다.
    evidenceVerified: Boolean(doc.due),
    foundByCode: false,
    origin: 'list',
  };
}

export function draftFromCandidate(candidate: TaskCandidate): TaskDraft {
  return {
    title: candidate.title,
    date: candidate.due?.date ?? '',
    time: candidate.due?.time ?? '',
    notes: '',
    ...(candidate.evidence ? { evidence: candidate.evidence } : {}),
    evidenceVerified: candidate.evidenceVerified,
    ...(candidate.due ? { due: candidate.due } : {}),
    ...(candidate.deliverables?.length ? { deliverables: candidate.deliverables } : {}),
    ...(candidate.contact ? { contact: candidate.contact } : {}),
    foundByCode: Boolean(candidate.foundByCode),
    origin: 'model',
  };
}

/**
 * 폼에 먼저 채울 후보를 앞으로 보낸다.
 *
 * ★ 기한이 있는 후보가 먼저다. 이 화면이 존재하는 이유가 "언제까지 해야 하는가"이고,
 *   기한 없는 항목이 기본값이 되면 사용자가 매번 고르게 된다.
 * ★ 나머지 후보를 **버리지 않는다.** 한 공문에 조치가 둘인 경우가 흔하고, 무엇이
 *   내 일인지는 본문을 본 사람이 정한다. 화면에서 바꿔 끼울 수 있게 뒤에 남긴다.
 */
export function rankCandidates(candidates: TaskCandidate[]): TaskCandidate[] {
  const score = (candidate: TaskCandidate): number =>
    (candidate.due ? 2 : 0) + (candidate.evidenceVerified ? 1 : 0);
  return [...candidates]
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) =>
      score(right.candidate) - score(left.candidate) ||
      (left.candidate.due?.date ?? '9999').localeCompare(right.candidate.due?.date ?? '9999') ||
      left.index - right.index)
    .map(item => item.candidate);
}

/**
 * 초안 → 저장할 일정 항목.
 *
 * ★ 사용자가 폼에서 고른 날짜는 추론이 아니다. 날짜를 고쳤으면 원문 표기(`text`)와
 *   연도 추정 표시도 그 값에 맞춘다(SchedulePanel의 폼과 같은 규칙). 고치지 않았으면
 *   공문에 적힌 표기를 그대로 남겨 나중에 원문과 대조할 수 있게 한다.
 *
 * ★ `dedupeKey`는 문서 한 건에 하나다. 같은 공문을 두 번 등록해도 일정이 둘로 늘지 않는다.
 */
export function toNewTask(doc: InboxDoc, draft: TaskDraft): NewScheduleTask {
  const title = draft.title.trim() || doc.title;
  const date = draft.date.trim();
  const time = date ? draft.time.trim() : '';
  const kept = date && draft.due?.date === date ? draft.due : null;
  const due: TaskDue | undefined = date
    ? {
        date,
        ...(time ? { time } : {}),
        text: kept ? kept.text : date,
        yearInferred: kept ? kept.yearInferred : false,
      }
    : undefined;
  const notes = draft.notes.trim();
  return {
    title,
    status: 'todo',
    dueDate: date,
    ...(due ? { due } : {}),
    ...(draft.evidence ? { evidence: draft.evidence } : {}),
    evidenceVerified: draft.evidenceVerified,
    ...(draft.deliverables?.length ? { deliverables: draft.deliverables } : {}),
    ...(draft.contact ? { contact: draft.contact } : {}),
    ...(notes ? { notes } : {}),
    source: { docTitle: doc.title },
    dedupeKey: `inbox:${doc.key}`,
  };
}

/**
 * 본문을 읽은 결과에서 일정 초안을 뽑는다.
 *
 * ★ 핵심·조치사항 카드(S01)와 **같은 스키마·같은 대조**를 쓴다. 이 화면만의 프롬프트를
 *   따로 두면, 같은 공문이 AI 탭과 여기서 다른 기한을 말하게 된다.
 *
 * ★ 기준일은 문서의 보고일자다. 오늘이 아니다 — 지난달 공문의 "9. 30.까지"가 한 해
 *   뒤로 밀리는 것을 막는다(due-date.ts 머리말).
 */
export async function draftTasksFromBody(
  doc: InboxDoc,
  page: AttachedPage,
  settings: Settings,
  signal?: AbortSignal,
): Promise<TaskDraftOutcome> {
  const context = buildContext(
    [{ role: 'user', content: actionCardInstruction(doc.title) }],
    settings.numCtx,
    page,
  );

  let raw = '';
  await streamChat(
    settings.endpoint,
    {
      model: settings.model,
      messages: context,
      stream: true,
      think: false,
      keep_alive: settings.keepAlive,
      format: ACTION_CARD_SCHEMA as unknown as Record<string, unknown>,
      // 사실 추출이다. 같은 공문이 매번 같은 기한으로 읽혀야 한다.
      options: { temperature: 0, num_ctx: settings.numCtx },
    },
    { onToken: token => { raw += token; } },
    signal,
  );
  signal?.throwIfAborted();

  const card = parseActionCard(raw);
  if (!card) throw new Error('AI 응답을 일정 형식으로 읽지 못했습니다.');
  const reference = parseReferenceDate(doc.reportDate) ?? new Date();
  return {
    drafts: rankCandidates(buildTaskCandidates(card, page.text, reference)).map(draftFromCandidate),
    summary: card.summary.trim(),
  };
}
