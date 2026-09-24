// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  draftToHtml,
  createDomFragmentFromText,
  copyDraftToClipboard,
  insertMultilineIntoHwp,
} from './draft-format';

describe('draft-format 유틸리티', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('draftToHtml', () => {
    it('빈 문자열은 빈 문자열을 반환한다', () => {
      expect(draftToHtml('')).toBe('');
    });

    it('각 행을 <p> 문단으로 감싸고, 빈 줄은 빈 문단으로 보존한다', () => {
      const text = '1. 추진 배경\n\n가. 주요 내용';
      const html = draftToHtml(text);

      expect(html).toContain('<p style="margin: 0 0 4px 0; line-height: 1.6; font-family: \'Malgun Gothic\', \'맑은 고딕\', sans-serif; font-size: 11pt;">1. 추진 배경</p>');
      expect(html).toContain('<p style="margin: 0; min-height: 1.2em;">&nbsp;</p>');
      expect(html).toContain('<p style="margin: 0 0 4px 0; line-height: 1.6; font-family: \'Malgun Gothic\', \'맑은 고딕\', sans-serif; font-size: 11pt;">가. 주요 내용</p>');
    });

    it('들여쓰기 공백을 &nbsp;로 변환하여 들여쓰기를 유지한다', () => {
      const text = '  (1) 세부 항목';
      const html = draftToHtml(text);

      expect(html).toContain('&nbsp;&nbsp;(1) 세부 항목');
    });

    it('HTML 특수문자(<, >, &, ")를 안전하게 이스케이프한다', () => {
      const text = '법률안 <혁신도시법 & 개정안> "검토"';
      const html = draftToHtml(text);

      expect(html).toContain('&lt;혁신도시법 &amp; 개정안&gt; &quot;검토&quot;');
    });
  });

  describe('createDomFragmentFromText', () => {
    it('줄바꿈마다 <br> 요소를 삽입하여 DOM Fragment를 생성한다', () => {
      const doc = document.implementation.createHTMLDocument();
      const text = '첫 번째 줄\n두 번째 줄\n세 번째 줄';
      const frag = createDomFragmentFromText(doc, text);

      const div = doc.createElement('div');
      div.appendChild(frag);

      expect(div.childNodes.length).toBe(5); // text, br, text, br, text
      expect(div.childNodes[0]?.textContent).toBe('첫 번째 줄');
      expect(div.childNodes[1]?.nodeName).toBe('BR');
      expect(div.childNodes[2]?.textContent).toBe('두 번째 줄');
      expect(div.childNodes[3]?.nodeName).toBe('BR');
      expect(div.childNodes[4]?.textContent).toBe('세 번째 줄');
    });
  });

  describe('copyDraftToClipboard', () => {
    it('ClipboardItem API가 지원되면 text/plain과 text/html을 동시 등록한다', async () => {
      let writtenItems: any[] = [];
      const mockClipboard = {
        write: vi.fn(async (items: any[]) => {
          writtenItems = items;
        }),
      };
      Object.assign(navigator, { clipboard: mockClipboard });

      // Mock ClipboardItem in global scope
      (global as any).ClipboardItem = class MockClipboardItem {
        data: Record<string, Blob>;
        constructor(data: Record<string, Blob>) {
          this.data = data;
        }
      };

      const res = await copyDraftToClipboard('1. 개요\n내용');
      expect(res).toBe(true);
      expect(mockClipboard.write).toHaveBeenCalled();
      expect(writtenItems.length).toBe(1);
      expect(writtenItems[0].data['text/plain']).toBeDefined();
      expect(writtenItems[0].data['text/html']).toBeDefined();
    });

    it('write 실패 시 writeText로 폴백한다', async () => {
      const mockClipboard = {
        write: vi.fn(async () => {
          throw new Error('Not allowed');
        }),
        writeText: vi.fn(async () => {}),
      };
      Object.assign(navigator, { clipboard: mockClipboard });

      const res = await copyDraftToClipboard('단순 텍스트');
      expect(res).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledWith('단순 텍스트');
    });
  });

  describe('insertMultilineIntoHwp', () => {
    it('단일 행은 InsertText 1회 호출한다', () => {
      const mockHwp = {
        InsertText: vi.fn(),
        Run: vi.fn(),
      };

      const res = insertMultilineIntoHwp(mockHwp, '한 줄 텍스트');
      expect(res).toBe(true);
      expect(mockHwp.InsertText).toHaveBeenCalledTimes(1);
      expect(mockHwp.InsertText).toHaveBeenCalledWith('한 줄 텍스트');
      expect(mockHwp.Run).not.toHaveBeenCalled();
    });

    it('다중 행은 각 행별 InsertText와 행 사이 BreakPara를 교대로 호출하여 줄바꿈을 완벽히 보존한다', () => {
      const mockHwp = {
        InsertText: vi.fn(),
        Run: vi.fn(),
      };

      const text = '1. 추진 배경\n가. 관련 법령\n(1) 세부 검토';
      const res = insertMultilineIntoHwp(mockHwp, text);

      expect(res).toBe(true);
      // 각 행(3개) InsertText
      expect(mockHwp.InsertText).toHaveBeenCalledTimes(3);
      expect(mockHwp.InsertText).toHaveBeenNthCalledWith(1, '1. 추진 배경');
      expect(mockHwp.InsertText).toHaveBeenNthCalledWith(2, '가. 관련 법령');
      expect(mockHwp.InsertText).toHaveBeenNthCalledWith(3, '(1) 세부 검토');

      // 행 사이(2개) BreakPara
      expect(mockHwp.Run).toHaveBeenCalledTimes(2);
      expect(mockHwp.Run).toHaveBeenNthCalledWith(1, 'BreakPara');
      expect(mockHwp.Run).toHaveBeenNthCalledWith(2, 'BreakPara');
    });

    it('중간의 빈 줄(문단 간 간격)에서도 BreakPara를 정상 발생시켜 빈 줄을 보존한다', () => {
      const mockHwp = {
        InsertText: vi.fn(),
        Run: vi.fn(),
      };

      const text = '1. 문단 1\n\n2. 문단 2';
      const res = insertMultilineIntoHwp(mockHwp, text);

      expect(res).toBe(true);
      // 문단 1, 빈 줄(스킵), 문단 2
      expect(mockHwp.InsertText).toHaveBeenCalledTimes(2);
      expect(mockHwp.InsertText).toHaveBeenNthCalledWith(1, '1. 문단 1');
      expect(mockHwp.InsertText).toHaveBeenNthCalledWith(2, '2. 문단 2');

      // 줄바꿈 2회
      expect(mockHwp.Run).toHaveBeenCalledTimes(2);
      expect(mockHwp.Run).toHaveBeenCalledWith('BreakPara');
    });

    it('1.5초 이내의 중복 호출은 deduplication되어 건너뛴다', () => {
      const mockHwp = {
        InsertText: vi.fn(),
        Run: vi.fn(),
      };

      const res1 = insertMultilineIntoHwp(mockHwp, '1. 첫번째');
      expect(res1).toBe(true);
      expect(mockHwp.InsertText).toHaveBeenCalledTimes(1);

      // 즉시 재호출 (동일 컨트롤 중복 삽입 시도)
      const res2 = insertMultilineIntoHwp(mockHwp, '1. 첫번째');
      expect(res2).toBe(true);
      // 추가 호출되지 않음!
      expect(mockHwp.InsertText).toHaveBeenCalledTimes(1);
    });
  });
});
