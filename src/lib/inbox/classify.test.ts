import { expect, it } from 'vitest';
import { buildClassifyInput, readClassification } from './classify';
import type { InboxDoc } from './types';

function doc(title: string, category: InboxDoc['category'] = 'notice'): InboxDoc {
  return {
    key: title, group: 'g', title, reportDate: '2026-09-19', sender: '부산광역시', department: '감사담당관',
    hasAttachment: false, readState: 'unread', category, reason: '규칙', dueDate: '',
    classifier: 'rule', firstSeenAt: 1, lastSeenAt: 1,
  };
}

it('모델에는 제목·발신·부서만 보낸다 — 본문은 열지 않는다', () => {
  const input = buildClassifyInput([doc('수요조사 협조'), doc('체육대회 안내')]);
  expect(input).toBe('1. 수요조사 협조 | 부산광역시 | 감사담당관\n2. 체육대회 안내 | 부산광역시 | 감사담당관');
});

it('응답을 번호 → 갈래로 읽는다', () => {
  const raw = '{"items":[{"index":1,"category":"mine"},{"index":2,"category":"notice"}]}';
  expect([...readClassification(raw, 2)]).toEqual([[0, 'mine'], [1, 'notice']]);
});

it('범위 밖 번호와 모르는 갈래는 버린다', () => {
  // ★ 느슨하게 읽으면 모델이 헛짚은 항목까지 받아들여, 규칙이 옳게 매긴 갈래를 덮어쓴다.
  const raw = '{"items":[{"index":0,"category":"mine"},{"index":9,"category":"mine"},{"index":1,"category":"deadline"},{"index":2,"category":"mine"}]}';
  expect([...readClassification(raw, 2)]).toEqual([[1, 'mine']]);
});

it('형식이 어긋난 응답은 아무것도 바꾸지 않는다', () => {
  expect(readClassification('말이 안 되는 응답', 3).size).toBe(0);
  expect(readClassification('', 3).size).toBe(0);
  expect(readClassification('{"items":null}', 3).size).toBe(0);
});
