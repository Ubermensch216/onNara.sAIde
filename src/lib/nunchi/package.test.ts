/**
 * 눈치코치 꾸러미 (lib/nunchi/package.ts).
 *
 * ★ 여기서 지키는 것.
 *   ① 꾸러미 폴더 밖의 파일은 꾸러미에 "받은 파일"로 실리지 않는다.
 *   ② 모르는 것을 지어내지 않는다 — 읽지 못한 일자는 빈 값, 글자로 만든 본문은 원본이 아니다.
 *   ③ package.fixture.json은 눈치코치(Nunchi_Coach `tests/fixtures/saide_package_v1.json`)가
 *      같은 내용으로 시험하는 두 저장소의 공통 계약이다. 규격을 바꾸면 두 파일을 함께 바꾼다.
 */

import { describe, expect, it } from 'vitest';
import { normalizedAttachmentPath } from '@/lib/downloads/naming';
import fixture from './package.fixture.json';
import { buildPackage, describePackage, isoDate, listRowId, newRunId, packageRoot, relativeToPackage } from './package';

const ROOT = packageRoot('20261012_153000_4f2a');
const DOWNLOADS = 'C:\\Users\\tester\\Downloads';
const saved = (relative: string) => `${DOWNLOADS}\\${ROOT.replace(/\//g, '\\')}\\${relative.replace(/\//g, '\\')}`;

describe('실행 ID와 폴더', () => {
  it('폴더 이름으로 쓸 수 있는 글자만 쓴다', () => {
    const id = newRunId(new Date(2026, 9, 12, 15, 30, 0), () => 0.31);
    expect(id).toBe('20261012_153000_4f5c');
    expect(packageRoot(id)).toBe('onNara.sAIde/수집/20261012_153000_4f5c');
  });

  it('★ 받는 파일은 꾸러미 폴더 아래 문서별 폴더에 모인다', () => {
    const path = normalizedAttachmentPath('붙임1.hwpx', { docTitle: '2025년 실적 보고', reportDate: '2025. 9. 1.', folder: true, rename: false, root: ROOT });
    expect(path).toBe('onNara.sAIde/수집/20261012_153000_4f2a/20250901_2025년 실적 보고/붙임1.hwpx');
  });

  it('★ 기준 폴더로 상위 경로를 만들 수 없다', () => {
    const path = normalizedAttachmentPath('붙임.hwp', { docTitle: '제목', folder: true, rename: false, root: '../../Windows/..' });
    expect(path.split('/')).not.toContain('..');
    expect(path.startsWith('Windows/')).toBe(true);
  });
});

describe('일자', () => {
  it('목록에 보이는 표기를 읽는다', () => {
    expect(isoDate('2025. 9. 1.')).toBe('2025-09-01');
    expect(isoDate('2025-09-01 14:20')).toBe('2025-09-01');
    expect(isoDate('20250901')).toBe('2025-09-01');
  });

  it('★ 읽지 못하면 비워 둔다', () => {
    expect(isoDate('어제')).toBe('');
    expect(isoDate('2025.13.1')).toBe('');
    expect(isoDate(undefined)).toBe('');
  });
});

describe('저장 경로', () => {
  it('꾸러미 폴더 기준 상대 경로로 바꾼다', () => {
    expect(relativeToPackage(saved('20250901_제목/붙임1.hwpx'), ROOT)).toBe('20250901_제목/붙임1.hwpx');
  });

  it('★ 꾸러미 폴더 밖에 저장된 파일은 받지 않은 것으로 본다', () => {
    expect(relativeToPackage('D:\\다른 곳\\붙임1.hwpx', ROOT)).toBeNull();
    expect(relativeToPackage(undefined, ROOT)).toBeNull();
  });
});

