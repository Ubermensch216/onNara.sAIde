import { DOCUMENT_COMMANDS, type CommandPrefix, type PanelTab } from '@/lib/onnara/commands';
/**
 * 프롬프트 프리셋. 계획서 §5 Phase 3-4 / 3-6 / 4-3 / 4-4
 *
 * 페이지 액션, 선택 텍스트 액션(컨텍스트 메뉴), 슬래시 커맨드를 한 곳에서
 * 정의한다. background.ts의 메뉴 id와 여기 id가 일치해야 한다.
 */

/** 프리셋이 요구하는 첨부물 */
/** 'documents'는 온나라 목록 명령이다. 나머지는 우클릭 메뉴의 선택 텍스트 프리셋에 쓴다. */
export type PresetNeeds = 'none' | 'documents' | 'page' | 'screen' | 'selection';

export interface Preset {
  id: string;
  /** 버튼·메뉴에 표시할 이름 */
  label: string;
  /** 슬래시 커맨드 (앞의 / 포함) */
  slash?: string;
  /** 같은 뜻으로 통하는 다른 이름들. 자동완성에서 함께 매치된다. */
  aliases?: string[];
  /** 자동완성 목록에 보여줄 한 줄 설명 */
  hint?: string;
  needs: PresetNeeds;
  /**
   * 슬래시 뒤에 남은 텍스트를 build()의 **인자로** 넘길지.
   *
   * 페이지형은 기본적으로 남은 텍스트를 프롬프트 뒤에 덧붙인다("/summary 표로").
   * 그런데 번역은 그 텍스트가 추가 지시가 아니라 **대상 언어**다. 덧붙이면
   * "…번역해줘\n\n영어"가 되어 모델이 언어를 지시로 읽지 못한다.
   */
  takesArg?: boolean;
  /** 사용자 메시지로 보낼 문구를 만든다 */
  build: (selection?: string) => string;
}

/* ── 번역 대상 언어 ────────────────────────────────────── */

/**
 * 사용자가 쓰는 이름을 프롬프트에 넣을 한 가지 표기로 모은다.
 *
 * ★ 목록에 없는 언어도 막지 않는다. 모델이 아는 언어는 우리 표보다 훨씬
 *   많으므로, 모르는 이름은 다듬기만 해서 그대로 넘긴다. 여기서 거부하면
 *   "지원하지 않는 언어"라는 없는 제약을 우리가 만들어내는 셈이다.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  en: '영어', eng: '영어', english: '영어', 영어: '영어',
  ko: '한국어', kr: '한국어', korean: '한국어', 한국어: '한국어', 한글: '한국어', 국어: '한국어',
  ja: '일본어', jp: '일본어', japanese: '일본어', 일본어: '일본어', 일어: '일본어',
  zh: '중국어', cn: '중국어', chinese: '중국어', 중국어: '중국어', 중어: '중국어',
  es: '스페인어', spanish: '스페인어', 스페인어: '스페인어',
  fr: '프랑스어', french: '프랑스어', 프랑스어: '프랑스어',
  de: '독일어', german: '독일어', 독일어: '독일어',
  ru: '러시아어', russian: '러시아어', 러시아어: '러시아어',
  vi: '베트남어', vietnamese: '베트남어', 베트남어: '베트남어',
};

/**
 * 슬래시 뒤에 남은 텍스트에서 대상 언어를 뽑는다.
 *
 * ★ 사용자는 슬래시 문법을 외우지 않는다. "/translate 영어"만 받게 만들면
 *   "/translate 영어로", "/translate 영어로 번역해줘"가 전부 빗나간다.
 *   조사와 "번역" 꼬리를 떼고 본다.
 */
/* ── 선택 텍스트 액션 (컨텍스트 메뉴 + 슬래시) ─────────── */

/**
 * ★ 선택 텍스트는 페이지 본문이 아니라 사용자가 직접 고른 조각이다.
 *   그래도 출처는 웹페이지이므로 <page_content>로 감싸 데이터임을 명시한다.
 *   여기에 인젝션이 들어 있을 수 있다는 전제는 동일하다.
 */
function wrapSelection(text: string): string {
  return `<page_content>\n${text}\n</page_content>`;
}

