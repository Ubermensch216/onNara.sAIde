// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createSelectionBubble } from './selection-bubble';

describe('selection-bubble', () => {
  it('버블 엘리먼트가 초기 상태에서는 숨겨져 있다', () => {
    const bubble = createSelectionBubble();
    expect(bubble.element.style.display).toBe('none');
    expect(bubble.element.querySelector('#btnSpellcheck')).not.toBeNull();
    expect(bubble.element.querySelector('#btnPolishMenu')).not.toBeNull();
    expect(bubble.element.querySelector('#btnPrivacyMask')).not.toBeNull();
  });

  it('다듬기 메뉴 버튼 클릭 시 드롭다운이 열린다', () => {
    const bubble = createSelectionBubble();
    document.body.appendChild(bubble.element);

    const btnPolish = bubble.element.querySelector<HTMLButtonElement>('#btnPolishMenu')!;
    const dropdown = bubble.element.querySelector<HTMLElement>('#dropdownPolish')!;

    expect(dropdown.style.display).toBe('none');
    btnPolish.click();
    expect(dropdown.style.display).toBe('flex');
    expect(dropdown.querySelectorAll('.saide-dropdown-item').length).toBe(6);

    bubble.destroy();
  });

  it('개인정보 마스킹 클릭 시 감지된 정보가 프리뷰에 표시된다', () => {
    const showToast = vi.fn();
    const bubble = createSelectionBubble({ showToast });
    document.body.appendChild(bubble.element);

    // 가상의 선택 영역 바인딩 테스트를 위해 textarea 생성
    const ta = document.createElement('textarea');
    ta.value = '담당자 홍길동 010-1234-5678 문의';
    document.body.appendChild(ta);

    ta.focus();
    ta.selectionStart = 0;
    ta.selectionEnd = ta.value.length;

    const unbind = bubble.bindEvents(document);

    // selectionchange 트리거
    document.dispatchEvent(new Event('selectionchange'));

    // 강제 클릭
    const btnPrivacy = bubble.element.querySelector<HTMLButtonElement>('#btnPrivacyMask')!;
    btnPrivacy.click();

    const preview = bubble.element.querySelector<HTMLElement>('#bubblePreview')!;
    const badge = bubble.element.querySelector<HTMLElement>('#previewBadge')!;

    // 프리뷰 카드 열림 확인
    expect(badge.textContent).toBeDefined();

    unbind();
    bubble.destroy();
    ta.remove();
  });

  it('문서카드 화면의 제목 입력창에서 텍스트를 선택해도 블럭 메뉴가 노출되지 않는다', async () => {
    const bubble = createSelectionBubble();
    document.body.appendChild(bubble.element);

    // 문서카드 화면 환경: [본문작성] 버튼과 제목 입력창 존재
    const writeBtn = document.createElement('button');
    writeBtn.textContent = '본문작성';
    writeBtn.getBoundingClientRect = () => ({ width: 80, height: 30, top: 0, left: 0, right: 80, bottom: 30, x: 0, y: 0, toJSON: () => ({}) });
    document.body.appendChild(writeBtn);

    const titleInput = document.createElement('input');
    titleInput.name = 'docTitle';
    titleInput.value = '「2026 부산 웰니스관광지 신규 발굴 선정 등 공고」 안내 및 협조 요청';
    document.body.appendChild(titleInput);

    titleInput.focus();
    titleInput.selectionStart = 15;
    titleInput.selectionEnd = 24; // '신규 발굴 선정 등 공고'

    const unbind = bubble.bindEvents(document);
    document.dispatchEvent(new Event('selectionchange'));

    // 타이머 대기
    await new Promise(r => setTimeout(r, 200));

    // 블럭 메뉴가 열리지 않아야 함!
    expect(bubble.element.style.display).toBe('none');

    unbind();
    bubble.destroy();
    writeBtn.remove();
    titleInput.remove();
  });
});
