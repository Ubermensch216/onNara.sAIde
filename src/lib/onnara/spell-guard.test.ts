import { describe, expect, it } from 'vitest';
import { guardSpellcheckResult, normalizeSpellText } from './spell-guard';
import { composeFromSegments, computeDiffSegments } from './text-diff';

const ORIGINAL = [
  '1. 보고 배경 및 목적',
  '가. 글로벌 해양수도 부산의 매력을 알리고 관광객에게 감똥과 즐거움을 제공하고자 「제21회 부산불꽃축제」를 개최함.',
  '',
  '2. 주요 추진 실적 및 현황',
  '가. 「제21회 부산불꽃축제 실행계획」을 근거로 행사 개요를 확정함.',
].join('\n');

describe('guardSpellcheckResult (맞춤법 교정 결과 보호)', () => {
  it('AI가 소제목을 지워도 원문 소제목은 그대로 남고, 고친 글자만 반영된다', () => {
    const ai = [
      '가. 글로벌 해양수도 부산의 매력을 알리고 관광객에게 감동과 즐거움을 제공하고자 「제21회 부산불꽃축제」를 개최함.',
      '가. 「제21회 부산불꽃축제 실행계획」을 근거로 행사 개요를 확정함.',
    ].join('\n');
    const out = guardSpellcheckResult(ORIGINAL, ai);
    const lines = out.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('1. 보고 배경 및 목적');
    expect(lines[1]).toContain('감동과');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('2. 주요 추진 실적 및 현황');
  });

  it('항목 기호·들여쓰기는 원문 것을 쓰고, AI가 덧붙인 줄은 버린다', () => {
    const original = '  - 행사 일시는 오후 7시 부터 운영함.';
    const ai = '- 행사 일시는 오후 7시부터 운영함.\n※ 참고: 우천 시 연기될 수 있음.';
    expect(guardSpellcheckResult(original, ai)).toBe('  - 행사 일시는 오후 7시부터 운영함.');
  });

  it('내용이 크게 바뀐(요약·확장된) 줄은 교정하지 않고 원문을 남긴다', () => {
    const original = '가. 관련 기관(부서)에서는 실행계획에 의거하여 자체 지원계획 및 안전관리대책을 수립 및 시행하여 협조함.';
    const ai = '가. 관련 기관에서는 실행계획에 의거하여 협조함.';
    expect(guardSpellcheckResult(original, ai)).toBe(original);
  });

  it('조합형 한글·보이지 않는 문자는 정규화해 같은 글자를 교정으로 보지 않는다', () => {
    const nfd = '감동과'.normalize('NFD') + '​';
    expect(normalizeSpellText(nfd)).toBe('감동과');
  });
});

describe('교정 항목 단위 제외', () => {
  it('제외한 항목만 원문으로 되돌린다', () => {
    const segs = computeDiffSegments('감똥과 즐거움을 제공', '감동과 즐거움을 재공');
    const changes = segs.filter((s) => s.kind === 'change');
    expect(changes).toHaveLength(2);
    expect(composeFromSegments(segs, new Set())).toBe('감동과 즐거움을 재공');
    const second = changes[1]!;
    expect(second.kind === 'change' && composeFromSegments(segs, new Set([second.id]))).toBe('감동과 즐거움을 제공');
  });
});
