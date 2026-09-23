// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  directInsertAtTarget,
  getElementLabel,
  isEditableElement,
  isHwpElementOrContainer,
  cleanupAccidentalContentEditable,
  tryApplyHwpCtrl,
} from '@/lib/onnara/draft-editor';

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
      expect(isHwpElementOrContainer(hwp)).toBe(true);
    });
  });

  describe('cleanupAccidentalContentEditable', () => {
    it('우발적으로 레이아웃 div에 걸린 contenteditable 속성을 안전하게 제거한다', () => {
      const outerLayout = document.createElement('div');
      outerLayout.id = 'hwpWrapperLayout';
      outerLayout.setAttribute('contenteditable', 'true');
      document.body.appendChild(outerLayout);

      const realEditor = document.createElement('div');
      realEditor.id = 'mainWebEditor';
      realEditor.className = 'editor-area';
      realEditor.setAttribute('contenteditable', 'true');
      document.body.appendChild(realEditor);

      cleanupAccidentalContentEditable(document);

      expect(outerLayout.getAttribute('contenteditable')).toBeNull();
      expect(realEditor.getAttribute('contenteditable')).toBe('true');
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

    it('WebHWP 관련 요소는 한글 기안기 본문 라벨을 반환한다', () => {
      const hwpDiv = document.createElement('div');
      hwpDiv.id = 'hwpArea';
      expect(getElementLabel(hwpDiv)).toBe('한글 기안기 본문');
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
    it('일반 div 클릭 시 외곽에 contenteditable을 강제로 부여하지 않고 안전하게 클립보드 폴백한다', async () => {
      const bodyBox = document.createElement('div');
      bodyBox.id = 'divBodyContent';
      document.body.appendChild(bodyBox);

      const res = await directInsertAtTarget(bodyBox, '공문서 본문 텍스트', undefined, undefined, document);

      // 외곽 div에 contenteditable이 붙지 않아야 함! (중요)
      expect(bodyBox.getAttribute('contenteditable')).toBeNull();
      expect(res.status).toBe('clipboard-fallback');
      expect(res.message).toContain('Ctrl+V');
    });
  });

  describe('WebHWP tryApplyHwpCtrl', () => {
    it('온나라 기안기 누름틀(Field) "본문"이 존재하면 MoveToField 후 InsertText를 우선 호출한다', () => {
      const calls: string[] = [];
      const mockHwp = {
        FieldExist: vi.fn((name: string) => name === '본문'),
        MoveToField: vi.fn((name: string) => {
          calls.push(`MoveToField:${name}`);
        }),
        InsertText: vi.fn((text: string) => {
          calls.push(`InsertText:${text}`);
        }),
      };

      const res = tryApplyHwpCtrl(mockHwp, '초안 본문');
      expect(res.success).toBe(true);
      expect(res.fieldName).toBe('본문');
      expect(mockHwp.MoveToField).toHaveBeenCalledWith('본문', true, true, true);
      expect(mockHwp.InsertText).toHaveBeenCalledWith('초안 본문');
    });

    it('MoveToField가 없고 PutFieldText만 지원할 때 PutFieldText를 호출한다', () => {
      const mockHwp = {
        FieldExist: vi.fn((name: string) => name === '본문'),
        PutFieldText: vi.fn(),
      };

      const res = tryApplyHwpCtrl(mockHwp, '초안 본문');
      expect(res.success).toBe(true);
      expect(mockHwp.PutFieldText).toHaveBeenCalledWith('본문', '초안 본문');
    });

    it('누름틀 필드가 없으면 현재 위치의 InsertText를 호출한다', () => {
      const mockHwp = {
        FieldExist: vi.fn(() => false),
        InsertText: vi.fn(),
      };

      const res = tryApplyHwpCtrl(mockHwp, '커서 위치 초안');
      expect(res.success).toBe(true);
      expect(mockHwp.InsertText).toHaveBeenCalledWith('커서 위치 초안');
    });

    it('InsertText 메서드가 없고 CreateAction 방식일 때 액션을 실행한다', () => {
      const mockSet = { SetItem: vi.fn() };
      const mockAct = {
        CreateSet: vi.fn(() => mockSet),
        Execute: vi.fn(),
      };
      const mockHwp = {
        FieldExist: vi.fn(() => false),
        CreateAction: vi.fn(() => mockAct),
      };

      const res = tryApplyHwpCtrl(mockHwp, '액션 삽입 텍스트');
      expect(res.success).toBe(true);
      expect(mockAct.CreateSet).toHaveBeenCalled();
      expect(mockSet.SetItem).toHaveBeenCalledWith('Text', '액션 삽입 텍스트');
      expect(mockAct.Execute).toHaveBeenCalledWith(mockSet);
    });

    it('직접 삽입 메서드가 없을 때 Run("Paste")를 실행한다', () => {
      const mockHwp = {
        FieldExist: vi.fn(() => false),
        Run: vi.fn(),
      };

      const res = tryApplyHwpCtrl(mockHwp, '붙여넣기 텍스트');
      expect(res.success).toBe(true);
      expect(mockHwp.Run).toHaveBeenCalledWith('Paste');
    });
  });

  describe('directInsertAtTarget with WebHWP HwpCtrl in Window', () => {
    it('윈도우에 WebHWP 컨트롤(HwpCtrl)이 있으면 누름틀 또는 InsertText를 실행한다', async () => {
      const mockHwp = {
        FieldExist: vi.fn((name: string) => name === '본문'),
        MoveToField: vi.fn(),
        InsertText: vi.fn(),
      };
      (window as any).HwpCtrl = mockHwp;

      const dummyEl = document.createElement('div');
      dummyEl.id = 'hwpArea';
      document.body.appendChild(dummyEl);

      const res = await directInsertAtTarget(dummyEl, '한글 기안문 본문 초안', undefined, undefined, document);

      expect(res.status).toBe('applied');
      expect(mockHwp.MoveToField).toHaveBeenCalledWith('본문', true, true, true);
      expect(mockHwp.InsertText).toHaveBeenCalledWith('한글 기안문 본문 초안');

      delete (window as any).HwpCtrl;
    });
  });
});
