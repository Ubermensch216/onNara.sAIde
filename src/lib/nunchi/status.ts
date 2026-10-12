/**
 * 눈치코치 연결 상태 판정.
 *
 * ★ 쓸 수 없는 상태를 "아무 일 없음"처럼 보이게 두지 않는다. 화면은 이 판정으로 이유를 보여 준다.
 * ★ 눈치코치가 꺼져 있어도 꾸러미 내보내기는 된다 — 자료는 폴더로 가고 브리지는 알림만 맡는다.
 *   그래서 'offline'은 오류가 아니라 "눈치코치에서 폴더를 직접 고르면 된다"는 안내다.
 */

import { NunchiError, type NunchiStatus } from './client';
import { NUNCHI_API_VERSION } from './connection';

export type NunchiState =
  | 'unpaired'          // 토큰 없음 — 연동 설정 안내
  | 'offline'           // 눈치코치가 꺼졌거나 연결을 끔
  | 'version_mismatch'
  | 'ready';

export interface NunchiHealth {
  state: NunchiState;
  /** 눈치코치에서 열어 둔 인수인계. 없으면 시작 화면이거나 알 수 없다. */
  project: string | null;
  error?: NunchiError;
}

export function judgeNunchi(status: NunchiStatus | null, error: unknown, paired: boolean): NunchiHealth {
  const base = { project: null };
  if (!paired) return { ...base, state: 'unpaired' };
  if (error || !status) {
    const failure = error instanceof NunchiError ? error : undefined;
    if (failure?.code === 'not_paired' || failure?.code === 'unauthorized') return { ...base, state: 'unpaired', error: failure };
    return { ...base, state: 'offline', ...(failure ? { error: failure } : {}) };
  }
  if (status.apiVersion !== NUNCHI_API_VERSION) return { ...base, state: 'version_mismatch' };
  // 토큰을 보냈는데 paired=false면 눈치코치가 이 토큰을 모른다(해제됨).
  if (!status.paired) return { ...base, state: 'unpaired' };
  return { state: 'ready', project: typeof status.project === 'string' && status.project ? status.project : null };
}
