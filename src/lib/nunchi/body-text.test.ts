/**
 * 꾸러미의 본문 글자 파일 (lib/nunchi/body-text.ts).
 *
 * ★ 여기서 지키는 것.
 *   ① 머리말이 깨지지 않는다 — 제목에 `:`·`#`·따옴표·줄바꿈이 있어도 한 줄의 값이다.
 *   ② 끝까지 읽지 못한 본문을 전체인 것처럼 싣지 않는다.
 *   ③ 긴 한글 본문이 주소로 옮겨져도 글자가 그대로다.
 */

import { describe, expect, it } from 'vitest';
import { bodyMarkdown, markdownDataUrl } from './body-text';

const NOW = new Date('2026-10-12T06:30:00.000Z');

describe('본문 글자 파일', () => {
  it('어디서 언제 읽었는지 머리말에 적고 본문을 그대로 싣는다', () => {
    const markdown = bodyMarkdown({
      title: '2025년 실적 보고', reportDate: '2025. 9. 1.', sourceUrl: 'http://onnara.invalid/bms/view.do?docid=1',
      text: '  1. 제출기한: 2025-09-30\n2. 예산 820백만원  ', truncated: false, charCount: 31, now: NOW,
    });
    expect(markdown).toBe([
      '---',
      'title: "2025년 실적 보고"',
      'report_date: "2025. 9. 1."',
      'source_url: "http://onnara.invalid/bms/view.do?docid=1"',
      'retrieved_at: "2026-10-12T06:30:00.000Z"',
      'origin: "onNara.sAIde 화면 추출"',
      'char_count: 31',
      'truncated: false',
      '---',
      '',
      '# 2025년 실적 보고',
      '',
      '1. 제출기한: 2025-09-30\n2. 예산 820백만원',
      '',
    ].join('\n'));
  });

  it('★ 잘린 본문은 잘렸다고 적는다', () => {
    const markdown = bodyMarkdown({ title: '긴 문서', text: '앞부분', truncated: true, charCount: 250_000, now: NOW });
    expect(markdown).toContain('truncated: true');
    expect(markdown).toContain('char_count: 250000');
    expect(markdown).not.toContain('report_date');
    expect(markdown).not.toContain('source_url');
  });

  it('★ 제목의 기호와 줄바꿈이 머리말을 깨지 않는다', () => {
    const markdown = bodyMarkdown({ title: '회신: "예산" # 1차\n---\ntruncated: true', text: '본문', truncated: false, charCount: 2, now: NOW });
    const header = markdown.slice(0, markdown.indexOf('\n---\n', 4)).split('\n');
    expect(header[1]).toBe('title: "회신: \\"예산\\" # 1차\\n---\\ntruncated: true"');
    expect(header.filter(line => line.startsWith('truncated:'))).toEqual(['truncated: false']);
    expect(markdown).toContain('\n# 회신: "예산" # 1차 --- truncated: true\n');
  });
});

describe('주소로 옮기기', () => {
  it('★ 긴 한글 본문도 글자가 그대로 돌아온다', () => {
    const markdown = bodyMarkdown({ title: '긴 문서', text: '가나다라마바사 😀 '.repeat(20_000), truncated: false, charCount: 200_000, now: NOW });
    const url = markdownDataUrl(markdown);
    expect(url.startsWith('data:text/markdown;charset=utf-8;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), char => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(markdown);
  });
});
