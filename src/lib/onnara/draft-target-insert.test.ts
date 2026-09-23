// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { directInsertAtTarget, getElementLabel, isEditableElement } from '@/lib/onnara/draft-editor';

describe('온나라 타깃 지정 초안 직접 삽입 (directInsertAtTarget)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('isEditableElement', () => {
    it('textarea, input, contenteditable을 편집 가능한 요소로 인식한다', () => {
      const ta = document.createElement('textarea');
      expect(isEditableElement(ta)).toBe(true);

      const inp = document.createElement('input');
      inp.type = 'text';
      expect(isEditableElement(inp)).toBe(true);

      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'true');
      expect(isEditableElement(div)).toBe(true);
    });

    it('일반 div, span, table 등 레이아웃 요소는 false를 반환한다', () => {
      const div = document.createElement('div');
      div.id = 'divSubject';
      expect(isEditableElement(div)).toBe(false);

      const span = document.createElement('span');
      expect(isEditableElement(span)).toBe(false);
    });

    it('온나라 HwpCtrl 관련 컨트롤 요소를 감지한다', () => {
      const hwp = document.createElement('object');
      hwp.id = 'HwpCtrl';
      expect(isEditableElement(hwp)).toBe(true);
    });
  });

  describe('getElementLabel', () => {
    it('textarea 요소의 placeholder 또는 기본 친절한 명칭을 반환한다', () => {
      const ta = document.createElement('textarea');
      expect(getElementLabel(ta)).toBe('본문 입력창');

      const ta2 = document.createElement('textarea');
      ta2.placeholder = '본문을 입력하세요';
      expect(getElementLabel(ta2)).toBe('본문을 입력하세요');
    });

    it('contenteditable 요소의 라벨을 식별한다', () => {
      const div = document.createElement('div');
      div.setAttribute('contenteditable', 'true');
      div.setAttribute('aria-label', '기안문 본문');
      expect(getElementLabel(div)).toBe('기안문 본문');
    });
  });

  describe('directInsertAtTarget with Textarea', () => {
    it('textarea의 커서 위치에 초안을 직접 삽입하고 input/change 이벤트를 발생시킨다', async () => {
      const ta = document.createElement('textarea');
      ta.value = '기존 문장 앞부분. 뒷부분.';
      document.body.appendChild(ta);

      // 커서 위치 설정: 11번째 인덱스
      ta.selectionStart = 11;
      ta.selectionEnd = 11;

      let inputFired = false;
      let changeFired = false;
      ta.addEventListener('input', () => {
        inputFired = true;
      });
      ta.addEventListener('change', () => {
        changeFired = true;
      });

      const res = await directInsertAtTarget(ta, '[추가된 초안]', undefined, undefined, document);

      expect(res.status).toBe('applied');
      expect(ta.value).toBe('기존 문장 앞부분. [추가된 초안]뒷부분.');
      expect(inputFired).toBe(true);
      expect(changeFired).toBe(true);
    });
  });

  describe('directInsertAtTarget with Contenteditable', () => {
    it('contenteditable 에디터 요소에 텍스트를 직접 삽입하고 input 이벤트를 발생시킨다', async () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.id = 'web-editor';
      document.body.appendChild(editor);

      let inputFired = false;
      editor.addEventListener('input', () => {
        inputFired = true;
      });

      const res = await directInsertAtTarget(editor, '안녕하세요. 공문서 초안입니다.', undefined, undefined, document);

      expect(res.status).toBe('applied');
      expect(editor.textContent).toContain('안녕하세요. 공문서 초안입니다.');
      expect(inputFired).toBe(true);
    });
  });

  describe('directInsertAtTarget with General DOM Container (div, td)', () => {
    it('일반 div 컨테이너를 클릭해도 복사로 포기하지 않고 텍스트를 직접 삽입한다', async () => {
      const bodyBox = document.createElement('div');
      bodyBox.id = 'divBodyContent';
      document.body.appendChild(bodyBox);

      const res = await directInsertAtTarget(bodyBox, '공문서 본문 텍스트', undefined, undefined, document);

      expect(res.status).toBe('applied');
      expect(bodyBox.innerText).toContain('공문서 본문 텍스트');
      expect(bodyBox.getAttribute('contenteditable')).toBe('true');
    });
  });

  describe('directInsertAtTarget with WebHWP HwpCtrl', () => {
    it('윈도우에 WebHWP 컨트롤(HwpCtrl)이 있으면 InsertText를 직접 호출한다', async () => {
      let insertedHwpText = '';
      const mockHwp = {
        InsertText: vi.fn((txt: string) => {
          insertedHwpText = txt;
        }),
      };
      (window as any).HwpCtrl = mockHwp;

      const dummyEl = document.createElement('div');
      document.body.appendChild(dummyEl);

      const res = await directInsertAtTarget(dummyEl, '한글 기안문 본문 초안', undefined, undefined, document);

      expect(res.status).toBe('applied');
      expect(mockHwp.InsertText).toHaveBeenCalledWith('한글 기안문 본문 초안');
      expect(insertedHwpText).toBe('한글 기안문 본문 초안');

      delete (window as any).HwpCtrl;
    });
  });
});
