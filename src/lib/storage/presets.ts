/**
 * 사용자 정의 프리셋 저장. 계획서 §5 Phase 4-4
 *
 * 대화(Dexie)와 달리 양이 적고 설정 성격이라 chrome.storage.local에 둔다.
 */

import type { CustomPreset, PresetNeeds } from '@/lib/prompts/presets';

const KEY = 'saide.presets';

export async function loadCustomPresets(): Promise<CustomPreset[]> {
  const raw = await chrome.storage.local.get(KEY);
  const list = raw?.[KEY];
  return Array.isArray(list) ? (list as CustomPreset[]) : [];
}

async function save(list: CustomPreset[]): Promise<CustomPreset[]> {
  await chrome.storage.local.set({ [KEY]: list });
  return list;
}

/**
 * 슬래시 이름을 정규화한다.
 * 공백이 들어가면 자동완성이 매치되지 않으므로 미리 걸러낸다.
 */
export function normalizeSlash(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w가-힣-]/g, '')
    .slice(0, 24)
    .toLowerCase();
}

export async function addCustomPreset(input: {
  label: string;
  slash: string;
  template: string;
  needs: PresetNeeds;
}): Promise<CustomPreset[]> {
  const list = await loadCustomPresets();
  const slash = normalizeSlash(input.slash);
  if (!slash || !input.label.trim() || !input.template.trim()) return list;

  // 같은 이름이 있으면 덮어쓴다 — 중복 슬래시는 자동완성을 혼란스럽게 만든다.
  const without = list.filter((p) => p.slash !== slash);
  return save([
    ...without,
    {
      id: `custom-${slash}-${Date.now().toString(36)}`,
      label: input.label.trim(),
      slash,
      template: input.template.trim(),
      needs: input.needs,
    },
  ]);
}

export async function updateCustomPreset(
  id: string,
  patch: Partial<Omit<CustomPreset, 'id'>>,
): Promise<CustomPreset[]> {
  const list = await loadCustomPresets();
  return save(
    list.map((p) =>
      p.id === id
        ? { ...p, ...patch, slash: patch.slash ? normalizeSlash(patch.slash) : p.slash }
        : p,
    ),
  );
}

export async function deleteCustomPreset(id: string): Promise<CustomPreset[]> {
  const list = await loadCustomPresets();
  return save(list.filter((p) => p.id !== id));
}

export function onCustomPresetsChanged(cb: (list: CustomPreset[]) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local' || !changes[KEY]) return;
    const v = changes[KEY].newValue;
    cb(Array.isArray(v) ? (v as CustomPreset[]) : []);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
