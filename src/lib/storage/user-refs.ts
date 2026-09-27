/**
 * 기안 코파일럿 '내 참고자료' 저장소 (Dexie v6 `userRefs`).
 *
 * ★ 원본 파일은 보관하지 않는다. 뽑은 글자·코드 추출 사실·모델 분석만 둔다.
 * ★ 전체 백업(backup.ts)은 db.tables를 따라가므로 이 표도 자동으로 백업·복원된다.
 * ★ 확장 ID가 바뀌면(폴더 경로 변경·제거 후 재설치) 이 저장소도 함께 갈린다. 백업 파일이 유일한 복구 경로다.
 */

import { liveQuery } from 'dexie';
import { db } from './db';
import type { FileFormat } from '@/lib/extract/files/types';
import type { CodeFacts, RefAnalysis, RefRole } from '@/lib/onnara/reference-analysis';

/** 자료함에 둘 수 있는 최대 건수. */
export const USER_REFS_MAX = 50;

export interface UserRef {
  id: string;
  /** 올린 파일 이름. */
  name: string;
  format: FileFormat;
  /** 원본 크기(바이트). */
  size: number;
  /** 원본 SHA-256. 같은 파일을 다시 올렸는지 가린다. */
  contentHash: string;
  role: RefRole;
  /** 구조 표시([n쪽], [표 n])가 들어간 전체 글자. */
  text: string;
  pages?: number;
  warnings: string[];
  /** 사용자가 이 자료에 덧붙인 요구사항·메모. */
  memo: string;
  codeFacts: CodeFacts;
  analysis?: RefAnalysis;
  createdAt: number;
  lastUsedAt: number;
}

export type NewUserRef = Omit<UserRef, 'id' | 'createdAt' | 'lastUsedAt' | 'memo' | 'analysis'> & { memo?: string };

function newId(): string {
  return `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 최근에 쓴 것부터. */
export async function listUserRefs(): Promise<UserRef[]> {
  const rows = await db.userRefs.toArray();
  return rows.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function getUserRef(id: string): Promise<UserRef | undefined> {
  return db.userRefs.get(id);
}

/**
 * 새 자료를 넣는다. 같은 지문의 자료가 있으면 새로 만들지 않고 그것을 돌려준다(`existed: true`).
 * 자료함이 가득 차면 던진다 — 오래된 자료를 몰래 지우지 않는다.
 */
export async function addUserRef(input: NewUserRef): Promise<{ ref: UserRef; existed: boolean }> {
  return db.transaction('rw', db.userRefs, async () => {
    const same = await db.userRefs.where('contentHash').equals(input.contentHash).first();
    if (same) {
      const touched = { ...same, lastUsedAt: Date.now() };
      await db.userRefs.put(touched);
      return { ref: touched, existed: true };
    }
    if ((await db.userRefs.count()) >= USER_REFS_MAX) {
      throw new Error(`내 참고자료는 ${USER_REFS_MAX}건까지 보관할 수 있습니다. 쓰지 않는 자료를 지운 뒤 올려 주세요.`);
    }
    const now = Date.now();
    const ref: UserRef = { ...input, memo: input.memo ?? '', id: newId(), createdAt: now, lastUsedAt: now };
    await db.userRefs.add(ref);
    return { ref, existed: false };
  });
}

export async function updateUserRef(id: string, patch: Partial<Omit<UserRef, 'id'>>): Promise<void> {
  await db.userRefs.update(id, patch);
}

export async function deleteUserRef(id: string): Promise<void> {
  await db.userRefs.delete(id);
}

/** 목록이 바뀔 때마다 알린다(다른 탭의 드로어에서 바꾼 것도 포함). 구독 해제 함수를 돌려준다. */
export function onUserRefsChanged(callback: (refs: UserRef[]) => void, onError?: (error: unknown) => void): () => void {
  const subscription = liveQuery(listUserRefs).subscribe({ next: callback, error: error => onError?.(error) });
  return () => subscription.unsubscribe();
}
