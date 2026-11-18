// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  classifyDraftRoute,
  findWriteBodyButton,
  hasDraftEditorSignals,
  isAllowedOrigin,
  isEditableViewPath,
  isExactDraftPath,
  isMetadataField,
  isDraftCardScreen,
  isBodyWritingScreen,
} from './draft-route';

describe('draft-route', () => {
  const allowed = ['http://onnara.example.go.kr', 'https://onnara.go.kr'];

  describe('isAllowedOrigin', () => {
    it('허용된 origin에 대해 true를 반환한다', () => {
      expect(isAllowedOrigin('http://onnara.example.go.kr/bms/dct/addoreportbodyview.do', allowed)).toBe(true);
      expect(isAllowedOrigin('https://onnara.go.kr/bms/dct/addoreportbodyview.do', allowed)).toBe(true);
    });

    it('허용되지 않은 origin에 대해 false를 반환한다', () => {
      expect(isAllowedOrigin('http://malicious.site/bms/dct/addoreportbodyview.do', allowed)).toBe(false);
      expect(isAllowedOrigin('https://example.com/test', allowed)).toBe(false);
    });
  });

  describe('기관별 서버 주소 독립성', () => {
    // 온나라 서버 주소(도메인·내부 IP·포트)는 기관마다 다르다. 판정은 주소가 아니라 경로로 한다.
    const hosts = [
      'http://onnara.example.go.kr',
      'https://onnara.saas.gcloud.go.kr',
      'http://10.20.30.40:8080',
      'http://192.168.0.5',
      'https://eapproval.other-agency.go.kr:8443',
    ];

    it.each(hosts)('%s: 허용 목록이 없으면 http/https 주소를 모두 통과시킨다', (host) => {
      expect(isAllowedOrigin(`${host}/bms/dct/addoreportbodyview.do`)).toBe(true);
    });

    it.each(hosts)('%s: 기안기·열람 경로를 주소와 무관하게 알아본다', (host) => {
      expect(isExactDraftPath(`${host}/bms/dct/addoreportbodyview.do?popupflag=Y`)).toBe(true);
      expect(isExactDraftPath(`${host}/bms/dct/addhwpbody.do`)).toBe(true);
      expect(isEditableViewPath(`${host}/bms/dct/viewreport.do`)).toBe(true);
      expect(isExactDraftPath(`${host}/bms/dct/rdoclist.do`)).toBe(false);
    });
  });

  describe('isExactDraftPath', () => {
    it('공식 기안기 및 본문작성 경로를 일치 판정한다', () => {
      expect(isExactDraftPath('http://onnara.example.go.kr/bms/dct/addoreportbodyview.do?popupflag=Y')).toBe(true);
      expect(isExactDraftPath('https://onnara.go.kr/bms/dct/modifyoreportbodyview.do')).toBe(true);
      expect(isExactDraftPath('http://onnara.example.go.kr/bms/dct/addhwpbody.do')).toBe(true);
      expect(isExactDraftPath('http://onnara.example.go.kr/bms/dct/hwpctrl.do')).toBe(true);
      // 기존 문서를 다시 연 문서관리카드(본문 편집 신호는 드로어가 따로 확인)
      expect(isExactDraftPath('http://onnara.example.go.kr/bms/dct/viewreport.do')).toBe(true);
      expect(isEditableViewPath('http://onnara.example.go.kr/bms/dct/viewreport.do')).toBe(true);
      expect(isEditableViewPath('http://onnara.example.go.kr/bms/dct/addoreportbodyview.do')).toBe(false);
    });

    it('유사한 가짜 경로 또는 목록 경로는 false를 반환한다', () => {
      expect(isExactDraftPath('http://onnara.example.go.kr/bms/dct/rdoclist.do')).toBe(false);
      expect(isExactDraftPath('http://onnara.example.go.kr/bms/dct/addoreportbodyview.do.fake')).toBe(false);
      expect(isExactDraftPath('http://onnara.example.go.kr/other/view.do')).toBe(false);
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
        'http://onnara.example.go.kr/bms/dct/addoreportbodyview.do?popupflag=Y',
        doc,
        allowed
      );
      expect(result.status).toBe('confirmed');
    });
  });

  describe('isMetadataField', () => {
    it('제목, 키워드, 요약, 단위관리 등 문서카드 필드를 정확히 메타데이터 필드로 판별한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <input name="docTitle" id="docTitle" value="부산 관광지 공고" />
        <input name="keyword" value="#관광" />
        <textarea name="summary">보고내용 요약</textarea>
        <input name="unitTask" value="관광진흥" />
        <div id="hwpArea" class="webhwp-editor">본문 영역</div>
      `;

      const titleInput = doc.querySelector<HTMLElement>('#docTitle');
      const keywordInput = doc.querySelector<HTMLElement>('input[name="keyword"]');
      const summaryTextarea = doc.querySelector<HTMLElement>('textarea[name="summary"]');
      const unitTaskInput = doc.querySelector<HTMLElement>('input[name="unitTask"]');
      const hwpArea = doc.querySelector<HTMLElement>('#hwpArea');

      expect(isMetadataField(titleInput)).toBe(true);
      expect(isMetadataField(keywordInput)).toBe(true);
      expect(isMetadataField(summaryTextarea)).toBe(true);
      expect(isMetadataField(unitTaskInput)).toBe(true);
      expect(isMetadataField(hwpArea)).toBe(false);
    });

    it('문서카드 폼 내부의 입력 요소들을 메타데이터 필드로 인식한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <form id="reportForm">
          <input type="text" name="customField" value="값" />
        </form>
      `;
      const inp = doc.querySelector<HTMLElement>('input[name="customField"]');
      expect(isMetadataField(inp)).toBe(true);
    });

    it('본문 영역의 div, p, td, span 등 텍스트 컨테이너는 reportForm 내부라도 메타데이터 필드가 아니다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <form id="reportForm">
          <table class="report_body">
            <tr>
              <td>
                <p id="para1">1. 추진 배경 및 필요성</p>
                <div id="div1">가. 2026년 부산 웰니스관광지</div>
              </td>
            </tr>
          </table>
        </form>
      `;
      const para = doc.querySelector<HTMLElement>('#para1');
      const div = doc.querySelector<HTMLElement>('#div1');
      const td = doc.querySelector<HTMLElement>('td');

      expect(isMetadataField(para)).toBe(false);
      expect(isMetadataField(div)).toBe(false);
      expect(isMetadataField(td)).toBe(false);
    });

    it('document, null, undefined 등 비 HTMLElement 객체에 대해 예외 없이 false를 반환한다', () => {
      expect(isMetadataField(null)).toBe(false);
      expect(isMetadataField(undefined as any)).toBe(false);
      expect(isMetadataField(document as any)).toBe(false);
    });
  });

  describe('isDraftCardScreen vs isBodyWritingScreen', () => {
    it('본문작성 버튼이 보이는 첫 번째 화면(문서카드)에서는 isDraftCardScreen=true, isBodyWritingScreen=false', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <button type="button" class="btn_main" style="width:80px;height:30px;">본문작성</button>
        <input name="docTitle" value="제목" />
      `;
      // jsdom getBoundingClientRect mock
      const btn = doc.querySelector('button')!;
      btn.getBoundingClientRect = () => ({ width: 80, height: 30, top: 0, left: 0, right: 80, bottom: 30, x: 0, y: 0, toJSON: () => ({}) });

      expect(isDraftCardScreen(doc)).toBe(true);
      expect(isBodyWritingScreen(doc)).toBe(false);
    });

    it('본문작성 화면(두 번째 화면)에서는 isDraftCardScreen=false, isBodyWritingScreen=true (WebHWP 컨트롤 존재 시)', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <button type="button">문서카드</button>
        <button type="button">본문저장</button>
        <button type="button">본문(검정변환)</button>
        <div id="hwpCtrl" class="webhwp-container">
          <canvas class="webhwp_canvas"></canvas>
        </div>
      `;

      expect(isDraftCardScreen(doc)).toBe(false);
      expect(isBodyWritingScreen(doc)).toBe(true);
    });

    it('HTML 테이블/문단 본문 화면에서도 reportForm이 존재하더라도 isDraftCardScreen=false, isBodyWritingScreen=true', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <form id="reportForm">
          <div class="top_actions">
            <button type="button">문서카드</button>
            <button type="button">본문저장</button>
            <button type="button">본문(검정변환)</button>
            <button type="button">표준기안문</button>
            <button type="button">서식참조</button>
          </div>
          <table class="report_body">
            <tr>
              <td>
                <p>1. 추진 배경 및 필요성</p>
                <p>가. 2026년 부산 웰니스관광지 및 테마 육성</p>
              </td>
            </tr>
          </table>
        </form>
      `;

      expect(isDraftCardScreen(doc)).toBe(false);
      expect(isBodyWritingScreen(doc)).toBe(true);
    });
  });
});

it('다른 출처의 top.document 접근이 거부되어도 현재 프레임의 본문·문서카드를 판정한다', () => {
  const doc = document.implementation.createHTMLDocument();
  const top = { get document() { throw new DOMException('Cross-origin', 'SecurityError'); } };
  Object.defineProperty(doc, 'defaultView', { value: { top }, configurable: true });
  doc.body.innerHTML = '<textarea class="editor" name="body">본문</textarea>';
  expect(isDraftCardScreen(doc)).toBe(false);
  expect(isBodyWritingScreen(doc)).toBe(true);
  doc.body.innerHTML = '<input name="docTitle">';
  expect(isDraftCardScreen(doc)).toBe(true);
  expect(isBodyWritingScreen(doc)).toBe(false);
});
