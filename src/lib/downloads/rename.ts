/**
 * 내려받는 파일의 이름을 정하는 자리 (B5).
 *
 * ★ 왜 `chrome.downloads.download({ filename })`만으로는 안 되는가.
 *   온나라 첨부의 대부분은 href가 없고 화면의 스크립트를 눌러야 받아진다
 *   (lib/onnara/attachments.ts). 그 경로에서는 우리가 URL을 쥐고 있지 않아 이름을 지정할 수 없다.
 *   `onDeterminingFilename`은 **브라우저가 이름을 정하기 직전**에 끼어들 수 있어 두 경로를 한 곳에서 덮는다.
 *
 * ★ 남의 다운로드를 건드리지 않는다.
 *   예약은 첨부를 누르기 직전에 한 건만 걸고, 한 번 쓰면 즉시 비운다. 시간이 지나면(기본 30초)
 *   스스로 만료된다. 사용자가 같은 순간에 직접 내려받은 파일까지 개명하는 사고를 막기 위해서다.
 *   첨부 다운로드는 작업 탭 잠금 아래에서 한 번에 하나씩만 일어나므로 예약도 하나면 충분하다.
 *
 * ★ 확장자는 브라우저가 정한 값을 그대로 물려받는다.
 *   우리가 아는 것은 화면에 적힌 이름이고, 실제 파일의 확장자는 서버 응답이 정한다.
 */

import { normalizedAttachmentPath, type NamingPlan } from './naming';

interface Reservation {
  plan: NamingPlan;
  /** 화면에서 읽은 첨부 이름. 브라우저가 이름을 주지 않을 때의 대비책이다. */
  fallbackName: string;
  until: number;
}

/** 예약이 살아 있는 시간. 다운로드가 시작되지 않으면 스스로 만료된다. */
export const RESERVATION_TTL_MS = 30_000;

let reservation: Reservation | null = null;

/** 다음에 시작될 다운로드 한 건의 이름을 예약한다. plan이 없으면 예약을 지운다. */
export function reserveDownloadName(fallbackName: string, plan: NamingPlan | null, ttlMs = RESERVATION_TTL_MS): void {
  reservation = plan ? { plan, fallbackName, until: Date.now() + ttlMs } : null;
}

/** 예약을 비운다. 다운로드가 끝났거나 실패했을 때 부른다. */
export function clearDownloadName(): void {
  reservation = null;
}

/**
 * 예약을 소비해 새 이름을 만든다. 예약이 없거나 만료됐으면 null —
 * 그때는 브라우저가 정한 이름을 그대로 둔다.
 */
export function consumeDownloadName(suggested: string): string | null {
  const current = reservation;
  if (!current) return null;
  reservation = null;
  if (Date.now() > current.until) return null;
  return normalizedAttachmentPath(suggested || current.fallbackName, current.plan);
}

/**
 * 서비스 워커에 처리기를 건다. **최상위에서** 부른다 — 워커는 이벤트마다 깨었다 죽는다.
 *
 * `onDeterminingFilename`은 동기로 `suggest`를 불러야 한다. 어떤 이유로든 실패하면
 * 인자 없이 불러 브라우저의 기본 동작으로 넘긴다(다운로드를 막지 않는다).
 */
export function registerDownloadNaming(): void {
  if (typeof chrome === 'undefined' || !chrome.downloads?.onDeterminingFilename?.addListener) return;
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    try {
      const filename = consumeDownloadName(item.filename ?? '');
      if (filename) suggest({ filename, conflictAction: 'uniquify' });
      else suggest();
    } catch {
      suggest();
    }
  });
}
