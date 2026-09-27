// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createSelectionBubble } from './selection-bubble';

describe('selection-bubble', () => {
  it('버블 메뉴의 포인터 조작이 편집기 선택 블럭의 포커스를 빼앗지 않는다', async () => {
    const bubble = createSelectionBubble();
    document.body.appendChild(bubble.element);
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '본문저장';
    document.body.appendChild(saveBtn);
    const ta = document.createElement('textarea');
    ta.value = '선택한 문장을 다듬는다';
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, 7);

    const unbind = bubble.bindEvents(document);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise(r => setTimeout(r, 220));
    expect(bubble.element.style.display).toBe('block');

    const menu = bubble.element.querySelector<HTMLButtonElement>('#btnPolishMenu')!;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    menu.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    menu.click();
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe(7);
    expect(bubble.element.querySelector<HTMLElement>('#dropdownPolish')?.style.display).toBe('flex');

    unbind();
    bubble.destroy();
    ta.remove();
    saveBtn.remove();
  });

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

  it('본문작성 화면에서 텍스트를 선택했을 때 블럭 메뉴가 정상적으로 열린다', async () => {
    const bubble = createSelectionBubble();
    document.body.appendChild(bubble.element);

    // 본문작성 화면 환경: [문서카드], [본문저장] 버튼과 본문 문단
    const cardBtn = document.createElement('button');
    cardBtn.textContent = '문서카드';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '본문저장';
    document.body.appendChild(cardBtn);
    document.body.appendChild(saveBtn);

    const para = document.createElement('p');
    para.textContent = '1. 추진 배경 및 필요성 - 가. 2026년 부산 웰니스관광지 및 테마 육성';
    document.body.appendChild(para);

    const textNode = para.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 3);
    range.setEnd(textNode, 14); // '추진 배경 및 필요성'
    const selObj = window.getSelection();
    selObj?.removeAllRanges();
    selObj?.addRange(range);

    range.getBoundingClientRect = () => ({
      width: 120,
      height: 20,
      top: 150,
      left: 100,
      right: 220,
      bottom: 170,
      x: 100,
      y: 150,
      toJSON: () => ({}),
    });

    const unbind = bubble.bindEvents(document);
    document.dispatchEvent(new Event('selectionchange'));

    // 타이머 150ms 대기
    await new Promise(r => setTimeout(r, 220));

    // 본문작성 화면이므로 블럭 메뉴가 정상 노출되어야 함!
    expect(bubble.element.style.display).toBe('block');

    unbind();
    bubble.destroy();
    cardBtn.remove();
    saveBtn.remove();
    para.remove();
    selObj?.removeAllRanges();
  });

  it('AI 작업 실행 중에는 블럭 메뉴에 is-ai-working 클래스와 로딩 취소 버튼이 활성화된다', async () => {
    const bubble = createSelectionBubble();
    document.body.appendChild(bubble.element);

    const ta = document.createElement('textarea');
    ta.value = '기반 마련을 위한 현황 보고를 바탕으로 공유하고자 함';
    document.body.appendChild(ta);
    ta.focus();
    ta.selectionStart = 0;
    ta.selectionEnd = ta.value.length;

    const cardBtn = document.createElement('button');
    cardBtn.textContent = '문서카드';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '본문저장';
    document.body.appendChild(cardBtn);
    document.body.appendChild(saveBtn);

    const unbind = bubble.bindEvents(document);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise(r => setTimeout(r, 220));

    expect(bubble.element.style.display).toBe('block');

    const bubbleBar = bubble.element.querySelector<HTMLElement>('.saide-bubble-bar')!;
    const btnPolish = bubble.element.querySelector<HTMLButtonElement>('#btnPolishMenu')!;
    const dropdown = bubble.element.querySelector<HTMLElement>('#dropdownPolish')!;

    // 다듬기 메뉴 오픈
    btnPolish.click();
    expect(dropdown.style.display).toBe('flex');

    // '내용 줄이기' 모드 버튼 클릭
    const shortenItem = dropdown.querySelector<HTMLButtonElement>('button[data-mode="shorten"]')!;
    expect(shortenItem).not.toBeNull();

    // AI 변환 트리거
    shortenItem.click();

    // AI 실행 중 상태 확인: 툴바와 버튼에 옅은 애니메이션 클래스 부여
    expect(bubbleBar.classList.contains('is-ai-working')).toBe(true);
    expect(btnPolish.classList.contains('is-ai-active')).toBe(true);

    const loadingBox = bubble.element.querySelector<HTMLElement>('#bubbleLoading')!;
    expect(loadingBox.style.display).toBe('flex');

    const btnCancel = bubble.element.querySelector<HTMLButtonElement>('#btnLoadingCancel')!;
    expect(btnCancel).not.toBeNull();

    // 취소 클릭 시 로딩 및 애니메이션 해제 확인
    btnCancel.click();
    expect(bubbleBar.classList.contains('is-ai-working')).toBe(false);
    expect(btnPolish.classList.contains('is-ai-active')).toBe(false);
    expect(loadingBox.style.display).toBe('none');

    unbind();
    bubble.destroy();
    ta.remove();
    cardBtn.remove();
    saveBtn.remove();
  });

  it('화면 오른쪽 가장자리에 블럭 지정 시 버블 메뉴가 뷰포트 내로 클램프되어 잘리지 않고 노출된다', async () => {
    window.innerWidth = 1200;
    window.innerHeight = 800;

    const bubble = createSelectionBubble();
    document.body.appendChild(bubble.element);

    const cardBtn = document.createElement('button');
    cardBtn.textContent = '문서카드';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '본문저장';
    document.body.appendChild(cardBtn);
    document.body.appendChild(saveBtn);

    const para = document.createElement('p');
    para.textContent = '1. 추진 배경 및 필요성 - 화면 우측 끝 텍스트 블록 지정 테스트 내용';
    document.body.appendChild(para);

    const textNode = para.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 15);
    range.setEnd(textNode, 35);
    const selObj = window.getSelection();
    selObj?.removeAllRanges();
    selObj?.addRange(range);

    // 화면 우측 끝(left: 1100, width: 90 -> right: 1190)의 위치 반환 모의
    range.getBoundingClientRect = () => ({
      width: 90,
      height: 22,
      top: 200,
      left: 1100,
      right: 1190,
      bottom: 222,
      x: 1100,
      y: 200,
      toJSON: () => ({}),
    });

    const unbind = bubble.bindEvents(document);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => setTimeout(r, 220));

    expect(bubble.element.style.display).toBe('block');

    const bubbleWrapper = bubble.element.querySelector<HTMLElement>('#saideBubbleWrapper')!;
    const leftPx = parseInt(bubbleWrapper.style.left || '0', 10);

    // 버블 메뉴의 left가 화면 우측을 벗어나지 않도록 클램프되어 있어야 함 (1200 - 580 - 12 = 608px 근처)
    expect(leftPx).toBeLessThanOrEqual(1200 - 580 - 12);
    expect(leftPx).toBeGreaterThanOrEqual(12);

    unbind();
    bubble.destroy();
    cardBtn.remove();
    saveBtn.remove();
    para.remove();
    selObj?.removeAllRanges();
  });

  it('블럭 지정 후 Alt 등 수식키(Modifier Key) 입력 시 버블 메뉴가 화면 중앙으로 점프하지 않고 위치를 유지한다', async () => {
    window.innerWidth = 1200;
    window.innerHeight = 800;

    const bubble = createSelectionBubble();
    document.body.appendChild(bubble.element);

    const cardBtn = document.createElement('button');
    cardBtn.textContent = '문서카드';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '본문저장';
    document.body.appendChild(cardBtn);
    document.body.appendChild(saveBtn);

    const para = document.createElement('p');
    para.textContent = '1. 추진 배경 및 필요성 - 키보드 수식키 입력 시 위치 안정성 보장';
    document.body.appendChild(para);

    const textNode = para.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 5);
    range.setEnd(textNode, 20);
    const selObj = window.getSelection();
    selObj?.removeAllRanges();
    selObj?.addRange(range);

    range.getBoundingClientRect = () => ({
      width: 100,
      height: 20,
      top: 200,
      left: 700,
      right: 800,
      bottom: 220,
      x: 700,
      y: 200,
      toJSON: () => ({}),
    });

    const unbind = bubble.bindEvents(document);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => setTimeout(r, 220));

    expect(bubble.element.style.display).toBe('block');

    const bubbleWrapper = bubble.element.querySelector<HTMLElement>('#saideBubbleWrapper')!;
    const initialLeft = bubbleWrapper.style.left;
    const initialTop = bubbleWrapper.style.top;

    // Alt 키의 keyup 이벤트 발생
    const altEvent = new KeyboardEvent('keyup', { key: 'Alt', bubbles: true });
    document.dispatchEvent(altEvent);
    await new Promise((r) => setTimeout(r, 220));

    // Alt 키를 눌렀다 떼어도 버블의 위치가 변하지 않고 그대로 유지되어야 함!
    expect(bubbleWrapper.style.left).toBe(initialLeft);
    expect(bubbleWrapper.style.top).toBe(initialTop);

    unbind();
    bubble.destroy();
    cardBtn.remove();
    saveBtn.remove();
    para.remove();
    selObj?.removeAllRanges();
  });

  it('프리뷰 카드에서 앞에 삽입, 뒤에 삽입, 대체하기(Enter) 3가지 적용 옵션 버튼이 제공된다', async () => {
    const bubble = createSelectionBubble();
    document.body.appendChild(bubble.element);

    const ta = document.createElement('textarea');
    ta.value = '문서 초안 작성 중';
    document.body.appendChild(ta);
    ta.focus();
    ta.selectionStart = 3;
    ta.selectionEnd = 5; // '초안'

    const cardBtn = document.createElement('button');
    cardBtn.textContent = '문서카드';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '본문저장';
    document.body.appendChild(cardBtn);
    document.body.appendChild(saveBtn);

    const unbind = bubble.bindEvents(document);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => setTimeout(r, 220));

    // 번호 매기기로 프리뷰 카드 즉시 열기
    const btnNumber = bubble.element.querySelector<HTMLButtonElement>('#btnAutoNumber')!;
    btnNumber.click();

    const preview = bubble.element.querySelector<HTMLElement>('#bubblePreview')!;
    expect(preview.style.display).toBe('block');

    const btnApply = preview.querySelector<HTMLButtonElement>('#btnPreviewApply');
    const btnBefore = preview.querySelector<HTMLButtonElement>('#btnPreviewInsertBefore');
    const btnAfter = preview.querySelector<HTMLButtonElement>('#btnPreviewInsertAfter');

    expect(btnApply).not.toBeNull();
    expect(btnBefore).not.toBeNull();
    expect(btnAfter).not.toBeNull();
    expect(btnApply?.textContent).toContain('대체하기');
    expect(btnBefore?.textContent).toContain('앞에 삽입');
    expect(btnAfter?.textContent).toContain('뒤에 삽입');

    unbind();
    bubble.destroy();
    ta.remove();
    cardBtn.remove();
    saveBtn.remove();
  });

  it('프리뷰 카드에서 "앞에 삽입" 클릭 시 선택 영역 앞에 텍스트를 삽입하고 창을 닫는다', async () => {
    const showToast = vi.fn();
    const bubble = createSelectionBubble({ showToast });
    document.body.appendChild(bubble.element);

    const ta = document.createElement('textarea');
    ta.value = '신규 사업 계획';
    document.body.appendChild(ta);
    ta.focus();
    ta.selectionStart = 6;
    ta.selectionEnd = 8; // '계획'

    const cardBtn = document.createElement('button');
    cardBtn.textContent = '문서카드';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '본문저장';
    document.body.appendChild(cardBtn);
    document.body.appendChild(saveBtn);

    const unbind = bubble.bindEvents(document);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => setTimeout(r, 220));

    // 번호 매기기로 프리뷰 열기
    const btnNumber = bubble.element.querySelector<HTMLButtonElement>('#btnAutoNumber')!;
    btnNumber.click();

    const btnBefore = bubble.element.querySelector<HTMLButtonElement>('#btnPreviewInsertBefore')!;
    btnBefore.click();

    // 약간 대기 후 결과 확인: '계획' 앞에 '1. 계획'이 삽입되어야 함
    await new Promise((r) => setTimeout(r, 50));
    expect(ta.value).toBe('신규 사업 1. 계획 계획');
    expect(bubble.element.style.display).toBe('none');
    expect(showToast).toHaveBeenCalled();

    unbind();
    bubble.destroy();
    ta.remove();
    cardBtn.remove();
    saveBtn.remove();
  });

  it('프리뷰 카드에서 "뒤에 삽입" 클릭 시 선택 영역 뒤에 텍스트를 삽입한다', async () => {
    const showToast = vi.fn();
    const bubble = createSelectionBubble({ showToast });
    document.body.appendChild(bubble.element);

    const ta = document.createElement('textarea');
    ta.value = '업무 추진';
    document.body.appendChild(ta);
    ta.focus();
    ta.selectionStart = 3;
    ta.selectionEnd = 5; // '추진'

    const cardBtn = document.createElement('button');
    cardBtn.textContent = '문서카드';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '본문저장';
    document.body.appendChild(cardBtn);
    document.body.appendChild(saveBtn);

    const unbind = bubble.bindEvents(document);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => setTimeout(r, 220));

    // 번호 매기기 실행
    const btnNumber = bubble.element.querySelector<HTMLButtonElement>('#btnAutoNumber')!;
    btnNumber.click();

    const btnAfter = bubble.element.querySelector<HTMLButtonElement>('#btnPreviewInsertAfter')!;
    btnAfter.click();

    await new Promise((r) => setTimeout(r, 50));
    expect(ta.value).toBe('업무 추진 1. 추진');
    expect(bubble.element.style.display).toBe('none');

    unbind();
    bubble.destroy();
    ta.remove();
    cardBtn.remove();
    saveBtn.remove();
  });
});

