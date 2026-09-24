/**
 * 에디터 블록 지정(Selection) 텍스트 변환 및 다듬기 엔진.
 *
 * 1. 로컬 규칙 기반:
 *    - 개인정보 자동 마스킹 (주민번호, 휴대전화, 이메일, 계좌번호 등)
 *    - 공문서 항목 번호 자동 매기기 (1. -> 가. -> (1) 등)
 * 2. AI(로컬 Ollama) 기반:
 *    - 맞춤법 & 띄어쓰기 교정
 *    - 문장 다듬기 6대 모드 (줄이기, 늘리기, 공문서 표준 어투, 개조식, 행정용어 순화, 정중한 협조체)
 */

import { loadSettings } from '@/lib/storage/settings';
import { cleanAdminDraft } from './draft-cleaner';

export type PolishMode =
  | 'shorten'   // 내용 줄이기 (간결화)
  | 'expand'    // 내용 늘리기 (구체화/배경보강)
  | 'official'  // 공문서 표준 어투 (~코자 함, ~바람)
  | 'bullet'    // 개조식 변환 (- · 항목화)
  | 'refine'    // 쉬운 행정용어 순화
  | 'courtesy'; // 정중한 협조체

export type TransformAction = 'spellcheck' | PolishMode;

export interface PrivacyMaskResult {
  text: string;
  count: number;
  types: string[];
}

/** 개인정보 패턴 자동 탐지 및 마스킹 */
export function maskPrivacyInfo(input: string): PrivacyMaskResult {
  let text = input;
  let count = 0;
  const types: Set<string> = new Set();

  // 1. 주민등록번호 (예: 900101-1234567, 9001011234567, 020505-3456789)
  const rrnRegex = /\b(\d{6})[-.\s]?([1-8]\d{6})\b/g;
  text = text.replace(rrnRegex, (_match, front, back) => {
    count++;
    types.add('주민등록번호');
    const firstDigit = back.charAt(0);
    return `${front}-${firstDigit}******`;
  });

  // 2. 휴대전화번호 (예: 010-1234-5678, 01012345678, 011, 016, 017, 018, 019)
  const phoneRegex = /\b(01[016789])[-.\s]?(\d{3,4})[-.\s]?(\d{4})\b/g;
  text = text.replace(phoneRegex, (_match, p1, _p2, p3) => {
    count++;
    types.add('휴대전화번호');
    return `${p1}-****-${p3}`;
  });

  // 3. 이메일 주소 (예: user@example.go.kr)
  const emailRegex = /\b([A-Za-z0-9._%+-]{1,3})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
  text = text.replace(emailRegex, (_match, userPrefix, domain) => {
    count++;
    types.add('이메일');
    return `${userPrefix}***@${domain}`;
  });

  // 4. 일반 계좌번호 패턴 (예: 110-123-456789, 302-0123-4567-81)
  const accountRegex = /\b(\d{3,6})[-.\s](\d{2,6})[-.\s](\d{3,6}(?:[-.\s]\d{1,4})?)\b/g;
  text = text.replace(accountRegex, (match, p1, p2, p3) => {
    // 날짜 포맷(2026-09-24) 및 주민/전화번호와 겹치지 않도록 보호
    if (/^\d{4}-\d{2}-\d{2}$/.test(match) || /^\d{6}-\d{7}$/.test(match) || /^01[0-9]-\d{3,4}-\d{4}$/.test(match)) {
      return match;
    }
    count++;
    types.add('계좌번호');
    return `${p1}-****-${p3.replace(/\d/g, '*')}`;
  });

  // 5. 신용카드 번호 (16자리)
  const cardRegex = /\b(\d{4})[-.\s]?(\d{4})[-.\s]?(\d{4})[-.\s]?(\d{4})\b/g;
  text = text.replace(cardRegex, (_match, p1, _p2, _p3, p4) => {
    count++;
    types.add('카드번호');
    return `${p1}-****-****-${p4}`;
  });

  return {
    text,
    count,
    types: Array.from(types),
  };
}

/**
 * 대한민국 행정업무운영편람 기준 공문서 항목 번호 자동 부여/정렬.
 * 줄바꿈된 텍스트 각 줄에 계층별(1. -> 가. -> (1)) 번호 부여.
 */
export function autoNumberAdminDraft(input: string): string {
  const lines = input.split('\n');
  if (lines.length === 0) return input;

  let topIndex = 1;
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    const trimmed = rawLine.trim();

    if (!trimmed) {
      result.push('');
      continue;
    }

    // 이미 행정 항목 기호(1., 가., (1), -, · 등)로 시작하는지 검사
    const existingPrefix = trimmed.match(/^([0-9]+\.|[가-하]\.|\([0-9]+\)|\([가-하]\)|[0-9]+\)|[가-하]\)|[-·•])\s*/);
    const content = existingPrefix ? trimmed.slice(existingPrefix[0].length) : trimmed;

    // 들여쓰기 깊이 계산 (공백 2칸 또는 탭 1개를 1단계로 산정)
    const leadingSpaces = rawLine.match(/^\s*/)?.[0] || '';
    const indentLevel = Math.floor(leadingSpaces.replace(/\t/g, '  ').length / 2);

    if (indentLevel === 0) {
      result.push(`${topIndex}. ${content}`);
      topIndex++;
    } else if (indentLevel === 1) {
      // 2단계: 가., 나., 다. ...
      const subChars = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차'];
      const subIdx = Math.min(subChars.length - 1, (result.filter(r => r.trimStart().startsWith('가.') || r.trimStart().startsWith('나.')).length) % subChars.length);
      result.push(`  ${subChars[subIdx]}. ${content}`);
    } else if (indentLevel === 2) {
      // 3단계: (1), (2), (3) ...
      result.push(`    (1) ${content}`);
    } else {
      // 개조식 기호
      result.push(`      - ${content}`);
    }
  }

  return result.join('\n');
}

