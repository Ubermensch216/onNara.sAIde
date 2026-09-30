/**
 * 답변 근거의 판본 대조 — 답변 당시 근거로 쓴 판본이 지금도 현행인지 확인한다.
 *
 * ★ 답변은 대화 기록에 남지만 원본은 계속 고쳐진다. 기록된 판본 해시(KnowledgeSource.contentHash)와
 *   TONGDAL의 현재 판본 해시를 대조해, 답변을 그대로 믿어도 되는지 사용자가 판단하게 한다.
 * ★ 자동으로 부르지 않는다. 지난 대화를 열 때마다 출처 수만큼 요청이 나가면 안 되므로 사용자가 누를 때만 한다.
 */

import { getDocument, TongdalError } from './client';
import { loadConnection } from './connection';
import type { KnowledgeSource } from './evidence';
import type { TongdalDocumentDetail } from './types';

export type SourceDrift =
  /** 현재 판본이 답변 당시 판본과 같다. */
  | { state: 'same'; label: string | null }
  /** 답변 뒤 원본이 고쳐졌다. */
  | { state: 'revised'; label: string | null; currentLabel: string | null }
  /** 문서가 지워졌거나 옮겨져 찾을 수 없다. */
  | { state: 'missing' }
  /** 답변 당시 판본을 기록하지 못했다(이전 기록·이전 TONGDAL·카탈로그에 없던 파일). */
  | { state: 'unpinned' }
  /** 연결 끊김 등으로 지금은 확인할 수 없다. */
  | { state: 'unavailable'; reason: string };

/** 순수 판정. 네트워크와 떼어 시험한다. */
export function judgeDrift(source: KnowledgeSource, detail: TongdalDocumentDetail): SourceDrift {
  if (!source.contentHash) return { state: 'unpinned' };
  const versions = detail.document.versions;
  const current = versions.find(version => version.isCurrent) ?? versions[0];
  if (!current) return { state: 'missing' };
  const label = source.versionLabel ?? null;
  return current.contentHash === source.contentHash
    ? { state: 'same', label }
    : { state: 'revised', label, currentLabel: current.versionLabel || null };
}

/** 출처마다 현재 판본과 대조한다. 같은 문서는 한 번만 묻는다. 결과 배열은 sources와 같은 순서다. */
export async function checkSourceDrift(sources: KnowledgeSource[], signal?: AbortSignal): Promise<SourceDrift[]> {
  const connection = await loadConnection();
  const details = new Map<string, Promise<TongdalDocumentDetail | SourceDrift>>();
  const fetchDetail = (id: string) => {
    let pending = details.get(id);
    if (!pending) {
      pending = getDocument(connection, id, {}, signal).catch((error: unknown): SourceDrift => {
        if (error instanceof TongdalError && error.code === 'not_found') return { state: 'missing' };
        return { state: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
      });
      details.set(id, pending);
    }
    return pending;
  };
  return Promise.all(sources.map(async (source): Promise<SourceDrift> => {
    if (!source.documentId || !source.contentHash) return { state: 'unpinned' };
    const detail = await fetchDetail(source.documentId);
    return 'state' in detail ? detail : judgeDrift(source, detail);
  }));
}

/** 답변 당시 판본 표시: "v2 · #1a2b3c4d". 판본을 모르면 빈 문자열. */
export function pinnedLabel(source: KnowledgeSource): string {
  const parts = [source.versionLabel, source.contentHash ? `#${source.contentHash.slice(0, 8)}` : ''].filter(Boolean);
  return parts.join(' · ');
}
