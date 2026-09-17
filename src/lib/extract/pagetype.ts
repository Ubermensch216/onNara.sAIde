/**
 * 페이지 유형 추론. 계획서 §5 Phase 4-5
 *
 * URL만으로 판단한다. 본문을 읽어야 알 수 있는 분류는 그 자체로 프리필
 * 비용(2,000토큰 / 15초)을 물게 되므로, 제안을 띄우자고 그 값을 치를 수 없다.
 *
 * 제안은 어디까지나 지름길이다. 틀려도 사용자는 다른 버튼을 누르면 된다.
 */

export type PageKind = 'video' | 'code' | 'doc' | 'unknown';

const VIDEO = [
  /(^|\.)youtube\.com$/,
  /(^|\.)youtu\.be$/,
  /(^|\.)vimeo\.com$/,
  /(^|\.)netflix\.com$/,
  /(^|\.)twitch\.tv$/,
];

const CODE = [
  /(^|\.)github\.com$/,
  /(^|\.)gitlab\.com$/,
  /(^|\.)bitbucket\.org$/,
  /(^|\.)stackoverflow\.com$/,
  /(^|\.)npmjs\.com$/,
  /(^|\.)pypi\.org$/,
  /(^|\.)developer\.mozilla\.org$/,
];

export function detectPageKind(url: string): PageKind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'unknown';
  }
  const host = u.hostname.toLowerCase();

  if (VIDEO.some((re) => re.test(host))) return 'video';
  if (CODE.some((re) => re.test(host))) return 'code';

  // 확장자로 잡히는 코드/문서
  if (/\.(ts|tsx|js|jsx|py|rs|go|java|rb|c|cpp|cs|sh|sql)$/i.test(u.pathname)) return 'code';
  if (/\.(pdf|docx?|pptx?)$/i.test(u.pathname)) return 'doc';

  // 기사·블로그로 흔한 경로 패턴
  if (/\/(news|article|posts?|blog|story|entry)\//i.test(u.pathname)) return 'doc';

  return 'unknown';
}

/**
 * 유형별로 먼저 보여줄 프리셋 id 순서.
 *
 * 목록에서 빼지는 않는다 — 순서만 바꾼다. 추론이 틀렸을 때 사용자가
 * 원하는 버튼을 못 찾는 상황을 만들지 않기 위해서다.
 */
export function suggestedOrder(kind: PageKind): string[] {
  switch (kind) {
    case 'video':
      // 자막이 있으면 요약이 잘 먹는다. 없으면 화면 캡처가 대안이다.
      return ['summary', 'three-lines', 'screen', 'ask', 'translate-page'];
    case 'code':
      // 코드 페이지에서 번역은 거의 쓸 일이 없다. 맨 뒤로 민다.
      return ['summary', 'ask', 'three-lines', 'screen', 'translate-page'];
    case 'doc':
      // 읽는 글이다. 외국어 문서를 만나는 곳도 여기라 번역을 앞으로 올린다.
      return ['summary', 'three-lines', 'translate-page', 'ask', 'screen'];
    default:
      return ['summary', 'three-lines', 'translate-page', 'ask', 'screen'];
  }
}

/** 빈 화면에 띄울 한 줄 안내. */
export function kindHint(kind: PageKind): string | null {
  switch (kind) {
    case 'video':
      return '영상 페이지입니다. 자막이 있으면 요약할 수 있습니다.';
    case 'code':
      return '코드 페이지입니다. 무엇을 하는 코드인지 물어보세요.';
    default:
      return null;
  }
}
