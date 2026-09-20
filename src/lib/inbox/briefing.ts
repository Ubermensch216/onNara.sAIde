/**
 * 브리핑 조립(N1).
 *
 * ★ 판단은 전부 [planBriefing]이라는 **순수 함수** 안에 있다. 목록 행과 원장을 받아
 *   무엇이 새 문서이고 어느 갈래인지를 정할 뿐, 저장소도 브라우저도 건드리지 않는다.
 *   그래서 "같은 문서를 두 번 브리핑하지 않는다"를 단위 시험으로 못 박을 수 있다.
 *
 * ★ 본문을 읽지 않는다. 목록 표에 있는 값만 쓴다. 그것이 미열람을 유지하는 유일한 방법이다.
 */

import {
  documentReadState,
  sameDocumentTitle,
  type DocumentReadState,
  type StructuredDocumentList,
} from '@/lib/onnara/document-list';
import { classifyByRules, type ClassifyOptions } from './classify-rules';
import { inboxDocKey, inboxGroupKey, normalizeReportDate, trimEllipsis } from './identity';
import { matchScope, type InboxScope } from './scope';
import type { InboxCategory, InboxDoc, InboxRow, InboxTrigger } from './types';

/** 한 번에 다룰 행 수 상한. 추출기 자체의 상한(500행)보다 앞에서 끊는다. */
export const MAX_INBOX_ROWS = 200;

/* ── 목록 표 → 행 ──────────────────────────────────────── */

/**
 * 첨부가 있는가.
 *
 * ★ 칸이 비어 있으면 **없는 것으로 본다**. 아이콘으로만 표시하는 판본에서는 글자가 없어
 *   알 수 없는데, "모르니까 있다"고 하면 첨부 표시가 목록 전체에 붙어 뜻을 잃는다.
 */
function readAttachment(value: string | undefined): boolean {
  const text = (value ?? '').replace(/\s/g, '');
  return Boolean(text) && text !== '0' && text !== '-';
}

