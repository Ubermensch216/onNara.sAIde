// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  maskPrivacyInfo,
  autoNumberAdminDraft,
  buildTransformPrompt,
} from './bubble-transform';

describe('bubble-transform', () => {
  describe('maskPrivacyInfo', () => {
    it('주민등록번호를 감지하여 뒷자리를 마스킹한다', () => {
      const input = '담당자 홍길동(850101-1234567) 및 020505-3456789 기안';
      const res = maskPrivacyInfo(input);

      expect(res.count).toBe(2);
      expect(res.types).toContain('주민등록번호');
      expect(res.text).toBe('담당자 홍길동(850101-1******) 및 020505-3****** 기안');
    });

    it('휴대전화번호를 감지하여 중간 자리를 마스킹한다', () => {
      const input = '문의전화: 010-1234-5678, 비상연락망 010-9876-5432';
      const res = maskPrivacyInfo(input);

      expect(res.count).toBe(2);
      expect(res.types).toContain('휴대전화번호');
      expect(res.text).toBe('문의전화: 010-****-5678, 비상연락망 010-****-5432');
    });

    it('이메일 주소를 감지하여 마스킹한다', () => {
      const input = '담당자 메일은 officer@korea.kr 로 제출 바랍니다.';
      const res = maskPrivacyInfo(input);

      expect(res.count).toBe(1);
      expect(res.types).toContain('이메일');
      expect(res.text).toContain('***@korea.kr');
    });

    it('날짜(2026-09-24) 등 정상 서식은 계좌번호로 오인하여 마스킹하지 않는다', () => {
      const input = '추진일자: 2026-09-24 회의 결과';
      const res = maskPrivacyInfo(input);

      expect(res.count).toBe(0);
      expect(res.text).toBe(input);
    });
  });

  describe('autoNumberAdminDraft', () => {
    it('일반 텍스트 줄들을 공문서 표준 번호 체계(1., 2., 3.)로 매긴다', () => {
      const input = '추진배경\n주요내용\n기대효과';
      const output = autoNumberAdminDraft(input);

      expect(output).toBe('1. 추진배경\n2. 주요내용\n3. 기대효과');
    });

    it('들여쓰기가 있는 줄은 하위 계층(가., 나.)으로 매긴다', () => {
      const input = '추진계획\n  사업개요\n  세부일정';
      const output = autoNumberAdminDraft(input);

      expect(output).toContain('1. 추진계획');
      expect(output).toContain('  가. 사업개요');
      expect(output).toContain('  나. 세부일정');
    });

    it('기존에 이미 번호가 매겨져 있는 경우 재정렬한다', () => {
      const input = '- 추진배경\n- 세부내용';
      const output = autoNumberAdminDraft(input);

      expect(output).toBe('1. 추진배경\n2. 세부내용');
    });
  });

  describe('buildTransformPrompt', () => {
    it('맞춤법 검사 프롬프트가 올바르게 생성된다', () => {
      const { systemPrompt, userPrompt } = buildTransformPrompt('spellcheck', '안녕하새요.');
      expect(systemPrompt).toContain('맞춤법');
      expect(userPrompt).toContain('안녕하새요.');
    });

    it('문장 다듬기 6대 모드가 모두 유효한 프롬프트를 생성한다', () => {
      const modes = ['shorten', 'expand', 'official', 'bullet', 'refine', 'courtesy'] as const;
      for (const m of modes) {
        const { systemPrompt, userPrompt } = buildTransformPrompt(m, '테스트 문장');
        expect(systemPrompt).toBeDefined();
        expect(userPrompt).toContain('테스트 문장');
      }
    });
  });
});
