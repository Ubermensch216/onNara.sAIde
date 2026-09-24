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
    it('현재 커서 위치의 InsertText를 최우선 호출하여 기존 문서 내용을 100% 보존한다', () => {
      const mockHwp = {
        FieldExist: vi.fn((name: string) => name === '본문'),
        MoveToField: vi.fn(),
        InsertText: vi.fn(),
      };

      const res = tryApplyHwpCtrl(mockHwp, '초안 본문');
      expect(res.success).toBe(true);
      expect(res.method).toBe('InsertText');
      // 클릭 커서 위치에 바로 삽입되므로 MoveToField로 기존 내용을 선택하거나 날리지 않음!
      expect(mockHwp.MoveToField).not.toHaveBeenCalled();
      expect(mockHwp.InsertText).toHaveBeenCalledWith('초안 본문');
    });

    it('InsertText가 실패하고 MoveToField로 필드 폴백할 때 select=false로 기존 내용을 보존한다', () => {
      const mockHwp = {
        FieldExist: vi.fn((name: string) => name === '본문'),
        MoveToField: vi.fn(),
        // InsertText가 없을 때
      };

      // CreateAction과 Run도 없을 때 필드 폴백
      const res = tryApplyHwpCtrl(mockHwp, '초안 본문');
      expect(res.success).toBe(false); // MoveToField만 있고 삽입 수단 없으면 안전하게 실패

      const mockHwpWithInsert = {
        FieldExist: vi.fn((name: string) => name === '본문'),
        MoveToField: vi.fn(),
        InsertText: vi.fn(),
      };
      // InsertText가 커서에서 예외를 던질 때
      mockHwpWithInsert.InsertText.mockImplementationOnce(() => {
        throw new Error('Cursor unavailable');
      });
      const res2 = tryApplyHwpCtrl(mockHwpWithInsert, '초안 본문');
      expect(res2.success).toBe(true);
      expect(res2.fieldName).toBe('본문');
      // start: false (끝 위치), select: false (기존 내용 선택/삭제 금지!)
      expect(mockHwpWithInsert.MoveToField).toHaveBeenCalledWith('본문', true, false, false);
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
      expect(mockHwp.InsertText).toHaveBeenCalledWith('한글 기안문 본문 초안');
      expect(mockHwp.MoveToField).not.toHaveBeenCalled();

      delete (window as any).HwpCtrl;
    });

    it('다중 행 텍스트인 경우 각 행별로 InsertText와 BreakPara를 교대로 호출하여 줄바꿈을 완벽히 보존한다', async () => {
      const mockHwp = {
        InsertText: vi.fn(),
        Run: vi.fn(),
      };
      (window as any).HwpCtrl = mockHwp;

      const dummyEl = document.createElement('div');
      dummyEl.id = 'hwpArea';
      document.body.appendChild(dummyEl);

      const multilineText = '1. 추진 배경\n2. 관련 의견 검토\n가. 세부 내용';
      const res = await directInsertAtTarget(dummyEl, multilineText, undefined, undefined, document);

      expect(res.status).toBe('applied');
      expect(mockHwp.InsertText).toHaveBeenCalledTimes(3);
      expect(mockHwp.InsertText).toHaveBeenNthCalledWith(1, '1. 추진 배경');
      expect(mockHwp.InsertText).toHaveBeenNthCalledWith(2, '2. 관련 의견 검토');
      expect(mockHwp.InsertText).toHaveBeenNthCalledWith(3, '가. 세부 내용');

      expect(mockHwp.Run).toHaveBeenCalledTimes(2);
      expect(mockHwp.Run).toHaveBeenCalledWith('BreakPara');

      delete (window as any).HwpCtrl;
    });
  });

  describe('directInsertAtTarget with Contenteditable multiline', () => {
    it('contenteditable 에디터에 다중 행 삽입 시 줄바꿈이 깨지지 않고 보존된다', async () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.id = 'web-editor';
      document.body.appendChild(editor);

      const multilineText = '1. 개요\n2. 세부사항';
      const res = await directInsertAtTarget(editor, multilineText, undefined, undefined, document);

      expect(res.status).toBe('applied');
      expect(editor.textContent).toContain('1. 개요');
      expect(editor.textContent).toContain('2. 세부사항');
      // <br> 태그 또는 <p> 태그가 존재하여 줄바꿈이 보존되어야 함
      const hasBreak = editor.querySelector('br') !== null || editor.querySelector('p') !== null;
      expect(hasBreak).toBe(true);
    });
  });
});
