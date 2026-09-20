import { updateMemoryPolicy } from '@/lib/memory/store';

/**
 * 계약 ③ — 설정 스키마와 영속화. 계획서 §4.3
 *
 * ★ 기본값은 실측(100% CPU, 프리필 131–161 tok/s)에 맞춘 값이다.
 *   GPU 머신으로 이전하면 코드가 아니라 **이 값들만** 바꾸면 v2 원안으로 복귀한다.
 *   그래서 하드코딩하지 않고 전부 설정으로 뺐다. 계획서 §11 리스크 6′.
 */

export type ThinkMode = 'off' | 'agent-only' | 'always';
export type ThemePref = 'light' | 'dark' | 'system';
export type Locale = 'ko' | 'en';

export interface Settings {
  endpoint: string;
  model: string;
  embedModel: string;
  temperature: number;

  /**
   * ★ 세션 중 변경 금지 (모델 리로드 유발).
   * v2는 16384였으나 프리필 131 tok/s에서는 과하다.
   */
  numCtx: number;

  /** v2는 '30m'. 16GB에 6.9GB 상주라 10분으로 낮춘다. */
  keepAlive: string;

  /** 'agent-only' = 툴 콜링 계획 단계에서만 thinking ON. 실측상 6.4배 차이. */
  thinkMode: ThinkMode;

  /** 페이지 본문에 허용할 토큰. 2000 ≈ 한국어 4,000자 ≈ 프리필 약 15초. */
  pageTokenBudget: number;

  /**
   * Phase 5. 에이전트 모드(툴 콜링) 사용 여부.
   * 기본 켜짐이되 입력창에서 명시적으로 켜야 동작한다 — 일반 대화가 매 턴
   * 툴 스키마 프리필을 무는 일이 없어야 한다.
   */
  agentEnabled: boolean;
  /** 루프 턴 상한. 이 하드웨어에서 1턴 약 25초라 8턴이면 최악 3분이다. */
  agentMaxTurns: number;

  /** Phase 6. 방문 페이지 임베딩 저장 여부 — 기본 꺼짐(옵트인). */
  memoryEnabled: boolean;
  /** 임베딩에서 제외할 도메인. */
  memoryExcludedDomains: string[];
  /** 보관 기간(일). 0이면 무기한. */
  memoryRetentionDays: number;

  locale: Locale;
  theme: ThemePref;

  /** 패널 오픈 시 워밍업 요청을 보낼지. 콜드 21.5초를 감추는 유일한 수단. */
  warmupOnOpen: boolean;

  /**
   * 일정(S07) 기한 알림. 하루 한 번, 지난 기한·오늘·내일 기한을 묶어 알린다.
   * 기본 켜짐 — 기한 보드를 두는 이유가 알림이다.
   */
  taskAlerts: boolean;
  /** 알릴 시각(0~23시). 업무 시작 무렵이 기본이다. */
  taskAlertHour: number;

  /**
   * 오래 걸린 작업이 끝나면 알린다(B2). 30초를 넘긴 작업에만 울린다.
   * 기본 켜짐 — 작업을 큐에 맡기게 만든 이유가 "끝난 줄 모르는 것"이다.
   */
  jobAlerts: boolean;

  /**
   * 첨부 파일명 정규화(B5). 'normalized'면 `보고일자_공문제목_원래이름`으로 저장한다.
   *
   * ★ 기본값을 정규화로 둔다. `붙임1.hwp` 다섯 개가 한 폴더에 떨어지는 것이 지금의 기본값인데,
   *   그것은 아무도 원한 적 없는 결과다. 원래 이름 그대로가 필요하면 'browser'로 되돌린다.
   */
  attachmentNaming: 'browser' | 'normalized';
  /** 공문마다 하위 폴더를 만들지. 기본 꺼짐 — 폴더가 늘어나는 것을 싫어하는 사용자가 있다. */
  attachmentFolder: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  endpoint: 'http://localhost:11434',
  model: 'gemma4:e2b',
  embedModel: 'bge-m3',
  temperature: 0.7,

  numCtx: 4096,
  keepAlive: '10m',
  thinkMode: 'agent-only',
  pageTokenBudget: 2000,

  agentEnabled: true,
  agentMaxTurns: 8,

  memoryEnabled: false,
  memoryExcludedDomains: [],
  memoryRetentionDays: 30,

  locale: 'ko',
  theme: 'system',
  warmupOnOpen: true,

  taskAlerts: true,
  taskAlertHour: 9,

  jobAlerts: true,
  attachmentNaming: 'normalized',
  attachmentFolder: false,
};

