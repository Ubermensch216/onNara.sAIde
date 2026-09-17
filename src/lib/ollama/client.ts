import { abortable, deadlineSignal } from '@/lib/async';
/**
 * Ollama HTTP 클라이언트. 계획서 §5 Phase 1-7 / 2-7
 *
 * 스트리밍은 stream.ts가 맡고, 여기서는 비스트리밍 엔드포인트와
 * 헬스체크·워밍업을 담당한다.
 */

import type {
  ChatRequest,
  EmbedResponse,
  ModelInfo,
  PsResponse,
  TagsResponse,
} from '@/types/ollama';
import { t } from '@/lib/i18n';
import type { AppError } from '@/lib/messaging/protocol';
import {
  OllamaError,
  classifyResponse,
  pullCommand,
  refineConnectionError,
} from './errors';
import { streamChat } from './stream';

export async function requestJson<T>(endpoint: string, path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const guard = deadlineSignal(timeoutMs, init.signal ?? undefined);
  try {
    const res = await abortable(fetch(`${endpoint}${path}`, { ...init, cache: 'no-store', signal: guard.signal }), guard.signal);
    if (!res.ok) throw await abortable(classifyResponse(res), guard.signal);
    return await abortable(res.json(), guard.signal) as T;
  } catch (error) {
    if (guard.signal.aborted) throw new OllamaError(init.signal?.aborted ? 'ABORTED' : 'TIMEOUT', init.signal?.aborted ? '요청을 중단했습니다.' : '서버 응답 시간이 초과되었습니다.');
    if (error instanceof OllamaError) throw error;
    if (error instanceof SyntaxError) throw new OllamaError('UNKNOWN', '서버의 JSON 응답이 올바르지 않습니다.');
    throw await refineConnectionError(endpoint, error);
  } finally { guard.dispose(); }
}
const getJson = <T>(endpoint: string, path: string) => requestJson<T>(endpoint, path);

export async function getVersion(endpoint: string): Promise<string> {
  const v = await getJson<{ version: string }>(endpoint, '/api/version');
  return v.version;
}

export async function listModels(endpoint: string): Promise<ModelInfo[]> {
  const tags = await getJson<TagsResponse>(endpoint, '/api/tags');
  const models = tags.models ?? [];
  // Limit concurrency when old servers omit capability metadata.
  for (let i = 0; i < models.length; i += 4) {
    await Promise.all(models.slice(i, i + 4).map(async model => {
      if (model.capabilities?.length) return;
      try { model.capabilities = (await showModel(endpoint, model.name)).capabilities; }
      catch { /* retain the model as unknown; explicit feature checks fail closed */ }
    }));
  }
  return models;
}

export async function listRunning(endpoint: string): Promise<PsResponse['models']> {
  const ps = await getJson<PsResponse>(endpoint, '/api/ps');
  return ps.models ?? [];
}

/** /api/show — 모델의 capabilities(tools·vision·thinking…) 확인용. */
export async function showModel(
  endpoint: string,
  model: string,
  signal?: AbortSignal,
): Promise<ModelInfo & { capabilities?: string[] }> {
  return requestJson(endpoint, '/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal });
}

export async function requireCapabilities(endpoint: string, model: string, required: string[], signal?: AbortSignal): Promise<void> {
  if (!required.length) return;
  const info = await showModel(endpoint, model, signal);
  const missing = required.filter(feature => !info.capabilities?.includes(feature));
  if (missing.length) throw new OllamaError('UNKNOWN', `선택한 모델의 ${missing.join(', ')} 기능을 확인할 수 없습니다.`, '설정에서 해당 기능을 지원하는 모델을 선택하세요.');
}

/**
 * ★ keep_alive를 부르는 쪽이 정한다.
 *   임베딩 큐는 '0'을 넘긴다 — 16GB에 gemma(6.9GB)가 상주한 상태에서
 *   bge-m3(1.2GB)가 몇 분씩 함께 머무르면 대화용 모델이 밀려난다.
 *   그러면 다음 질문이 콜드 스타트 21초를 다시 문다(Phase 6-1 주의).
 */
export async function embed(
  endpoint: string,
  model: string,
  input: string | string[],
  keepAlive: string = '2m',
  signal?: AbortSignal,
): Promise<number[][]> {
  const json = await requestJson<EmbedResponse>(endpoint, '/api/embed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input, keep_alive: keepAlive }), signal,
  }, 180_000);
  return json.embeddings ?? [];
}

