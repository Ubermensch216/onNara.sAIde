/**
 * 첨부 파일명 정규화 (B5).
 *
 * ★ 여기서 지키는 것 셋.
 *   ① **확장자는 절대 바뀌지 않는다.** `.hwpx`를 잃으면 파일을 열 수 없다.
 *   ② 경로 구분자와 상위 참조를 만들지 않는다. `..`가 섞이면 의도하지 않은 위치에 쓰인다.
 *   ③ 값이 없을 때는 개명하지 않는다. 얻는 것 없이 이름만 낯설어지는 것은 개선이 아니다.
 */

import { describe, expect, it } from 'vitest';
import { compactDate, normalizedAttachmentPath, sanitizeSegment, splitExtension } from './naming';

describe('조각 정리', () => {
  it('파일명에 쓸 수 없는 글자를 지운다', () => {
    expect(sanitizeSegment('예산/편성:지침*안')).toBe('예산 편성 지침 안');
  });

  // ★ 이것이 깨지면 다운로드가 엉뚱한 폴더로 간다.
  it('★ 상위 경로 참조를 만들지 않는다', () => {
    const path = normalizedAttachmentPath('붙임.hwp', { docTitle: '../../etc/passwd' });
    expect(path).not.toContain('..');
    expect(path.split('/').length).toBe(1);
  });

  it('점과 공백으로 끝나지 않는다', () => {
    expect(sanitizeSegment('보고서... ')).toBe('보고서');
  });
});

describe('확장자', () => {
  it('마지막 점만 확장자로 본다', () => {
    expect(splitExtension('처리결과(수영구, 20260916)hwpx(link).html')).toEqual({
      base: '처리결과(수영구, 20260916)hwpx(link)', ext: '.html',
    });
  });

  it('확장자가 없으면 빈 문자열이다', () => {
    expect(splitExtension('첨부파일')).toEqual({ base: '첨부파일', ext: '' });
  });

  // ★ 이름이 아무리 길어도 확장자는 깎이지 않는다.
  it('★ 이름이 길어도 확장자를 유지한다', () => {
    const path = normalizedAttachmentPath(`${'가'.repeat(300)}.hwpx`, { docTitle: '예산 편성 지침 통보' });
    expect(path.endsWith('.hwpx')).toBe(true);
    expect(path.length).toBeLessThanOrEqual(160);
  });
});

describe('날짜 접기', () => {
  it.each([
    ['2026. 9. 30.', '20260930'],
    ['2026-09-30', '20260930'],
    ['2026년 9월 30일', '20260930'],
    ['20260930', '20260930'],
  ])('%s → %s', (input, expected) => {
    expect(compactDate(input)).toBe(expected);
  });

  it('읽을 수 없으면 날짜 조각을 만들지 않는다', () => {
    expect(compactDate(undefined)).toBe('');
  });
});

describe('경로 만들기', () => {
  it('보고일자와 공문 제목을 앞에 붙인다', () => {
    expect(normalizedAttachmentPath('붙임1.hwp', { docTitle: '예산 편성 지침 통보', reportDate: '2026. 9. 30.' }))
      .toBe('20260930_예산 편성 지침 통보_붙임1.hwp');
  });

  // ★ `붙임1.hwp` 다섯 개가 한 폴더에 떨어지는 것이 이 기능을 만든 이유다.
  it('★ 공문이 다르면 파일명이 달라진다', () => {
    const plan = (docTitle: string) => normalizedAttachmentPath('붙임1.hwp', { docTitle, reportDate: '2026. 9. 30.' });
    expect(plan('예산 편성 지침')).not.toBe(plan('실적 제출 요청'));
  });

  it('이름에 이미 공문 제목이 있으면 두 번 쓰지 않는다', () => {
    expect(normalizedAttachmentPath('예산 편성 지침 통보_서식.hwp', { docTitle: '예산 편성 지침 통보' }))
      .toBe('예산 편성 지침 통보_서식.hwp');
  });

  it('하위 폴더를 켜면 공문 폴더 아래로 넣는다', () => {
    expect(normalizedAttachmentPath('붙임1.hwp', { docTitle: '예산 편성 지침', reportDate: '2026-09-30', folder: true }))
      .toBe('20260930_예산 편성 지침/20260930_예산 편성 지침_붙임1.hwp');
  });

  // ★ 붙일 것이 없으면 원래 이름 그대로 둔다.
  it('공문 제목이 없으면 개명하지 않는다', () => {
    expect(normalizedAttachmentPath('붙임1.hwp', { docTitle: '   ' })).toBe('붙임1.hwp');
  });

  it('이름이 비어도 파일을 만들 수 있는 이름을 준다', () => {
    expect(normalizedAttachmentPath('', { docTitle: '예산 편성 지침' })).toBe('예산 편성 지침_첨부파일');
  });
});