describe('꾸러미', () => {
  const build = () => buildPackage({
    runId: '20261012_153000_4f2a', root: ROOT, pageUrl: 'http://onnara.invalid/bms/list.do?page=1', listName: '기록물등록대장',
    extensionVersion: '0.1.0', now: new Date('2026-10-12T06:30:00.000Z'),
    documents: [
      {
        title: '2025년 실적 보고',
        row: { title: '2025년 실적 보고', reportDate: '2025. 9. 1.', department: '기획과', reporter: '홍길동', status: '결재완료' },
        files: [
          { name: '2025년 실적 보고_본문.pdf', status: 'complete', downloadId: 1, path: saved('20250901_2025년 실적 보고/download.pdf'), generated: true },
          { name: '붙임1.hwpx', status: 'complete', downloadId: 2, path: saved('20250901_2025년 실적 보고/붙임1.hwpx') },
          { name: '붙임2.xlsx', status: 'failed', message: '다운로드가 중단되었습니다.' },
          { name: '붙임3.pdf', status: 'complete', downloadId: 4, path: 'D:\\다른 곳\\붙임3.pdf' },
        ],
      },
      { title: '열지 못한 문서', row: { title: '열지 못한 문서', reportDate: '2025-10-02' }, error: { code: 'TIMEOUT', message: '문서를 열지 못했습니다.' } },
      {
        title: '글자로 받은 문서',
        row: { title: '글자로 받은 문서', reportDate: '2025-10-03', department: '기획과', reporter: '홍길동' },
        files: [{ name: '글자로 받은 문서_본문.md', status: 'complete', downloadId: 5, path: saved('20251003_글자로 받은 문서/download.md'), extractedText: true, truncated: true }],
      },
    ],
  });

  it('★ 화면에서 읽은 글자는 원본도 PDF도 아니라고 밝히고, 잘렸으면 잘렸다고 남긴다', async () => {
    const asset = (await build()).documents[2]!.assets[0];
    expect(asset).toEqual({
      asset_id: 'a1', role: 'body', filename: '글자로 받은 문서_본문.md', path: '20251003_글자로 받은 문서/download.md',
      status: 'complete', fidelity: 'extracted-text', truncated: true,
    });
  });

  it('★ 두 저장소의 공통 계약과 같은 모양이다', async () => {
    expect(await build()).toEqual(fixture);
  });

  it('첫 파일이 본문이고, 글자로 만든 본문은 원본이라고 하지 않는다', async () => {
    const [document] = (await build()).documents;
    expect(document!.assets.map(asset => asset.role)).toEqual(['body', 'attachment', 'attachment', 'attachment']);
    expect(document!.assets[0]).toMatchObject({ status: 'complete', fidelity: 'rendered-text' });
    expect(document!.assets[1]).toMatchObject({ status: 'complete', fidelity: 'original' });
  });

  it('★ 받지 못한 파일을 지우지 않고 사유와 함께 남긴다', async () => {
    const pkg = await build();
    expect(pkg.documents[0]!.assets[2]).toEqual({ asset_id: 'a3', role: 'attachment', filename: '붙임2.xlsx', status: 'failed', message: '다운로드가 중단되었습니다.' });
    expect(pkg.documents[0]!.assets[3]).toMatchObject({ status: 'failed', message: '꾸러미 폴더 밖에 저장되었습니다.' });
    expect(pkg.documents[1]!.assets).toEqual([]);
    expect(describePackage(pkg)).toBe('문서 3건 · 파일 3개 · 받지 못한 파일 2개 · 본문이 없는 문서 1건');
  });

  it('문서 ID가 없다는 것을 밝히고, 같은 행이면 같은 식별자를 만든다', async () => {
    const first = await build();
    const second = await build();
    expect(first.documents.map(document => document.id_basis)).toEqual(['list-row', 'list-row', 'list-row']);
    expect(first.documents.map(document => document.document_id)).toEqual(second.documents.map(document => document.document_id));
    expect(first.documents[0]!.document_id).toBe(await listRowId({ title: '2025년 실적 보고', date: '2025-09-01', department: '기획과', reporter: '홍길동' }));
  });

  it('같은 날 같은 제목의 문서 둘은 서로 다른 식별자를 갖는다', async () => {
    const row = { title: '주간 보고', reportDate: '2025-09-01' };
    const pkg = await buildPackage({
      runId: 'r', root: ROOT, pageUrl: 'http://onnara.invalid/', listName: '', extensionVersion: '0',
      documents: [{ title: '주간 보고', row }, { title: '주간 보고', row }],
    });
    const [a, b] = pkg.documents.map(document => document.document_id);
    expect(b).toBe(`${a}-2`);
  });
});
