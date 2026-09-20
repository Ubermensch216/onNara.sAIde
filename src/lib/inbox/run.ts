/**
 * 브리핑 한 번의 실행(N1).
 *
 * ★ 판단은 [briefing.ts]의 순수 함수가 하고, 여기서는 저장소를 오간다.
 *   이 파일에 규칙을 적기 시작하면 브리핑의 정확도를 시험으로 지킬 수 없게 된다.
 *
 * ★ 실패도 기록한다. 온나라 세션이 끊겨 건너뛴 날 사용자가 빈 화면을 보고
 *   "오늘은 문서가 없구나"로 오해하면, 이 기능은 있는 것보다 나쁘다.
 */

import type { StructuredDocumentList } from '@/lib/onnara/document-list';
import type { Settings } from '@/lib/storage/settings';
import { planBriefing, summarizeBriefing, toInboxRows, type Briefing } from './briefing';
import type { InboxScope } from './scope';
import { loadInboxGroups, markBriefed, pruneInboxDocs, recordInboxRun, saveInboxDocs } from './store';
import type { InboxTrigger } from './types';

export function scopeFromSettings(settings: Settings): InboxScope {
  return {
    scope: settings.briefingScope,
    keywords: settings.briefingKeywords,
    exclude: settings.briefingExcludeKeywords,
    fields: settings.briefingFields,
  };
}

export interface RunBriefingInput {
  list: StructuredDocumentList;
  settings: Settings;
  trigger: InboxTrigger;
  now?: Date;
}

export async function runBriefing({ list, settings, trigger, now = new Date() }: RunBriefingInput): Promise<Briefing> {
  const at = now.getTime();
  const rows = toInboxRows(list);
  const plan = planBriefing(rows, await loadInboxGroups(rows), {
    at,
    scope: scopeFromSettings(settings),
    classify: { now, interests: settings.briefingKeywords },
  });

  await saveInboxDocs(plan.docs);
  // ★ 표시는 카드를 만든 뒤에 한다. 저장이 먼저 끝나야 "이미 브리핑했다"가 사실이 된다.
  await markBriefed(plan.briefed.map(doc => doc.key), at);
  await pruneInboxDocs(settings.briefingRetentionDays, now);

  const briefing = summarizeBriefing(plan, list.listName, trigger, at);
  await recordInboxRun({
    at,
    trigger,
    scanned: plan.scanned,
    added: plan.added,
    briefed: plan.briefed.length,
    filtered: plan.filtered,
    readStateChanged: plan.readStateChanged,
  });
  return briefing;
}

/** 실행하지 못한 사실을 남긴다. 수치는 0이고 사유만 있다. */
export async function recordSkippedRun(trigger: InboxTrigger, error: string, now: Date = new Date()): Promise<void> {
  await recordInboxRun({
    at: now.getTime(), trigger, scanned: 0, added: 0, briefed: 0, filtered: 0, readStateChanged: 0, error,
  });
}
