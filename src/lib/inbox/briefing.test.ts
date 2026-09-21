// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { extractStructuredDocumentList } from '@/lib/onnara/document-list';
import { planBriefing, summarizeBriefing, toInboxRows, type BriefingOptions } from './briefing';
import { inboxDocKey } from './identity';
import type { InboxDoc, InboxRow } from './types';

const NOW = new Date('2026-09-20T09:00:00');
const AT = NOW.getTime();

function row(overrides: Partial<InboxRow> = {}): InboxRow {
  return {
    title: '2026년 상반기 청렴도 측정 결과 안내',
    reportDate: '2026-09-18',
    sender: '부산광역시',
    department: '감사담당관',
    hasAttachment: false,
    readState: 'unread',
    ...overrides,
  };
}

function options(overrides: Partial<BriefingOptions> = {}): BriefingOptions {
  return {
    at: AT,
    scope: { scope: 'all', keywords: [], exclude: [], fields: ['title', 'sender', 'department'] },
    classify: { now: NOW },
    ...overrides,
  };
}

it('목록 표에서 브리핑이 쓸 값만 추리고, 제목의 줄임표를 떼어낸다', () => {
  document.body.innerHTML = `
    <h2>받은문서</h2>
    <table>
      <tr><th>선택</th><th>보고일자</th><th>제목</th><th>부서</th><th>수(발)신자</th><th>붙임</th><th>열람</th></tr>
      <tr><td><input type="checkbox"></td><td>2026.09.18</td><td><a>재정집행 실적 제출 요청…</a></td><td>예산담당관</td><td>부산광역시</td><td>2</td><td>미열람</td></tr>
      <tr><td><input type="checkbox"></td><td>2026.09.17</td><td><a>청렴 교육 안내</a></td><td>감사담당관</td><td>해운대구</td><td>-</td><td>열람</td></tr>
    </table>`;
  expect(toInboxRows(extractStructuredDocumentList()!)).toEqual([
    { title: '재정집행 실적 제출 요청', reportDate: '2026-09-18', sender: '부산광역시', department: '예산담당관', hasAttachment: true, readState: 'unread' },
    { title: '청렴 교육 안내', reportDate: '2026-09-17', sender: '해운대구', department: '감사담당관', hasAttachment: false, readState: 'read' },
  ]);
});

it('제목에서 코드가 기한을 뽑아 기한 임박으로 가른다', () => {
  const plan = planBriefing([row({ title: '재정집행 실적 제출(9. 22.까지)' })], [], options());
  expect(plan.briefed[0]).toMatchObject({ category: 'deadline', dueDate: '2026-09-22' });
  expect(plan.briefed[0]!.reason).toContain('기한 D-2');
});

it('한참 지난 날짜는 기한이 아니라 제목의 표기로 본다', () => {
  const plan = planBriefing([row({ title: '2026. 3. 31. 기준 재산현황 통보' })], [], options());
  expect(plan.briefed[0]!.category).not.toBe('deadline');
});

it('조치를 요구하는 말이 있으면 내 업무로, 없으면 단순 공람으로 본다', () => {
  const plan = planBriefing([
    row({ title: '업무추진비 집행내역 회신 협조' }),
    row({ title: '직원 동호회 활동 사진 공모' }),
  ], [], options());
  expect(plan.briefed.map(doc => doc.category)).toEqual(['mine', 'notice']);
  expect(plan.briefed[0]!.reason).toContain('회신');
});

it('키워드 범위는 걸리지 않은 문서를 버리지 않고 범위 밖으로 남긴다', () => {
  const plan = planBriefing([
    row({ title: '예산 편성 지침 통보' }),
    row({ title: '체육대회 개최 알림' }),
  ], [], options({ scope: { scope: 'keywords', keywords: ['예산편성'], exclude: [], fields: ['title'] } }));

  expect(plan.filtered).toBe(1);
  expect(plan.briefed).toHaveLength(1);
  // 걸러진 문서도 원장에는 남는다 — 나중에 키워드를 넓히면 되살아난다.
  expect(plan.docs.map(doc => doc.category)).toEqual(['mine', 'filtered']);
  expect(plan.docs[0]!.reason).toContain('키워드 "예산편성"');
});

it('제외 키워드는 전체 범위에서도 먼저 적용된다', () => {
  const plan = planBriefing([row({ title: '직장 체육대회 참석 요청' })], [],
    options({ scope: { scope: 'all', keywords: [], exclude: ['체육대회'], fields: ['title'] } }));
  expect(plan.briefed).toHaveLength(0);
  expect(plan.docs[0]).toMatchObject({ category: 'filtered' });
});