export const SELECTION_PRESETS: Preset[] = [
  {
    /**
     * ★ 슬래시가 없다. `/translate`는 페이지 번역이 가져갔다.
     *   선택 텍스트 번역의 진입점은 우클릭 메뉴(background.ts의 saide.translate)이고,
     *   거기서는 id로 찾으므로 슬래시가 필요 없다. 한 이름이 첨부 대상이 다른 두
     *   동작을 가리키면, 사용자는 무엇이 번역될지 칠 때마다 추측해야 한다.
     */
    id: 'translate',
    label: '번역',
    hint: '선택한 텍스트를 한↔영으로',
    needs: 'selection',
    build: (s = '') =>
      `다음 텍스트를 한국어로 자연스럽게 번역해줘. 이미 한국어면 영어로 번역해줘.\n\n${wrapSelection(s)}`,
  },
  {
    id: 'explain',
    label: '쉽게 설명',
    slash: '/explain',
    hint: '처음 보는 사람도 알아듣게',
    needs: 'selection',
    build: (s = '') =>
      `다음 텍스트를 처음 접하는 사람도 이해할 수 있게 쉽게 설명해줘.\n\n${wrapSelection(s)}`,
  },
  {
    id: 'polish',
    label: '문장 다듬기',
    slash: '/polish',
    hint: '뜻은 그대로, 더 자연스럽게',
    needs: 'selection',
    build: (s = '') =>
      `다음 문장을 뜻은 그대로 두고 더 자연스럽게 다듬어줘. 다듬은 결과만 보여줘.\n\n${wrapSelection(s)}`,
  },
  {
    id: 'send',
    label: '사이드패널로 보내기',
    needs: 'selection',
    // 사용자가 무엇을 물을지 정한다. 입력창에 넣어만 준다.
    build: (s = '') => wrapSelection(s),
  },
];

export const ALL_PRESETS = SELECTION_PRESETS;

export function findPreset(id: string): Preset | undefined {
  return ALL_PRESETS.find((p) => p.id === id);
}

/* ── 슬래시 커맨드 (Phase 4-3) ─────────────────────────── */

export interface SlashCommand {
  /**
   * 접두 문자. `/`는 답이 AI 창에 남는 명령, `@`는 다른 탭메뉴가 주화면인 명령이다.
   *
   * ★ 이름(`slash`, `aliases`)은 접두 문자를 **포함한** 전체 문자열이다. 입력창은 실제로
   *   친 이름의 길이만큼 잘라 인자를 뽑으므로, 이름에서 접두 문자를 떼면 인자가 어긋난다.
   */
  prefix: CommandPrefix;
  slash: string;
  label: string;
  hint: string;
  presetId: string;
  needs: PresetNeeds;
  /** `@` 명령이 끝나고 넘어갈 탭. 자동완성의 뱃지도 이 값으로 그린다. */
  opensTab?: PanelTab;
  /** 자동완성에서 함께 매치될 다른 이름들 */
  aliases?: string[];
  /** 사용자 정의 프리셋인가 */
  custom?: boolean;
}

/** 사용자가 만든 프리셋. chrome.storage.local에 저장된다. */
export interface CustomPreset {
  id: string;
  label: string;
  /** 앞의 / 없이 저장한다 */
  slash: string;
  /** 본문. {{selection}} 자리에 입력창에 남은 텍스트가 들어간다. */
  template: string;
  needs: PresetNeeds;
}

/**
 * 내장 명령은 온나라 문서등록대장 목록을 다루는 명령만 둔다.
 *
 * ★ 예전에는 웹페이지 본문을 다루는 명령(/summary, /translate 등)이 있었다. 온나라 업무는
 *   목록(제목)을 보며 지시하는 일이라 쓰이지 않았고, 문장으로 하는 요청과 역할이 겹쳤다.
 *   지금은 정형화된 작업만 명령으로, 나머지 문장은 모두 일반 대화로 간다.
 */
export function builtinCommands(): SlashCommand[] {
  return DOCUMENT_COMMANDS.map((command) => ({
    prefix: command.prefix,
    slash: command.slash,
    label: command.label,
    hint: command.hint,
    presetId: command.id,
    needs: 'documents' as const,
    aliases: command.aliases,
    ...(command.opensTab ? { opensTab: command.opensTab } : {}),
  }));
}

/** 이 커맨드가 반응하는 모든 이름 */
export function namesOf(c: SlashCommand): string[] {
  return [c.slash, ...(c.aliases ?? [])];
}

