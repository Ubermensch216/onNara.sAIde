/**
 * 공문서 서식 템플릿 모델 및 내장 표준 서식 정의.
 *
 * 업무보고, 기본 계획서, 구축 계획서, 언론 보도 등 공공기관 표준 공문서 유형별
 * 주요 필수 항목과 작성 지침을 정의하고 영속화 및 프롬프트 생성에 사용한다.
 */

export type DocumentType =
  | '업무보고'
  | '기본 계획서'
  | '구축 계획서'
  | '언론 보도'
  | '기타';

export const DOCUMENT_TYPES: DocumentType[] = [
  '업무보고',
  '기본 계획서',
  '구축 계획서',
  '언론 보도',
  '기타',
];

export interface DraftTemplate {
  id: string;
  title: string;              // 서식 명칭 (예: "표준 업무보고 서식")
  documentType: DocumentType | string; // 문서 유형
  description: string;        // 서식 설명
  sections: string[];         // 유형에 따른 주요 항목 목록 (예: ['1. 보고 배경 및 목적', ...])
  guidance?: string;          // 항목 작성 시 준수할 특화 지침
  isBuiltin?: boolean;        // 기본 탑재 서식 여부
  createdAt: number;
  updatedAt: number;
}

/** 문서 유형별 추천 기본 주요 항목 목록 (서식 신규 등록 시 추천 항목으로 활용) */
export const RECOMMENDED_SECTIONS_BY_TYPE: Record<string, string[]> = {
  '업무보고': [
    '1. 보고 배경 및 목적',
    '2. 주요 추진 실적 및 현황',
    '3. 당면 과제 및 문제점',
    '4. 향후 추진 계획 및 일정',
    '5. 건의 및 협조 요청사항',
  ],
  '기본 계획서': [
    '1. 추진 배경 및 필요성',
    '2. 관련 현황 및 문제점 분석',
    '3. 기본 방향 및 중점 추진 목표',
    '4. 분야별 세부 추진 과제',
    '5. 소요 예산 및 재원 조달 방안',
    '6. 향후 추진 일정 및 기대 효과',
  ],
  '구축 계획서': [
    '1. 사업(구축) 개요 및 목표',
    '2. 현행 시스템 분석 및 개선 방향',
    '3. 목표 시스템 구성 및 세부 구축 내용',
    '4. 소요 예산 산출 내역 및 인력 투입 계획',
    '5. 세부 사업 추진 일정 (WBS)',
    '6. 위험 관리 방안 및 기대 효과',
  ],
  '언론 보도': [
    '1. 보도 요지 및 핵심 성과 (헤드라인 요약)',
    '2. 추진 배경 및 도입 목적',
    '3. 주요 발표 내용 및 핵심 수혜/혜택',
    '4. 향후 추진 일정 및 기대 효과',
    '5. 부서 담당자 및 문의처 (참고)',
  ],
  '기타': [
    '1. 추진 배경 및 목적',
    '2. 주요 내용',
    '3. 향후 조치 계획',
  ],
};

/** 내장 표준 서식 4종 */
export const BUILTIN_TEMPLATES: DraftTemplate[] = [
  {
    id: 'builtin-work-report',
    title: '표준 업무보고 서식',
    documentType: '업무보고',
    description: '주요 현안, 업무 실적 및 향후 계획을 보고하는 공문서 표준 서식',
    sections: [
      '1. 보고 배경 및 목적',
      '2. 주요 추진 실적 및 현황',
      '3. 당면 과제 및 문제점',
      '4. 향후 추진 계획 및 일정',
      '5. 건의 및 협조 요청사항',
    ],
    guidance: '객관적 사실과 수치 중심의 개조식(~함, ~음)으로 기술하며, 문제점에 대한 실효성 있는 대응방안을 포함하십시오.',
    isBuiltin: true,
    createdAt: 1774300000000,
    updatedAt: 1774300000000,
  },
  {
    id: 'builtin-basic-plan',
    title: '표준 기본 계획서 서식',
    documentType: '기본 계획서',
    description: '신규 사업 및 정책의 기본 방향과 종합 추진 전략을 수립하는 공문서 서식',
    sections: [
      '1. 추진 배경 및 필요성',
      '2. 관련 현황 및 문제점 분석',
      '3. 기본 방향 및 중점 추진 목표',
      '4. 분야별 세부 추진 과제',
      '5. 소요 예산 및 재원 조달 방안',
      '6. 향후 추진 일정 및 기대 효과',
    ],
    guidance: '정책적 타당성과 추진 목표를 명확히 하고, 단계별 로드맵과 구체적인 성과 지표(정량/정성)를 제시하십시오.',
    isBuiltin: true,
    createdAt: 1774300000000,
    updatedAt: 1774300000000,
  },
  {
    id: 'builtin-build-plan',
    title: '표준 정보시스템·인프라 구축 계획서 서식',
    documentType: '구축 계획서',
    description: '정보시스템 및 디지털 인프라 신규 구축 또는 기능 개선 사업 계획을 수립하는 서식',
    sections: [
      '1. 사업(구축) 개요 및 목표',
      '2. 현행 시스템 분석 및 개선 방향',
      '3. 목표 시스템 구성 및 세부 구축 내용',
      '4. 소요 예산 산출 내역 및 인력 투입 계획',
      '5. 세부 사업 추진 일정 (WBS)',
      '6. 위험 관리 방안 및 기대 효과',
    ],
    guidance: '아키텍처 및 도입 기술 규격을 명확히 하고, 개발 공정 관리 및 보안·품질 위험 관리 방안을 구체화하십시오.',
    isBuiltin: true,
    createdAt: 1774300000000,
    updatedAt: 1774300000000,
  },
  {
    id: 'builtin-press-release',
    title: '표준 언론 보도자료 서식',
    documentType: '언론 보도',
    description: '대국민 정책 홍보 및 언론 배포를 위한 보도자료 표준 공문 서식',
    sections: [
      '1. 보도 요지 및 핵심 성과 (헤드라인 요약)',
      '2. 추진 배경 및 도입 목적',
      '3. 주요 발표 내용 및 핵심 수혜/혜택',
      '4. 향후 추진 일정 및 기대 효과',
      '5. 부서 담당자 및 문의처 (참고)',
    ],
    guidance: '대국민 전달력을 높이기 위해 전문 행정용어를 알기 쉽게 순화하고, 육하원칙과 두괄식 핵심 메시지를 부각하십시오.',
    isBuiltin: true,
    createdAt: 1774300000000,
    updatedAt: 1774300000000,
  },
];

/**
 * 서식의 주요 항목 목록을 AI 프롬프트 주입용 텍스트로 형식화한다.
 */
export function formatTemplatePrompt(template: DraftTemplate): string {
  const lines: string[] = [
    `[적용 서식: ${template.title} (문서 유형: ${template.documentType})]`,
  ];
  if (template.description) {
    lines.push(`- 서식 설명: ${template.description}`);
  }
  if (template.guidance) {
    lines.push(`- 서식 특화 지침: ${template.guidance}`);
  }
  lines.push('- 필수 구성 항목 (반드시 아래 항목 순서와 체계에 맞춰 각 항목별 내용을 빠짐없이 작성하십시오):');
  for (const sec of template.sections) {
    lines.push(`  ${sec}`);
  }
  return lines.join('\n');
}

/**
 * 서식의 주요 항목들을 사용자가 메모 입력창에 바로 활용할 수 있도록 개요 골격 텍스트로 변환한다.
 */
export function generateTemplateOutline(template: DraftTemplate): string {
  return template.sections
    .map((sec) => `${sec}\n- `)
    .join('\n\n');
}