/**
 * 작업 유형별 AI 시스템 프롬프트 및 사용자 프롬프트 생성기.
 */
export function buildTransformPrompt(
  action: TransformAction,
  selectedText: string
): { systemPrompt: string; userPrompt: string } {
  const baseSystemPrompt =
    '당신은 대한민국 정부 공문서 작성 및 교정 전문가 AI입니다. 원문의 핵심 취지와 고유명사를 훼손하지 마십시오. 마크다운 특수기호(##, **, *, `, > 등)를 일체 사용하지 마십시오. 오직 교정·변환된 결과 문장 텍스트만을 출력하십시오.';

  switch (action) {
    case 'spellcheck':
      return {
        systemPrompt: `${baseSystemPrompt} 주어진 텍스트의 한글 맞춤법, 띄어쓰기, 표준어 규정 및 공문서 문장부호를 정확하게 교정하십시오.`,
        userPrompt: `다음 문장의 맞춤법과 띄어쓰기를 올바르게 교정해 주십시오:\n\n${selectedText}`,
      };

    case 'shorten':
      return {
        systemPrompt: `${baseSystemPrompt} 불필요한 중복 수식어, 군더더기 피동 표현을 제거하고 명확하고 간결한 핵심 단문으로 압축하십시오.`,
        userPrompt: `다음 문장의 군더더기를 없애고 핵심만 간결하게 압축해 주십시오:\n\n${selectedText}`,
      };

    case 'expand':
      return {
        systemPrompt: `${baseSystemPrompt} 핵심 키워드나 거친 메모 형태의 문장에 행정적 추진 배경, 근거, 기대효과를 보강하여 논리적으로 완성도 높은 공문서 문장으로 확장하십시오.`,
        userPrompt: `다음 문장에 행정적 배경과 타당성을 보강하여 구체적인 공문서 문장으로 확장해 주십시오:\n\n${selectedText}`,
      };

    case 'official':
      return {
        systemPrompt: `${baseSystemPrompt} 행정업무운영편람에 따라 정형화된 공문서 표준 어투(~코자 함, ~바람, ~통보함, ~알림 등)로 변환하십시오.`,
        userPrompt: `다음 문장을 행정 공문서 표준 어투(~코자 함, ~바람 등)로 변환해 주십시오:\n\n${selectedText}`,
      };

    case 'bullet':
      return {
        systemPrompt: `${baseSystemPrompt} 서술형 줄글 문장을 공문서 표준 개조식 항목 기호(-, ·)를 사용하여 명확하게 항목별로 분절 및 구조화하십시오.`,
        userPrompt: `다음 서술형 문장을 공문서 표준 개조식(-, ·) 형태로 요점화하여 변환해 주십시오:\n\n${selectedText}`,
      };

    case 'refine':
      return {
        systemPrompt: `${baseSystemPrompt} 국립국어원 공공언어 순화어 규정에 따라 어려운 한자어, 일본식 행정용어, 불필요한 외래어를 국민이 알기 쉬운 우리말 행정용어로 순화하십시오.`,
        userPrompt: `다음 문장에 포함된 어려운 한자어나 일본식 표현, 외래어를 알기 쉬운 공공언어 순화어로 바꿔 주십시오:\n\n${selectedText}`,
      };

    case 'courtesy':
      return {
        systemPrompt: `${baseSystemPrompt} 타 부처, 공공기관 또는 대외 기관에 발송하는 공문에 알맞게 정중하고 격식 있는 협조 어조로 변환하십시오.`,
        userPrompt: `다음 문장을 타 기관에 정중히 협조를 요청하는 격식 있는 공문서 문체로 변환해 주십시오:\n\n${selectedText}`,
      };
  }
}

/**
 * 로컬 Ollama 모델을 호출하여 텍스트를 변환합니다.
 */
export async function transformTextWithAI(
  action: TransformAction,
  selectedText: string,
  signal?: AbortSignal
): Promise<string> {
  const settings = await loadSettings();
  const { systemPrompt, userPrompt } = buildTransformPrompt(action, selectedText);

  const requestBody = {
    model: settings.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    stream: false,
    options: {
      temperature: 0.3, // 교정 및 다듬기는 정밀도를 위해 낮은 temperature 적용
    },
  };

  const response = await fetch(`${settings.endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama 통신 오류 (${response.status})`);
  }

  const json = await response.json();
  const rawOutput = json.message?.content || '';
  return cleanAdminDraft(rawOutput);
}