/** 사용자 프리셋의 결과는 AI 창에 나타난다. 그래서 언제나 `/` 그룹이다. */
export function customCommands(customs: CustomPreset[]): SlashCommand[] {
  return customs.map((c) => ({
    prefix: '/' as const,
    slash: `/${c.slash}`,
    label: c.label,
    hint: '내 프리셋',
    presetId: c.id,
    needs: c.needs,
    custom: true,
  }));
}

/** 이 글자로 명령이 시작될 수 있는가. */
export function isCommandPrefix(ch: string): ch is CommandPrefix {
  return ch === '/' || ch === '@';
}

/**
 * 입력창 내용에서 명령 후보를 찾는다.
 *
 * 첫 글자가 `/` 또는 `@`이고 아직 공백이 없을 때만 자동완성을 띄운다.
 * 본문 중간의 `/`(URL, 날짜 등)나 `@`(전자우편 주소)를 건드리면 방해만 된다.
 *
 * ★ 친 접두 문자와 같은 그룹만 보여 준다. 두 그룹을 섞어 보이면 접두 문자로 결과가
 *   어디에 나타나는지 알린다는 구분 자체가 무의미해진다.
 *
 * ★ 다만 같은 그룹에 맞는 것이 하나도 없으면 반대 그룹에서 찾아 보여 준다. `/첨부`가
 *   `@첨부`로 옮겨 갔을 때, 예전 이름을 친 사람에게 빈 목록 대신 새 이름을 보여 주는
 *   길이다. 골라 넣으면 입력이 새 이름으로 바뀌므로 한 번에 옮겨 배운다.
 */
export function matchSlash(
  input: string,
  commands: SlashCommand[],
): SlashCommand[] {
  const head = input.slice(0, 1);
  if (!isCommandPrefix(head)) return [];
  const token = input.slice(1);
  if (/\s/.test(token)) return [];
  const q = token.toLowerCase();
  const hits = commands.filter((c) =>
    namesOf(c).some((n) => n.slice(1).toLowerCase().startsWith(q)),
  );
  const sameGroup = hits.filter((c) => c.prefix === head);
  return sameGroup.length ? sameGroup : hits;
}

/**
 * 다 쓰고 Enter를 친 한 줄에서 실행할 명령과 인자를 가려낸다.
 *
 * ★ 접두 문자가 어긋나도 이름이 맞으면 찾아 준다. `/첨부`가 `@첨부`로 옮겨 갔는데
 *   예전 이름을 친 사람의 입력이 그대로 모델에게 보내지면, 명령이 사라진 것처럼 보이고
 *   토큰까지 쓴다. 접두 문자가 맞는 명령을 먼저 보고, 없을 때만 이름으로 찾는다.
 */
export function resolveTyped(
  input: string,
  commands: SlashCommand[],
): { cmd: SlashCommand; rest: string } | null {
  const text = input.trim();
  const head = text.slice(0, 1);
  if (!isCommandPrefix(head)) return null;
  const body = text.slice(1).toLowerCase();

  /** 이 명령의 이름 중 하나로 시작하는가. 맞으면 접두 문자를 뺀 이름 길이. */
  const nameLength = (c: SlashCommand): number => {
    for (const full of namesOf(c)) {
      const name = full.slice(1).toLowerCase();
      if (body === name || body.startsWith(`${name} `)) return name.length;
    }
    return -1;
  };

  for (const group of [commands.filter((c) => c.prefix === head), commands]) {
    for (const c of group) {
      const len = nameLength(c);
      if (len >= 0) return { cmd: c, rest: text.slice(1 + len).trim() };
    }
  }
  return null;
}

/** 슬래시 커맨드를 실제 프롬프트로 바꾼다. */
export function expandCommand(
  cmd: SlashCommand,
  rest: string,
  customs: CustomPreset[],
): string {
  if (cmd.custom) {
    const c = customs.find((x) => x.id === cmd.presetId);
    if (!c) return rest;
    return c.template.includes('{{selection}}')
      ? c.template.replace(/\{\{selection\}\}/g, rest)
      : rest
        ? `${c.template}\n\n${wrapSelection(rest)}`
        : c.template;
  }

  const preset = findPreset(cmd.presetId);
  if (!preset) return rest;

  // 선택 텍스트형은 뒤에 붙은 내용을 대상으로 삼는다.
  if (preset.needs === 'selection') return preset.build(rest);

  // 인자를 받는 페이지형(번역의 대상 언어)은 뒤에 덧붙이지 않고 넘겨준다.
  if (preset.takesArg) return preset.build(rest);

  const base = preset.build();
  return rest ? `${base}\n\n${rest}` : base;
}
