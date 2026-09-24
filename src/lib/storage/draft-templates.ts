/**
 * 공문서 서식 저장소 관리 모듈.
 *
 * chrome.storage.local에 저장하며, 없을 경우 내장 기본 서식(Builtin) 4종을 자동 시드한다.
 * 서식 추가, 수정, 삭제, 기본 서식 복원 및 변경 이벤트 리스너를 제공한다.
 */

import {
  BUILTIN_TEMPLATES,
  type DraftTemplate,
} from '@/lib/onnara/draft-templates';

const STORAGE_KEY = 'saide.draft_templates';

/** chrome.storage.local 안전 접근 헬퍼 */
async function getStorageData(): Promise<DraftTemplate[] | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(STORAGE_KEY);
      const list = res?.[STORAGE_KEY];
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch {
    // ignore
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) return list;
    }
  } catch {
    // ignore
  }

  return null;
}

/** chrome.storage.local 및 localStorage에 서식 목록 동기화 저장 */
async function setStorageData(list: DraftTemplate[]): Promise<DraftTemplate[]> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: list });
    }
  } catch {
    // ignore
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }

  return list;
}

/**
 * 저장된 서식 목록을 로드한다.
 * 아직 저장된 서식이 없으면 내장 기본 서식(4종)으로 초기화한다.
 */
export async function loadDraftTemplates(): Promise<DraftTemplate[]> {
  const existing = await getStorageData();
  if (existing && existing.length > 0) {
    return existing;
  }

  // 초기 시드: 내장 기본 서식 저장
  const clonedDefaults = JSON.parse(JSON.stringify(BUILTIN_TEMPLATES)) as DraftTemplate[];
  await setStorageData(clonedDefaults);
  return clonedDefaults;
}

/**
 * 신규 서식을 추가한다.
 */
export async function addDraftTemplate(input: {
  title: string;
  documentType: string;
  description?: string;
  sections: string[];
  guidance?: string;
}): Promise<DraftTemplate[]> {
  const list = await loadDraftTemplates();
  const now = Date.now();
  const newTemplate: DraftTemplate = {
    id: `template-${now.toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
    title: input.title.trim() || '새 서식',
    documentType: input.documentType.trim() || '기타',
    description: (input.description || '').trim(),
    sections: input.sections.map((s) => s.trim()).filter(Boolean),
    guidance: (input.guidance || '').trim() || undefined,
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  };

  const updated = [...list, newTemplate];
  return setStorageData(updated);
}

/**
 * 기존 서식을 수정한다.
 */
export async function updateDraftTemplate(
  id: string,
  patch: Partial<Omit<DraftTemplate, 'id' | 'createdAt'>>,
): Promise<DraftTemplate[]> {
  const list = await loadDraftTemplates();
  const now = Date.now();

  const updated = list.map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      ...patch,
      title: patch.title !== undefined ? patch.title.trim() : item.title,
      documentType: patch.documentType !== undefined ? patch.documentType.trim() : item.documentType,
      description: patch.description !== undefined ? patch.description.trim() : item.description,
      sections: patch.sections !== undefined
        ? patch.sections.map((s) => s.trim()).filter(Boolean)
        : item.sections,
      guidance: patch.guidance !== undefined ? (patch.guidance.trim() || undefined) : item.guidance,
      updatedAt: now,
    };
  });

  return setStorageData(updated);
}

/**
 * 서식을 삭제한다.
 */
export async function deleteDraftTemplate(id: string): Promise<DraftTemplate[]> {
  const list = await loadDraftTemplates();
  const updated = list.filter((item) => item.id !== id);
  return setStorageData(updated);
}

/**
 * 기본 내장 서식으로 초기화(재설정)한다.
 */
export async function resetToDefaultDraftTemplates(): Promise<DraftTemplate[]> {
  const clonedDefaults = JSON.parse(JSON.stringify(BUILTIN_TEMPLATES)) as DraftTemplate[];
  return setStorageData(clonedDefaults);
}

/**
 * 서식 변경 이벤트 리스너 등록
 */
export function onDraftTemplatesChanged(cb: (templates: DraftTemplate[]) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const v = changes[STORAGE_KEY].newValue;
    cb(Array.isArray(v) ? (v as DraftTemplate[]) : []);
  };

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  } catch {
    // ignore
  }

  // fallback for window storage event
  const storageListener = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) cb(parsed);
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener('storage', storageListener);
  return () => window.removeEventListener('storage', storageListener);
}
