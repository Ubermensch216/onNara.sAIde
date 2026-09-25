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
      const btn = document.createElement('button');
      btn.textContent = '본문저장';
      document.body.appendChild(btn);

      const ta = document.createElement('textarea');
      ta.className = 'editor';
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
      btn.remove();
    });

    it('선택된 텍스트가 2자 미만이면 null을 반환한다', () => {
      const btn = document.createElement('button');
      btn.textContent = '본문저장';
      document.body.appendChild(btn);

      const ta = document.createElement('textarea');
      ta.className = 'editor';
      ta.value = '가나다';
      document.body.appendChild(ta);

      ta.focus();
      ta.selectionStart = 0;
      ta.selectionEnd = 1;

      const sel = captureActiveSelection(document);
      expect(sel).toBeNull();
      ta.remove();
      btn.remove();
    });

    it('iframe 안 textarea의 선택도 해당 프레임의 DOM 생성자로 캡처한다', () => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      const frameDoc = iframe.contentDocument!;

      const btn = frameDoc.createElement('button');
      btn.textContent = '본문저장';
      frameDoc.body.appendChild(btn);

      const ta = frameDoc.createElement('textarea');
      ta.className = 'editor';
      ta.value = '본문 편집기 선택 테스트';
      frameDoc.body.appendChild(ta);

      ta.focus();
      ta.selectionStart = 0;
      ta.selectionEnd = ta.value.length;

      const selection = captureActiveSelection(frameDoc);
      expect(selection?.text).toBe('본문 편집기 선택 테스트');
      expect(selection?.ownerDoc).toBe(frameDoc);

      iframe.remove();
    });

    it('문서카드 화면(첫 번째 첨부 이미지)의 제목/키워드/요약 등 메타데이터 필드 선택 시 null을 반환한다 (블럭 메뉴 노출 차단)', () => {
      // 1. [본문작성] 버튼이 있는 문서카드 화면 모의
      const btn = document.createElement('button');
      btn.textContent = '본문작성';
      btn.getBoundingClientRect = () => ({ width: 80, height: 30, top: 0, left: 0, right: 80, bottom: 30, x: 0, y: 0, toJSON: () => ({}) });
      document.body.appendChild(btn);

      const titleInput = document.createElement('input');
      titleInput.name = 'docTitle';
      titleInput.value = '2026 부산 웰니스관광지 신규 발굴 선정 등 공고';
      document.body.appendChild(titleInput);

      titleInput.focus();
      titleInput.selectionStart = 5;
      titleInput.selectionEnd = 16; // '웰니스관광지 신규 발굴'

      const sel = captureActiveSelection(document, titleInput);
      expect(sel).toBeNull(); // 메타데이터 필드이므로 블럭 메뉴가 뜨지 않아야 함!

      btn.remove();
      titleInput.remove();
    });

    it('문서관리카드 화면에서 보고경로 테이블(기안 주무관 김명진)의 이름을 선택해도 블럭 메뉴가 노출되지 않는다', () => {
      const headerDiv = document.createElement('div');
      headerDiv.textContent = '문서관리카드';
      document.body.appendChild(headerDiv);

      const writeBtn = document.createElement('button');
      writeBtn.textContent = '본문작성';
      document.body.appendChild(writeBtn);

      const table = document.createElement('table');
      table.innerHTML = `
        <tr><th>구분</th><th>직위</th><th>이름</th><th>본문</th></tr>
        <tr><td>기안</td><td>주무관</td><td id="drafterName">김명진</td><td></td></tr>
      `;
      document.body.appendChild(table);

      const drafterTd = table.querySelector('#drafterName')!;
      const textNode = drafterTd.firstChild!;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 3); // '김명진'
      const selObj = window.getSelection();
      selObj?.removeAllRanges();
      selObj?.addRange(range);

      range.getBoundingClientRect = () => ({ width: 40, height: 20, top: 200, left: 100, right: 140, bottom: 220, x: 100, y: 200, toJSON: () => ({}) });

      const sel = captureActiveSelection(document);
      expect(sel).toBeNull(); // 문서관리카드 화면이므로 반드시 null!

      headerDiv.remove();
      writeBtn.remove();
      table.remove();
      selObj?.removeAllRanges();
    });

    it('본문작성 화면(두 번째/세 번째 첨부 이미지)의 본문 문단/테이블 텍스트 선택 시 정상적으로 캡처된다 (블럭 메뉴 호출 허용)', () => {
      const btn1 = document.createElement('button');
      btn1.textContent = '문서카드';
      const btn2 = document.createElement('button');
      btn2.textContent = '본문저장';
      document.body.appendChild(btn1);
      document.body.appendChild(btn2);

      const p = document.createElement('p');
      p.textContent = '1. 추진 배경 및 필요성 - 가. 2026년 부산 웰니스관광지 및 테마 육성';
      document.body.appendChild(p);

      const textNode = p.firstChild!;
      const range = document.createRange();
      range.setStart(textNode, 3);
      range.setEnd(textNode, 14); // '추진 배경 및 필요성'
      const selObj = window.getSelection();
      selObj?.removeAllRanges();
      selObj?.addRange(range);

      range.getBoundingClientRect = () => ({ width: 120, height: 20, top: 150, left: 100, right: 220, bottom: 170, x: 100, y: 150, toJSON: () => ({}) });

      const sel = captureActiveSelection(document);
      expect(sel).not.toBeNull();
      expect(sel?.text).toBe('추진 배경 및 필요성');
      expect(sel?.targetElement).toBe(p);

      btn1.remove();
      btn2.remove();
      p.remove();
      selObj?.removeAllRanges();
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
