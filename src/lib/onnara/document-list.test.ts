// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import {
  describeOpenFailure,
  extractStructuredDocumentList,
  findDocumentOpenTarget,
  sameDocumentTitle,
  openDocumentTarget,
  serializeDocumentList,
  isReceivedDocumentList,
  documentReadState,
} from './document-list';
import { commandTargets } from './commands';

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

it('명령 대상은 체크한 문서이고, "전체"를 붙이면 화면의 모든 문서다', () => {
  document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = true;
  const list = extractStructuredDocumentList()!;
  expect(commandTargets(list)).toEqual([list.rows[0]!.title]);
  expect(commandTargets(list, '전체')).toEqual(list.rows.map(row => row.title));
  document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked = false;
  expect(commandTargets(extractStructuredDocumentList()!)).toEqual([]);
  expect(findDocumentOpenTarget('감사결과 처분요구 이행실태 특정감사 자료 제출')?.tagName).toBe('A');
});

it('제목 링크는 클릭하고 일반 제목 셀은 더블클릭한다', () => {
  Element.prototype.scrollIntoView = () => undefined;
  const link = findDocumentOpenTarget('감사결과 처분요구 이행실태 특정감사 자료 제출')!;
  let clicked = false;
  link.addEventListener('click', event => { event.preventDefault(); clicked = true; });
  openDocumentTarget(link);
  expect(clicked).toBe(true);

  const cell = [...document.querySelectorAll<HTMLElement>('td')].find(element => element.textContent?.includes('제목에 |'))!;
  let doubled = false;
  cell.addEventListener('dblclick', () => { doubled = true; });
  openDocumentTarget(cell);
  expect(doubled).toBe(true);
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

it.each([
  // 숨은 전체 제목 입력이 없는 목록: 링크 글자가 제목 전체를 담지 않아 예전에는 제목 칸(td)을 더블클릭했다.
  ['제목 앞 표시가 링크 밖에 있음', '<span class="ico_auto">[auto]</span><a href="javascript:void(0)" onclick="openDoc()">감사원 감사자료 제출 요구</a>', false],
  // 표시도 링크라 제목 칸에 링크가 둘: 숨은 제목이 있어도 "링크가 하나일 때만" 고르던 규칙이 실패했다.
  ['표시도 링크임', '<a class="ico_auto" href="javascript:void(0)" onclick="autoInfo()">[auto]</a><a href="javascript:void(0)" onclick="openDoc()">감사원 감사자료 제출 요구</a>', true],
  ['제목 링크가 말줄임됨', '<span>[auto]</span><a href="javascript:void(0)" onclick="openDoc()">감사원 감사자료…</a>', true],
])('제목 칸에 [auto] 같은 표시가 붙어도 실제 제목 링크를 누른다 (%s)', (_case, cell, hiddenTitle) => {
  const hidden = hiddenTitle ? '<input type="hidden" name="chkDocTitle" value="[auto]감사원 감사자료 제출 요구">' : '';
  document.body.innerHTML = `<table>
    <tr><th>선택</th><th>제목</th><th>상태</th></tr>
    <tr><td><input type="checkbox">${hidden}</td><td>${cell}</td><td>접수</td></tr>
  </table>`;
  const target = findDocumentOpenTarget('[auto]감사원 감사자료 제출 요구');
  expect(target?.getAttribute('onclick')).toBe('openDoc()');
});

it('제목 칸에 누를 링크가 없으면 행에 걸린 열기 동작을 누른다', () => {
  document.body.innerHTML = `<table>
    <tr><th>선택</th><th>제목</th><th>상태</th></tr>
    <tr ondblclick="openDoc()"><td><input type="checkbox"></td><td><span>[auto]</span>감사원 감사자료 제출 요구</td><td>접수</td></tr>
  </table>`;
  expect(findDocumentOpenTarget('[auto]감사원 감사자료 제출 요구')?.tagName).toBe('TR');
});

it('sameDocumentTitle은 공백, 괄호/인용부호 및 접두사 차이가 있어도 올바르게 일치로 판별한다', () => {
  const title1 = '(조달청)「건설자재 조달관리시스템 이용약관」제정안 의견 조회';
  const title1WithSpace = '(조달청) 「건설자재 조달관리시스템 이용약관」제정안 의견 조회';
  const title1Fullwidth = '（조달청） "건설자재 조달관리시스템 이용약관" 제정안 의견 조회';
  expect(sameDocumentTitle(title1, title1WithSpace)).toBe(true);
  expect(sameDocumentTitle(title1, title1Fullwidth)).toBe(true);

  const title2 = '(조달청) 물품 공급입찰 무분별입찰 방지를 위한 수요기관 협조 요청';
  const title2WithPrefix = '[붙임] (조달청) 물품 공급입찰 무분별입찰 방지를 위한 수요기관 협조 요청';
  expect(sameDocumentTitle(title2, title2WithPrefix)).toBe(true);

  expect(sameDocumentTitle(title1, title2)).toBe(false);
});

/* ── 문서 열기 대상을 하나로 못 고르던 사례 ── */

it('머리글 앞에 숨은 행이 있어도 제목 열을 찾아 숨은 전체 제목으로 문서를 연다', () => {
  // 목록 위쪽의 검색 조건 행이 숨겨져 있으면 예전에는 제목 열 번호를 찾지 못해 열기에 실패했다.
  document.body.innerHTML = `<table>
    ${'<tr style="display:none"><td colspan="3">숨은 틀 행</td></tr>'.repeat(5)}
    <tr><th>선택</th><th>제목</th><th>상태</th></tr>
    <tr>
      <td><input type="checkbox" checked><input type="hidden" name="chkDocTitle" value="감사결과에 대한 재심의 신청 및 조치계획 보고"></td>
      <td><a href="javascript:void(0)" onclick="openDoc()">감사결과에 대한 재심의 신청 및 조치계…</a></td>
      <td>접수</td>
    </tr>
  </table>`;
  expect(extractStructuredDocumentList()?.selectedTitles).toEqual(['감사결과에 대한 재심의 신청 및 조치계획 보고']);
  expect(findDocumentOpenTarget('감사결과에 대한 재심의 신청 및 조치계획 보고')?.getAttribute('onclick')).toBe('openDoc()');
});

it('같은 제목이 여러 행에 있으면 사용자가 체크한 행을 연다', () => {
  document.body.innerHTML = `<table>
    <tr><th>선택</th><th>제목</th><th>상태</th></tr>
    <tr><td><input type="checkbox"></td><td><a onclick="openFirst()">감사결과에 대한 재심의 신청 및 조치계획 보고</a></td><td>반려</td></tr>
    <tr><td><input type="checkbox" checked></td><td><a onclick="openSecond()">감사결과에 대한 재심의 신청 및 조치계획 보고</a></td><td>접수</td></tr>
  </table>`;
  expect(findDocumentOpenTarget('감사결과에 대한 재심의 신청 및 조치계획 보고')?.getAttribute('onclick')).toBe('openSecond()');
});

it('제목이 서로 다른 문서에 걸치면 임의로 열지 않고 이유를 알려 준다', () => {
  document.body.innerHTML = `<table>
    <tr><th>선택</th><th>제목</th><th>상태</th></tr>
    <tr><td><input type="checkbox"></td><td><a onclick="openA()">감사결과에 대한 재심의 신청 및 조치계획 보고 1차</a></td><td>접수</td></tr>
    <tr><td><input type="checkbox"></td><td><a onclick="openB()">감사결과에 대한 재심의 신청 및 조치계획 보고 2차</a></td><td>접수</td></tr>
  </table>`;
  expect(findDocumentOpenTarget('감사결과에 대한 재심의 신청 및 조치계획 보고')).toBeNull();
  expect(describeOpenFailure('감사결과에 대한 재심의 신청 및 조치계획 보고')).toContain('제목이 겹치는 행이 2건');
});

it('목록에 없는 제목이면 현재 목록 제목을 예로 들어 안내한다', () => {
  const hint = describeOpenFailure('없는 문서 제목');
  expect(hint).toContain('일치하는 행이 없습니다');
  expect(hint).toContain('감사결과 처분요구 이행실태 특정감사 자료 제출');
});

it('작업 탭에서 제목이 더 짧게 줄어 보여도 같은 문서로 보고 연다', () => {
  // 복제한 작업 탭은 폭이 달라 목록 제목을 원본보다 짧게 줄여 그린다. 숨은 전체 제목이 없는 목록에서는
  // 글자가 정확히 같지 않아 예전에는 문서를 열지 못했다.
  document.body.innerHTML = `<table>
    <tr><th>선택</th><th>제목</th><th>상태</th></tr>
    <tr><td><input type="checkbox"></td><td><a onclick="openDoc()">감사결과에 대한 재심의 신청 및 조치계…</a></td><td>접수</td></tr>
  </table>`;
  expect(findDocumentOpenTarget('감사결과에 대한 재심의 신청 및 조치계획 보고')?.getAttribute('onclick')).toBe('openDoc()');
});


it('받은문서 화면을 목록 이름으로 가려내고, 열람 열을 상태 열과 섞지 않는다', () => {
  document.body.innerHTML = `
    <h2>받은문서</h2>
    <table>
      <tr><th>선택</th><th>보고일자</th><th>제목</th><th>열람상태</th><th>처리상태</th></tr>
      <tr><td><input type="checkbox"></td><td>2026.09.18</td><td><a>미열람 공문</a></td><td>미열람</td><td>접수</td></tr>
      <tr><td><input type="checkbox"></td><td>2026.09.17</td><td><a>이미 읽은 공문</a></td><td>열람</td><td>접수</td></tr>
    </table>`;
  const list = extractStructuredDocumentList()!;
  expect(isReceivedDocumentList(list)).toBe(true);
  expect(list.columns.map(column => column.key)).toContain('readState');
  expect(list.rows.map(documentReadState)).toEqual(['unread', 'read']);
});

it('열람 열이 없으면 상태 칸을 보되, 처리 단계를 열람으로 읽지 않는다', () => {
  expect(documentReadState({ status: '미열람' })).toBe('unread');
  expect(documentReadState({ status: '열람' })).toBe('read');
  // '미열람'은 '열람'을 포함한다. 부정 낱말을 먼저 가리지 않으면 전부 열람으로 집계된다.
  expect(documentReadState({ readState: '미열람', status: '열람' })).toBe('unread');
  expect(documentReadState({ status: '접수' })).toBe('unknown');
  expect(documentReadState({})).toBe('unknown');
});

it('받은문서가 아닌 목록은 접수함으로 인정하지 않는다', () => {
  document.body.innerHTML = `
    <h2>문서등록대장</h2>
    <table>
      <tr><th>보고일자</th><th>제목</th><th>부서</th></tr>
      <tr><td>2026.09.18</td><td><a>일반 공문</a></td><td>감사담당관</td></tr>
    </table>`;
  expect(isReceivedDocumentList(extractStructuredDocumentList())).toBe(false);
  expect(isReceivedDocumentList(null)).toBe(false);
});
