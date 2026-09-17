/**
 * 페이지 유형 추론 테스트. 계획서 §9 / Phase 4-5
 *
 * 제안은 지름길일 뿐이므로 틀려도 치명적이지 않다. 다만 **목록에서 빼면 안 된다** —
 * 추론이 틀렸을 때 사용자가 원하는 버튼을 못 찾게 된다. 그 불변식을 고정한다.
 */

import { describe, expect, it } from 'vitest';
import { detectPageKind, kindHint, suggestedOrder } from './pagetype';
import { PAGE_PRESETS } from '@/lib/prompts/presets';

describe('detectPageKind', () => {
  it('영상 사이트', () => {
    expect(detectPageKind('https://www.youtube.com/watch?v=abc')).toBe('video');
    expect(detectPageKind('https://youtu.be/abc')).toBe('video');
    expect(detectPageKind('https://vimeo.com/12345')).toBe('video');
  });

  it('코드 사이트', () => {
    expect(detectPageKind('https://github.com/a/b')).toBe('code');
    expect(detectPageKind('https://stackoverflow.com/questions/1')).toBe('code');
    expect(detectPageKind('https://developer.mozilla.org/ko/docs/Web')).toBe('code');
  });

  it('소스 파일 확장자', () => {
    expect(detectPageKind('https://example.com/src/main.ts')).toBe('code');
    expect(detectPageKind('https://example.com/a/b.py')).toBe('code');
  });

  it('문서 확장자와 기사 경로', () => {
    expect(detectPageKind('https://example.com/paper.pdf')).toBe('doc');
    expect(detectPageKind('https://www.aitimes.com/news/articleView.html')).toBe('doc');
    expect(detectPageKind('https://blog.example.com/posts/hello')).toBe('doc');
  });

  it('유사 도메인을 영상으로 오인하지 않는다', () => {
    // youtube.com.evil.com 같은 경우
    expect(detectPageKind('https://youtube.com.evil.com/x')).toBe('unknown');
    expect(detectPageKind('https://notyoutube.com/watch')).toBe('unknown');
  });

  it('서브도메인은 인정한다', () => {
    expect(detectPageKind('https://m.youtube.com/watch?v=a')).toBe('video');
    expect(detectPageKind('https://gist.github.com/a')).toBe('code');
  });

  it('잘못된 URL에서 터지지 않는다', () => {
    expect(detectPageKind('')).toBe('unknown');
    expect(detectPageKind('그냥 문자열')).toBe('unknown');
  });
});

describe('suggestedOrder', () => {
  it('★ 어떤 유형에서도 프리셋을 빼지 않는다 — 순서만 바꾼다', () => {
    const ids = PAGE_PRESETS.map((p) => p.id).sort();
    for (const kind of ['video', 'code', 'doc', 'unknown'] as const) {
      expect([...suggestedOrder(kind)].sort(), kind).toEqual(ids);
    }
  });

  it('영상에서는 화면 캡처를 앞으로 끌어올린다', () => {
    // 자막이 없는 영상에서는 화면을 보는 편이 낫다
    const video = suggestedOrder('video');
    const doc = suggestedOrder('doc');
    expect(video.indexOf('screen')).toBeLessThan(doc.indexOf('screen'));
  });

  it('모든 유형에서 요약이 첫 번째다', () => {
    for (const kind of ['video', 'code', 'doc', 'unknown'] as const) {
      expect(suggestedOrder(kind)[0]).toBe('summary');
    }
  });
});

describe('kindHint', () => {
  it('영상·코드에만 안내를 준다', () => {
    expect(kindHint('video')).toBeTruthy();
    expect(kindHint('code')).toBeTruthy();
    expect(kindHint('doc')).toBeNull();
    expect(kindHint('unknown')).toBeNull();
  });
});
