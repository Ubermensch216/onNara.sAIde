import { abortable, deadlineSignal } from '@/lib/async';
/**
 * 오류 분류. 계획서 §5 Phase 1-8 / §6 완료 기준
 *
 * 핵심 난제: **CORS 차단과 서버 다운을 구분하는 것.**
 * 브라우저는 CORS 프리플라이트 실패를 fetch의 TypeError로 뭉뚱그려 던지므로,
 * 응답 본문만으로는 둘을 구별할 수 없다. 그래서 no-cors 프로브로 갈라낸다:
 *   - 서버가 죽었으면 no-cors 요청도 실패한다        → OLLAMA_DOWN
 *   - 서버는 살아 있는데 CORS만 막혔으면 no-cors는 성공(opaque) → CORS_BLOCKED
 * 이 구분이 없으면 사용자에게 엉뚱한 해결 방법을 안내하게 된다.
 */

import type { AppError, ErrorCode } from '@/lib/messaging/protocol';

export class OllamaError extends Error implements AppError {
  code: ErrorCode;
  hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'OllamaError';
    this.code = code;
    this.hint = hint;
  }

  toAppError(): AppError {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

export const CORS_HINT =
  '확장 프로그램의 origin이 Ollama에서 차단되고 있습니다. ' +
  'OLLAMA_ORIGINS 환경 변수를 설정한 뒤 Ollama를 완전히 종료했다가 다시 시작하세요.';

export const CORS_COMMAND =
  `[Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS','chrome-extension://*','User')`;

export const DOWN_HINT =
  'Ollama가 실행 중이 아닙니다. Ollama를 시작한 뒤 다시 시도하세요.';

export function pullCommand(model: string): string {
  return `ollama pull ${model}`;
}

/** fetch가 예외를 던진 경우 — 네트워크 계층 실패. */
export function classifyFetchError(e: unknown): OllamaError {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return new OllamaError('ABORTED', '생성을 중단했습니다.');
  }
  if (e instanceof OllamaError) return e;

  // 여기서는 아직 DOWN인지 CORS인지 알 수 없다. 호출자가 probeEndpoint로 확정한다.
  return new OllamaError(
    'OLLAMA_DOWN',
    'Ollama에 연결하지 못했습니다.',
    DOWN_HINT,
  );
}

/** HTTP 응답은 왔으나 상태 코드가 실패인 경우. */
export async function classifyResponse(res: Response): Promise<OllamaError> {
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    /* 본문을 못 읽어도 상태 코드로 판단한다 */
  }

  if (res.status === 403) {
    return new OllamaError('CORS_BLOCKED', 'Ollama가 요청 origin을 거부했습니다.', CORS_HINT);
  }
  if (res.status === 404) {
    return new OllamaError(
      'MODEL_MISSING',
      '요청한 모델을 Ollama에서 찾을 수 없습니다.',
      detail || undefined,
    );
  }
  if (/memory|oom|allocat/i.test(detail)) {
    return new OllamaError(
      'OOM',
      '모델을 올릴 메모리가 부족합니다.',
      'num_ctx를 줄이거나 다른 프로그램을 종료한 뒤 다시 시도하세요.',
    );
  }
  return new OllamaError(
    'UNKNOWN',
    `Ollama 오류 (HTTP ${res.status})`,
    detail?.slice(0, 300) || undefined,
  );
}

/**
 * 서버 생존 여부를 CORS와 무관하게 확인한다.
 *
 * no-cors 모드는 응답을 읽을 수 없는 opaque 응답을 주지만, **요청 자체가
 * 성공했는지는 알려준다.** 그것만으로 DOWN과 CORS_BLOCKED가 갈린다.
 */
export async function isServerReachable(endpoint: string): Promise<boolean> {
  const guard = deadlineSignal(3000);
  try {
    await abortable(fetch(`${endpoint}/api/version`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: guard.signal,
    }), guard.signal);
    return true;
  } catch {
    return false;
  } finally { guard.dispose(); }
}

/** fetch 실패를 DOWN / CORS_BLOCKED 중 하나로 확정한다. */
export async function refineConnectionError(
  endpoint: string,
  e: unknown,
): Promise<OllamaError> {
  const base = classifyFetchError(e);
  if (base.code !== 'OLLAMA_DOWN') return base;

  return (await isServerReachable(endpoint))
    ? new OllamaError(
        'CORS_BLOCKED',
        'Ollama는 실행 중이지만 확장의 origin을 거부하고 있습니다.',
        CORS_HINT,
      )
    : new OllamaError('OLLAMA_DOWN', 'Ollama가 실행 중이 아닙니다.', DOWN_HINT);
}
