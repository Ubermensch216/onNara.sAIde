import type { ProcessingLocation, ProviderId } from './provider';

export type FeatureId = 'briefing' | 'distribution' | 'drafting' | 'proofreading' | 'qa' | 'embedding';
export type EgressPolicy = 'block' | 'confirm' | 'allow';
export type ContentRetention = 'session' | 'persistent';
export type ConfigSource = 'institution-policy' | 'user' | 'build' | 'safe-default';

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  endpoint: string;
  chatModels: string[];
  embedModels: string[];
  processingLocation: ProcessingLocation;
  configured: boolean;
}

export interface AiPreferences {
  defaultProvider?: ProviderId;
  featureModels?: Partial<Record<FeatureId, string>>;
  externalEgressPolicy?: EgressPolicy;
  localContentRetention?: ContentRetention;
}

export interface ProviderOverride {
  endpoint?: string;
  chatModels?: string[];
  embedModels?: string[];
}

export interface InstitutionAiPolicy extends AiPreferences {
  providers?: Partial<Record<ProviderId, ProviderOverride>>;
}

export interface BuildAiConfig extends AiPreferences {
  providers?: Partial<Record<ProviderId, ProviderOverride>>;
}

export interface ResolvedAiConfig {
  defaultProvider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  featureModels: Record<FeatureId, string>;
  externalEgressPolicy: EgressPolicy;
  localContentRetention: ContentRetention;
  sources: Record<string, ConfigSource>;
}

export const AI_PREFERENCES_KEY = 'onnara.saide.ai.preferences';
export const AI_POLICY_KEY = 'onnara.saide.policy';

const FEATURES: FeatureId[] = ['briefing', 'distribution', 'drafting', 'proofreading', 'qa', 'embedding'];
const MODEL_PATTERN = /^[\w./-]+(?::[\w.-]+)*$/;

const SAFE_DEFAULTS: ResolvedAiConfig = {
  defaultProvider: 'ollama',
  providers: {
    ollama: {
      id: 'ollama',
      label: '내 PC · Ollama',
      endpoint: 'http://127.0.0.1:11434',
      chatModels: ['gemma4:e2b'],
      embedModels: ['bge-m3:latest'],
      processingLocation: 'local',
      configured: true,
    },
    'gov-ai': {
      id: 'gov-ai',
      label: '범정부 AI 공통기반',
      endpoint: '',
      chatModels: [],
      embedModels: [],
      processingLocation: 'external',
      configured: false,
    },
  },
  featureModels: {
    briefing: 'ollama:gemma4:e2b',
    distribution: 'ollama:gemma4:e2b',
    drafting: 'ollama:gemma4:e2b',
    proofreading: 'ollama:gemma4:e2b',
    qa: 'ollama:gemma4:e2b',
    embedding: 'ollama:bge-m3:latest',
  },
  externalEgressPolicy: 'confirm',
  localContentRetention: 'session',
  sources: {},
};

type Env = Record<string, string | boolean | undefined>;

const textValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function endpointValue(value: unknown): string | undefined {
  const text = textValue(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return url.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function modelList(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const result = [...new Set(values.map(value => typeof value === 'string' ? value.trim() : '').filter(value => MODEL_PATTERN.test(value)))];
  return result.length ? result : undefined;
}

function modelRef(value: unknown): string | undefined {
  const text = textValue(value);
  if (!text) return undefined;
  const separator = text.indexOf(':');
  if (separator < 1) return undefined;
  const provider = text.slice(0, separator);
  const model = text.slice(separator + 1);
  return (provider === 'ollama' || provider === 'gov-ai') && MODEL_PATTERN.test(model) ? text : undefined;
}

export function readBuildAiConfig(env: Env = import.meta.env as Env): BuildAiConfig {
  const featureModels: Partial<Record<FeatureId, string>> = {};
  const names: Record<FeatureId, string> = {
    briefing: 'WXT_MODEL_BRIEFING',
    distribution: 'WXT_MODEL_DISTRIBUTION',
    drafting: 'WXT_MODEL_DRAFTING',
    proofreading: 'WXT_MODEL_PROOFREADING',
    qa: 'WXT_MODEL_QA',
    embedding: 'WXT_MODEL_EMBEDDING',
  };
  for (const feature of FEATURES) {
    const value = modelRef(env[names[feature]]);
    if (value) featureModels[feature] = value;
  }

  const defaultProvider = env.WXT_LLM_DEFAULT_PROVIDER;
  const externalEgressPolicy = env.WXT_EXTERNAL_EGRESS_POLICY;
  const localContentRetention = env.WXT_LOCAL_CONTENT_RETENTION;
  return {
    ...(defaultProvider === 'ollama' || defaultProvider === 'gov-ai' ? { defaultProvider } : {}),
    ...(externalEgressPolicy === 'block' || externalEgressPolicy === 'confirm' || externalEgressPolicy === 'allow' ? { externalEgressPolicy } : {}),
    ...(localContentRetention === 'session' || localContentRetention === 'persistent' ? { localContentRetention } : {}),
    featureModels,
    providers: {
      ollama: {
        endpoint: endpointValue(env.WXT_OLLAMA_ENDPOINT),
        chatModels: modelList(env.WXT_OLLAMA_CHAT_MODELS),
        embedModels: modelList(env.WXT_OLLAMA_EMBED_MODEL),
      },
      'gov-ai': {
        endpoint: endpointValue(env.WXT_GOV_AI_ENDPOINT),
        chatModels: modelList(env.WXT_GOV_AI_CHAT_MODELS),
      },
    },
  };
}

function choose<T>(
  path: string,
  sources: Record<string, ConfigSource>,
  validate: (value: unknown) => T | undefined,
  policy: unknown,
  user: unknown,
  build: unknown,
  fallback: T,
): T {
  const candidates: Array<[unknown, ConfigSource]> = [
    [policy, 'institution-policy'],
    [user, 'user'],
    [build, 'build'],
    [fallback, 'safe-default'],
  ];
  for (const [candidate, source] of candidates) {
    const value = validate(candidate);
    if (value !== undefined) {
      sources[path] = source;
      return value;
    }
  }
  sources[path] = 'safe-default';
  return fallback;
}

const providerId = (value: unknown): ProviderId | undefined => value === 'ollama' || value === 'gov-ai' ? value : undefined;
const egressPolicy = (value: unknown): EgressPolicy | undefined => value === 'block' || value === 'confirm' || value === 'allow' ? value : undefined;
const retention = (value: unknown): ContentRetention | undefined => value === 'session' || value === 'persistent' ? value : undefined;

export function resolveAiConfig(
  policy: InstitutionAiPolicy = {},
  user: AiPreferences = {},
  build: BuildAiConfig = readBuildAiConfig(),
): ResolvedAiConfig {
  const sources: Record<string, ConfigSource> = {};
  const providers = structuredClone(SAFE_DEFAULTS.providers);

  for (const id of ['ollama', 'gov-ai'] as const) {
    const buildProvider = build.providers?.[id];
    const policyProvider = policy.providers?.[id];
    providers[id].endpoint = choose(`providers.${id}.endpoint`, sources, endpointValue, policyProvider?.endpoint, undefined, buildProvider?.endpoint, providers[id].endpoint);
    providers[id].chatModels = choose(`providers.${id}.chatModels`, sources, modelList, policyProvider?.chatModels, undefined, buildProvider?.chatModels, providers[id].chatModels);
    providers[id].embedModels = choose(`providers.${id}.embedModels`, sources, modelList, policyProvider?.embedModels, undefined, buildProvider?.embedModels, providers[id].embedModels);
    providers[id].configured = Boolean(providers[id].endpoint && (providers[id].chatModels.length || providers[id].embedModels.length));
  }

  const featureModels = {} as Record<FeatureId, string>;
  for (const feature of FEATURES) {
    featureModels[feature] = choose(`featureModels.${feature}`, sources, modelRef, policy.featureModels?.[feature], user.featureModels?.[feature], build.featureModels?.[feature], SAFE_DEFAULTS.featureModels[feature]);
  }

  return {
    defaultProvider: choose('defaultProvider', sources, providerId, policy.defaultProvider, user.defaultProvider, build.defaultProvider, SAFE_DEFAULTS.defaultProvider),
    providers,
    featureModels,
    externalEgressPolicy: choose('externalEgressPolicy', sources, egressPolicy, policy.externalEgressPolicy, user.externalEgressPolicy, build.externalEgressPolicy, SAFE_DEFAULTS.externalEgressPolicy),
    localContentRetention: choose('localContentRetention', sources, retention, policy.localContentRetention, user.localContentRetention, build.localContentRetention, SAFE_DEFAULTS.localContentRetention),
    sources,
  };
}

function normalizePreferences(value: unknown): AiPreferences {
  if (!value || typeof value !== 'object') return {};
  const raw = value as AiPreferences;
  const result: AiPreferences = {};
  if (providerId(raw.defaultProvider)) result.defaultProvider = raw.defaultProvider;
  if (egressPolicy(raw.externalEgressPolicy)) result.externalEgressPolicy = raw.externalEgressPolicy;
  if (retention(raw.localContentRetention)) result.localContentRetention = raw.localContentRetention;
  const featureModels: Partial<Record<FeatureId, string>> = {};
  for (const feature of FEATURES) {
    const value = modelRef(raw.featureModels?.[feature]);
    if (value) featureModels[feature] = value;
  }
  if (Object.keys(featureModels).length) result.featureModels = featureModels;
  return result;
}

function normalizePolicy(value: unknown): InstitutionAiPolicy {
  const preferences = normalizePreferences(value);
  if (!value || typeof value !== 'object') return preferences;
  const raw = value as InstitutionAiPolicy;
  const providers: InstitutionAiPolicy['providers'] = {};
  for (const id of ['ollama', 'gov-ai'] as const) {
    const input = raw.providers?.[id];
    if (!input) continue;
    const next: ProviderOverride = {};
    const endpoint = endpointValue(input.endpoint);
    const chatModels = modelList(input.chatModels);
    const embedModels = modelList(input.embedModels);
    if (endpoint) next.endpoint = endpoint;
    if (chatModels) next.chatModels = chatModels;
    if (embedModels) next.embedModels = embedModels;
    if (Object.keys(next).length) providers[id] = next;
  }
  return Object.keys(providers).length ? { ...preferences, providers } : preferences;
}

export async function loadAiPreferences(): Promise<AiPreferences> {
  const stored = await chrome.storage.local.get(AI_PREFERENCES_KEY);
  return normalizePreferences(stored[AI_PREFERENCES_KEY]);
}

export async function saveAiPreferences(patch: AiPreferences): Promise<AiPreferences> {
  const current = await loadAiPreferences();
  const next = normalizePreferences({
    ...current,
    ...patch,
    featureModels: { ...current.featureModels, ...patch.featureModels },
  });
  await chrome.storage.local.set({ [AI_PREFERENCES_KEY]: next });
  return next;
}

export async function loadInstitutionAiPolicy(): Promise<InstitutionAiPolicy> {
  try {
    const stored = await chrome.storage.managed.get(AI_POLICY_KEY);
    return normalizePolicy(stored[AI_POLICY_KEY]);
  } catch {
    // 관리형 저장소 스키마가 없는 개발 환경은 정책 없음으로 처리한다.
    return {};
  }
}

export async function loadResolvedAiConfig(): Promise<ResolvedAiConfig> {
  const [policy, user] = await Promise.all([loadInstitutionAiPolicy(), loadAiPreferences()]);
  return resolveAiConfig(policy, user);
}
