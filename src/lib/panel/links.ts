/**
 * 답변 안에서 다른 탭의 항목으로 건너뛰는 링크.
 *
 * ★ `@` 명령을 실행했다고 화면을 옮겨 버리지 않는다. 사용자는 지시한 자리에서 결과를
 *   읽고 다음 지시를 잇는 중이다. 화면이 통째로 바뀌면 방금 무엇을 시켰는지, 답이
 *   무엇이었는지가 함께 사라진다. 결과는 AI 창에 남기고, **갈지 말지는 누르는 사람이
 *   정한다.**
 *
 * ★ 조각 주소(`#`)에 담는다. 다운로드 링크(downloads/links.ts)와 같은 방식이다 —
 *   DOMPurify를 통과해도 실행 가능한 스킴이 생기지 않고, 마크다운 본문에 그대로 쓸 수 있다.
 */

import { isCalendarMode, type CalendarMode } from '@/lib/schedule/calendar';

export const PANEL_LINK_PREFIX = '#saide-goto=';

/**
 * sanitize 허용 목록에 넣을 조각(lib/markdown.ts).
 *
 * ★ 링크를 만드는 곳과 통과시키는 곳이 갈라지면, 새 형태를 추가한 날 링크가 조용히
 *   사라진다. 화면에서는 밑줄 없는 글자로만 보여 무엇이 잘못됐는지 알기 어렵다.
 *   그래서 문법을 여기 한 곳에 두고, links.test.ts가 둘이 어긋나지 않음을 확인한다.
 */
export const PANEL_LINK_URI_PATTERN =
  // ★ 정규식 리터럴에서 꺼낸다. 문자열로 적으면 `\d`가 TypeScript 단계에서 `d`로 삼켜져,
  //   컴파일도 테스트도 통과하는 채로 허용 목록만 조용히 헐거워진다.
  /#saide-goto=(?:schedule(?::task:\d{1,12}|:date:\d{4}-\d{2}-\d{2}:[a-z]+)?|tools(?::job:[\w-]{1,64})?|inbox(?::doc:[a-z0-9]{1,32})?)$/
    .source;

/** 누르면 갈 곳. 탭만 여는 것부터 항목 하나를 짚는 것까지. */
export type PanelLink =
  /** 일정 탭의 이 항목으로. 날짜·보기는 그 항목에 맞춰 화면이 정한다. */
  | { tab: 'schedule'; taskId: number }
  /** 일정 탭의 이 날짜·보기로. 조회 결과의 범위를 그대로 펼칠 때 쓴다. */
  | { tab: 'schedule'; cursor: string; mode: CalendarMode }
  | { tab: 'schedule' }
  /** 도구 탭의 이 작업으로. */
  | { tab: 'automation'; jobId: string }
  | { tab: 'automation' }
  /** 공유/공람 탭의 이 문서로. 알림을 눌렀을 때 그 문서를 짚어 연다(N1). */
  | { tab: 'inbox'; docKey: string }
  | { tab: 'inbox' };

export function panelLink(target: PanelLink): string {
  if (target.tab === 'inbox') {
    return `${PANEL_LINK_PREFIX}inbox${'docKey' in target ? `:doc:${target.docKey}` : ''}`;
  }
  if (target.tab === 'automation') {
    return `${PANEL_LINK_PREFIX}tools${'jobId' in target ? `:job:${target.jobId}` : ''}`;
  }
  if ('taskId' in target) return `${PANEL_LINK_PREFIX}schedule:task:${target.taskId}`;
  if ('cursor' in target) return `${PANEL_LINK_PREFIX}schedule:date:${target.cursor}:${target.mode}`;
  return `${PANEL_LINK_PREFIX}schedule`;
}

/**
 * 링크 주소를 갈 곳으로 되읽는다. 우리가 만든 형태가 아니면 null이다.
 *
 * ★ 느슨하게 읽지 않는다. 답변 본문에는 공문에서 온 글자가 섞이므로, 조금이라도
 *   어긋나면 링크가 아닌 것으로 본다.
 */
export function parsePanelLink(href: string | null | undefined): PanelLink | null {
  const value = href ?? '';
  if (!value.startsWith(PANEL_LINK_PREFIX)) return null;
  const rest = value.slice(PANEL_LINK_PREFIX.length);

  if (rest === 'schedule') return { tab: 'schedule' };
  if (rest === 'tools') return { tab: 'automation' };
  if (rest === 'inbox') return { tab: 'inbox' };

  const inbox = /^inbox:doc:([a-z0-9]{1,32})$/.exec(rest);
  if (inbox) return { tab: 'inbox', docKey: inbox[1]! };

  const task = /^schedule:task:(\d{1,12})$/.exec(rest);
  if (task) return { tab: 'schedule', taskId: Number(task[1]) };

  const date = /^schedule:date:(\d{4}-\d{2}-\d{2}):(\w+)$/.exec(rest);
  if (date && isCalendarMode(date[2])) return { tab: 'schedule', cursor: date[1]!, mode: date[2] };

  const job = /^tools:job:([\w-]{1,64})$/.exec(rest);
  if (job) return { tab: 'automation', jobId: job[1]! };

  return null;
}
