// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import {
  buildDocumentTitleTable,
  extractStructuredDocumentList,
  isDocumentListTableRequest,
  serializeDocumentList,
} from './document-list';

beforeEach(() => {
  document.body.innerHTML = `
    <h2>받은문서</h2>
    <table id="noise"><tr><th>이름</th><th>값</th></tr><tr><td>A</td><td>B</td></tr></table>
    <table id="documents">
      <thead><tr><th></th><th>보고일자</th><th>제목</th><th>부서</th><th>수(발)신자</th><th>보고자</th><th>상태</th></tr></thead>
      <tbody>
        <tr><td><input type="checkbox"></td><td>2026.09.16</td><td><a>감사결과 처분요구 이행실태 특정감사 자료 제출</a></td><td>감사담당관</td><td>부산광역시</td><td>서주영</td><td>접수</td></tr>
        <tr><td><input type="checkbox"></td><td>2026.09.15</td><td>제목에 | 기호가 있는 문서</td><td>감사담당관</td><td>해운대구</td><td>서주영</td><td>접수</td></tr>
      </tbody>
    </table>`;
});

it('받은문서 표의 헤더와 모든 표시 행을 구조화한다', () => {
  const list = extractStructuredDocumentList();
  expect(list).toMatchObject({
    kind: 'onnara-document-list',
    listName: '받은문서',
    rows: [
      { reportDate: '2026.09.16', title: '감사결과 처분요구 이행실태 특정감사 자료 제출', department: '감사담당관' },
      { reportDate: '2026.09.15', title: '제목에 | 기호가 있는 문서' },
    ],
  });
  expect(serializeDocumentList(list!)).toContain('현재 화면 표시 문서: 2건');
});

it('사용자 요청을 판별하고 Markdown 안전한 제목 표를 만든다', () => {
  const prompt = '받은문서 메뉴에 리스트업된 모든 문서의 제목을 읽어서 테이블로 만들어줘.';
  expect(isDocumentListTableRequest(prompt)).toBe(true);
  const answer = buildDocumentTitleTable(prompt, extractStructuredDocumentList()!);
  expect(answer).toContain('| 1 | 감사결과 처분요구 이행실태 특정감사 자료 제출 |');
  expect(answer).toContain('| 2 | 제목에 \\| 기호가 있는 문서 |');
  expect(answer).toContain('현재 화면에 렌더링된 목록 기준');
});
