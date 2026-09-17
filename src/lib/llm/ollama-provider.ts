import { checkHealth, embed as ollamaEmbed, listModels as listOllamaModels } from '@/lib/ollama/client';
import { streamChat } from '@/lib/ollama/stream';
import type { Capability } from '@/types/ollama';
import type { ProviderConfig } from './config';
import type { AiModel, ChatOptions, LlmProvider, ProviderHealth } from './provider';

const capabilityMap: Partial<Record<Capability, AiModel['capabilities'][number]>> = {
  completion: 'chat',
  embedding: 'embedding',
  vision: 'vision',
  tools: 'tools',
  thinking: 'thinking',
};

export class OllamaProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  readonly label: string;
  readonly processingLocation = 'local' as const;

  constructor(private readonly config: ProviderConfig) {
    if (config.id !== 'ollama') throw new Error('Ollama 공급자 설정이 아닙니다.');
    this.label = config.label;
  }

  async health(): Promise<ProviderHealth> {
    const model = this.config.chatModels[0];
    if (!this.config.configured || !model) return { state: 'unavailable', detail: 'Ollama 엔드포인트 또는 대화 모델이 설정되지 않았습니다.' };
    const report = await checkHealth(this.config.endpoint, model);
    if (report.state === 'ok' || report.state === 'cold') return { state: 'ready', version: report.version };
    return { state: 'error', detail: report.error?.message, version: report.version };
  }

  async listModels(): Promise<AiModel[]> {
    if (!this.config.endpoint) return [];
    return (await listOllamaModels(this.config.endpoint)).map(model => ({
      id: model.name,
      label: model.name,
      capabilities: [...new Set((model.capabilities ?? []).map(capability => capabilityMap[capability]).filter((capability): capability is AiModel['capabilities'][number] => Boolean(capability)))],
    }));
  }

  async chat(options: ChatOptions): Promise<void> {
    if (!this.config.chatModels.includes(options.model)) throw new Error(`허용되지 않은 Ollama 대화 모델입니다: ${options.model}`);
    await streamChat(this.config.endpoint, {
      model: options.model,
      messages: options.turns,
      stream: true,
    }, { onToken: options.onToken }, options.signal);
  }

  async embed(model: string, input: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!this.config.embedModels.includes(model)) throw new Error(`허용되지 않은 Ollama 임베딩 모델입니다: ${model}`);
    return ollamaEmbed(this.config.endpoint, model, input, '0', signal);
  }
}
