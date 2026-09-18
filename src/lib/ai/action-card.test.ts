// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { renderMarkdown } from '@/lib/markdown';
import { evidenceFound, findDates, findDueDates, parseActionCard, renderActionCard } from './action-card';

const source = [
  '제목 2026년 제2회 고충상담원 역량강화 워크숍 개최 알림 및 참석자 명단 제출 요청',
  '1. 고충상담원의 상담 역량 강화를 위하여 워크숍을 다음과 같이 개최합니다.',
  '가. 일시: 2026. 10. 14.(수) 14:00~17:00',
  '나. 장소: 시청 12층 대회의실',
  '2. 참석자 명단을 붙임 서식에 작성하여 2026. 9. 30.(수)까지 감사담당관으로 제출하여 주시기 바랍니다.',
  '3. 문의: 감사담당관 김OO(051-888-0000)',
].join('\n');

it('공문식 날짜를 찾고 항목 번호는 날짜로 오인하지 않는다', () => {
  expect(findDates(source).map(date => [date.year, date.month, date.day])).toEqual([[2026, 10, 14], [2026, 9, 30]]);
  expect(findDates('1. 2. 3. 항목')).toEqual([]);
  expect(findDates('9월 30일까지')[0]).toMatchObject({ month: 9, day: 30 });
});

it('원문의 "…까지" 기한만 골라낸다', () => {
  expect(findDueDates(source).map(date => [date.month, date.day])).toEqual([[9, 30]]);
});

it('근거 문장이 원문에 있는지 공백·문장부호와 무관하게 대조한다', () => {
  expect(evidenceFound('참석자 명단을 붙임 서식에 작성하여 2026. 9. 30.(수)까지 감사담당관으로 제출', source)).toBe(true);
  expect(evidenceFound('10월 2일까지 공보관실로 회신', source)).toBe(false);
});

it('모델 JSON을 검증해 확인된 값과 원문에 없는 값을 구분하고, 빠뜨린 기한을 코드로 보완한다', () => {
  const card = parseActionCard(JSON.stringify({
    summary: '워크숍 개최를 알리고 참석자 명단 제출을 요청함',
    actions: [
      { task: '참석자 명단 작성·제출', evidence: '참석자 명단을 붙임 서식에 작성하여 2026. 9. 30.(수)까지 감사담당관으로 제출하여 주시기 바랍니다.' },
      { task: '예산 집행 결과 보고', evidence: '예산 집행 결과를 보고하시기 바랍니다.' },
    ],
    deliverables: ['참석자 명단(붙임 서식)'],
    deadlines: [{ date: '2026. 10. 2.', what: '명단 제출', evidence: '없는 문장' }],
    contact: '감사담당관 김OO(051-888-0000)',
  }))!;
  const md = renderActionCard('워크숍 알림', card, source);
  // 사용자가 보는 글자로 확인한다(마크다운이 날짜를 번호 목록으로 바꾸지 않았는지까지).
  const view = document.createElement('div');
  view.innerHTML = renderMarkdown(md);
  const shown = view.textContent ?? '';
  expect(shown).toContain('참석자 명단 작성·제출 (원문 확인)');
  expect(shown).toContain('예산 집행 결과 보고 (원문에서 찾지 못함)');
  expect(shown).toContain('2026. 10. 2. · 명단 제출 (날짜를 원문에서 찾지 못함)');
  expect(view.querySelectorAll('ol')).toHaveLength(0);
  // 모델이 9월 30일을 빠뜨렸으므로 코드가 원문에서 찾아 넣는다.
  expect(shown).toMatch(/2026\. 9\. 30\.\(수\) · 원문의 기한 문장: .*AI가 빠뜨려 코드가 찾음/);
  expect(md).toContain('**근거 문장**');
  expect(md).not.toContain('예산 집행 결과를 보고하시기');
});

it('JSON이 아니거나 항목이 비면 안전하게 처리한다', () => {
  expect(parseActionCard('요약: 워크숍')).toBeNull();
  const empty = parseActionCard('{"summary":"단순 알림","actions":[],"deliverables":[],"deadlines":[],"contact":""}')!;
  const md = renderActionCard('알림', empty, '통계 결과를 알립니다. 별도 회신은 필요하지 않습니다.');
  expect(md).toContain('단순 알림일 수 있음');
  expect(md).toContain('**문의처** 본문에 없음');
});
