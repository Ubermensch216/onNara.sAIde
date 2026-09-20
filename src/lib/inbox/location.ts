/**
 * 접수함으로 지정한 화면의 위치(N1).
 *
 * ★ 설정에 주소를 타이핑하게 하지 않는다. 온나라 목록은 대개 POST 조회라 주소만으로는
 *   같은 화면이 재현되지 않는다. 사용자가 **그 화면에서 한 번 눌러** 조회 폼째 저장한다.
 *
 * ★ 저장한 값은 나중에 백그라운드 탭에서 그대로 제출된다. 그래서 읽어 올 때마다
 *   형태를 다시 검증한다 — 저장소의 값이 손상되었거나 예전 판본의 것일 수 있고,
 *   검증 없이 쓰면 확장이 임의 주소로 폼을 보내는 길이 된다.
 */

import type { DocumentListLocation } from '@/lib/onnara/document-navigation';

const KEY = 'saide.inboxLocation';

/** 조회 폼 필드 수·길이 상한. 온나라 검색 폼은 수십 개를 넘지 않는다. */
const MAX_FIELDS = 200;
const MAX_FIELD_LENGTH = 2000;
const MAX_FRAME_DEPTH = 10;

export interface InboxLocation {
  location: DocumentListLocation;
  /** 지정할 때 화면이 밝힌 목록 이름. 화면에 "무엇을 접수함으로 두었는지" 보인다. */
  listName: string;
  /** 살아 있는 온나라 탭을 찾을 때 쓰는 출처. */
  origin: string;
  savedAt: number;
}

function validOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** 저장된 값을 쓸 수 있는 형태로 확인한다. 조금이라도 어긋나면 없는 것으로 본다. */
export function normalizeInboxLocation(raw: unknown): InboxLocation | null {
  const value = raw as Partial<InboxLocation> | null;
  const location = value?.location;
  if (!location || typeof location.url !== 'string') return null;
  const origin = validOrigin(location.url);
  if (!origin) return null;

  const framePath = Array.isArray(location.framePath) ? location.framePath : [];
  if (framePath.length > MAX_FRAME_DEPTH) return null;
  if (!framePath.every(index => Number.isInteger(index) && index >= 0 && index < 1000)) return null;

  const next: DocumentListLocation = { url: location.url, framePath };
  if (typeof location.frameName === 'string' && location.frameName.length <= 200) next.frameName = location.frameName;

  const form = location.form;
  if (form && (form.method === 'get' || form.method === 'post')) {
    const fields = Array.isArray(form.fields) ? form.fields : [];
    const clean = fields
      .filter((field): field is [string, string] =>
        Array.isArray(field) && field.length === 2 &&
        typeof field[0] === 'string' && typeof field[1] === 'string' &&
        field[0].length > 0 && field[0].length <= MAX_FIELD_LENGTH && field[1].length <= MAX_FIELD_LENGTH)
      .slice(0, MAX_FIELDS);
    next.form = { method: form.method, fields: clean };
  }

  return {
    location: next,
    listName: typeof value?.listName === 'string' ? value.listName.slice(0, 80) : '받은문서',
    origin,
    savedAt: typeof value?.savedAt === 'number' && Number.isFinite(value.savedAt) ? value.savedAt : 0,
  };
}

export async function loadInboxLocation(): Promise<InboxLocation | null> {
  try {
    return normalizeInboxLocation((await chrome.storage.local.get(KEY))[KEY]);
  } catch {
    return null;
  }
}

export async function saveInboxLocation(location: DocumentListLocation, listName: string): Promise<InboxLocation | null> {
  const entry = normalizeInboxLocation({ location, listName, savedAt: Date.now() });
  if (!entry) return null;
  try {
    await chrome.storage.local.set({ [KEY]: entry });
    return entry;
  } catch {
    return null;
  }
}

export async function clearInboxLocation(): Promise<void> {
  try { await chrome.storage.local.remove(KEY); } catch { /* 지울 것이 없다 */ }
}

export function onInboxLocationChanged(callback: (entry: InboxLocation | null) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[KEY]) return;
    callback(normalizeInboxLocation(changes[KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
