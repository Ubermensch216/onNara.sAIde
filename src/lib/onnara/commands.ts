/**
 * 문서등록대장 목록 제어 명령.
 *
 * ★ 온나라 업무는 "목록(제목)을 보며 지시"한다. 본문을 띄워 놓고 읽는 작업이 아니다.
 *   그래서 이 명령들은 목록에 대한 정형화된 작업만 담고, 그 외의 문장은 모두
 *   일반 AI 대화로 보낸다(대화 문맥으로 답한다).
 *
 * ★ 명령은 문장으로 짐작하지 않는다. 예전에는 "문서", "내용" 같은 낱말로 의도를 추측해
 *   사용자의 질문이 문서별 요약으로 바뀌는 일이 있었다. 이제 어떤 작업인지는 명령 id가 정한다.
 *
 * ★ 접두 문자가 결과를 어디서 볼지 알린다(§ CommandPrefix). `/`는 답이 AI 창에 남는
 *   명령이고, `@`는 주화면이 다른 탭인 명령이다. 첨부 받기는 내려받은 결과와 실행 기록이
 *   도구 탭에 쌓이므로 `@`다 — 결과가 있는 곳을 이름이 미리 알려 주어야 한다.
 */

import type { StructuredDocumentList } from './document-list';

/**
 * 명령의 접두 문자.
 *
 * - `/` : 결과가 AI 창에 나타나는 명령. 답을 그 자리에서 읽는다.
 * - `@` : 다른 탭메뉴(일정·도구)가 주화면인 명령. 실행하면 그 탭으로 넘어간다.
 */
export type CommandPrefix = '/' | '@';

/** `@` 명령의 주화면. AI 창은 여기 없다 — 그것이 `/`와 `@`를 가르는 기준이다. */
export type PanelTab = 'schedule' | 'automation' | 'inbox';

export type DocumentCommandId = 'summary' | 'actions' | 'compare' | 'read' | 'attachments' | 'refresh';

export interface DocumentCommand {
  id: DocumentCommandId;
  prefix: CommandPrefix;
  /** 접두 문자를 포함한 전체 이름. 입력창에서 잘라낼 때 이 길이를 쓴다. */
  slash: string;
  /** 같은 뜻으로 통하는 다른 이름들. 접두 문자를 포함한다. */
  aliases: string[];
  /** `@` 명령이 끝나고 넘어갈 탭. `/` 명령에는 없다. */
  opensTab?: PanelTab;
  label: string;
  hint: string;
  /** 모델을 부르는 명령인가. false면 온나라 화면 조작만 한다(Ollama가 꺼져 있어도 동작). */
  usesModel: boolean;
  /** 슬래시 뒤에 남은 문장을 추가 지시로 함께 보낼 수 있는가. */
  takesArg: boolean;
}

export const DOCUMENT_COMMANDS: DocumentCommand[] = [
  {
    id: 'summary',
    prefix: '/',
    slash: '/요약',
    aliases: ['/summary', '/s'],
    label: '문서별 요약',
    hint: '체크한 문서를 한 건씩 읽고 각각 요약합니다',
    usesModel: true,
    takesArg: true,
  },
  {
    id: 'actions',
    prefix: '/',
    slash: '/조치',
    aliases: ['/actions', '/a'],
    label: '핵심·조치사항',
    hint: '할 일·제출물·기한을 원문과 대조해 정리합니다',
    usesModel: true,
    takesArg: false,
  },
  {
    id: 'compare',
    prefix: '/',
    slash: '/비교',
    aliases: ['/compare', '/c'],
    label: '여러 문서 비교',
    hint: '체크한 문서를 함께 읽고 한 번에 비교·분석합니다',
    usesModel: true,
    takesArg: true,
  },
  {
    id: 'read',
    prefix: '/',
    slash: '/읽기',
    aliases: ['/read', '/r'],
    label: '본문만 붙이기',
    hint: '요약 없이 본문만 읽어 둡니다. 이어서 그냥 질문하세요',
    usesModel: false,
    takesArg: false,
  },
  {
    id: 'attachments',
    // 내려받기는 도구 탭의 작업 대기열에 쌓인다. 결과를 보는 곳이 AI 창이 아니므로 `@`다.
    prefix: '@',
    slash: '@첨부',
    aliases: ['@attach', '@download'],
    opensTab: 'automation',
    label: '첨부 받기',
    hint: '체크한 문서의 첨부 파일을 모두 내려받습니다 (도구 탭)',
    usesModel: false,
    takesArg: false,
  },
  {
    id: 'refresh',
    prefix: '/',
    slash: '/새로고침',
    aliases: ['/refresh', '/list'],
    label: '목록 다시 읽기',
    hint: '화면의 목록과 체크 상태를 다시 읽어 옵니다',
    usesModel: false,
    takesArg: false,
  },
];

export function findDocumentCommand(id: string): DocumentCommand | undefined {
  return DOCUMENT_COMMANDS.find(command => command.id === id);
}

/** 명령이 다룰 문서 제목. 체크한 문서가 원칙이고, "전체"를 붙이면 현재 화면의 모든 문서다. */
export function commandTargets(list: StructuredDocumentList, args = ''): string[] {
  const compact = args.replace(/\s/g, '');
  if (/(전체|모든|모두)/.test(compact)) return list.rows.flatMap(row => row.title ? [row.title] : []);
  return list.selectedTitles ?? [];
}

/** 명령 뒤에 붙인 문장이 없을 때 모델에 보낼 기본 지시. */
export function defaultInstruction(id: DocumentCommandId): string {
  switch (id) {
    case 'summary':
      return '이 문서의 내용을 요약해줘.';
    case 'compare':
      return '이 문서들을 견주어 공통점과 차이점을 정리해줘.';
    default:
      return '';
  }
}
