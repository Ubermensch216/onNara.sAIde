/**
 * 마크다운 렌더링 + 코드 하이라이팅. 계획서 §4 기술 스택 / Phase 2-6
 *
 * ★ DOMPurify는 선택이 아니다. 모델이 페이지에서 읽은 `javascript:` 링크나
 *   `<img onerror>`를 그대로 재출력할 수 있다. 계획서 §7 추가 방어.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { PANEL_LINK_URI_PATTERN } from '@/lib/panel/links';
import type { HighlighterCore } from 'shiki/core';

/* ── 하이라이터 ────────────────────────────────────────── */

// 번들 크기를 위해 10종으로 제한한다(계획서 §2). 나머지는 평문으로 렌더된다.
const LANGS = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/shellscript.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
} as const;

const ALIASES: Record<string, keyof typeof LANGS> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  powershell: 'bash',
  ps1: 'bash',
  yaml: 'json',
  yml: 'json',
};

let highlighter: HighlighterCore | null = null;
let loading: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

/**
 * 하이라이터는 첫 코드블록이 나올 때 지연 로드한다.
 *
 * ★ shiki 코어 자체도 동적 import다. 코드블록이 없는 대화가 대부분인데
 *   패널을 열 때마다 코어를 받으면, 콜드 스타트 워밍업과 대역폭을 다투면서
 *   초기 청크만 200KB 넘게 불린다.
 */
async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;
  if (loading) return loading;

  loading = (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);

    const h = await createHighlighterCore({
      themes: [
        import('shiki/themes/github-light.mjs'),
        import('shiki/themes/github-dark.mjs'),
      ],
      langs: [],
      // WASM 대신 JS 정규식 엔진 — 확장 CSP와 번들 크기 모두에 유리하다.
      engine: createJavaScriptRegexEngine(),
    });
    highlighter = h;
    return h;
  })();

  return loading;
}

function normalizeLang(lang: string): keyof typeof LANGS | null {
  const key = lang.toLowerCase().trim();
  if (key in LANGS) return key as keyof typeof LANGS;
  return ALIASES[key] ?? null;
}

export async function highlightCode(
  code: string,
  lang: string,
  dark: boolean,
): Promise<string | null> {
  const normalized = normalizeLang(lang);
  if (!normalized) return null;

  try {
    const h = await getHighlighter();
    if (!loadedLangs.has(normalized)) {
      await h.loadLanguage(await LANGS[normalized]());
      loadedLangs.add(normalized);
    }
    return h.codeToHtml(code, {
      lang: normalized,
      theme: dark ? 'github-dark' : 'github-light',
    });
  } catch {
    // 하이라이팅 실패가 메시지 렌더링을 막아서는 안 된다.
    return null;
  }
}

/* ── 마크다운 ──────────────────────────────────────────── */

marked.setOptions({ gfm: true, breaks: true });

/** 답변의 다운로드 파일 열기 링크(lib/downloads/links.ts). */
const DOWNLOAD_LINK_URI_PATTERN = /#saide-download=(?:open|show):\d+$/.source;

/**
 * 링크에 허용하는 주소.
 *
 * ★ 조각은 정규식 리터럴의 `.source`로 가져온다. 문자열로 적으면 `\d`가 그냥 `d`가 되어
 *   허용 목록이 조용히 헐거워진다 — 컴파일도 테스트도 통과하므로 눈치채기 어렵다.
 */
const ALLOWED_LINK_URI = new RegExp(
  `^(?:https?:|mailto:|${DOWNLOAD_LINK_URI_PATTERN}|${PANEL_LINK_URI_PATTERN})`,
  'i',
);

/**
 * 스트리밍 중에는 마크다운이 미완성 상태(닫히지 않은 ``` 등)로 들어온다.
 * marked는 이를 관대하게 처리하지만, 코드펜스가 열린 채 끝나면 나머지를
 * 통째로 코드로 삼킨다. 스트리밍 중에는 그게 오히려 자연스러우므로 둔다.
 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md, { async: false });

  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
      'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'span',
    ],
    ALLOWED_ATTR: ['href', 'title', 'class', 'style'],
    // javascript:, data: 등 실행 가능한 스킴을 링크에서 제거한다.
    // 조각 주소 두 가지만 통과시킨다 — 답변의 다운로드 파일 열기(lib/downloads/links.ts)와
    // 일정·도구 탭으로 건너뛰기(lib/panel/links.ts). 문법은 각 모듈이 정의하고 여기서는 붙이기만 한다.
    ALLOWED_URI_REGEXP: ALLOWED_LINK_URI,
  });
}

/** 마크다운에서 코드블록을 뽑아낸다. 복사 버튼과 하이라이팅에 쓴다. */
export interface CodeBlock {
  lang: string;
  code: string;
}

export function extractCodeBlocks(md: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```([\w+-]*)\n([\s\S]*?)(?:```|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    blocks.push({ lang: m[1] ?? '', code: (m[2] ?? '').replace(/\n$/, '') });
  }
  return blocks;
}
