// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  captureActiveSelection,
  replaceSelectedText,
  calculateBubblePosition,
} from './selection-manager';

describe('selection-manager', () => {
  describe('captureActiveSelection', () => {
    it('textarea의 텍스트가 블록 지정되었을 때 정상 캡처한다', () => {
      const ta = document.createElement('textarea');
      ta.value = '2026년 공공 업무 혁신 추진 계획서';
      document.body.appendChild(ta);

      ta.focus();
      ta.selectionStart = 6;
      ta.selectionEnd = 15; // '공공 업무 혁신'

      const sel = captureActiveSelection(document);
      expect(sel).not.toBeNull();
      expect(sel?.text).toBe('공공 업무 혁신');
      expect(sel?.inputRange).toEqual({ start: 6, end: 15 });
      expect(sel?.isEditable).toBe(true);
      ta.remove();
    });

    it('선택된 텍스트가 2자 미만이면 null을 반환한다', () => {
      const ta = document.createElement('textarea');
      ta.value = '가나다';
      document.body.appendChild(ta);

      ta.focus();
      ta.selectionStart = 0;
      ta.selectionEnd = 1;

      const sel = captureActiveSelection(document);
      expect(sel).toBeNull();
      ta.remove();
    });
  });

  describe('replaceSelectedText', () => {
    it('textarea의 선택 영역을 새로운 텍스트로 치환한다', async () => {
      const doc = document.implementation.createHTMLDocument();
      const ta = doc.createElement('textarea');
      ta.value = '오늘은 화창한 날씨입니다.';
      doc.body.appendChild(ta);

      const selection = {
        text: '화창한',
        clientRect: { top: 0, left: 0, width: 100, height: 20 } as DOMRect,
        targetElement: ta,
        ownerDoc: doc,
        isEditable: true,
        inputRange: { start: 4, end: 7 },
      };

      const res = await replaceSelectedText(selection, '매우 맑은');
      expect(res.success).toBe(true);
      expect(ta.value).toBe('오늘은 매우 맑은 날씨입니다.');
    });
  });

  describe('calculateBubblePosition', () => {
    it('선택 영역 상단 중앙으로 위치를 계산한다', () => {
      // viewport mock
      window.innerWidth = 1200;
      window.innerHeight = 800;

      const rect = {
        top: 200,
        left: 400,
        width: 100,
        height: 20,
        bottom: 220,
        right: 500,
      } as DOMRect;

      const pos = calculateBubblePosition(rect, 300, 40, 8);
      // center: 400 + 50 = 450. left: 450 - 150 = 300
      expect(pos.left).toBe(300);
      // top: 200 - 40 - 8 = 152
      expect(pos.top).toBe(152);
      expect(pos.placement).toBe('top');
    });

    it('화면 맨 위쪽이면 하단으로 배치(flip)한다', () => {
      window.innerWidth = 1200;
      window.innerHeight = 800;

      const rect = {
        top: 20,
        left: 400,
        width: 100,
        height: 20,
        bottom: 40,
        right: 500,
      } as DOMRect;

      const pos = calculateBubblePosition(rect, 300, 40, 8);
      expect(pos.placement).toBe('bottom');
      expect(pos.top).toBe(48); // 40 + 8
    });
  });
});
