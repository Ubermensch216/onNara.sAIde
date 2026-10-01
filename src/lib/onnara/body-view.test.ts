// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findBodyViewButton } from './body-view';

function doc(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('findBodyViewButton', () => {
  it('문서카드 도구 모음에서 본문보기 버튼을 찾는다', () => {
    const found = findBodyViewButton(doc('<div class="btns"><a href="#" onclick="x()"><span>본문 보기</span></a><a href="#">문서정보</a></div>'));
    expect(found?.tagName).toBe('A');
  });

  it('이미지 버튼은 alt로 찾고 감싼 링크를 돌려준다', () => {
    const found = findBodyViewButton(doc('<a id="b" href="javascript:view()"><img alt="본문보기" src="b.gif"></a>'));
    expect(found?.id).toBe('b');
  });

  it('input 버튼의 value로 찾는다', () => {
    expect(findBodyViewButton(doc('<input type="button" id="v" value="본문보기">'))?.id).toBe('v');
  });

  it('기안기의 본문작성·숨은 버튼·긴 문장은 누르지 않는다', () => {
    expect(findBodyViewButton(doc('<button>본문작성</button>'))).toBeNull();
    expect(findBodyViewButton(doc('<div style="display:none"><button>본문보기</button></div>'))).toBeNull();
    expect(findBodyViewButton(doc('<td>본문보기를 누르면 문서의 본문이 새 창으로 열립니다</td>'))).toBeNull();
  });
});
