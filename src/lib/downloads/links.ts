/**
 * 답변 안의 다운로드 파일 링크.
 *
 * ★ file:/// 링크는 확장 페이지에서 열리지 않고, 브라우저가 로컬 경로를 새 탭으로 여는 것도 막는다.
 *   대신 다운로드 ID를 조각 주소(#)에 담아 두고, 클릭하면 패널이 chrome.downloads로 직접 연다.
 *   조각 주소라 DOMPurify를 통과해도 실행 가능한 스킴이 생기지 않는다.
 */

export const DOWNLOAD_LINK_PREFIX = '#saide-download=';

export type DownloadLinkAction = 'open' | 'show';

export function downloadLink(action: DownloadLinkAction, downloadId: number): string {
  return `${DOWNLOAD_LINK_PREFIX}${action}:${downloadId}`;
}

export function parseDownloadLink(href: string | null | undefined): { action: DownloadLinkAction; downloadId: number } | null {
  const match = href?.match(/^#saide-download=(open|show):(\d{1,12})$/);
  return match ? { action: match[1] as DownloadLinkAction, downloadId: Number(match[2]) } : null;
}

/** 경로를 마크다운 링크 글자로 넣을 때 역슬래시·밑줄 등이 서식으로 먹히지 않게 한다. */
export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_{}[\]()<>#+!|~]/g, char => `\\${char}`);
}

/**
 * 파일을 기본 프로그램으로 열거나 탐색기에서 위치를 보여 준다.
 *
 * ★ chrome.downloads.open은 사용자 제스처 안에서만 동작한다. 클릭 핸들러에서 await 없이 가장 먼저 부른다.
 *   실패 원인은 호출 뒤에 다운로드 기록을 조회해 설명한다.
 */
export async function runDownloadLink(action: DownloadLinkAction, downloadId: number): Promise<void> {
  try {
    if (action === 'open') await chrome.downloads.open(downloadId);
    else chrome.downloads.show(downloadId);
  } catch (error) {
    const [item] = await chrome.downloads.search({ id: downloadId }).catch(() => []);
    if (!item) throw new Error('브라우저 다운로드 기록에서 이 파일을 찾지 못했습니다. 다운로드 기록을 지웠다면 파일 탐색기에서 직접 찾아 여세요.');
    if (item.exists === false) throw new Error(`파일이 옮겨졌거나 삭제되었습니다: ${item.filename}`);
    if (item.state !== 'complete') throw new Error('아직 다운로드가 끝나지 않았습니다. 완료된 뒤 다시 누르세요.');
    throw new Error(`파일을 열지 못했습니다: ${item.filename} (${String(error)})`);
  }
}
