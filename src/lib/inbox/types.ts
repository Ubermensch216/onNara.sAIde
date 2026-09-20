/**
 * 접수함 브리핑(N1 · 계획서 S09)의 자료형.
 *
 * ★ 대상은 온나라 `공유/공람 > 받은문서` 한 화면이다. 다른 문서함을 함께 다루지 않는다 —
 *   문서함마다 열 구성과 열람 처리 규칙이 달라, 하나로 뭉치면 어느 쪽도 정확하지 않다.
 *
 * ★ 여기 있는 값은 전부 **목록 표에서 읽은 것**이다. 본문을 열지 않는다. 그것이
 *   미열람 상태를 그대로 두는 유일한 방법이다(docs/n1-inbox-briefing-plan.md §2).
 */

import type { DocumentReadState } from '@/lib/onnara/document-list';
import type { TaskDue } from '@/lib/schedule/due-date';

/**
 * 브리핑의 갈래.
 *
 * - `deadline` 기한 임박 — 제목에서 코드가 날짜를 뽑아낸 문서
 * - `mine` 내 업무로 보임 — 키워드가 걸리거나 조치를 요구하는 말이 있는 문서
 * - `notice` 단순 공람 — 나머지
 * - `filtered` 범위 밖 — 사용자가 정한 범위에 들지 않은 문서. **버리지 않고 남긴다**
 */
export type InboxCategory = 'deadline' | 'mine' | 'notice' | 'filtered';

export const INBOX_CATEGORIES: readonly InboxCategory[] = ['deadline', 'mine', 'notice', 'filtered'];

/** 목록 표 한 행에서 브리핑이 쓰는 값만 추린 것. */
export interface InboxRow {
  title: string;
  /** 보고일자. 기한 연도 추론의 기준일이자 문서 정체성의 일부다. */
  reportDate: string;
  sender: string;
  department: string;
  hasAttachment: boolean;
  readState: DocumentReadState;
}

/**
 * 원장 한 줄. 같은 문서는 몇 번을 다시 읽어도 한 줄이다.
 *
 * ★ `briefedAt`이 비어 있으면 "아직 브리핑하지 않았다"는 뜻이다. 이 한 필드가
 *   "무엇을 처리했는가"의 전부다 — 별도의 처리 플래그를 두지 않는다.
 */
export interface InboxDoc extends InboxRow {
  /** 문서 정체성(기본키). lib/inbox/identity.ts */
  key: string;
  /** 보고일자·수발신자 묶음 키. 제목이 줄여 그려졌을 때 같은 문서를 찾는 범위다. */
  group: string;
  category: InboxCategory;
  /** 왜 그 갈래로 보았는가. 사용자가 되짚을 수 있어야 한다. */
  reason: string;
  /** 코드가 제목에서 뽑은 기한. 모델이 만든 값은 여기 들어오지 않는다. */
  due?: TaskDue;
  /** 색인·정렬용 기한 날짜(YYYY-MM-DD). 없으면 빈 문자열 — tasks 테이블과 같은 규칙이다. */
  dueDate: string;
  /** 규칙이 정했는가, 모델이 다시 정했는가. */
  classifier: 'rule' | 'model';
  firstSeenAt: number;
  lastSeenAt: number;
  briefedAt?: number;
  /** 사용자가 브리핑에서 문서를 열었다(= 열람 처리됐다). */
  openedAt?: number;
  /**
   * 브리핑이 설정(`mark-read`)에 따라 이 문서를 열어 열람 처리한 시각.
   *
   * ★ `openedAt`과 나눠 둔다. 하나는 사용자가 읽으려고 연 것이고, 다른 하나는 설정이
   *   시킨 것이다. 섞으면 "내가 언제 이걸 봤지?"에 답할 수 없고, 아직 읽지 않은 문서가
   *   처리된 것처럼 목록에서 사라진다.
   */
  markedReadAt?: number;
  /** 사용자가 넘겼다. 다음 브리핑에 다시 올리지 않는다. */
  dismissedAt?: number;
  /** 일정으로 등록했다면 그 항목. 브리핑 → 일정 전환율의 근거다. */
  taskId?: number;
}

export type InboxTrigger = 'alarm' | 'startup' | 'manual';

/**
 * 실행 한 번의 기록.
 *
 * ★ 성공만 남기지 않는다. 온나라 세션이 끊겨 건너뛴 것도 기록이다 — 사용자가 아침에
 *   빈 브리핑을 보고 "오늘은 문서가 없구나"로 오해하면 안 된다.
 */
export interface InboxRun {
  id: number;
  at: number;
  trigger: InboxTrigger;
  /** 목록에서 읽은 행 수. */
  scanned: number;
  /** 처음 본 문서 수. */
  added: number;
  /** 이번 브리핑에 실린 문서 수. */
  briefed: number;
  /** 범위 밖으로 걸러진 문서 수. */
  filtered: number;
  /**
   * 지난 확인 이후 열람 상태가 바뀐 문서 수.
   *
   * ★ `keep-unread`에서는 0이어야 한다. 0이 아니면 브리핑이 아닌 무언가가 문서를 열었거나
   *   열람 열을 잘못 읽고 있다는 뜻이다. 그 사실을 화면에 그대로 보인다.
   */
  readStateChanged: number;
  /** 실행하지 못한 이유. 있으면 나머지 수치는 0이다. */
  error?: string;
}
