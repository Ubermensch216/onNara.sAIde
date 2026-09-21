/**
 * 전체 백업과 복원.
 *
 * ★ 왜 필요한가. 확장의 저장소는 **확장 ID에 묶여 있다.** 언팩 확장의 ID는 압축을 푼
 *   폴더 경로에서 나오고, 확장을 제거하면 브라우저가 저장소를 함께 지운다. 코드가
 *   아무것도 지우지 않아도 사용자는 폴더를 옮기거나 제거 후 재설치하는 것만으로
 *   일정과 대화를 통째로 잃는다. 그 길을 코드로 막을 수는 없으므로, **되돌릴 수단**을 둔다.
 *
 * ★ 무엇을 담는가. chrome.storage.local 전량과 Dexie의 모든 표다. 담을 키 목록을 적어 두지
 *   않는 이유는 빠뜨림 때문이다 — 새 기능이 키를 하나 늘릴 때마다 이 파일을 고쳐야 한다면
 *   언젠가 잊고, 그 기능만 조용히 백업에서 빠진다. 대신 **빼야 할 것만** 적는다.
 *
 * ★ 복원은 덮어쓰기다. 합치기가 아니다. `++id` 자동 증가 표를 두 벌 합치면 같은 id가
 *   부딪혀 대화에 남의 메시지가 붙는다. 복구·기기 이전이라는 실제 쓰임에도 덮어쓰기가 맞다.
 *
 * ★ 백업 파일은 사용자가 고른 외부 파일이다. 읽은 값을 그대로 믿지 않는다 —
 *   설정과 브리핑 대상 위치는 원래의 검증기를 다시 통과시키고, 이 판본이 모르는
 *   표와 미래 판본의 파일은 받지 않는다.
 */

import { t } from '@/lib/i18n';
import { normalizeInboxLocation } from '@/lib/inbox/location';
import { db } from './db';
import { normalizeSettings } from './settings';

export const BACKUP_FORMAT = 'onnara-saide-backup';
export const BACKUP_VERSION = 1;

/** 기억(임베딩) 표. 파일 크기를 혼자 좌우해서, 내보낼 때 따로 고른다. */
export const MEMORY_TABLE = 'pageVectors';

/**
 * 백업에서 빼는 chrome.storage.local 키.
 *
 * 데이터가 아니라 그때그때의 신호다. 되살리면 복원 직후 엉뚱한 탭이 열리거나
 * (openInbox), 오늘 몫의 기한 알림이 이미 간 것으로 처리된다(taskAlertOn).
 */
export const TRANSIENT_KEYS = ['saide.openInbox', 'saide.taskAlertOn'];

/**
 * 마지막으로 백업을 내려받은 시각이 담기는 키.
 *
 * ★ 화면에 보이는 것이 목적이다. "언제 마지막으로 받았는지"가 보이지 않으면
 *   이 기능은 만들어만 두고 아무도 누르지 않는 버튼이 된다.
 */
export const LAST_BACKUP_KEY = 'saide.lastBackupAt';

export interface BackupFile {
  format: string;
  version: number;
  /** 백업을 만든 시각(ms). 복원 전에 "언제 것인지" 보여 준다. */
  createdAt: number;
  /** 만든 확장 판본. 사람이 파일을 열어 볼 때의 단서다. */
  appVersion: string;
  /**
   * 만든 쪽의 Dexie 스키마 판본.
   *
   * ★ 이보다 낮은 판본의 확장으로는 복원하지 않는다. 새 표·새 색인을 모르는 코드가
   *   받아 쓰면 그 자리만 조용히 비고, 사용자는 복원이 끝난 줄 안다.
   */
  schemaVersion: number;
  local: Record<string, unknown>;
  tables: Record<string, unknown[]>;
}

/** 표 이름 → 행 수. 내보내기 직후와 복원 확인 대화상자가 같은 값을 보인다. */
export interface BackupSummary {
  counts: Record<string, number>;
  localKeys: number;
  total: number;
}

export function summarize(backup: BackupFile): BackupSummary {
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(backup.tables)) counts[name] = rows.length;
  return {
    counts,
    localKeys: Object.keys(backup.local).length,
    total: Object.values(counts).reduce((sum, n) => sum + n, 0),
  };
}

/* ── 모으기 ────────────────────────────────────────────── */

export async function collectBackup(options: { includeMemory?: boolean } = {}): Promise<BackupFile> {
  const createdAt = Date.now();
  const stored = await chrome.storage.local.get(null);
  const local: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (!TRANSIENT_KEYS.includes(key)) local[key] = value;
  }
  // 이 파일이 만들어진 시각을 파일 자신에도 적는다. 복원한 쪽의 "마지막 백업"이
  // 그 전 백업의 날짜로 보이면, 맞는 것처럼 생긴 틀린 값이 된다.
  local[LAST_BACKUP_KEY] = createdAt;

  const tables: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    if (table.name === MEMORY_TABLE && !options.includeMemory) continue;
    tables[table.name] = await table.toArray();
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    appVersion: appVersion(),
    schemaVersion: db.verno,
    local,
    tables,
  };
}

function appVersion(): string {
  try { return chrome.runtime.getManifest().version; } catch { return '0.0.0'; }
}

/* ── 직렬화 ────────────────────────────────────────────── */

/**
 * 임베딩 벡터가 담기는 자리.
 *
 * ★ Float32Array는 JSON이 모르는 형이다. 그냥 넘기면 `{"0":0.1,"1":…}`가 되어 1024개
 *   칸마다 색인 문자열이 붙고, 되읽어도 평범한 객체라 검색이 조용히 망가진다.
 *   바이트를 base64로 담고 되읽을 때 되돌린다.
 */
