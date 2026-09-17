/**
 * 유튜브 자막 추출. 계획서 §5 Phase 3-8
 *
 * 유튜브는 Readability로 아무것도 못 건진다 — 본문이 DOM에 없고 플레이어만
 * 있기 때문이다. 그런데 영상은 사이드패널 어시스턴트의 주요 사용처라
 * 별도 핸들러가 필요하다.
 *
 * ★ content script 안에서 돈다. 페이지의 `ytInitialPlayerResponse`에
 *   자막 트랙 목록이 들어 있으므로 그걸 읽어 자막 파일을 받아온다.
 *   외부 API 키나 서버는 필요 없다 — 전부 페이지가 이미 가진 정보다.
 */

export function isYouTubeWatch(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') &&
      u.pathname === '/watch'
    );
  } catch {
    return false;
  }
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

/** 페이지 스크립트에서 자막 트랙 목록을 찾는다. */
function findCaptionTracks(): CaptionTrack[] {
  // ① 전역 객체가 살아 있는 경우
  const fromGlobal = (window as unknown as Record<string, unknown>)
    .ytInitialPlayerResponse as
    | { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } }
    | undefined;

  const direct = fromGlobal?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (direct?.length) return direct;

  // ② SPA 이동 후에는 전역이 갱신되지 않을 수 있어 인라인 스크립트를 뒤진다
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent;
    if (!text || !text.includes('captionTracks')) continue;
    const m = text.match(/"captionTracks":(\[.*?\])/);
    if (!m?.[1]) continue;
    try {
      return JSON.parse(m[1]) as CaptionTrack[];
    } catch {
      /* 다음 후보로 */
    }
  }
  return [];
}

/**
 * 선호 언어 순으로 트랙을 고른다.
 * 자동 생성(kind: 'asr') 자막은 품질이 낮으므로 수동 자막을 먼저 찾는다.
 */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const prefer = ['ko', 'en'];

  for (const lang of prefer) {
    const manual = tracks.find((t) => t.languageCode === lang && t.kind !== 'asr');
    if (manual) return manual;
  }
  for (const lang of prefer) {
    const auto = tracks.find((t) => t.languageCode === lang);
    if (auto) return auto;
  }
  return tracks[0] ?? null;
}

/** 자막 XML을 평문으로 바꾼다. */
function xmlToText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const lines: string[] = [];
  for (const node of doc.querySelectorAll('text')) {
    const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
  }
  // 자막은 짧은 조각이 이어지므로 문장처럼 이어붙인다.
  return lines.join(' ');
}

/**
 * 현재 유튜브 영상의 자막을 가져온다. 없으면 null.
 *
 * fetch 대상은 유튜브 자신의 자막 URL이라 페이지 origin과 같다 —
 * 확장의 host_permissions가 필요 없다.
 */
export async function extractYouTubeCaption(): Promise<string | null> {
  const track = pickTrack(findCaptionTracks());
  if (!track?.baseUrl) return null;

  try {
    const res = await fetch(track.baseUrl);
    if (!res.ok) return null;
    const text = xmlToText(await res.text());
    return text.length > 100 ? text : null;
  } catch {
    return null;
  }
}

/** 제목·채널 등 영상 메타데이터. 자막만으로는 맥락이 부족하다. */
export function youTubeMeta(): string {
  const title =
    document.querySelector('meta[name="title"]')?.getAttribute('content') ??
    document.title.replace(/ - YouTube$/, '');
  const channel =
    document.querySelector('ytd-channel-name a')?.textContent?.trim() ??
    document.querySelector('link[itemprop="name"]')?.getAttribute('content') ??
    '';

  return channel ? `영상: ${title}\n채널: ${channel}` : `영상: ${title}`;
}
