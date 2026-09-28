/**
 * TONGDAL.ai 연결 상태 판정 — 계획서 tongdal-integration-workplan.md §4.7.
 *
 * ★ fail-closed. 쓸 수 없는 상태를 "결과 없음"처럼 보이게 두지 않는다. 화면은 이 판정으로
 *   기능을 숨기거나 이유를 보여 준다.
 */

import { TongdalError } from './client';
import { TONGDAL_API_VERSION, type TongdalStatus } from './types';

export type TongdalState =
  | 'unpaired'        // 토큰 없음 — 연동 설정 안내
  | 'offline'         // TONGDAL이 꺼졌거나 연결을 끔
  | 'version_mismatch'
  | 'no_space'        // 지식 공간 미선택
  | 'starting'        // 처리 엔진 준비 중
  | 'engine_error'
  | 'ready';

export interface TongdalHealth {
  state: TongdalState;
  /** 검색은 되지만 Ollama가 없어 키워드 검색만 되는 상태. */
  keywordOnly: boolean;
  /** 색인 대기·진행 중인 자료 수. 0보다 크면 답변이 느려질 수 있다. */
  indexing: number;
  spaceName: string | null;
  canRead: boolean;
  /** 판정 근거가 된 오류(있으면). 화면이 메시지를 그대로 쓴다. */
  error?: TongdalError;
}

export function judgeStatus(status: TongdalStatus | null, error: unknown, paired: boolean): TongdalHealth {
  const base = { keywordOnly: false, indexing: 0, spaceName: null, canRead: false };
  if (!paired) return { ...base, state: 'unpaired' };
  if (error || !status) {
    const failure = error instanceof TongdalError ? error : undefined;
    if (failure?.code === 'not_paired' || failure?.code === 'unauthorized') return { ...base, state: 'unpaired', error: failure };
    return { ...base, state: 'offline', error: failure };
  }
  if (status.apiVersion !== TONGDAL_API_VERSION) return { ...base, state: 'version_mismatch' };
  // 토큰을 보냈는데 paired=false면 TONGDAL이 이 토큰을 모른다(해제됨).
  if (!status.paired) return { ...base, state: 'unpaired' };

  const indexing = (status.indexing?.queueLength ?? 0);
  const spaceName = status.knowledgeSpace?.name ?? null;
  const canRead = status.scopes?.includes('read') ?? false;
  const common = { indexing, spaceName, canRead, keywordOnly: status.ollama?.state === 'offline' || status.ollama?.state === 'missing_models' };
  if (!status.knowledgeSpace?.connected) return { ...common, state: 'no_space' };
  if (status.engine?.state === 'error') return { ...common, state: 'engine_error' };
  if (status.engine?.state !== 'ready') return { ...common, state: 'starting' };
  return { ...common, state: 'ready' };
}
