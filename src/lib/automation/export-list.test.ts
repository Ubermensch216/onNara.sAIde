// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { buildDocumentListCsv, csvCell, exportDocumentList, exportFileName, isListExportRequest } from './export-list';
import type { StructuredDocumentList } from '@/lib/onnara/document-list';

afterEach(() => vi.unstubAllGlobals());

const list: StructuredDocumentList = {
  kind: 'onnara-document-list', listName: '받은문서',
  columns: [{ key: 'title', label: '제목', sourceIndex: 2 }, { key: 'reportDate', label: '보고일자', sourceIndex: 1 }, { key: 'sender', label: '수(발)신자', sourceIndex: 4 }],
  rows: [
    { title: '(조달청) 물품 공급입찰, "무분별입찰" 방지', reportDate: '2026.09.17', sender: '조달청' },
    { title: '=HYPERLINK("http://x")', reportDate: '2026.09.16', sender: '+외부' },
  ],
  selectedTitles: ['(조달청) 물품 공급입찰, "무분별입찰" 방지'],
};

it('화면의 열 순서대로 CSV를 만들고, 엑셀용 BOM·선택 표시·따옴표 이스케이프를 넣는다', () => {
  const csv = buildDocumentListCsv(list);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv.slice(1).split('\r\n')).toEqual([
    '선택,보고일자,제목,수(발)신자',
    'Y,2026.09.17,"(조달청) 물품 공급입찰, ""무분별입찰"" 방지",조달청',
    `,2026.09.16,"'=HYPERLINK(""http://x"")",'+외부`,
    '',
  ]);
});

it('외부에서 온 값이 수식으로 실행되지 않게 막는다', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx']) expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
  expect(csvCell('일반 제목')).toBe('일반 제목');
});

it('파일 이름에 쓸 수 없는 문자를 바꾸고 시각을 붙인다', () => {
  expect(exportFileName('받은문서/기관:공지?', new Date(2026, 8, 17, 9, 5))).toBe('받은문서_기관_공지__20260917_0905.csv');
});

it('AI 대화에서 목록 내보내기 요청을 알아보되 표 보기 요청과는 구분한다', () => {
  expect(isListExportRequest('받은문서 목록을 엑셀로 내보내줘')).toBe(true);
  expect(isListExportRequest('문서 목록 CSV 파일로 저장해줘')).toBe(true);
  expect(isListExportRequest('받은문서 목록 제목을 표로 보여줘')).toBe(false);
  expect(isListExportRequest('선택한 문서 요약해줘')).toBe(false);
});

it('CSV를 브라우저 다운로드로 저장하고 완료된 경로를 기록한다', async () => {
  const download = vi.fn(async () => 42);
  const search = vi.fn(async () => [{ id: 42, state: 'complete', filename: 'C:\Downloads\받은문서.csv' }]);
  vi.stubGlobal('chrome', { downloads: { download, search } });
  URL.createObjectURL = vi.fn(() => 'blob:csv');
  URL.revokeObjectURL = vi.fn();
  const page = { url: 'https://onnara.test', title: '받은문서', text: '', charCount: 0, truncated: false, keptRatio: 1, estimatedTokens: 0, method: 'onnara-document-list' as const, extractedAt: 1, structuredData: list };
  const outcome = await exportDocumentList(page, new AbortController().signal);
  expect(download).toHaveBeenCalledWith(expect.objectContaining({ url: 'blob:csv', conflictAction: 'uniquify', saveAs: false, filename: expect.stringMatching(/^받은문서_\d{8}_\d{4}\.csv$/) }));
  expect(outcome).toMatchObject({ files: [{ status: 'complete', downloadId: 42, path: 'C:\Downloads\받은문서.csv' }], summary: expect.stringContaining('2건') });
  const noList = await exportDocumentList({ ...page, structuredData: undefined }, new AbortController().signal);
  expect(noList.error?.message).toContain('목록 표를 찾지 못했습니다');
});
