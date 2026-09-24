import { describe, it, expect } from 'vitest';
import {
  BUILTIN_TEMPLATES,
  RECOMMENDED_SECTIONS_BY_TYPE,
  formatTemplatePrompt,
  generateTemplateOutline,
  type DraftTemplate,
} from './draft-templates';
import { buildReferencePrompt } from './related-info';

describe('draft-templates', () => {
  it('기본 4종 표준 서식(업무보고, 기본 계획서, 구축 계획서, 언론 보도)이 누락 없이 제공된다', () => {
    const types = BUILTIN_TEMPLATES.map((t) => t.documentType);
    expect(types).toContain('업무보고');
    expect(types).toContain('기본 계획서');
    expect(types).toContain('구축 계획서');
    expect(types).toContain('언론 보도');

    // 각 서식별 필수 항목이 3개 이상 정의되어 있어야 함
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.sections.length).toBeGreaterThanOrEqual(3);
      expect(t.title).toBeTruthy();
      expect(t.description).toBeTruthy();
    }
  });

  it('업무보고 서식은 보고 배경, 추진 실적, 향후 계획 등 필수 주요 항목을 포함한다', () => {
    const reportTpl = BUILTIN_TEMPLATES.find((t) => t.documentType === '업무보고');
    expect(reportTpl).toBeDefined();
    expect(reportTpl?.sections.some((s) => s.includes('보고 배경'))).toBe(true);
    expect(reportTpl?.sections.some((s) => s.includes('추진 실적'))).toBe(true);
    expect(reportTpl?.sections.some((s) => s.includes('향후 추진 계획'))).toBe(true);
  });

  it('기본 계획서 서식은 추진 배경, 세부 추진 과제, 소요 예산 등 필수 항목을 포함한다', () => {
    const planTpl = BUILTIN_TEMPLATES.find((t) => t.documentType === '기본 계획서');
    expect(planTpl).toBeDefined();
    expect(planTpl?.sections.some((s) => s.includes('추진 배경'))).toBe(true);
    expect(planTpl?.sections.some((s) => s.includes('세부 추진'))).toBe(true);
    expect(planTpl?.sections.some((s) => s.includes('소요 예산'))).toBe(true);
  });

  it('구축 계획서 서식은 시스템 구성, 구축 일정(WBS), 위험 관리 항목을 포함한다', () => {
    const buildTpl = BUILTIN_TEMPLATES.find((t) => t.documentType === '구축 계획서');
    expect(buildTpl).toBeDefined();
    expect(buildTpl?.sections.some((s) => s.includes('시스템'))).toBe(true);
    expect(buildTpl?.sections.some((s) => s.includes('추진 일정'))).toBe(true);
    expect(buildTpl?.sections.some((s) => s.includes('위험 관리'))).toBe(true);
  });

  it('언론 보도 서식은 보도 요지, 주요 발표 내용, 담당자/문의처 항목을 포함한다', () => {
    const pressTpl = BUILTIN_TEMPLATES.find((t) => t.documentType === '언론 보도');
    expect(pressTpl).toBeDefined();
    expect(pressTpl?.sections.some((s) => s.includes('보도 요지'))).toBe(true);
    expect(pressTpl?.sections.some((s) => s.includes('주요 발표 내용'))).toBe(true);
    expect(pressTpl?.sections.some((s) => s.includes('문의처'))).toBe(true);
  });

  it('문서 유형별 추천 주요 항목 세트(RECOMMENDED_SECTIONS_BY_TYPE)를 제공한다', () => {
    expect((RECOMMENDED_SECTIONS_BY_TYPE['업무보고'] ?? []).length).toBeGreaterThan(0);
    expect((RECOMMENDED_SECTIONS_BY_TYPE['기본 계획서'] ?? []).length).toBeGreaterThan(0);
    expect((RECOMMENDED_SECTIONS_BY_TYPE['구축 계획서'] ?? []).length).toBeGreaterThan(0);
    expect((RECOMMENDED_SECTIONS_BY_TYPE['언론 보도'] ?? []).length).toBeGreaterThan(0);
  });

  it('formatTemplatePrompt는 서식명과 주요 항목 순서를 지시문에 정확히 포맷팅한다', () => {
    const sampleTpl: DraftTemplate = {
      id: 'test-1',
      title: '테스트 서식',
      documentType: '업무보고',
      description: '테스트 설명',
      sections: ['1. 배경', '2. 실적', '3. 계획'],
      guidance: '수치 중심 작성',
      createdAt: 1000,
      updatedAt: 1000,
    };

    const formatted = formatTemplatePrompt(sampleTpl);
    expect(formatted).toContain('적용 서식: 테스트 서식');
    expect(formatted).toContain('문서 유형: 업무보고');
    expect(formatted).toContain('1. 배경');
    expect(formatted).toContain('2. 실적');
    expect(formatted).toContain('3. 계획');
    expect(formatted).toContain('수치 중심 작성');
  });

  it('generateTemplateOutline은 메모 입력창에 넣을 목차 개요를 생성한다', () => {
    const sampleTpl: DraftTemplate = {
      id: 'test-2',
      title: '테스트 서식 2',
      documentType: '기본 계획서',
      description: '',
      sections: ['1. 개요', '2. 세부내용'],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const outline = generateTemplateOutline(sampleTpl);
    expect(outline).toBe('1. 개요\n- \n\n2. 세부내용\n- ');
  });

  it('buildReferencePrompt에 지정 서식이 주어지면 항목 순서와 작성 지침이 프롬프트에 주입된다', () => {
    const sampleTpl: DraftTemplate = {
      id: 'test-3',
      title: '디지털 혁신 기본 계획서 서식',
      documentType: '기본 계획서',
      description: '부서 디지털 전환 계획 수립',
      sections: ['1. 추진 배경 및 필요성', '2. 세부 추진 과제', '3. 소요 예산'],
      guidance: '연도별 예산 투입 계획을 명시할 것',
      createdAt: 1000,
      updatedAt: 1000,
    };

    const prompt = buildReferencePrompt({
      userPrompt: 'AI 업무자동화 확산 추진 계획 작성해줘',
      docTitle: '2026 공공 AI 추진계획',
      template: sampleTpl,
    });

    expect(prompt).toContain('공문 제목: 2026 공공 AI 추진계획');
    expect(prompt).toContain('[지정된 공문서 서식 및 구성 항목]');
    expect(prompt).toContain('적용 서식명: 디지털 혁신 기본 계획서 서식');
    expect(prompt).toContain('문서 유형: 기본 계획서');
    expect(prompt).toContain('1. 추진 배경 및 필요성');
    expect(prompt).toContain('2. 세부 추진 과제');
    expect(prompt).toContain('3. 소요 예산');
    expect(prompt).toContain('연도별 예산 투입 계획을 명시할 것');
    expect(prompt).toContain('AI 업무자동화 확산 추진 계획 작성해줘');
    expect(prompt).toContain('대한민국 행정업무운영편람의 표준 서식');
  });
});
