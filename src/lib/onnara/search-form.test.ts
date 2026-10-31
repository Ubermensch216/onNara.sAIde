// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { fillDocumentSearchForm } from './search-form';

it('문서등록대장 검색 폼의 라벨을 찾아 조건을 채우고 조회 버튼은 누르지 않는다', () => {
  let submitted = false;
  document.body.innerHTML = `
    <form id="searchForm">
      <table>
        <tr>
          <th>등록일자</th>
          <td>
            <input type="text" name="bgnDe" title="검색시작일" value="">
            ~
            <input type="text" name="endDe" title="검색종료일" value="">
          </td>
          <th>문서구분</th>
          <td>
            <select name="docType">
              <option value="">전체</option>
              <option value="PROD">생산</option>
              <option value="RECV">접수</option>
            </select>
          </td>
        </tr>
        <tr>
          <th><label for="drafterInput">기안자</label></th>
          <td><input id="drafterInput" type="text" value=""></td>
          <th>기안부서</th>
          <td><input name="deptNm" type="text" value=""></td>
        </tr>
        <tr>
          <th>단위과제</th>
          <td><input name="taskCardNm" type="text" value=""></td>
          <th>제목</th>
          <td><input name="searchWrd" type="text" value=""></td>
        </tr>
      </table>
      <button type="button" id="searchBtn">검색</button>
    </form>
  `;
  document.getElementById('searchBtn')!.addEventListener('click', () => {
    submitted = true;
  });

  const result = fillDocumentSearchForm({
    authorName: '홍길동',
    department: '기획과',
    startDate: '2024-01-01',
    endDate: '2025-12-31',
    keyword: '적극행정',
    taskCard: '적극행정 추진',
    docType: '생산',
  });

  expect(result.missing).toEqual([]);
  expect(result.filled.sort()).toEqual(
    ['authorName', 'department', 'docType', 'endDate', 'keyword', 'startDate', 'taskCard'].sort(),
  );
  expect((document.getElementById('drafterInput') as HTMLInputElement).value).toBe('홍길동');
  expect((document.querySelector('input[name="deptNm"]') as HTMLInputElement).value).toBe('기획과');
  expect((document.querySelector('input[name="bgnDe"]') as HTMLInputElement).value).toBe('2024-01-01');
  expect((document.querySelector('input[name="endDe"]') as HTMLInputElement).value).toBe('2025-12-31');
  expect((document.querySelector('input[name="searchWrd"]') as HTMLInputElement).value).toBe('적극행정');
  expect((document.querySelector('input[name="taskCardNm"]') as HTMLInputElement).value).toBe('적극행정 추진');
  expect((document.querySelector('select[name="docType"]') as HTMLSelectElement).value).toBe('PROD');
  expect(submitted).toBe(false);
  expect(result.message).toContain('[검색/조회] 버튼을 누른 뒤');
});
