/**
 * 작업 완료 알림 (B2).
 *
 * ★ 왜 필요한가.
 *   CPU 추론에서 문서 다섯 건 분석은 2~3분이다. 그 사이 사용자는 다른 일을 한다 —
 *   그것이 작업 큐를 둔 이유다. 그런데 끝난 줄 모르면 결국 화면 앞에서 기다리게 된다.
 *
 * ★ 짧은 작업에는 울리지 않는다.
 *   눈앞에서 10초 만에 끝난 일까지 알리면 알림이 소음이 되고, 사용자는 알림 자체를 끈다.
 *   자리를 뜰 만한 길이(기본 30초)를 넘겼을 때만 알린다.
 *
 * ★ 같은 id로 덮어쓴다. 기한 알림과 같은 태도다(lib/schedule/alerts.ts) —
 *   알림이 쌓여 작업 수만큼 목록에 남지 않게 한다.
 */

import { t } from '@/lib/i18n';
import { loadSettings } from '@/lib/storage/settings';
import type { AutomationJob } from './jobs';

/** 알림 id. 덮어쓰기용으로 하나만 쓴다. */
export const JOB_NOTIFICATION_ID = 'saide.jobDone';
/** 이보다 짧게 끝난 작업은 알리지 않는다. */
export const MIN_NOTIFY_MS = 30_000;

/** 알릴 문구. 알릴 이유가 없으면 null이다. */
export function jobAlertText(job: AutomationJob, elapsedMs: number): { title: string; message: string } | null {
  if (elapsedMs < MIN_NOTIFY_MS) return null;
  // 사용자가 직접 취소한 작업을 알리는 것은 방해일 뿐이다.
  if (job.status === 'cancelled') return null;

  const kind = t(`auto.kind.${job.kind}` as Parameters<typeof t>[0]);
  return {
    title: job.status === 'failed' ? t('job.alert.failed', { kind }) : t('job.alert.done', { kind }),
    message: [job.label, job.error?.message ?? job.summary ?? ''].filter(Boolean).join('\n'),
  };
}

/**
 * 작업이 끝났음을 알린다. 실제로 알렸으면 true.
 *
 * 패널 문서에서 부른다 — 서비스 워커를 거칠 이유가 없다. 알림 권한이 없거나 설정에서 껐으면
 * 조용히 아무 일도 하지 않는다(실패가 사용자 흐름을 막지 않는다).
 */
export async function notifyJobFinished(job: AutomationJob, elapsedMs: number): Promise<boolean> {
  const text = jobAlertText(job, elapsedMs);
  if (!text) return false;

  const settings = await loadSettings().catch(() => null);
  if (!settings?.jobAlerts) return false;
  if (typeof chrome === 'undefined' || !chrome.notifications?.create) return false;

  await chrome.notifications.create(JOB_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: chrome.runtime?.getURL?.('icon/128.png') ?? '',
    title: text.title,
    message: text.message,
  }).catch?.(() => undefined);
  return true;
}
