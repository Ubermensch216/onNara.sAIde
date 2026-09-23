// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  classifyDraftRoute,
  findWriteBodyButton,
  hasDraftEditorSignals,
  isAllowedOrigin,
  isExactDraftPath,
} from './draft-route';

describe('draft-route', () => {
  const allowed = ['http://99.1.2.134', 'https://onnara.go.kr'];

  describe('isAllowedOrigin', () => {
    it('허용된 origin에 대해 true를 반환한다', () => {
      expect(isAllowedOrigin('http://99.1.2.134/bms/dct/addoreportbodyview.do', allowed)).toBe(true);
      expect(isAllowedOrigin('https://onnara.go.kr/bms/dct/addoreportbodyview.do', allowed)).toBe(true);
    });

    it('허용되지 않은 origin에 대해 false를 반환한다', () => {
      expect(isAllowedOrigin('http://malicious.site/bms/dct/addoreportbodyview.do', allowed)).toBe(false);
      expect(isAllowedOrigin('https://example.com/test', allowed)).toBe(false);
    });
  });

  describe('isExactDraftPath', () => {
    it('공식 기안기 및 본문작성 경로를 일치 판정한다', () => {
      expect(isExactDraftPath('http://99.1.2.134/bms/dct/addoreportbodyview.do?popupflag=Y')).toBe(true);
      expect(isExactDraftPath('https://onnara.go.kr/bms/dct/modifyoreportbodyview.do')).toBe(true);
      expect(isExactDraftPath('http://99.1.2.134/bms/dct/addhwpbody.do')).toBe(true);
      expect(isExactDraftPath('http://99.1.2.134/bms/dct/hwpctrl.do')).toBe(true);
    });

    it('유사한 가짜 경로 또는 목록 경로는 false를 반환한다', () => {
      expect(isExactDraftPath('http://99.1.2.134/bms/dct/rdoclist.do')).toBe(false);
      expect(isExactDraftPath('http://99.1.2.134/bms/dct/addoreportbodyview.do.fake')).toBe(false);
      expect(isExactDraftPath('http://99.1.2.134/other/view.do')).toBe(false);
    });
  });

  describe('findWriteBodyButton', () => {
    it('본문작성 버튼을 정확하게 찾아낸다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <button type="button" class="btn">문서정보</button>
        <button type="button" class="btn_main">본문작성</button>
      `;
      const btn = findWriteBodyButton(doc);
      expect(btn).not.toBeNull();
      expect(btn?.textContent).toBe('본문작성');
    });

    it('onclick에 addHwp가 들어있는 링크도 찾아낸다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = '<a href="#" onclick="fn_addHwpBody();">기안문작성</a>';
      const btn = findWriteBodyButton(doc);
      expect(btn).not.toBeNull();
    });
  });

  describe('hasDraftEditorSignals', () => {
    it('기안기 DOM 신호가 있으면 true를 반환한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = '<input name="docTitle" value="" />';
      expect(hasDraftEditorSignals(doc)).toBe(true);
    });

    it('본문작성 버튼이 있어도 true를 반환한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = '<button type="button">본문작성</button>';
      expect(hasDraftEditorSignals(doc)).toBe(true);
    });

    it('신호가 없으면 false를 반환한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = '<div>일반 웹페이지</div>';
      expect(hasDraftEditorSignals(doc)).toBe(false);
    });
  });

  describe('classifyDraftRoute', () => {
    it('3중 조건이 모두 맞으면 confirmed를 반환한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = '<input name="docTitle" value="2026 기안" />';

      const result = classifyDraftRoute(
        'http://99.1.2.134/bms/dct/addoreportbodyview.do?popupflag=Y',
        doc,
        allowed
      );
      expect(result.status).toBe('confirmed');
    });
  });
});
