import type { OnnaraSnapshot } from './context';

export interface OnnaraDocument {
  title: string;
  bodyText: string;
  sourceDocumentId?: string;
  managementNumber?: string;
  createdDate?: string;
  attachments: Array<{ name: string; size?: number }>;
}

export interface OnnaraAdapter<T = unknown> {
  readonly id: string;
  readonly priority: number;
  matches(snapshot: OnnaraSnapshot): boolean;
  extract(snapshot: OnnaraSnapshot): Promise<T>;
}

/** 동일 화면에 여러 어댑터가 맞으면 우선순위가 높은 명시적 어댑터를 선택한다. */
export function selectOnnaraAdapter<T>(snapshot: OnnaraSnapshot, adapters: Array<OnnaraAdapter<T>>): OnnaraAdapter<T> | null {
  return [...adapters]
    .filter(adapter => adapter.matches(snapshot))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0] ?? null;
}
