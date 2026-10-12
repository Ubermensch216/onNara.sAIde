/**
 * 눈치코치(Nunchi_Coach)로 넘기는 수집 꾸러미.
 *
 * ★ 꾸러미는 폴더 하나다 — 내려받은 본문·첨부와 그것들이 어느 공문의 무엇인지 적은 package.json.
 *   눈치코치는 그 폴더를 읽기만 한다(노트북 › 자료 추가 › 온나라 수집본 가져오기).
 *   규격의 기준 문서는 Nunchi_Coach `docs/온나라_연동_구현계획서_2026-10-12.md` §3이다.
 *
 * ★ 왜 파일을 직접 보내지 않는가.
 *   온나라 첨부의 대부분은 화면의 스크립트를 눌러야 받아지고(lib/onnara/attachments.ts),
 *   그 바이트는 브라우저가 디스크에 쓸 뿐 확장이 읽지 못한다. 그래서 파일은 다운로드 폴더에 두고
 *   여기서는 "어디에 무엇이 있는지"만 적는다.
 *
 * ★ 모르는 것은 모른다고 적는다.
 *   목록에서 읽을 수 있는 것은 제목·일자·부서·보고자·상태뿐이다. 온나라 문서 ID가 없으므로
 *   식별자는 목록 행으로 만들고 `id_basis: "list-row"`로 밝힌다. 글자로 만든 본문 PDF는
 *   `fidelity: "rendered-text"`다 — 원본과 같은 파일이 아니다.
 */

import type { AppError, AttachmentDownloadResult } from '@/lib/messaging/protocol';
import type { DocumentListField } from '@/lib/onnara/document-list';
import { sanitizeRoot } from '@/lib/downloads/naming';

export const PACKAGE_FORMAT = 'saide-onnara-package';
export const PACKAGE_VERSION = 1;
export const PACKAGE_FILE = 'package.json';

export type ListRow = Partial<Record<DocumentListField, string>>;

export interface PackageAsset {
  asset_id: string;
  role: 'body' | 'attachment';
  filename: string;
  /** 꾸러미 폴더 기준 상대 경로. 받지 못한 파일에는 없다. */
  path?: string;
  status: 'complete' | 'failed';
  fidelity?: 'original' | 'rendered-text' | 'extracted-text';
  /** 읽은 본문이 잘렸다. 받은 파일이지만 본문 전체가 아니다. */
  truncated?: true;
  message?: string;
}

export interface PackageDocument {
  document_id: string;
  id_basis: 'list-row';
  title: string;
  document_number: string;
  author_id: string;
  author_name: string;
  department: string;
  authored_at: string;
  status: string;
  assets: PackageAsset[];
}

export interface NunchiPackage {
  format: typeof PACKAGE_FORMAT;
  version: typeof PACKAGE_VERSION;
  run_id: string;
  created_at: string;
  exporter: { name: string; version: string };
  system: { origin: string; institution: string };
  scope: {
    kind: 'selection';
    list_name: string;
    author_ids: never[];
    author_names: never[];
    start_date: null;
    end_date: null;
    departments: string[];
  };
  listing: { total: null; finished: false };
  documents: PackageDocument[];
}