it('이미 브리핑한 문서는 다시 올리지 않고, 사용자가 넘긴 문서도 올리지 않는다', () => {
  const first = planBriefing([row({ title: '가' }), row({ title: '나' })], [], options());
  expect(first.briefed).toHaveLength(2);

  const stored = first.docs.map(doc => doc.key === inboxDocKey(row({ title: '가' }))
    ? { ...doc, briefedAt: AT }
    : { ...doc, dismissedAt: AT });
  const second = planBriefing([row({ title: '가' }), row({ title: '나' })], stored, options({ at: AT + 1000 }));
  expect(second.briefed).toHaveLength(0);
  expect(second.added).toBe(0);
  expect(second.docs.every(doc => doc.lastSeenAt === AT + 1000)).toBe(true);
});

it('목록이 제목을 줄여 그려도 같은 문서로 보고 두 번 브리핑하지 않는다', () => {
  const full = row({ title: '감사결과 처분요구 이행실태 특정감사 자료 제출' });
  const stored: InboxDoc[] = planBriefing([full], [], options()).docs.map(doc => ({ ...doc, briefedAt: AT }));

  // 복제한 작업 탭은 폭이 달라 제목을 줄여 그린다(document-list.ts의 주석 참조).
  const shortened = row({ title: '감사결과 처분요구 이행실태 특정감사 자료…' });
  const plan = planBriefing([shortened], stored, options({ at: AT + 1000 }));
  expect(plan.added).toBe(0);
  expect(plan.briefed).toHaveLength(0);
  // 더 온전한 제목을 지킨다.
  expect(plan.docs[0]!.title).toBe(full.title);
});

it('열람 상태 변화를 코드가 센다 — 미열람 유지의 근거다', () => {
  const stored = planBriefing([row({ readState: 'unread' })], [], options()).docs;
  const same = planBriefing([row({ readState: 'unread' })], stored, options({ at: AT + 1 }));
  expect(same.readStateChanged).toBe(0);
  expect(same.readState).toMatchObject({ unread: 1, read: 0 });

  const opened = planBriefing([row({ readState: 'read' })], stored, options({ at: AT + 2 }));
  expect(opened.readStateChanged).toBe(1);
});

it('열람 여부를 알 수 없는 판본에서는 변화를 세지 않는다', () => {
  const stored = planBriefing([row({ readState: 'unknown' })], [], options()).docs;
  const next = planBriefing([row({ readState: 'unknown' })], stored, options({ at: AT + 1 }));
  expect(next.readStateChanged).toBe(0);
  expect(next.readState.unknown).toBe(1);
});

it('급한 것부터 실어 보내고, 빈 갈래는 만들지 않는다', () => {
  const plan = planBriefing([
    row({ title: '동호회 안내' }),
    row({ title: '정산자료 제출(9. 25.까지)' }),
    row({ title: '수요조사 협조' }),
    row({ title: '정산자료 제출(9. 21.까지)' }),
  ], [], options());
  const briefing = summarizeBriefing(plan, '받은문서', 'manual', AT);
  expect(briefing.groups.map(group => group.category)).toEqual(['deadline', 'mine', 'notice']);
  // 같은 갈래 안에서는 기한이 이른 것이 먼저다.
  expect(briefing.groups[0]!.docs.map(doc => doc.dueDate)).toEqual(['2026-09-21', '2026-09-25']);
  expect(briefing.readState.changed).toBe(0);
});

it('전체 목록의 200건 이후도 분류하고 마지막 페이지의 키워드 일치 문서도 브리핑한다', () => {
  const list = { kind: 'onnara-document-list' as const, listName: '받은문서', columns: [],
    rows: Array.from({ length: 525 }, (_, i) => ({ title: i === 524 ? '예산 편성 지침' : `일반 문서 ${i}`, reportDate: '2026-09-21' })) };
  const rows = toInboxRows(list);
  expect(rows).toHaveLength(525);
  expect(planBriefing(rows, [], options()).briefed).toHaveLength(525);
  const scoped = planBriefing(rows, [], options({ scope: { scope: 'keywords', keywords: ['예산'], exclude: [], fields: ['title'] } }));
  expect(scoped.scanned).toBe(525);
  expect(scoped.filtered).toBe(524);
  expect(scoped.briefed.map(doc => doc.title)).toEqual(['예산 편성 지침']);
});
