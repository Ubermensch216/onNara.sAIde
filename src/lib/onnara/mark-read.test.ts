// @vitest-environment jsdom
/**
 * 받은문서 `읽기처리`.
 *
 * ★ 되돌릴 수 없는 동작이라, 무엇을 체크하고 무엇을 누르는지가 전부다.
 *   대상 외 문서가 함께 처리되지 않는지를 가장 먼저 본다.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { clickMarkedReadButton, findReadButton, markReadButton, prepareMarkRead, READ_BUTTON_MARK, READ_DIALOG_ATTR, readMarkReadDialogs, selectMarkReadRows } from './mark-read';

function list(extra = '') {
  document.body.innerHTML = `
    <div class="btns"><label><input type="checkbox" id="mine">내부서 조회</label>
      <button id="share">공람지정</button><a href="#" id="read" onclick="return false;"><span>읽기처리</span></a></div>
    <table>
      <tr><th><input type="checkbox" id="all"></th><th>보고일자</th><th>제목</th><th>부서</th><th>상태</th></tr>
      <tr><td><input type="checkbox" id="c1"></td><td>2026.09.22</td><td><a>2026년 하반기 자랑스런 공무원 선발계획 알림</a></td><td>감사담당관</td><td>담당확인</td></tr>
      <tr><td><input type="checkbox" id="c2" checked></td><td>2026.09.22</td><td><a>제111회 부산미래경제포럼 상시학습 인정 알림</a></td><td>감사담당관</td><td>접수</td></tr>
      <tr><td><input type="checkbox" id="c3"></td><td>2026.09.22</td><td><a>법원문서 통보(회생 등 10건)</a></td><td>감사담당관</td><td>담당확인</td></tr>
    </table>${extra}`;
}

const box = (id: string) => document.getElementById(id) as HTMLInputElement;

afterEach(() => { document.body.innerHTML = ''; sessionStorage.removeItem(READ_DIALOG_ATTR); });

it('대상 행만 체크하고, 사용자가 체크해 둔 다른 문서는 풀고, 버튼에 표지를 붙인다', () => {
  list();
  box('mine').checked = true;
  const prepared = prepareMarkRead(['법원문서 통보(회생 등 10건)']);

  expect(prepared).toEqual({ ok: true, checked: ['법원문서 통보(회생 등 10건)'], missing: [] });
  expect(box('c3').checked).toBe(true);
  // 함께 처리되면 되돌릴 수 없다.
  expect(box('c2').checked).toBe(false);
  expect(box('c1').checked).toBe(false);
  // 표 밖의 조회 조건 체크는 건드리지 않는다.
  expect(box('mine').checked).toBe(true);
  // 안쪽 span이 아니라 누를 수 있는 바깥 링크에 표지를 붙인다.
  expect(document.getElementById('read')!.hasAttribute(READ_BUTTON_MARK)).toBe(true);
});

it('목록 스크립트가 듣는 click 이벤트로 체크한다', () => {
  list();
  const heard = vi.fn();
  box('c1').addEventListener('click', heard);
  prepareMarkRead(['2026년 하반기 자랑스런 공무원 선발계획 알림']);
  expect(heard).toHaveBeenCalledTimes(1);
});

it('읽기처리 버튼이 없으면 아무것도 체크하지 않고 멈춘다', () => {
  list();
  document.getElementById('read')!.remove();
  const prepared = prepareMarkRead(['법원문서 통보(회생 등 10건)']);
  expect(prepared.ok).toBe(false);
  expect(box('c3').checked).toBe(false);
});

it('목록 프레임에 버튼이 없어도 대상 행을 체크하고 다른 프레임의 버튼을 표시할 수 있다', () => {
  list();
  document.getElementById('read')!.remove();
  expect(selectMarkReadRows(['법원문서 통보(회생 등 10건)'])).toMatchObject({ ok: true, checked: ['법원문서 통보(회생 등 10건)'] });
  expect(box('c3').checked).toBe(true);
  const toolbar = document.implementation.createHTMLDocument('상위 도구 모음');
  toolbar.body.innerHTML = '<button>읽기처리</button>';
  expect(markReadButton(toolbar)).toBe(true);
  expect(toolbar.querySelector(`[${READ_BUTTON_MARK}]`)).not.toBeNull();
});

it('같은 글자의 버튼이 둘이면 고르지 않는다', () => {
  list('<button>읽기처리</button>');
  expect(findReadButton()).toBeNull();
});

it('목록에 없는 문서는 missing으로 돌려준다', () => {
  list();
  const prepared = prepareMarkRead(['법원문서 통보(회생 등 10건)', '목록에 없는 전혀 다른 공문 제목']);
  expect(prepared).toMatchObject({ ok: true, missing: ['목록에 없는 전혀 다른 공문 제목'] });
});

it('버튼을 누르는 동안만 확인창을 수락하고, 뜬 글을 남긴다', () => {
  vi.useFakeTimers();
  try {
    list();
    prepareMarkRead(['법원문서 통보(회생 등 10건)']);
    const nativeConfirm = vi.fn(() => false);
    window.confirm = nativeConfirm;
    let answered: boolean | undefined;
    document.getElementById('read')!.addEventListener('click', () => {
      answered = window.confirm('선택한 문서를 읽기처리 하시겠습니까?');
      window.alert('읽기처리 되었습니다.');
    });

    expect(clickMarkedReadButton(READ_BUTTON_MARK, READ_DIALOG_ATTR)).toEqual({ clicked: true });
    expect(answered).toBe(true);
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(readMarkReadDialogs(READ_DIALOG_ATTR)).toEqual(['선택한 문서를 읽기처리 하시겠습니까?', '읽기처리 되었습니다.']);
    document.documentElement.removeAttribute(READ_DIALOG_ATTR);
    expect(readMarkReadDialogs(READ_DIALOG_ATTR)).toEqual(['선택한 문서를 읽기처리 하시겠습니까?', '읽기처리 되었습니다.']);
    // 표지는 한 번 쓰고 없앤다. 다음 요청이 옛 버튼을 누르지 않게 한다.
    expect(document.querySelector(`[${READ_BUTTON_MARK}]`)).toBeNull();

    vi.advanceTimersByTime(10_000);
    expect(window.confirm).toBe(nativeConfirm);
  } finally {
    vi.useRealTimers();
  }
});
