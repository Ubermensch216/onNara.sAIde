// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { captureDocumentListLocation, restoreDocumentListLocation } from './document-navigation';
import { findDocumentOpenTarget } from './document-list';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

function list() {
  document.body.innerHTML = `<form method="post">
    <input name="pageIndex" value="3"><input name="searchText" value="감사">
    <input type="password" name="password" value="secret">
    <input type="submit" name="accept" value="접수">
    <input type="checkbox" name="unchecked" value="1">
    <select name="department"><option value="audit" selected>감사과</option></select>
    <table><tr><th>선택</th><th>제목</th><th>상태</th></tr>
      <tr><td><input type="checkbox" name="chkDocId" value="doc-123" checked>
        <input type="hidden" name="chkDocTitle" value="감사자료 제출 요청 전체 제목"></td>
        <td><a href="javascript:void(0)">감사자료 제출…</a></td><td>접수</td></tr>
    </table></form>`;
}

it('숨긴 전체 제목이 체크박스 셀에 있어도 제목 열의 생략된 링크를 찾는다', () => {
  list();
  document.querySelector<HTMLInputElement>('input[name="chkDocTitle"]')!.value = '감사자료\u200b 제출 요청 전체 제목';
  expect(findDocumentOpenTarget('감사자료 제출 요청 전체 제목')?.tagName).toBe('A');
});

it('원본 조회 조건만 저장하고 선택 문서 ID·비밀번호·실행 버튼은 재전송하지 않는다', () => {
  list();
  const click = vi.fn(); document.querySelector('a')!.addEventListener('click', click);
  expect(captureDocumentListLocation('감사자료 제출 요청 전체 제목')).toEqual({
    url: location.href, framePath: [],
    form: { method: 'post', fields: [['pageIndex', '3'], ['searchText', '감사'], ['department', 'audit']] },
  });
  expect(click).not.toHaveBeenCalled();
});

it('다른 처리 endpoint를 가리키는 폼은 조회 조건 재전송에 사용하지 않는다', () => {
  list();
  document.querySelector('form')!.action = '/accept-document';
  expect(captureDocumentListLocation('감사자료 제출 요청 전체 제목')?.form).toBeUndefined();
});

it('복제한 목록 iframe에 조회 조건을 POST하고 임시 폼을 제거한다', () => {
  document.body.innerHTML = '<iframe name="_MAIN"></iframe>';
  const submitted: Array<{ action: string; target: string; method: string; fields: unknown[] }> = [];
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
    submitted.push({ action: this.action, target: this.target, method: this.method, fields: [...new FormData(this).entries()] });
  });
  expect(restoreDocumentListLocation({ url: 'https://onnara.test/list', framePath: [0], form: { method: 'post', fields: [['pageIndex', '3'], ['query', '감사']] } })).toBe(true);
  expect(submitted).toEqual([{ action: 'https://onnara.test/list', target: '_MAIN', method: 'post', fields: [['pageIndex', '3'], ['query', '감사']] }]);
  expect(document.querySelector('form')).toBeNull();
});

it('부모 프레임이 아직 없으면 복원을 실행하지 않는다', () => {
  const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
  expect(restoreDocumentListLocation({ url: 'https://onnara.test/list', framePath: [0, 1] })).toBe(false);
  expect(restoreDocumentListLocation({ url: 'https://onnara.test/list', framePath: [0] })).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});

it('프레임 순서가 바뀌어도 이름으로 복원하고 GET 주소의 쿼리를 보존한다', () => {
  document.body.innerHTML = '<iframe name="menu"></iframe><iframe name="_MAIN"></iframe>';
  const submissions: unknown[] = [];
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
    submissions.push({ target: this.target, fields: [...new FormData(this).entries()] });
  });
  expect(restoreDocumentListLocation({ url: 'https://onnara.test/list?box=received&page=1', framePath: [0], frameName: '_MAIN', form: { method: 'get', fields: [['page', '3']] } })).toBe(true);
  expect(submissions).toEqual([{ target: '_MAIN', fields: [['page', '3'], ['box', 'received']] }]);
});
