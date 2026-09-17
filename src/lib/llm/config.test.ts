import { afterEach, expect, it, vi } from 'vitest';
import {
  AI_POLICY_KEY,
  AI_PREFERENCES_KEY,
  loadResolvedAiConfig,
  readBuildAiConfig,
  resolveAiConfig,
  saveAiPreferences,
} from './config';

afterEach(() => vi.unstubAllGlobals());

it('기관 정책, 사용자 설정, 빌드값, 안전 기본값 순서로 해석한다', () => {
  const build = readBuildAiConfig({
    WXT_LLM_DEFAULT_PROVIDER: 'ollama',
    WXT_MODEL_BRIEFING: 'ollama:build-model',
    WXT_MODEL_QA: 'ollama:build-qa',
    WXT_EXTERNAL_EGRESS_POLICY: 'allow',
  });
  const config = resolveAiConfig(
    { featureModels: { briefing: 'gov-ai:policy-model' }, externalEgressPolicy: 'block' },
    { defaultProvider: 'gov-ai', featureModels: { briefing: 'ollama:user-model', qa: 'gov-ai:user-qa' } },
    build,
  );

  expect(config.defaultProvider).toBe('gov-ai');
  expect(config.featureModels.briefing).toBe('gov-ai:policy-model');
  expect(config.featureModels.qa).toBe('gov-ai:user-qa');
  expect(config.featureModels.embedding).toBe('ollama:bge-m3:latest');
  expect(config.externalEgressPolicy).toBe('block');
  expect(config.sources).toMatchObject({
    defaultProvider: 'user',
    'featureModels.briefing': 'institution-policy',
    'featureModels.qa': 'user',
    'featureModels.embedding': 'safe-default',
    externalEgressPolicy: 'institution-policy',
  });
});

it('잘못된 URL과 모델 식별자를 버리고 설정된 공급자만 활성화한다', () => {
  const build = readBuildAiConfig({
    WXT_OLLAMA_ENDPOINT: 'javascript:alert(1)',
    WXT_GOV_AI_ENDPOINT: 'https://ai.example.go.kr/v1/',
    WXT_GOV_AI_CHAT_MODELS: 'gov-chat, bad model,gov-chat',
  });
  const config = resolveAiConfig({}, {}, build);
  expect(config.providers.ollama.endpoint).toBe('http://127.0.0.1:11434');
  expect(config.providers['gov-ai']).toMatchObject({
    endpoint: 'https://ai.example.go.kr/v1',
    chatModels: ['gov-chat'],
    configured: true,
  });
});

it('관리 정책이 없는 개발 환경에서도 사용자 설정을 불러온다', async () => {
  let local: Record<string, unknown> = {};
  vi.stubGlobal('chrome', { storage: {
    local: {
      get: vi.fn(async () => structuredClone(local)),
      set: vi.fn(async (value: Record<string, unknown>) => { local = { ...local, ...structuredClone(value) }; }),
    },
    managed: { get: vi.fn(async () => { throw new Error('schema missing'); }) },
  } });

  await saveAiPreferences({ defaultProvider: 'gov-ai', featureModels: { drafting: 'gov-ai:draft-v1' } });
  const config = await loadResolvedAiConfig();
  expect(local[AI_PREFERENCES_KEY]).toBeTruthy();
  expect(local[AI_POLICY_KEY]).toBeUndefined();
  expect(config.defaultProvider).toBe('gov-ai');
  expect(config.featureModels.drafting).toBe('gov-ai:draft-v1');
});
