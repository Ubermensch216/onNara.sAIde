// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractRecommendedTitleAndDraft,
  buildDraftTitleSystemPrompt,
  generateFallbackTitle,
  findTitleInputElement,
  applyTitleToHwpCtrl,
  applyDraftTitleToDom,
} from './draft-title';

describe('draft-title', () => {
  describe('extractRecommendedTitleAndDraft', () => {
    it('[추천 제목] 태그와 [공문서 초안] 태그가 포함된 출력을 정상 분리한다', () => {
      const raw = `[추천 제목] 2026년 공공 AI 업무혁신 추진계획(안)

[공문서 초안]
1. 추진 배경
가. 인공지능 기술의 급격한 발전 및 행정 서비스 고도화 필요
- 대국민 행정 효율 극대화 추진`;

      const result = extractRecommendedTitleAndDraft(raw);
      expect(result.title).toBe('2026년 공공 AI 업무혁신 추진계획(안)');
      expect(result.draft).toContain('1. 추진 배경');
      expect(result.draft).toContain('가. 인공지능 기술의 급격한 발전');
      expect(result.draft).not.toContain('[추천 제목]');
      expect(result.draft).not.toContain('[공문서 초안]');
    });

    it('추천 제목에 마크다운이나 따옴표가 있어도 깔끔하게 제거한다', () => {
      const raw = `**[추천 제목]** "부산광역시 해양수산 발전계획(안)"

1. 추진 근거
- 관련 조례 제5조`;

      const result = extractRecommendedTitleAndDraft(raw);
      expect(result.title).toBe('부산광역시 해양수산 발전계획(안)');
      expect(result.draft).toContain('1. 추진 근거');
      expect(result.draft).not.toContain('**');
      expect(result.draft).not.toContain('"');
    });

    it('태그 없이 "제목: "으로 시작하는 경우도 제목을 추출한다', () => {
      const raw = `제목: 2026년도 하반기 부서별 보안점검 실시 안내

1. 점검 개요
가. 일시: 2026. 10. 15.`;

      const result = extractRecommendedTitleAndDraft(raw);
      expect(result.title).toBe('2026년도 하반기 부서별 보안점검 실시 안내');
      expect(result.draft).toContain('1. 점검 개요');
      expect(result.draft).not.toContain('제목:');
    });

    it('제목 태그가 누락된 경우 사용자 프롬프트로부터 행정 공문서형 제목을 자동 생성한다', () => {
      const raw = `1. 추진 배경
가. 행정 효율화 필요`;
      const prompt = '2026년 청년 일자리 창출 지원사업 추진계획안 작성해줘.';

      const result = extractRecommendedTitleAndDraft(raw, prompt);
      expect(result.title).toBe('2026년 청년 일자리 창출 지원사업 추진계획(안)');
      expect(result.draft).toContain('1. 추진 배경');
    });

    it('빈 텍스트일 때 적절한 기본 제목을 반환한다', () => {
      const result = extractRecommendedTitleAndDraft('', '업무 협조 요청 작성 부탁드립니다');
      expect(result.title).toContain('업무 협조 요청');
      expect(result.draft).toBe('');
    });
  });

  describe('generateFallbackTitle', () => {
    it('기존 문서 제목이 있고 의미있으면 우선 사용한다', () => {
      const title = generateFallbackTitle('아무 프롬프트', '부산광역시 조직개편안');
      expect(title).toBe('부산광역시 조직개편안');
    });

    it('작성해줘 등의 지시어를 정제한다', () => {
      const title = generateFallbackTitle('2026년 부산 경제 활성화 종합계획 작성해줘');
      expect(title).toBe('2026년 부산 경제 활성화 종합계획(안)');
    });
  });

  describe('buildDraftTitleSystemPrompt', () => {
    it('추천 제목 출력 규격을 기존 프롬프트에 병합한다', () => {
      const base = '기본 프롬프트입니다.';
      const res = buildDraftTitleSystemPrompt(base);
      expect(res).toContain('기본 프롬프트입니다.');
      expect(res).toContain('[추천 제목]');
      expect(res).toContain('[공문서 초안]');
    });
  });

  describe('findTitleInputElement and applyDraftTitleToDom', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('표준 input[name="docTitle"]을 찾아서 입력한다', () => {
      document.body.innerHTML = `
        <form>
          <input type="text" name="docTitle" id="docTitle" value="" />
        </form>
      `;

      const input = findTitleInputElement(document);
      expect(input).not.toBeNull();
      expect((input as HTMLInputElement).name).toBe('docTitle');

      const res = applyDraftTitleToDom(document, '새로운 공문 제목');
      expect(res.success).toBe(true);
      expect((document.querySelector('#docTitle') as HTMLInputElement).value).toBe('새로운 공문 제목');
    });

    it('테이블 내 "제목" 셀 옆의 input을 찾아 입력한다 (공문 서식 형태)', () => {
      document.body.innerHTML = `
        <table>
          <tbody>
            <tr>
              <th>수신</th>
              <td>수신자 목록</td>
            </tr>
            <tr>
              <th>(경유)</th>
              <td></td>
            </tr>
            <tr>
              <th>제목</th>
              <td><input type="text" class="form-control" value="" /></td>
            </tr>
          </tbody>
        </table>
      `;

      const input = findTitleInputElement(document);
      expect(input).not.toBeNull();

      const res = applyDraftTitleToDom(document, '2026년도 부산경제 활성화 방안(안)');
      expect(res.success).toBe(true);
      const targetInput = document.querySelector('input') as HTMLInputElement;
      expect(targetInput.value).toBe('2026년도 부산경제 활성화 방안(안)');
    });

    it('label[for]로 연결된 제목 입력칸을 찾아 입력한다', () => {
      document.body.innerHTML = `
        <div>
          <label for="custom_title_field">제목</label>
          <input type="text" id="custom_title_field" value="" />
        </div>
      `;

      const input = findTitleInputElement(document);
      expect(input).not.toBeNull();
      expect((input as HTMLInputElement).id).toBe('custom_title_field');

      const res = applyDraftTitleToDom(document, '조례 개정안 공고');
      expect(res.success).toBe(true);
      expect((document.querySelector('#custom_title_field') as HTMLInputElement).value).toBe('조례 개정안 공고');
    });
  });

  describe('applyTitleToHwpCtrl', () => {
    it('PutFieldText 메소드가 있는 경우 누름틀에 제목을 입력한다', () => {
      const putFieldMock = vi.fn().mockReturnValue(true);
      const fieldExistMock = vi.fn().mockReturnValue(true);
      const mockHwp = {
        FieldExist: fieldExistMock,
        PutFieldText: putFieldMock,
      };

      const res = applyTitleToHwpCtrl(mockHwp, '2026년도 예산안 승인의 건');
      expect(res.success).toBe(true);
      expect(res.method).toBe('PutFieldText');
      expect(putFieldMock).toHaveBeenCalledWith('제목', '2026년도 예산안 승인의 건');
    });

    it('MoveToField + InsertText 방식도 지원한다', () => {
      const moveToFieldMock = vi.fn();
      const insertTextMock = vi.fn();
      const mockHwp = {
        FieldExist: vi.fn().mockReturnValue(true),
        MoveToField: moveToFieldMock,
        InsertText: insertTextMock,
      };

      const res = applyTitleToHwpCtrl(mockHwp, '보안 지침 알림');
      expect(res.success).toBe(true);
      expect(res.method).toBe('MoveToField+InsertText');
      expect(moveToFieldMock).toHaveBeenCalledWith('제목', true, true, true);
      expect(insertTextMock).toHaveBeenCalledWith('보안 지침 알림');
    });
  });
});