export function toInboxRows(list: StructuredDocumentList, limit = MAX_INBOX_ROWS): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const row of list.rows) {
    const title = trimEllipsis(row.title ?? '');
    if (!title) continue;
    rows.push({
      title,
      reportDate: normalizeReportDate(row.reportDate) || (row.reportDate ?? '').trim(),
      sender: (row.sender ?? '').trim(),
      department: (row.department ?? '').trim(),
      hasAttachment: readAttachment(row.attachment),
      readState: documentReadState(row),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/* ── 계획 ──────────────────────────────────────────────── */

export interface BriefingOptions {
  at: number;
  scope: InboxScope;
  classify?: ClassifyOptions;
}

export interface BriefingPlan {
  /** 저장할 문서(새로 만든 것 + 갱신한 것). */
  docs: InboxDoc[];
  /** 이번 브리핑에 실을 문서. */
  briefed: InboxDoc[];
  scanned: number;
  added: number;
  filtered: number;
  /** 지난 확인 이후 열람 상태가 바뀐 문서 수. `keep-unread`에서는 0이어야 한다. */
  readStateChanged: number;
  readState: Record<DocumentReadState, number>;
}

const ORDER: Record<InboxCategory, number> = { deadline: 0, mine: 1, notice: 2, filtered: 3 };

/** 더 온전한 제목을 고른다. 목록은 화면 폭에 따라 제목을 줄여 그린다. */
function betterTitle(left: string, right: string): string {
  return right.length > left.length ? right : left;
}

/**
 * 목록 행과 원장을 견주어 이번에 무엇을 브리핑할지 정한다.
 *
 * ★ 이미 브리핑한 문서(`briefedAt`)와 사용자가 넘긴 문서(`dismissedAt`)는 다시 올리지 않는다.
 * ★ 범위 밖 문서도 원장에 남긴다. 나중에 키워드를 넓혔을 때 되살릴 수 있어야 한다.
 */
export function planBriefing(rows: InboxRow[], existing: InboxDoc[], options: BriefingOptions): BriefingPlan {
  const byKey = new Map(existing.map(doc => [doc.key, doc]));
  const byGroup = new Map<string, InboxDoc[]>();
  for (const doc of existing) byGroup.set(doc.group, [...(byGroup.get(doc.group) ?? []), doc]);

  const docs: InboxDoc[] = [];
  const readState: Record<DocumentReadState, number> = { unread: 0, read: 0, unknown: 0 };
  let added = 0;
  let filtered = 0;
  let readStateChanged = 0;

  for (const row of rows) {
    readState[row.readState]++;
    const key = inboxDocKey(row);
    const group = inboxGroupKey(row);
    // 제목이 줄여 그려져 키가 어긋나도, 같은 묶음 안에서 제목을 견주면 같은 문서를 찾아낸다.
    const found = byKey.get(key) ?? byGroup.get(group)?.find(doc => sameDocumentTitle(doc.title, row.title));

    if (found) {
      if (found.readState !== 'unknown' && row.readState !== 'unknown' && found.readState !== row.readState) readStateChanged++;
      if (found.category === 'filtered') filtered++;
      docs.push({
        ...found,
        title: betterTitle(found.title, row.title),
        hasAttachment: found.hasAttachment || row.hasAttachment,
        readState: row.readState === 'unknown' ? found.readState : row.readState,
        lastSeenAt: options.at,
      });
      continue;
    }

    const verdict = matchScope(row, options.scope);
    // ★ 범위 키워드는 곧 관심 키워드다. 사용자가 그 낱말을 등록한 이유가 "내 일이라서"인데,
    //   범위 판정에만 쓰고 갈래 판정에서 빼면 걸러 낸 문서가 전부 '단순 공람'으로 떨어진다.
    const rule = classifyByRules(row, {
      ...options.classify,
      interests: [...(options.classify?.interests ?? []), ...options.scope.keywords],
    });
    if (!verdict.included) filtered++;
    added++;
    docs.push({
      ...row,
      key,
      group,
      category: verdict.included ? rule.category : 'filtered',
      // 범위에 든 이유(키워드)가 있으면 갈래의 이유와 함께 보인다 — 둘은 다른 질문이다.
      reason: verdict.included && verdict.hit ? `${rule.reason} · ${verdict.reason}` : verdict.included ? rule.reason : verdict.reason,
      ...(rule.due ? { due: rule.due } : {}),
      dueDate: rule.due?.date ?? '',
      classifier: 'rule',
      firstSeenAt: options.at,
      lastSeenAt: options.at,
    });
  }

  const briefed = docs
    .filter(doc => !doc.briefedAt && !doc.dismissedAt && doc.category !== 'filtered')
    .sort((left, right) =>
      ORDER[left.category] - ORDER[right.category] ||
      (left.dueDate || '9999').localeCompare(right.dueDate || '9999') ||
      right.reportDate.localeCompare(left.reportDate));

  return { docs, briefed, scanned: rows.length, added, filtered, readStateChanged, readState };
}

/* ── 화면에 보일 형태 ──────────────────────────────────── */

export interface BriefingGroup {
  category: InboxCategory;
  docs: InboxDoc[];
}

export interface Briefing {
  at: number;
  listName: string;
  trigger: InboxTrigger;
  scanned: number;
  added: number;
  filtered: number;
  /** 갈래별로 묶은, 이번에 새로 실은 문서. 빈 갈래는 넣지 않는다. */
  groups: BriefingGroup[];
  readState: Record<DocumentReadState, number> & { changed: number };
  /** 설정(`mark-read`)에 따라 열어 열람 처리한 문서 수. 브리핑이 스스로 바꾼 상태다. */
  markedRead?: number;
}

export function summarizeBriefing(plan: BriefingPlan, listName: string, trigger: InboxTrigger, at: number): Briefing {
  const groups: BriefingGroup[] = [];
  for (const category of ['deadline', 'mine', 'notice'] as const) {
    const docs = plan.briefed.filter(doc => doc.category === category);
    if (docs.length) groups.push({ category, docs });
  }
  return {
    at,
    listName,
    trigger,
    scanned: plan.scanned,
    added: plan.added,
    filtered: plan.filtered,
    groups,
    readState: { ...plan.readState, changed: plan.readStateChanged },
  };
}

export function briefingCount(briefing: Briefing): number {
  return briefing.groups.reduce((total, group) => total + group.docs.length, 0);
}
