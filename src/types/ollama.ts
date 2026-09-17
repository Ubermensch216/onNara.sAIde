/**
 * 계약 ① — Ollama API 타입. 계획서 §4.1
 *
 * 실측(2026-08-19, gemma4:e2b)에 근거한 주석이 붙어 있다. 추측이 아니다.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  /**
   * ★ gemma4:e2b는 `thinking` 능력을 가지며, 추론 텍스트를 content가 아닌
   * 이 필드로 따로 스트리밍한다. 파서가 분기하지 않으면 화면이 오염된다.
   */
  thinking?: string;
  /** base64. `data:image/png;base64,` 프리픽스는 제외한 순수 페이로드. */
  images?: string[];
  tool_calls?: ToolCall[];
  /** role === 'tool' 인 응답 메시지에서 어떤 툴의 결과인지 표시 */
  tool_name?: string;
}

export interface ToolCall {
  /** 예: "call_xz7pgw03" */
  id: string;
  function: {
    index: number;
    name: string;
    /**
     * ★ Ollama는 이미 파싱된 **객체**를 준다. OpenAI처럼 JSON 문자열이 아니다.
     * `JSON.parse(arguments)` 하면 터진다.
     */
    arguments: Record<string, unknown>;
  };
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, JsonSchemaProp>;
      required: string[];
    };
  };
}

export interface JsonSchemaProp {
  type: 'string' | 'number' | 'integer' | 'boolean';
  description: string;
  enum?: string[];
}

export interface ChatOptions {
  temperature?: number;
  /**
   * ★ 세션 중 변경 금지. 값이 바뀌면 Ollama가 모델을 통째로 리로드하며,
   * 실측 기준 약 20초가 날아간다. 워밍업 요청도 반드시 같은 값을 써야 한다.
   */
  num_ctx?: number;
  num_predict?: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: true;
  /**
   * ★ 기본 false. 실측에서 thinking ON이 동일 품질 답변의 총 지연을
   * 2.5초 → 15.7초로 6.4배 늘렸다. 에이전트 계획 단계에서만 켠다.
   */
  think?: boolean;
  /** 기본 "10m". 16GB 머신에서 6.9GB 상주라 30분은 과하다. */
  keep_alive?: string;
  tools?: ToolSchema[];
  /** 구조화 출력용 JSON 스키마. 소형 모델의 형식 이탈을 막는다(핵심·조치사항 카드). */
  format?: Record<string, unknown>;
  options?: ChatOptions;
}

/** 스트림 종료 청크. 이 프로젝트의 모든 성능 계측이 여기서 나온다. */
export interface DoneChunk {
  done: true;
  done_reason: 'stop' | 'length' | 'load';
  model: string;
  /** 프리필 토큰 수 */
  prompt_eval_count: number;
  /** 프리필 소요 (나노초) */
  prompt_eval_duration: number;
  /** 생성 토큰 수 */
  eval_count: number;
  /** 생성 소요 (나노초) */
  eval_duration: number;
  /** 전체 소요 (나노초). ★ 콜드 스타트 시 모델 로드 시간이 포함된다. */
  total_duration: number;
  load_duration?: number;
}

/** 스트리밍 중 오는 개별 NDJSON 라인 */
export interface StreamChunk {
  model: string;
  created_at: string;
  message?: Partial<ChatMessage>;
  done: boolean;
  done_reason?: DoneChunk['done_reason'];
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  load_duration?: number;
}

/* ── /api/tags ─────────────────────────────────────────── */

export type Capability =
  | 'completion'
  | 'vision'
  | 'audio'
  | 'tools'
  | 'thinking'
  | 'embedding';

export interface ModelInfo {
  name: string;
  model: string;
  size: number;
  modified_at: string;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    context_length?: number;
    embedding_length?: number;
  };
  capabilities?: Capability[];
}

export interface TagsResponse {
  models: ModelInfo[];
}

/* ── /api/ps — 모델 상주 여부와 CPU/GPU 배치 확인 ────────── */

export interface RunningModel {
  name: string;
  model: string;
  size: number;
  size_vram: number;
  context_length?: number;
  expires_at: string;
}

export interface PsResponse {
  models: RunningModel[];
}

/* ── /api/embed — bge-m3, 1024-dim ─────────────────────── */

export interface EmbedRequest {
  model: string;
  input: string | string[];
  keep_alive?: string;
}

export interface EmbedResponse {
  model: string;
  embeddings: number[][];
}

/* ── 성능 계측 ─────────────────────────────────────────── */

/** DoneChunk를 사람이 읽는 단위로 환산한 것. 계획서 §6 목표 대조용. */
export interface PerfSample {
  /** 첫 토큰까지 (ms) — 벽시계 기준 */
  ttfbMs: number;
  /** 프리필 처리량 (tok/s). 실측 기준선 131–161 */
  prefillTokPerSec: number;
  /** 생성 처리량 (tok/s). 실측 기준선 21 */
  decodeTokPerSec: number;
  promptTokens: number;
  outputTokens: number;
  totalMs: number;
  /** 모델 로드가 발생했는가 (콜드 스타트) */
  wasCold: boolean;
}
