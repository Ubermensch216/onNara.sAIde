// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  parseRelatedDocText,
  extractRelatedDocuments,
  fitReferenceText,
  buildReferencePrompt,
  generateRuleBasedSummary,
  generateDocSummary,
  type RelatedDocInfo,
} from './related-info';

describe('related-info', () => {
  describe('parseRelatedDocText', () => {
    it('[문서] 제목 형태를 정확히 파싱한다', () => {
      const res = parseRelatedDocText('[문서] 공유재산관리계획 수립 대상사업 안건 제출 안내');
      expect(res).not.toBeNull();
      expect(res?.type).toBe('문서');
      expect(res?.title).toBe('공유재산관리계획 수립 대상사업 안건 제출 안내');
    });

    it('[보고문서] 구분 및 문서번호 괄호를 분리한다', () => {
      const res = parseRelatedDocText('[보고문서] 2026년 상반기 종합감사 결과 보고 (11099)');
      expect(res).not.toBeNull();
      expect(res?.type).toBe('보고문서');
      expect(res?.title).toBe('2026년 상반기 종합감사 결과 보고');
      expect(res?.docNumber).toBe('11099');
    });

    it('말미의 삭제/검색 버튼 문구를 정제한다', () => {
      const res = parseRelatedDocText('[메모보고] 업무보고 자료 제출 안내 삭제');
      expect(res).not.toBeNull();
      expect(res?.title).toBe('업무보고 자료 제출 안내');
    });

    it('괄호 없이 콜론으로 구분된 경우도 처리한다', () => {
      const res = parseRelatedDocText('문서: 지방출자출연법 개정안 검토');
      expect(res).not.toBeNull();
      expect(res?.type).toBe('문서');
      expect(res?.title).toBe('지방출자출연법 개정안 검토');
    });
  });

  describe('extractRelatedDocuments (DOM 파싱)', () => {
    it('th(관련정보) - td 구조에서 관련문서를 정확히 수집한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <table class="table_form">
          <tr>
            <th scope="row">제목</th>
            <td><input name="docTitle" value="2026 기안" /></td>
          </tr>
          <tr>
            <th scope="row">관련정보</th>
            <td>
              <span class="rel_item">[문서] 공유재산관리계획 수립 대상사업 안건 제출 안내</span>
              <button type="button" class="btn_search">검색</button>
            </td>
          </tr>
        </table>
      `;

      const docs = extractRelatedDocuments(doc);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.title).toBe('공유재산관리계획 수립 대상사업 안건 제출 안내');
      expect(docs[0]!.type).toBe('문서');
    });

    it('onclick에서 docId(11099)가 포함된 링크를 파싱한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <table>
          <tr>
            <td>관련정보</td>
            <td>
              <a href="#" onclick="fn_viewReport('11099');">[보고문서] 안건 제출 안내</a>
            </td>
          </tr>
        </table>
      `;

      const docs = extractRelatedDocuments(doc);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.title).toBe('안건 제출 안내');
      expect(docs[0]!.type).toBe('보고문서');
      expect(docs[0]!.id).toBe('11099');
      expect(docs[0]!.docNumber).toBe('11099');
    });

    it('hidden input에 저장된 관련문서 정보도 추출한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <div id="divAddInfo">
          <input type="hidden" name="addInfoDocId" value="22001" />
          <input type="hidden" name="addInfoTitle" value="[문서] 사전 컨설팅감사 결과 알림" />
        </div>
      `;

      const docs = extractRelatedDocuments(doc);
      expect(docs).toHaveLength(1);
      expect(docs[0]!.title).toBe('사전 컨설팅감사 결과 알림');
    });

    it('중복된 제목은 한 건만 수집한다', () => {
      const doc = document.implementation.createHTMLDocument();
      doc.body.innerHTML = `
        <table>
          <tr>
            <th>관련정보</th>
            <td>
              <span>[문서] 동일한 공문</span>
              <div id="addInfoList"><span>[문서] 동일한 공문</span></div>
            </td>
          </tr>
        </table>
      `;

      const docs = extractRelatedDocuments(doc);
      expect(docs).toHaveLength(1);
    });
  });

  describe('fitReferenceText', () => {
    it('지정된 글자수 이내면 그대로 반환한다', () => {
      const text = '간단한 지침 내용입니다.';
      expect(fitReferenceText(text, 100)).toBe(text);
    });

    it('글자수를 초과하면 앞부분과 뒷부분을 남기고 중략한다', () => {
      const longText = 'A'.repeat(1000) + ' ' + 'B'.repeat(1000);
      const fitted = fitReferenceText(longText, 500);
      expect(fitted.length).toBeLessThanOrEqual(550);
      expect(fitted).toContain('[... 중략 ...]');
    });
  });

  describe('buildReferencePrompt', () => {
    it('참고 문서가 없으면 기본 프롬프트를 생성한다', () => {
      const prompt = buildReferencePrompt({
        userPrompt: '추진계획 작성',
        docTitle: '공문 제목',
      });
      expect(prompt).toContain('공문 제목: 공문 제목');
      expect(prompt).toContain('요청 사항: 추진계획 작성');
      expect(prompt).not.toContain('[참고 문서 (관련정보)]');
    });

    it('참고 문서가 제공되면 관련정보 컨텍스트와 필수 지침을 포함한다', () => {
      const refDoc: RelatedDocInfo = {
        title: '공유재산관리계획 수립 대상사업 안건 제출 안내',
        type: '문서',
        docNumber: '11099',
        rawText: '[문서] 공유재산관리계획 수립 대상사업 안건 제출 안내',
        content: '제출기한: 2026년 10월 15일(목) 18:00까지. 제출서식: 별첨 1 서식 작성.',
      };

      const prompt = buildReferencePrompt({
        userPrompt: '우리 과 소관 사업 안건 제출 공문 작성해줘',
        docTitle: '공유재산관리계획 수립 대상사업 안건 제출(기획조정실)',
        referenceDoc: refDoc,
      });

      expect(prompt).toContain('[참고 문서 (관련정보)]');
      expect(prompt).toContain('공유재산관리계획 수립 대상사업 안건 제출 안내');
      expect(prompt).toContain('문서번호: 11099');
      expect(prompt).toContain('제출기한: 2026년 10월 15일');
      expect(prompt).toContain('대한민국 행정업무운영편람의 표준 서식');
      expect(prompt).toContain('우리 과 소관 사업 안건 제출 공문 작성해줘');
    });
  });

  describe('generateRuleBasedSummary', () => {
    it('추진배경, 주요내용, 제출기한, 서식 요구사항을 개조식으로 요약한다', () => {
      const docContent = `
        2026년 공공 AI 지원사업 추진계획 안내
        1. 추진 배경 및 목적
        공공부문 AI 전환 촉진을 통한 대민 행정서비스 품질 혁신 및 생산성 향상
        2. 주요 추진 내용 및 방침
        부서별 행정업무 보조 AI 시범 도입 및 표준 가이드라인 배포
        3. 제출 기한 및 일정
        신청서 제출 기한: 2026년 10월 20일(화) 18:00까지 전자문서 제출
        4. 서식 및 행정사항
        붙임 별첨 1 서식에 의거 사업계획서 및 부서장 확인서 제출
      `;

      const summary = generateRuleBasedSummary(docContent, '2026년 공공 AI 지원사업 추진계획 안내');
      expect(summary).toContain('- 추진배경/목적:');
      expect(summary).toContain('- 주요내용/방침:');
      expect(summary).toContain('- 제출기한/일정:');
      expect(summary).toContain('- 서식/행정사항:');
      expect(summary).toContain('2026년 10월 20일');
    });

    it('본문이 비어있으면 대체 안내를 반환한다', () => {
      const summary = generateRuleBasedSummary('');
      expect(summary).toBe('(본문 내용이 없습니다.)');
    });
  });

  describe('generateDocSummary', () => {
    it('네트워크/Ollama 실패 시 규칙 기반 요약으로 안전하게 폴백한다', async () => {
      const docContent = '추진 배경: 행정 혁신. 제출 기한: 10월 15일까지. 별첨 1 서식 제출.';
      const summary = await generateDocSummary(docContent, '행정 혁신 계획', {
        ollamaUrl: 'http://localhost:99999', // 존재하지 않는 포트
        model: 'non-existent',
      });
      expect(summary).toContain('10월 15일');
    });
  });
});
