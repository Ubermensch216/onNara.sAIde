/**
 * @vitest-environment jsdom
 *
 * 마크다운 sanitize 테스트. 계획서 §7 추가 방어
 *
 * ★ 이건 보안 테스트다. 모델은 웹페이지 본문을 읽고 그 내용을 답변에 그대로
 *   되뱉을 수 있다. 페이지에 심어진 `javascript:` 링크나 `<img onerror>`가
 *   그 경로로 사이드패널 안에서 실행되면 확장 권한 아래에서 돌게 된다.
 */

import { describe, expect, it } from 'vitest';
import { extractCodeBlocks, renderMarkdown } from './markdown';

describe('renderMarkdown — sanitize', () => {
  it('script 태그를 제거한다', () => {
    const html = renderMarkdown('안녕 <script>alert(1)</script> 하세요');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('이벤트 핸들러 속성을 제거한다', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert');
  });

  it('javascript: 링크를 제거한다', () => {
    // 모델이 페이지에서 이런 링크를 읽어 그대로 재출력하는 경우
    const html = renderMarkdown('[클릭](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
  });

  it('data: URI 링크를 제거한다', () => {
    const html = renderMarkdown('[클릭](data:text/html;base64,PHNjcmlwdD4=)');
    expect(html).not.toContain('data:text/html');
  });

  it('iframe을 제거한다', () => {
    const html = renderMarkdown('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('일반 https 링크는 살린다', () => {
    const html = renderMarkdown('[문서](https://example.com/docs)');
    expect(html).toContain('https://example.com/docs');
  });

  it('정상 마크다운 서식을 보존한다', () => {
    const html = renderMarkdown('**굵게** *기울임* `코드`\n\n- 첫째\n- 둘째');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<code>');
    expect(html).toContain('<li>');
  });

  it('표를 렌더한다 (GFM)', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>');
  });

  it('빈 입력에서 터지지 않는다', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('한국어를 깨뜨리지 않는다', () => {
    const html = renderMarkdown('로컬 LLM은 데이터를 밖으로 보내지 않습니다.');
    expect(html).toContain('로컬 LLM은 데이터를 밖으로 보내지 않습니다.');
  });
});

describe('extractCodeBlocks', () => {
  it('언어와 코드를 뽑아낸다', () => {
    const blocks = extractCodeBlocks('설명\n\n```ts\nconst a = 1;\n```\n\n끝');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ lang: 'ts', code: 'const a = 1;' });
  });

  it('여러 블록을 순서대로 뽑는다', () => {
    const blocks = extractCodeBlocks('```js\na\n```\n텍스트\n```py\nb\n```');
    expect(blocks.map((b) => b.lang)).toEqual(['js', 'py']);
  });

  it('언어 표시가 없어도 처리한다', () => {
    const blocks = extractCodeBlocks('```\nplain\n```');
    expect(blocks[0]!.lang).toBe('');
  });

  it('스트리밍 중 닫히지 않은 펜스도 뽑는다', () => {
    // 생성 도중에는 ```가 아직 안 닫힌 상태로 들어온다
    const blocks = extractCodeBlocks('```ts\nconst a = ');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code).toBe('const a = ');
  });
});