/** 한 문서의 다운로드 결과. `본문+첨부`로 받았으므로 files의 첫 항목이 본문이다. */
export interface ExportedDocument {
  title: string;
  row?: ListRow | undefined;
  files?: AttachmentDownloadResult[] | undefined;
  error?: AppError | undefined;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** 실행 ID. 폴더 이름이 되므로 영숫자와 밑줄만 쓴다. */
export function newRunId(now = new Date(), random = Math.random): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}_${time}_${Math.floor(random() * 0x10000).toString(16).padStart(4, '0')}`;
}

/** 다운로드 폴더 아래 꾸러미 폴더. */
export function packageRoot(runId: string): string {
  return sanitizeRoot(`onNara.sAIde/수집/${runId}`);
}

/** 목록의 일자 표기를 `YYYY-MM-DD`로. 읽지 못하면 빈 값 — 추정해 채우지 않는다. */
export function isoDate(value: string | undefined): string {
  if (!value) return '';
  const match = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/.exec(value);
  const digits = value.replace(/\D/g, '');
  const parts = match ? [match[1]!, match[2]!, match[3]!]
    : digits.length === 8 ? [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)] : null;
  if (!parts) return '';
  const [year, month, day] = parts.map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * 저장된 파일의 전체 경로를 꾸러미 폴더 기준 상대 경로로 바꾼다.
 *
 * ★ 꾸러미 폴더 밖에 저장됐으면 null이다. 브라우저가 "저장 위치를 매번 묻기"로 설정돼 있으면
 *   사용자가 다른 곳을 고를 수 있고, 눈치코치는 꾸러미 밖의 파일을 읽지 않는다.
 */
export function relativeToPackage(path: string | undefined, root: string): string | null {
  if (!path || !root) return null;
  const normalized = path.replace(/\\/g, '/');
  const marker = `/${root}/`;
  const at = normalized.lastIndexOf(marker);
  if (at < 0) return null;
  const relative = normalized.slice(at + marker.length);
  return relative && !relative.split('/').includes('..') ? relative : null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** 목록 행으로 만든 식별자. 같은 제목·일자·부서·보고자면 다시 내보내도 같은 값이다. */
export async function listRowId(fields: { title: string; date: string; department: string; reporter: string }): Promise<string> {
  const key = [fields.title, fields.date, fields.department, fields.reporter].map(part => part.trim()).join('\u0000');
  return `row-${(await sha256Hex(key)).slice(0, 24)}`;
}

function assetsOf(document: ExportedDocument, root: string): PackageAsset[] {
  return (document.files ?? []).map((file, index) => {
    const role = index === 0 ? 'body' as const : 'attachment' as const;
    const base = { asset_id: `a${index + 1}`, role, filename: file.name };
    if (file.status !== 'complete') {
      return { ...base, status: 'failed' as const, message: file.message ?? '다운로드가 끝나지 않았습니다.' };
    }
    const path = relativeToPackage(file.path, root);
    if (!path) return { ...base, status: 'failed' as const, message: '꾸러미 폴더 밖에 저장되었습니다.' };
    const fidelity = file.extractedText ? 'extracted-text' as const : file.generated ? 'rendered-text' as const : 'original' as const;
    return { ...base, path, status: 'complete' as const, fidelity, ...(file.truncated ? { truncated: true as const } : {}) };
  });
}

/** 목록 행 하나의 식별자(순번 없이). 꾸러미에 적히는 값과 눈치코치에 "이미 있나" 묻는 값이 같아야 한다. */
export function rowIdOf(title: string, row: ListRow | undefined): Promise<string> {
  return listRowId({ title, date: isoDate(row?.reportDate), department: row?.department ?? '', reporter: row?.reporter ?? '' });
}

export async function buildPackage(input: {
  runId: string;
  root: string;
  pageUrl: string;
  listName: string;
  extensionVersion: string;
  documents: ExportedDocument[];
  now?: Date;
}): Promise<NunchiPackage> {
  let origin = '';
  try { origin = new URL(input.pageUrl).origin; } catch { /* 주소를 읽지 못하면 비워 둔다 */ }

  const seen = new Map<string, number>();
  const documents: PackageDocument[] = [];
  for (const document of input.documents) {
    const row = document.row ?? {};
    const date = isoDate(row.reportDate);
    const base = await rowIdOf(document.title, document.row);
    // 같은 날 같은 제목의 문서가 둘이면 순번으로 가른다. 눈치코치는 중복 ID를 거절한다.
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    documents.push({
      document_id: count === 1 ? base : `${base}-${count}`,
      id_basis: 'list-row',
      title: document.title,
      document_number: '',
      author_id: '',
      author_name: row.reporter ?? '',
      department: row.department ?? '',
      authored_at: date,
      status: row.status ?? '',
      assets: assetsOf(document, input.root),
    });
  }

  return {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    run_id: input.runId,
    created_at: (input.now ?? new Date()).toISOString(),
    exporter: { name: 'onNara.sAIde', version: input.extensionVersion },
    system: { origin, institution: '' },
    scope: {
      kind: 'selection',
      list_name: input.listName,
      // ★ 체크한 문서가 곧 범위다. 작성자를 범위로 선언하면 보고자 칸이 빈 문서가
      //   눈치코치에서 "범위 밖"으로 빠진다. 작성자·기간은 받는 쪽이 문서에서 읽는다.
      author_ids: [],
      author_names: [],
      start_date: null,
      end_date: null,
      departments: [],
    },
    listing: { total: null, finished: false },
    documents,
  };
}

/** 내보낸 결과를 한 줄로. 도구 탭의 작업 기록에 남는다. */
export function describePackage(pkg: NunchiPackage): string {
  const assets = pkg.documents.flatMap(document => document.assets);
  const failed = assets.filter(asset => asset.status !== 'complete').length;
  const empty = pkg.documents.filter(document => !document.assets.some(asset => asset.role === 'body' && asset.status === 'complete')).length;
  const parts = [`문서 ${pkg.documents.length}건 · 파일 ${assets.length - failed}개`];
  if (failed) parts.push(`받지 못한 파일 ${failed}개`);
  if (empty) parts.push(`본문이 없는 문서 ${empty}건`);
  return parts.join(' · ');
}