const KEY = 'saide.settings';

export function normalizeSettings(input: unknown): Settings {
  const raw = input && typeof input === 'object' ? input as Partial<Settings> : {};
  const next = { ...DEFAULT_SETTINGS };
  const enums = {
    thinkMode: ['off', 'agent-only', 'always'], theme: ['light', 'dark', 'system'], locale: ['ko', 'en'],
    attachmentNaming: ['browser', 'normalized'],
  };
  for (const [key, values] of Object.entries(enums)) {
    const value = raw[key as keyof Settings];
    if (values.includes(String(value))) Object.assign(next, { [key]: value });
  }
  for (const key of ['agentEnabled', 'memoryEnabled', 'warmupOnOpen', 'taskAlerts', 'jobAlerts', 'attachmentFolder'] as const) if (typeof raw[key] === 'boolean') next[key] = raw[key];
  for (const key of ['model', 'embedModel'] as const) if (typeof raw[key] === 'string' && /^[\w.:/-]{1,200}$/.test(raw[key])) next[key] = raw[key];
  if (typeof raw.endpoint === 'string') {
    try {
      const url = new URL(raw.endpoint);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) next.endpoint = url.href.replace(/\/+$/, '');
    } catch { /* damaged settings use a safe default */ }
  }
  // 이전 버전의 agentIdleTimeoutMs 저장값은 읽지 않는다. LLM 응답은 무기한 대기한다.
  const ranges = { temperature: [0, 1.5], numCtx: [2048, 32768], pageTokenBudget: [500, 8000], agentMaxTurns: [2, 12], memoryRetentionDays: [0, 3650], taskAlertHour: [0, 23] };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = raw[key as keyof Settings];
    if (typeof value === 'number' && Number.isFinite(value)) Object.assign(next, { [key]: Math.min(max!, Math.max(min!, key === 'temperature' ? value : Math.round(value))) });
  }
  if (['5m', '10m', '30m', '-1'].includes(raw.keepAlive ?? '')) next.keepAlive = raw.keepAlive!;
  if (Array.isArray(raw.memoryExcludedDomains)) next.memoryExcludedDomains = [...new Set(raw.memoryExcludedDomains
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim().toLowerCase().replace(/^\.+|\.$/g, ''))
    .filter(v => /^[a-z0-9.-]+$/.test(v)))].slice(0, 500);
  return next;
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(KEY);
  return normalizeSettings(raw?.[KEY]);
}

let writes: Promise<unknown> = Promise.resolve();
function withSettingsLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('saide.settings', work);
  const next = writes.then(work, work);
  writes = next.catch(() => undefined);
  return next;
}

async function persist(next: Settings, memoryChanged: boolean): Promise<Settings> {
  if (memoryChanged) await updateMemoryPolicy({ enabled: next.memoryEnabled, excluded: next.memoryExcludedDomains });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return withSettingsLock(async () => {
    const next = normalizeSettings({ ...(await loadSettings()), ...patch });
    if (patch.endpoint !== undefined) {
      let valid = false;
      try { const url = new URL(patch.endpoint); valid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; } catch { /* invalid */ }
      if (!valid) throw new Error('올바른 HTTP/HTTPS Ollama 주소를 입력하세요.');
    }
    return persist(next, patch.memoryEnabled !== undefined || patch.memoryExcludedDomains !== undefined);
  });
}

export async function resetSettings(): Promise<Settings> {
  return withSettingsLock(() => persist({ ...DEFAULT_SETTINGS, memoryExcludedDomains: [] }, true));
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local' || !changes[KEY]) return;
    cb(normalizeSettings(changes[KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/* ── 실측 기반 대기시간 예측 ───────────────────────────── */

/** 이 머신 실측 하한. 설정 UI가 "예상 대기시간"을 정직하게 보여주기 위한 상수. */
export const MEASURED_PREFILL_TOK_PER_SEC = 131;
export const MEASURED_DECODE_TOK_PER_SEC = 21;
export const MEASURED_COLD_LOAD_SEC = 21.5;

/**
 * 프롬프트 토큰 수로 첫 토큰까지의 대기시간을 추정한다.
 * 설정 화면의 예산 슬라이더 옆에 실시간으로 띄운다 —
 * 사용자가 비용을 알고 예산을 늘리게 하기 위해서다.
 */
export function estimateTtfbSeconds(promptTokens: number, cold = false): number {
  const prefill = promptTokens / MEASURED_PREFILL_TOK_PER_SEC;
  return Math.round((prefill + (cold ? MEASURED_COLD_LOAD_SEC : 0)) * 10) / 10;
}
