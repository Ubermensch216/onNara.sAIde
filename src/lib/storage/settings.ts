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

  /* ── 공유/공람 브리핑(N1) ─────────────────────────────── */

  /**
   * 아침 브리핑을 켤지. **기본 꺼짐.**
   *
   * ★ 켜는 순간이 사용자의 승인이다. 이 기능만이 사용자가 누르지 않아도 백그라운드 탭을
   *   만들어 온나라 목록을 읽는다. 기본값으로 켜 두면 승인 없는 자동 실행이 된다
   *   (docs/n1-inbox-briefing-plan.md §7).
   */
  briefingEnabled: boolean;
  /** 브리핑할 시각(0~23시). 기한 알림과 같은 시각이 기본이다. */
  briefingHour: number;

  /**
   * 브리핑이 문서를 열 것인가 — 곧 **열람 상태를 바꿀 것인가**.
   *
   * ★ 열람 처리는 온나라 서버가 상세 화면을 내려줄 때 기록하므로, 확장이 되돌릴 수 없다.
   *   그래서 되돌릴 수 없는 쪽을 기본값으로 두지 않는다.
   *
   * - `keep-unread` 목록 표만 읽는다. 미열람 그대로.
   * - `mark-read`   브리핑에 실린 문서를 한 번씩 열어 열람 처리한다. 요약은 하지 않는다.
   *
   * ★ 본문 요약까지 만드는 갈래(`brief-body`)는 아직 없다. 모르는 값은 기본값으로 떨어지고,
   *   기본값은 상태를 바꾸지 않는 쪽이다 — 설정을 잘못 읽어 문서가 열리는 일은 없어야 한다.
   */
  briefingReadPolicy: 'keep-unread' | 'mark-read';
  /** `mark-read`에서 한 번에 열 문서 수 상한. 문서당 수 초가 든다. */
  briefingOpenLimit: number;

  /** 브리핑 대상 범위. `keywords`면 아래 키워드에 걸리는 문서만 싣는다. */
  briefingScope: 'all' | 'keywords';
  /** 포함 키워드. `all`에서도 '내 업무로 보임' 판정에 쓰인다. */
  briefingKeywords: string[];
  /** 제외 키워드. 범위와 무관하게 언제나 먼저 적용된다. */
  briefingExcludeKeywords: string[];
  /** 키워드를 대조할 칸. */
  briefingFields: Array<'title' | 'sender' | 'department'>;
  /** 브리핑 원장 보관 기간(일). 공문 제목이 남는 자리라 기간을 둔다. */
  briefingRetentionDays: number;
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

  briefingEnabled: false,
  briefingHour: 9,
  briefingReadPolicy: 'keep-unread',
  briefingOpenLimit: 5,
  briefingScope: 'all',
  briefingKeywords: [],
  briefingExcludeKeywords: [],
  briefingFields: ['title', 'sender', 'department'],
  briefingRetentionDays: 60,
};

/** 키워드 한 개의 글자 수 상한과 개수 상한. 화면과 대조 비용을 함께 지킨다. */
const KEYWORD_MAX_LENGTH = 40;
const KEYWORD_MAX_COUNT = 100;

/**
 * 키워드 목록 정규화.
 *
 * ★ 글자를 바꾸지 않는다(소문자화·공백 제거를 하지 않는다). 대조는 [inbox/scope.ts]가
 *   정규화해서 하고, 여기 남는 값은 **사용자가 적은 그대로** 화면에 다시 보여야 한다.
 */
function normalizeKeywords(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length >= 1 && item.length <= KEYWORD_MAX_LENGTH))]
    .slice(0, KEYWORD_MAX_COUNT);
}

const KEY = 'saide.settings';

export function normalizeSettings(input: unknown): Settings {
  const raw = input && typeof input === 'object' ? input as Partial<Settings> : {};
  const next = { ...DEFAULT_SETTINGS };
  const enums = {
    thinkMode: ['off', 'agent-only', 'always'], theme: ['light', 'dark', 'system'], locale: ['ko', 'en'],
    attachmentNaming: ['browser', 'normalized'],
    briefingReadPolicy: ['keep-unread', 'mark-read'], briefingScope: ['all', 'keywords'],
  };
  for (const [key, values] of Object.entries(enums)) {
    const value = raw[key as keyof Settings];
    if (values.includes(String(value))) Object.assign(next, { [key]: value });
  }
  for (const key of ['agentEnabled', 'memoryEnabled', 'warmupOnOpen', 'taskAlerts', 'jobAlerts', 'attachmentFolder', 'briefingEnabled'] as const) if (typeof raw[key] === 'boolean') next[key] = raw[key];
  for (const key of ['model', 'embedModel'] as const) if (typeof raw[key] === 'string' && /^[\w.:/-]{1,200}$/.test(raw[key])) next[key] = raw[key];
  if (typeof raw.endpoint === 'string') {
    try {
      const url = new URL(raw.endpoint);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) next.endpoint = url.href.replace(/\/+$/, '');
    } catch { /* damaged settings use a safe default */ }
  }
  // 이전 버전의 agentIdleTimeoutMs 저장값은 읽지 않는다. LLM 응답은 무기한 대기한다.
  const ranges = {
    temperature: [0, 1.5], numCtx: [2048, 32768], pageTokenBudget: [500, 8000], agentMaxTurns: [2, 12],
    memoryRetentionDays: [0, 3650], taskAlertHour: [0, 23],
    briefingHour: [0, 23], briefingOpenLimit: [1, 20], briefingRetentionDays: [7, 365],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = raw[key as keyof Settings];
    if (typeof value === 'number' && Number.isFinite(value)) Object.assign(next, { [key]: Math.min(max!, Math.max(min!, key === 'temperature' ? value : Math.round(value))) });
  }
  if (['5m', '10m', '30m', '-1'].includes(raw.keepAlive ?? '')) next.keepAlive = raw.keepAlive!;
  for (const key of ['briefingKeywords', 'briefingExcludeKeywords'] as const) {
    const keywords = normalizeKeywords(raw[key]);
    if (keywords) next[key] = keywords;
  }
  if (Array.isArray(raw.briefingFields)) {
    const fields = [...new Set(raw.briefingFields.filter((field): field is Settings['briefingFields'][number] =>
      field === 'title' || field === 'sender' || field === 'department'))];
    // ★ 빈 목록은 받지 않는다. 대조할 칸이 없으면 모든 키워드가 빗나가, 사용자는
    //   키워드를 잘못 적은 줄 알고 계속 고치게 된다.
    if (fields.length) next.briefingFields = fields;
  }
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
