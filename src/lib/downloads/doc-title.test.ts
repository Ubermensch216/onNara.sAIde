/**
 * 원본 공문 제목 (lib/downloads/doc-title.ts).
 *
 * ★ 여기서 지키는 것.
 *   ① 온나라 목록이 제목 칸에 붙이는 `[auto]` 표시는 이름에 쓰지 않는다.
 *   ② 사용자가 제목에 적은 대괄호는 제목이므로 그대로 둔다.
 */

import { describe, expect, it } from 'vitest';
import { originalDocTitle } from './doc-title';
import { normalizedAttachmentPath } from './naming';

describe('원본 공문 제목', () => {
  it('★ 목록이 붙인 [auto] 표시를 뗀다', () => {
    expect(originalDocTitle('[auto]데이터 품질관리 협조 요청')).toBe('데이터 품질관리 협조 요청');
    expect(originalDocTitle('[Auto] 데이터 품질관리 협조 요청')).toBe('데이터 품질관리 협조 요청');
    expect(originalDocTitle('[auto][auto]제목')).toBe('제목');
    expect(originalDocTitle('제목 [auto]')).toBe('제목');
  });

  it('★ 제목에 직접 적은 대괄호와 다른 글자는 바꾸지 않는다', () => {
    expect(originalDocTitle('[AI 기반 스마트 행정] 추진계획')).toBe('[AI 기반 스마트 행정] 추진계획');
    expect(originalDocTitle('[긴급] 자료 제출')).toBe('[긴급] 자료 제출');
    expect(originalDocTitle('automatic 제목')).toBe('automatic 제목');
  });

  it('표시만 있는 제목은 비우지 않는다', () => {
    expect(originalDocTitle('[auto]')).toBe('[auto]');
  });

  it('★ 폴더 이름에 [auto]가 붙지 않는다', () => {
    const path = normalizedAttachmentPath('붙임1.hwpx', {
      docTitle: originalDocTitle('[auto]데이터 품질관리 협조 요청'), reportDate: '2026. 8. 7.', folder: true, rename: false, root: 'onNara.sAIde/수집/r',
    });
    expect(path).toBe('onNara.sAIde/수집/r/20260807_데이터 품질관리 협조 요청/붙임1.hwpx');
  });
});
