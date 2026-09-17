import { beforeEach, expect, it, vi } from 'vitest';
import { resolveAiConfig } from './config';
import { OllamaProvider } from './ollama-provider';
import { assessTransfer } from './transfer-policy';

const client = vi.hoisted(() => ({
  checkHealth: vi.fn(),
  embed: vi.fn(),
  listModels: vi.fn(),
  streamChat: vi.fn(),
}));

vi.mock('@/lib/ollama/client', () => ({
  checkHealth: client.checkHealth,
  embed: client.embed,
  listModels: client.listModels,
}));
vi.mock('@/lib/ollama/stream', () => ({ streamChat: client.streamChat }));

beforeEach(() => vi.clearAllMocks());

it('Ollama 상태와 모델 능력을 공통 형식으로 변환한다', async () => {
  client.checkHealth.mockResolvedValue({ state: 'cold', version: '0.34.1', models: [], resident: false, onGpu: false });
  client.listModels.mockResolvedValue([{ name: 'gemma4:e2b', capabilities: ['completion', 'vision', 'tools'] }]);
  const provider = new OllamaProvider(resolveAiConfig().providers.ollama);
  expect(await provider.health()).toEqual({ state: 'ready', version: '0.34.1' });
  expect(await provider.listModels()).toEqual([{
    id: 'gemma4:e2b',
    label: 'gemma4:e2b',
    capabilities: ['chat', 'vision', 'tools'],
  }]);
});

it('허용된 모델만 대화와 임베딩에 사용한다', async () => {
  client.streamChat.mockResolvedValue(null);
  client.embed.mockResolvedValue([[0.1, 0.2]]);
  const provider = new OllamaProvider(resolveAiConfig().providers.ollama);
  const tokens: string[] = [];
  await provider.chat({ model: 'gemma4:e2b', turns: [{ role: 'user', content: '안녕' }], onToken: token => tokens.push(token) });
  await expect(provider.chat({ model: 'unknown', turns: [], onToken: () => undefined })).rejects.toThrow('허용되지 않은');
  expect(await provider.embed('bge-m3:latest', ['본문'])).toEqual([[0.1, 0.2]]);
  expect(client.streamChat).toHaveBeenCalledOnce();
  expect(client.embed).toHaveBeenCalledWith('http://127.0.0.1:11434', 'bge-m3:latest', ['본문'], '0', undefined);
});

it('로컬 처리는 즉시 허용하고 외부 전송은 정책과 민감정보에 따라 막거나 확인한다', () => {
  expect(assessTransfer('local', 'block', true).decision).toBe('allow');
  expect(assessTransfer('external', 'block', false).decision).toBe('block');
  expect(assessTransfer('external', 'confirm', false).decision).toBe('confirm');
  expect(assessTransfer('external', 'allow', true).decision).toBe('confirm');
  expect(assessTransfer('external', 'allow', false).decision).toBe('allow');
});
