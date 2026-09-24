import { describe, expect, it, vi } from 'vitest';
import {
  DRAWER_GAP_PX,
  applyPageLayoutShift,
  computeDrawerLayoutStyles,
} from './drawer-layout';

describe('drawer-layout', () => {
  it('기본 안전 여유 공간(DRAWER_GAP_PX)은 사용자 요청에 맞춰 9px이어야 한다', () => {
    expect(DRAWER_GAP_PX).toBe(9);
  });

  it('열린 상태 스타일 계산 시 drawerWidth와 gap의 합산 오프셋을 사용한다', () => {
    const styles = computeDrawerLayoutStyles(true, 440, 9);
    expect(styles.totalOffset).toBe(449);
    expect(styles.docEl.marginRight).toBe('449px');
    expect(styles.docEl.width).toBe('calc(100% - 449px)');
    expect(styles.docEl.maxWidth).toBe('calc(100% - 449px)');
    expect(styles.docEl.boxSizing).toBe('border-box');
    expect(styles.body.marginRight).toBe('0px');
    expect(styles.body.maxWidth).toBe('100%');
  });

  it('100vw 대신 calc(100% - totalOffset)을 사용하여 스크롤바 넘침을 차단한다', () => {
    const styles = computeDrawerLayoutStyles(true, 500, 36);
    expect(styles.docEl.width).not.toContain('100vw');
    expect(styles.docEl.width).toContain('100%');
  });

  it('닫힌 상태에서는 모든 스타일이 빈 문자열로 초기화된다', () => {
    const styles = computeDrawerLayoutStyles(false, 440, 36);
    expect(styles.totalOffset).toBe(0);
    expect(styles.docEl.marginRight).toBe('');
    expect(styles.docEl.width).toBe('');
    expect(styles.docEl.maxWidth).toBe('');
    expect(styles.body.marginRight).toBe('');
    expect(styles.body.maxWidth).toBe('');
  });

  it('DOM 문서에 적용 시 CSS 변수 및 스타일이 올바르게 반영되고 닫을 때 원상 복구된다', () => {
    const fakeDoc = {
      documentElement: {
        style: {
          setProperty: vi.fn(),
          removeProperty: vi.fn(),
          marginRight: '',
          width: '',
          maxWidth: '',
          boxSizing: '',
          transition: '',
          overflowX: '',
        },
      },
      body: {
        style: {
          marginRight: '',
          width: '',
          maxWidth: '',
          boxSizing: '',
          overflowX: '',
        },
      },
    } as unknown as Document;

    // 열기 적용 (기본 9px 간격)
    const offset = applyPageLayoutShift(true, 440, DRAWER_GAP_PX, fakeDoc);
    expect(offset).toBe(449);
    expect(fakeDoc.documentElement.style.setProperty).toHaveBeenCalledWith('--saide-drawer-width', '440px');
    expect(fakeDoc.documentElement.style.setProperty).toHaveBeenCalledWith('--saide-drawer-gap', '9px');
    expect(fakeDoc.documentElement.style.setProperty).toHaveBeenCalledWith('--saide-drawer-offset', '449px');
    expect(fakeDoc.documentElement.style.marginRight).toBe('449px');
    expect(fakeDoc.documentElement.style.width).toBe('calc(100% - 449px)');

    // 닫기 복원
    applyPageLayoutShift(false, 440, 36, fakeDoc);
    expect(fakeDoc.documentElement.style.removeProperty).toHaveBeenCalledWith('--saide-drawer-width');
    expect(fakeDoc.documentElement.style.removeProperty).toHaveBeenCalledWith('--saide-drawer-gap');
    expect(fakeDoc.documentElement.style.removeProperty).toHaveBeenCalledWith('--saide-drawer-offset');
    expect(fakeDoc.documentElement.style.marginRight).toBe('');
    expect(fakeDoc.documentElement.style.width).toBe('');
  });
});
