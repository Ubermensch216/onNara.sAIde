export type ProviderId = 'ollama' | 'gov-ai';
export type ProcessingLocation = 'local' | 'external';
export type ProviderHealthState = 'ready' | 'unavailable' | 'unauthorized' | 'error';

export interface AiModel {
  id: string;
  label: string;
  capabilities: Array<'chat' | 'embedding' | 'vision' | 'tools' | 'thinking'>;
}

export interface ProviderHealth {
  state: ProviderHealthState;
  detail?: string;
  version?: string;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatOptions {
  model: string;
  turns: ChatTurn[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
}

/**
 * 기능 코드는 이 계약만 사용한다. 공급자별 HTTP 형식과 인증 방식은 어댑터가
 * 책임지므로 Ollama와 범정부 AI 공통기반을 바꿔도 업무 기능을 수정하지 않는다.
 */
export interface LlmProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly processingLocation: ProcessingLocation;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  listModels(signal?: AbortSignal): Promise<AiModel[]>;
  chat(options: ChatOptions): Promise<void>;
  embed(model: string, input: string[], signal?: AbortSignal): Promise<number[][]>;
}
