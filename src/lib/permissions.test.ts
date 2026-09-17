/**
 * 호스트 권한 패턴 테스트.
 *
 * 패턴이 틀리면 권한 대화상자가 뜨긴 하는데 executeScript는 계속 실패한다 —
 * 사용자 입장에서는 "허용했는데도 안 된다"가 되어 원인을 짚기 어렵다.
 */

import { describe, expect, it } from 'vitest';
import { originPatternFor } from './permissions';

describe('originPatternFor', () => {
  it('경로와 쿼리를 떼고 호스트 전체 패턴을 만든다', () => {
    // 실제로 실패했던 URL
    expect(originPatternFor('https://www.aitimes.com/news/articleView.html?idxno=214086')).toBe(
      'https://www.aitimes.com/*',
    );
  });

  it('http도 지원한다', () => {
    expect(originPatternFor('http://example.com/a/b')).toBe('http://example.com/*');
  });

  it('포트가 있어도 호스트만 쓴다', () => {
    // 권한 패턴에 포트를 넣으면 매치되지 않는다
    expect(originPatternFor('http://localhost:3000/page')).toBe('http://localhost/*');
  });

  it('서브도메인은 별개로 취급한다', () => {
    expect(originPatternFor('https://a.example.com/')).toBe('https://a.example.com/*');
    expect(originPatternFor('https://b.example.com/')).toBe('https://b.example.com/*');
  });

  it('해시와 인증정보를 무시한다', () => {
    expect(originPatternFor('https://example.com/x#frag')).toBe('https://example.com/*');
  });

  it('http/https가 아니면 null', () => {
    // 권한을 요청해도 의미가 없는 스킴들
    expect(originPatternFor('chrome://extensions')).toBeNull();
    expect(originPatternFor('file:///C:/a.html')).toBeNull();
    expect(originPatternFor('about:blank')).toBeNull();
    expect(originPatternFor('chrome-extension://abc/page.html')).toBeNull();
  });

  it('잘못된 URL에서 터지지 않는다', () => {
    expect(originPatternFor('')).toBeNull();
    expect(originPatternFor('그냥 문자열')).toBeNull();
  });

  it('한글 도메인을 punycode로 정규화한다', () => {
    // URL이 알아서 변환한다. 그대로 두면 패턴이 매치되지 않는다.
    const p = originPatternFor('https://한글도메인.kr/page');
    expect(p).toMatch(/^https:\/\/xn--/);
    expect(p?.endsWith('/*')).toBe(true);
  });
});
