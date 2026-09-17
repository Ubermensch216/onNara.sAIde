/**
 * URL 비교 테스트.
 *
 * 이 판정이 느슨하면 이전 페이지 내용을 물고 답하고, 너무 빡빡하면
 * 새로고침만 해도 붙여 둔 페이지가 떨어진다. 양쪽 다 사용자를 혼란스럽게 한다.
 */

import { describe, expect, it } from 'vitest';
import { normalizeUrl, sameDocument, isRestrictedUrl } from './protocol';

describe('sameDocument', () => {
  it('완전히 같은 URL', () => {
    expect(sameDocument('https://a.com/x', 'https://a.com/x')).toBe(true);
  });

  it('해시만 다르면 같은 문서 (문서 내 이동)', () => {
    expect(sameDocument('https://a.com/x', 'https://a.com/x#top')).toBe(true);
    expect(sameDocument('https://a.com/x#a', 'https://a.com/x#b')).toBe(true);
  });

  it('★ 경로가 다르면 다른 문서', () => {
    expect(sameDocument('https://news.com/article/1', 'https://news.com/article/2')).toBe(false);
  });

  it('★ 쿼리가 다르면 다른 문서', () => {
    // aitimes 같은 형태: articleView.html?idxno=214086
    expect(sameDocument('https://a.com/v.html?id=1', 'https://a.com/v.html?id=2')).toBe(false);
  });

  it('호스트가 다르면 다른 문서', () => {
    expect(sameDocument('https://a.com/x', 'https://b.com/x')).toBe(false);
  });

  it('스킴이 다르면 다른 문서', () => {
    expect(sameDocument('http://a.com/x', 'https://a.com/x')).toBe(false);
  });

  it('잘못된 URL에서 터지지 않는다', () => {
    expect(sameDocument('', '')).toBe(true);
    expect(sameDocument('그냥 문자열', '그냥 문자열')).toBe(true);
    expect(sameDocument('그냥 문자열', '다른 문자열')).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('해시를 떼어낸다', () => {
    expect(normalizeUrl('https://a.com/x#frag')).toBe('https://a.com/x');
  });

  it('쿼리는 남긴다', () => {
    expect(normalizeUrl('https://a.com/x?q=1')).toBe('https://a.com/x?q=1');
  });
});

describe('isRestrictedUrl', () => {
  it('확장이 접근할 수 없는 페이지를 걸러낸다', () => {
    for (const u of ['chrome://extensions', 'about:blank', 'https://chromewebstore.google.com/x']) {
      expect(isRestrictedUrl(u), u).toBe(true);
    }
  });

  it('일반 웹페이지는 통과', () => {
    expect(isRestrictedUrl('https://www.aitimes.com/news/articleView.html?idxno=1')).toBe(false);
  });

  it('undefined는 제한으로 본다', () => {
    expect(isRestrictedUrl(undefined)).toBe(true);
  });
});