/* ── 헬스체크 ──────────────────────────────────────────── */

export type HealthState =
  | 'ok'         // 연결됨 + 모델 있음 + 상주 중
  | 'cold'       // 연결됨 + 모델 있음, 그러나 메모리에 없음 (첫 응답 ~21초)
  | 'model-missing'
  | 'cors-blocked'
  | 'down'
  | 'checking';

export interface HealthReport {
  state: HealthState;
  version?: string;
  models: ModelInfo[];
  /** 대상 모델이 메모리에 상주 중인가 */
  resident: boolean;
  /** ★ 상주 모델이 GPU에 올라갔는가. false면 CPU 추론 — 성능 목표가 달라진다. */
  onGpu: boolean;
  error?: AppError;
}

export async function checkHealth(
  endpoint: string,
  model: string,
): Promise<HealthReport> {
  const empty: Omit<HealthReport, 'state'> = {
    models: [],
    resident: false,
    onGpu: false,
  };

  let version: string;
  let models: ModelInfo[];
  try {
    version = await getVersion(endpoint);
    models = await listModels(endpoint);
  } catch (e) {
    const err = e instanceof OllamaError ? e : new OllamaError('UNKNOWN', String(e));
    return {
      ...empty,
      state: err.code === 'CORS_BLOCKED' ? 'cors-blocked' : 'down',
      error: err.toAppError(),
    };
  }

  const sameModel = (name: string) => (name.includes(':') ? name : `${name}:latest`) === (model.includes(':') ? model : `${model}:latest`);
  const has = models.some((m) => sameModel(m.name) || sameModel(m.model));
  if (!has) {
    return {
      ...empty,
      state: 'model-missing',
      version,
      models,
      error: {
        code: 'MODEL_MISSING',
        message: `모델 '${model}'이 설치되어 있지 않습니다.`,
        hint: pullCommand(model),
      },
    };
  }

  let resident = false;
  let onGpu = false;
  try {
    const running = await listRunning(endpoint);
    const hit = running.find((m) => sameModel(m.name) || sameModel(m.model));
    resident = Boolean(hit);
    // size_vram > 0 이면 일부라도 GPU에 올라간 것.
    onGpu = (hit?.size_vram ?? 0) > 0;
  } catch {
    /* /api/ps 실패는 치명적이지 않다 — 상주 여부만 모를 뿐이다 */
  }

  return {
    state: resident ? 'ok' : 'cold',
    version,
    models,
    resident,
    onGpu,
  };
}

/* ── 워밍업 ────────────────────────────────────────────── */

/**
 * 모델을 메모리에 올려둔다. 콜드 21.5초를 사용자가 체감하지 않게 만드는 유일한 수단.
 *
 * ★ numCtx는 이후 실제 대화와 **반드시 동일**해야 한다. 값이 다르면 Ollama가
 *   모델을 리로드하므로 워밍업이 통째로 무의미해진다. 계획서 §1 변경 7번.
 */
export async function warmup(
  endpoint: string,
  model: string,
  numCtx: number,
  keepAlive: string,
  signal?: AbortSignal,
): Promise<void> {
  const req: ChatRequest = {
    model,
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    think: false,
    keep_alive: keepAlive,
    options: { num_ctx: numCtx, num_predict: 1, temperature: 0 },
  };
  // 응답 내용은 버린다. 목적은 오직 모델 상주.
  await streamChat(endpoint, req, {}, signal);
}