interface EncodedFloat32 { __f32: string }

function isEncodedFloat32(value: unknown): value is EncodedFloat32 {
  return Boolean(value) && typeof value === 'object' && typeof (value as EncodedFloat32).__f32 === 'string';
}

function toBase64(bytes: Uint8Array): string {
  // 한 번에 넘기면 인자 수 상한에 걸린다. 벡터 하나가 4KB이고 수천 개가 모인다.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, (_key, value: unknown) =>
    value instanceof Float32Array
      ? { __f32: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) } satisfies EncodedFloat32
      : value);
}

/* ── 읽기 ──────────────────────────────────────────────── */

/** 백업 파일 글자를 검증된 백업으로 바꾼다. 어긋나면 이유를 담아 던진다. */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text, (_key, value: unknown) => {
      if (!isEncodedFloat32(value)) return value;
      const bytes = fromBase64(value.__f32);
      return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
    });
  } catch {
    throw new Error(t('backup.err.notBackup'));
  }

  const file = raw as Partial<BackupFile> | null;
  if (!file || typeof file !== 'object' || file.format !== BACKUP_FORMAT) throw new Error(t('backup.err.notBackup'));
  if (!file.local || typeof file.local !== 'object' || Array.isArray(file.local)) throw new Error(t('backup.err.notBackup'));
  if (!file.tables || typeof file.tables !== 'object' || Array.isArray(file.tables)) throw new Error(t('backup.err.notBackup'));
  if (typeof file.version !== 'number' || file.version > BACKUP_VERSION) throw new Error(t('backup.err.newer'));
  if (typeof file.schemaVersion !== 'number' || file.schemaVersion > db.verno) throw new Error(t('backup.err.newerSchema'));

  const tables: Record<string, unknown[]> = {};
  for (const [name, rows] of Object.entries(file.tables)) {
    // 이 판본이 모르는 표는 버린다. 되살릴 자리가 없고, 있다고 보고하면 거짓말이 된다.
    if (!db.tables.some(table => table.name === name)) continue;
    if (!Array.isArray(rows)) throw new Error(t('backup.err.notBackup'));
    tables[name] = rows.filter(row => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
  }

  return {
    format: BACKUP_FORMAT,
    version: file.version,
    createdAt: typeof file.createdAt === 'number' ? file.createdAt : 0,
    appVersion: typeof file.appVersion === 'string' ? file.appVersion : '',
    schemaVersion: file.schemaVersion,
    local: sanitizeLocal(file.local as Record<string, unknown>),
    tables,
  };
}

/**
 * 되살릴 chrome.storage.local 값을 다듬는다.
 *
 * ★ 원래의 검증기를 그대로 다시 쓴다. 설정은 normalizeSettings가, 브리핑 대상 위치는
 *   normalizeInboxLocation이 판정한다 — 저장된 위치는 나중에 로그인된 출처로 조회 폼을
 *   다시 보내는 값이라, 파일에서 들어온 것을 검증 없이 넣으면 확장이 임의 주소로 폼을
 *   보내는 길이 된다(location.ts 머리말).
 */
function sanitizeLocal(local: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(local)) {
    if (TRANSIENT_KEYS.includes(key)) continue;
    if (key === 'saide.settings') { next[key] = normalizeSettings(value); continue; }
    if (key === 'saide.inboxLocation') {
      const location = normalizeInboxLocation(value);
      if (location) next[key] = location;
      continue;
    }
    next[key] = value;
  }
  return next;
}

/* ── 복원 ──────────────────────────────────────────────── */

/**
 * 백업으로 덮어쓴다.
 *
 * ★ **백업에 담긴 표만** 비우고 채운다. 기억을 뺀 백업으로 복원했다고 해서 지금 쌓아 둔
 *   기억까지 지우지는 않는다 — 사용자가 지우라고 한 적이 없다.
 *
 * ★ id를 그대로 넣는다. `++id` 표라도 명시한 키를 받으며, 그래야 messages의
 *   conversationId 같은 참조가 살아남는다. IndexedDB의 키 생성기도 넣은 최댓값 위로 올라간다.
 */
export async function restoreBackup(backup: BackupFile): Promise<BackupSummary> {
  const names = Object.keys(backup.tables);
  if (names.length) {
    await db.transaction('rw', names.map(name => db.table(name)), async () => {
      for (const name of names) {
        const table = db.table(name);
        await table.clear();
        const rows = backup.tables[name]!;
        if (rows.length) await table.bulkPut(rows);
      }
    });
  }
  // 설정을 마지막에 넣는다. 표를 채우다 실패하면 설정도 그대로여야, 절반만 바뀐 상태가 남지 않는다.
  if (Object.keys(backup.local).length) await chrome.storage.local.set(backup.local);
  return summarize(backup);
}

/* ── 마지막 백업 시각 ──────────────────────────────────── */

export async function lastBackupAt(): Promise<number | null> {
  try {
    const stored = await chrome.storage.local.get(LAST_BACKUP_KEY);
    const at = stored?.[LAST_BACKUP_KEY];
    return typeof at === 'number' && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export async function markBackedUp(at: number): Promise<void> {
  try { await chrome.storage.local.set({ [LAST_BACKUP_KEY]: at }); } catch { /* 표시를 못 남겨도 파일은 받았다 */ }
}

/* ── 파일 이름 ─────────────────────────────────────────── */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 시각까지 붙인다. 같은 날 두 번 받아도 앞의 것을 덮어쓰지 않는다. */
export function backupFileName(now: Date = new Date()): string {
  return `온나라-sAIde-백업-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}
