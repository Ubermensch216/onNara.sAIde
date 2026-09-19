// @vitest-environment jsdom
/**
 * 탭 사이를 건너뛰는 링크 테스트.
 *
 * ★ 만드는 쪽(panelLink)·읽는 쪽(parsePanelLink)·통과시키는 쪽(renderMarkdown의 sanitize)
 *   셋이 모두 같은 문법을 봐야 한다. 하나라도 어긋나면 링크가 **조용히** 사라진다 —
 *   화면에는 밑줄 없는 글자만 남아 무엇이 잘못됐는지 알 수 없다. 그 셋을 여기서 묶어 확인한다.
 */

import { describe, expect, it } from 'vitest';
import { panelLink, parsePanelLink, type PanelLink } from './links';
import { renderMarkdown } from '@/lib/markdown';

const ALL: PanelLink[] = [
  { tab: 'schedule' },
  { tab: 'schedule', taskId: 1 },
  { tab: 'schedule', taskId: 987654321 },
  { tab: 'schedule', cursor: '2026-05-01', mode: 'month' },
  { tab: 'schedule', cursor: '2026-09-19', mode: 'day' },
  { tab: 'schedule', cursor: '2026-09-13', mode: 'week' },
  { tab: 'schedule', cursor: '2026-09-13', mode: 'list' },
  { tab: 'automation' },
  { tab: 'automation', jobId: '0b8e1c2a-1111-4222-8333-abcdefabcdef' },
];

describe('panelLink / parsePanelLink', () => {
  it('★ 만든 링크는 모두 그대로 되읽힌다', () => {
    for (const target of ALL) {
      expect(parsePanelLink(panelLink(target)), JSON.stringify(target)).toEqual(target);
    }
  });

  it('주소 모양을 고정한다', () => {
    expect(panelLink({ tab: 'schedule', taskId: 12 })).toBe('#saide-goto=schedule:task:12');
    expect(panelLink({ tab: 'schedule', cursor: '2026-05-01', mode: 'month' }))
      .toBe('#saide-goto=schedule:date:2026-05-01:month');
    expect(panelLink({ tab: 'automation', jobId: 'abc-123' })).toBe('#saide-goto=tools:job:abc-123');
  });

  it('우리가 만든 형태가 아니면 읽지 않는다', () => {
    for (const href of [
      null, undefined, '', '#', 'https://example.test',
      '#saide-download=open:5',
      '#saide-goto=',
      '#saide-goto=evil',
      '#saide-goto=schedule:task:x',
      '#saide-goto=schedule:task:1;rm',
      '#saide-goto=schedule:date:2026-5-1:month',
      '#saide-goto=schedule:date:2026-05-01:zzz',
      '#saide-goto=tools:job:',
      'x#saide-goto=schedule',
    ]) {
      expect(parsePanelLink(href), String(href)).toBeNull();
    }
  });
});

describe('sanitize 통과', () => {
  /*
   * ★ renderMarkdown의 허용 목록은 화이트리스트다. 새 링크 형태를 추가하고 목록에 넣지
   *   않으면 DOMPurify가 href를 통째로 지워, 답변에 글자만 남고 누를 수 없게 된다.
   */
  it('★ 만든 링크는 모두 마크다운 렌더를 거쳐도 살아남는다', () => {
    for (const target of ALL) {
      const href = panelLink(target);
      const html = renderMarkdown(`[보기](${href})`);
      expect(html, href).toContain(`href="${href}"`);
    }
  });

  it('실행 가능한 스킴과 엉뚱한 조각 주소는 여전히 막는다', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('javascript:');
    expect(renderMarkdown('[x](#saide-goto=evil)')).not.toContain('href="#saide-goto=evil"');
    // 다운로드 링크는 그대로 통과해야 한다(lib/downloads/links.ts).
    expect(renderMarkdown('[x](#saide-download=open:5)')).toContain('href="#saide-download=open:5"');
  });
});
