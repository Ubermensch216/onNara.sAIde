/**
 * 다운로드 이름 예약 (B5).
 *
 * ★ 여기서 지키는 것 둘.
 *   ① 예약은 **한 번만** 쓰인다. 남아 있으면 그다음에 사용자가 직접 내려받은 파일까지 개명된다.
 *   ② 시간이 지나면 스스로 만료된다. 첨부를 눌렀는데 다운로드가 시작되지 않은 경우를 위해서다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDownloadName, consumeDownloadName, reserveDownloadName } from './rename';

beforeEach(() => {
  vi.useRealTimers();
  clearDownloadName();
});

describe('예약 소비', () => {
  it('예약이 없으면 브라우저가 정한 이름을 그대로 둔다', () => {
    expect(consumeDownloadName('붙임1.hwp')).toBeNull();
  });

  it('예약이 있으면 정규화한 이름을 준다', () => {
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침', reportDate: '2026-09-30' });
    expect(consumeDownloadName('붙임1.hwp')).toBe('20260930_예산 편성 지침_붙임1.hwp');
  });

  // ★ 이게 깨지면 사용자가 직접 받은 파일까지 공문 이름으로 바뀐다.
  it('★ 한 번 쓰면 사라진다', () => {
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침' });
    consumeDownloadName('붙임1.hwp');
    expect(consumeDownloadName('내 파일.pdf')).toBeNull();
  });

  it('브라우저가 준 이름의 확장자를 따른다', () => {
    reserveDownloadName('붙임1', { docTitle: '예산 편성 지침' });
    expect(consumeDownloadName('실제이름.pdf')).toBe('예산 편성 지침_실제이름.pdf');
  });

  it('브라우저가 이름을 주지 않으면 화면에서 읽은 이름을 쓴다', () => {
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침' });
    expect(consumeDownloadName('')).toBe('예산 편성 지침_붙임1.hwp');
  });

  it('예약을 지우면 개명하지 않는다', () => {
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침' });
    clearDownloadName();
    expect(consumeDownloadName('붙임1.hwp')).toBeNull();
  });

  it('계획이 없으면 예약 자체가 서지 않는다', () => {
    reserveDownloadName('붙임1.hwp', null);
    expect(consumeDownloadName('붙임1.hwp')).toBeNull();
  });

  // ★ 첨부를 눌렀는데 다운로드가 시작되지 않은 채 사용자가 다른 파일을 받는 경우.
  it('★ 시간이 지난 예약은 쓰지 않는다', () => {
    vi.useFakeTimers();
    reserveDownloadName('붙임1.hwp', { docTitle: '예산 편성 지침' }, 1_000);
    vi.advanceTimersByTime(1_500);
    expect(consumeDownloadName('붙임1.hwp')).toBeNull();
  });
});
