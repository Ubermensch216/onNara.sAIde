/**
 * Side Panel 루트. 계획서 §3 설계 결정 ①
 *
 * ★ LLM 호출의 주체는 이 문서다. Service Worker가 아니다.
 *   패널은 열려 있는 동안 살아 있는 실제 document이므로 장시간 스트리밍에
 *   안정적이다. (MV3 서비스 워커는 약 30초 유휴 시 죽는다.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkHealth, warmup, type HealthReport } from '@/lib/ollama/client';
import { setLocale, useT } from '@/lib/i18n';
import { createEmbedQueue, type EmbedQueue } from '@/lib/memory/queue';
import {
  recall,
  RECALL_ALIASES,
  RECALL_PRESET_ID,
  RECALL_SLASH,
} from '@/lib/memory/recall';
import { useChat } from '@/lib/chat/store';
import { listMessages, pruneEmptyConversations, type Conversation } from '@/lib/storage/db';
import { isRestrictedUrl, sameDocument, sendToSW } from '@/lib/messaging/protocol';
import type { SWToPanel, TabSummary } from '@/lib/messaging/protocol';
import {
  builtinCommands,
  customCommands,
  expandCommand,
  findPreset,
  PAGE_PRESETS,
  type CustomPreset,
  type SlashCommand,
} from '@/lib/prompts/presets';
import { loadCustomPresets, onCustomPresetsChanged } from '@/lib/storage/presets';
import { detectPageKind, kindHint, suggestedOrder } from '@/lib/extract/pagetype';
import { requestAllUrls, requestCaptureAccess, requestHostAccess, requestOriginsAccess } from '@/lib/permissions';
import { runDownloadLink } from '@/lib/downloads/links';
import { estimateTtfbSeconds } from '@/lib/storage/settings';
import {
  loadSettings,
  onSettingsChanged,
  DEFAULT_SETTINGS,
  MEASURED_COLD_LOAD_SEC,
  type Settings,
} from '@/lib/storage/settings';
import { canRunAgent as agentAllowed } from '@/lib/agent/executor';
import { SaideIcon, Wordmark } from './components/BrandMark';
import { ApprovalCard } from './components/ApprovalCard';
import { ErrorBanner } from './components/ErrorBanner';
import { HealthBanner } from './components/HealthBanner';
import { MessageList } from './components/MessageList';
import { ResetIcon } from './components/ChatActionIcons';
import { Composer } from './components/Composer';
import { ConversationMenu } from './components/ConversationMenu';
import { PageContextChip } from './components/PageContextChip';
import { PageActions } from './components/PageActions';
import { ScreenshotChip } from './components/ScreenshotChip';
import { AutomationPanel } from './components/AutomationPanel';
import { useAutomation } from '@/lib/automation/jobs';
import type { DownloadLinkAction } from '@/lib/downloads/links';
import type { AppError } from '@/lib/messaging/protocol';

type View = 'ai' | 'automation';
const VIEW_KEY = 'saide.view';

/** 마지막으로 연 탭은 이 브라우저에서만 기억한다. 저장소를 못 쓰면 AI 도우미로 시작한다. */
function initialView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'automation' ? 'automation' : 'ai'; } catch { return 'ai'; }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [health, setHealth] = useState<HealthReport>({
    state: 'checking',
    models: [],
    resident: false,
    onGpu: false,
  });
  const [warming, setWarming] = useState(false);
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<TabSummary | null>(null);
  const [draft, setDraft] = useState('');
  const [customs, setCustoms] = useState<CustomPreset[]>([]);
  /**
   * 에이전트 모드 (Phase 5). 켠 동안에만 툴 스키마가 붙는다.
   * 기본 꺼짐인 이유는 비용이다 — 툴 8종 설명이 매 턴 프리필에 들어간다.
   */
  const [agentMode, setAgentMode] = useState(false);
  /**
   * AI 도우미(판단·생성)와 자동화(온나라 화면의 정해진 동작)를 탭으로 나눈다.
   * 결과를 믿는 방식이 다르기 때문이다 — AI는 검토가 필요하고, 자동화는 실행 기록이 남는다.
   */
  const [view, setView] = useState<View>(initialView);
  const [automationError, setAutomationError] = useState<AppError | null>(null);
  const runningJobs = useAutomation(state => state.jobs.filter(job => job.status === 'queued' || job.status === 'running').length);
  const warmedFor = useRef('');

  const t = useT();
  const chat = useChat();

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* 기억하지 못해도 동작에는 지장 없다 */ }
  }, [view]);

  /* ── 설정 ── */
  useEffect(() => {
    loadSettings().then(setSettings);
    return onSettingsChanged(setSettings);
  }, []);

  // 설정의 언어를 i18n 스토어에 반영한다. React 밖(스토어·오류 분류)에서도
  // t()가 같은 로케일을 쓰도록 한 곳에서만 넣는다.
  useEffect(() => {
    setLocale(settings.locale);
  }, [settings.locale]);

  /* ── 빈 대화 청소 ──
   * 이전 버전이 탭을 열 때마다 빈 대화를 만들어 두었다. 그 잔재를 걷어낸다.
   * 지금은 첫 메시지를 보낼 때만 생성하므로 새로 쌓이지는 않는다.
   */
  useEffect(() => {
    void pruneEmptyConversations();
  }, []);

  /* ── 사용자 정의 프리셋 (Phase 4-4) ── */
  useEffect(() => {
    loadCustomPresets().then(setCustoms);
    return onCustomPresetsChanged(setCustoms);
  }, []);

  /* ── 테마 ──
   * shiki가 라이트/다크 중 어느 테마로 코드를 칠할지 알아야 하므로,
   * data-theme 속성만이 아니라 실제 적용된 값도 state로 들고 있어야 한다.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const resolve = () =>
      setDark(settings.theme === 'dark' || (settings.theme === 'system' && mq.matches));
    resolve();
    mq.addEventListener('change', resolve);
    return () => mq.removeEventListener('change', resolve);
  }, [settings.theme]);

  /* ── 헬스체크 ── */
  const refresh = useCallback(async () => {
    setHealth((h) => ({ ...h, state: 'checking' }));
    setHealth(await checkHealth(settings.endpoint, settings.model));
  }, [settings.endpoint, settings.model]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ── 탭별 세션 + 컨텍스트 메뉴 (Phase 2-5 / 3-6) ── */
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 지금 패널이 붙들고 있는 탭. 중복 이벤트를 걸러내는 기준이다.
  const currentTab = useRef<TabSummary | null>(null);

  useEffect(() => {
    let alive = true;

    /**
     * ★ 같은 문서로 다시 들어오면 세션을 갈아끼우지 않는다.
     *
     *   onUpdated / onActivated는 새로고침이나 탭 왕복만으로도 여러 번 온다.
     *   그때마다 openForTab을 부르면 붙여 둔 페이지가 떨어져, 사용자는
     *   "방금 붙였는데 왜 없어졌지" 상태가 된다.
     *   문서가 바뀌면 해당 세션을 표시하되, 숨겨진 세션의 작업은 계속된다.
     */
    const open = (t: TabSummary | null) => {
      if (!alive || !t || t.tabId < 0) return;

      const prev = currentTab.current;
      const same = prev && prev.tabId === t.tabId && sameDocument(prev.url, t.url);

      currentTab.current = t;
      setTab(t);
      if (same) return;

      void chat.openForTab(t.tabId, t.url);
    };

    sendToSW({ type: 'GET_ACTIVE_TAB' }).then((res) => {
      if (res.type === 'ACTIVE_TAB') open(res.tab);
    });

    const listener = (msg: SWToPanel) => {
      if (msg.type === 'TAB_CHANGED') {
        open(msg.tab);
      } else if (msg.type === 'CONTEXT_MENU') {
        handleContextMenu(msg.preset, msg.selectionText);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      alive = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
    // chat은 zustand 스토어라 참조가 안정적이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 컨텍스트 메뉴에서 온 선택 텍스트 처리.
   *
   * 'send'는 사용자가 무엇을 물을지 정해야 하므로 입력창에 넣기만 한다.
   * 나머지는 바로 보낸다 — 선택 텍스트는 짧아 프리필이 싸다.
   */
  const handleContextMenu = (presetId: string, selection: string) => {
    const preset = findPreset(presetId);
    if (!preset || !selection) return;

    const text = preset.build(selection);
    if (presetId === 'send') setDraft(text);
    else void chat.send(text, settingsRef.current);
  };

  /* ── 기억 큐 (Phase 6-1) ──
   *
   * ★ 대화 중에는 돌지 않는다. 16GB에 gemma(6.9GB)가 상주한 상태에서
   *   bge-m3를 아무 때나 올리면 대화용 모델이 밀려나고, 사용자는 다음
   *   질문에서 콜드 스타트 21초를 문다. 판정은 큐가 isBusy로 물어본다.
   */
  const queueRef = useRef<EmbedQueue | null>(null);
  useEffect(() => {
    const q = createEmbedQueue({
      isBusy: () => useChat.isBusy(),
      getSettings: () => settingsRef.current,
      // 실패해도 화면에 띄우지 않는다. 사용자가 요청한 일이 아니라
      // 뒤에서 도는 일이라, 배너를 띄우면 방해만 된다.
      onError: (e) => console.warn('[sAIde] 임베딩 실패', e),
    });
    queueRef.current = q;
    // 보관 기간이 지난 기억은 여기서 정리한다(6-3).
    void q.sweep();
    return () => {
      q.stop();
      queueRef.current = null;
    };
  }, []);

  /**
   * 읽어들인 페이지를 기억 큐에 넣는다.
   *
   * ★ 진입점이 여기 하나인 이유: 이 확장은 **읽은 페이지만** 기억할 수 있다.
   *   모든 방문을 잡으려면 상시 주입이 필요한데 그것은 설계 결정 ②를 뒤집는다.
   */
  useEffect(() => {
    const page = chat.page;
    if (!page) return;
    queueRef.current?.enqueue({ url: page.url, title: page.title, text: page.text });
  }, [chat.page]);

  /* ── 워밍업 ──
   * 콜드 스타트 21.5초를 사용자가 체감하지 않게 만드는 유일한 수단.
   * ★ numCtx는 실제 대화와 동일해야 한다 — 다르면 모델이 리로드된다.
   */
  useEffect(() => {
    if (!settings.warmupOnOpen || health.state !== 'cold') return;

    const key = `${settings.model}@${settings.numCtx}`;
    if (warmedFor.current === key) return;
    warmedFor.current = key;

    const ac = new AbortController();
    setWarming(true);
    warmup(settings.endpoint, settings.model, settings.numCtx, settings.keepAlive, ac.signal)
      .then(refresh)
      .catch(() => undefined)
      .finally(() => setWarming(false));

    return () => ac.abort();
  }, [
    health.state,
    settings.warmupOnOpen,
    settings.endpoint,
    settings.model,
    settings.numCtx,
    settings.keepAlive,
    refresh,
  ]);

  const blocked =
    health.state === 'down' ||
    health.state === 'cors-blocked' ||
    health.state === 'model-missing' || chat.loading;

  const canReadPage = Boolean(tab && !isRestrictedUrl(tab.url));

  /**
   * 페이지 접근 권한을 확보한다.
   *
   * ★ 클릭 핸들러의 첫 동작이어야 한다. 앞에 await가 끼면 사용자 제스처가
   *   소실돼 chrome.permissions.request가 거부된다. 이미 허용된 사이트면
   *   대화상자 없이 즉시 true가 돌아온다.
   */
  const ensureAccess = async (url: string): Promise<boolean> => {
    const ok = await requestHostAccess(url);
    if (!ok) {
      // 코드를 붙여 넘긴다. 배너가 '권한 허용' 버튼을 달아 주는 근거다(Phase 7-2).
      chat.setError({
        code: 'HOST_PERMISSION_REQUIRED',
        message: t('perm.page.denied'),
      });
    }
    return ok;
  };

  /**
   * 화면 캡처 권한을 확보한다.
   *
   * ★ 본문 읽기와 요구 권한이 다르다.
   *   chrome.tabs.captureVisibleTab은 사이트별 권한을 받아주지 않고
   *   `<all_urls>` 또는 activeTab만 인정한다. activeTab은 상주 사이드패널에서
   *   신뢰할 수 없으므로(§0.7), 캡처에서만 권한을 한 단계 올린다.
   */
  const ensureCapture = async (): Promise<boolean> => {
    const ok = await requestCaptureAccess();
    if (!ok) {
      chat.setError({
        code: 'HOST_PERMISSION_REQUIRED',
        message: t('perm.capture.denied'),
      });
    }
    return ok;
  };

  /**
   * 페이지 빠른 작업 실행 — 권한 확보 → 첨부 → 프리셋 문구 전송.
   *
   * needs가 'screen'이면 본문 대신 화면을 캡처한다. 실측 262토큰/4.5초로
   * 본문(2,000토큰/15초)보다 싸므로, 글로 안 읽히는 화면에서는 이쪽이 낫다.
   */
  const runPageAction = async (presetId: string) => {
    if (!tab || chat.streaming) return;
    const preset = PAGE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    // 캡처와 본문 읽기는 요구 권한이 다르다.
    const granted =
      preset.needs === 'screen' ? await ensureCapture() : await ensureAccess(tab.url);
    if (!granted) return;

    const attached =
      preset.needs === 'screen'
        ? await chat.attachScreenshot(tab.tabId)
        : await chat.attachPage(tab.tabId, settings);
    if (!attached) return; // 실패 사유는 store가 error에 넣는다

    const text = preset.build();
    if (text) void chat.send(text, settings);
  };

  /**
   * 에이전트 모드 전송 (Phase 5).
   *
   * ★ 권한 요청이 이 함수의 **첫 동작**이어야 한다. 루프가 돌기 시작하면
   *   사용자 제스처가 사라져 chrome.permissions.request가 거부된다.
   *   여기서 한 번 받아 두면 루프 안의 모든 액션이 그 권한으로 동작한다.
   */
  const startAgent = async (text: string) => {
    if (!tab || chat.streaming) return;
    if (!(await ensureAccess(tab.url))) return;
    await chat.sendAgent(text, settings, tab);
  };

  /** 대화 도중 페이지 붙이기 */
  const attachCurrentPage = async () => {
    if (!tab) return;
    if (!(await ensureAccess(tab.url))) return;
    await chat.attachPage(tab.tabId, settings);
  };

  /** 대화 도중 화면 캡처 붙이기 */
  const attachCurrentScreen = async () => {
    if (!tab) return;
    if (!(await ensureCapture())) return;
    await chat.attachScreenshot(tab.tabId);
  };

  /* ── 슬래시 커맨드 (Phase 4-3) ── */
  const commands = useMemo(
    () => [
      ...builtinCommands(),
      // 기억이 꺼져 있으면 목록에 띄우지 않는다. 눌러도 아무 일이 없는
      // 항목을 보여 주는 것은 안내가 아니라 소음이다.
      ...(settings.memoryEnabled
        ? [
            {
              slash: RECALL_SLASH,
              label: t('mem.search.title'),
              hint: t('mem.search.hint'),
              presetId: RECALL_PRESET_ID,
              needs: 'selection' as const,
              aliases: RECALL_ALIASES,
            },
          ]
        : []),
      ...customCommands(customs),
    ],
    [customs, settings.memoryEnabled, t],
  );

  const runSlash = async (cmd: SlashCommand, rest: string) => {
    setDraft('');

    // ★ /기억은 프리셋이 아니다. 프롬프트를 펼치기 전에 임베딩과 검색을
    //   먼저 돌려야 한다. 찾은 것이 없으면 모델을 부르지 않는다 — 근거 없이
    //   답하게 두면 기억에서 찾은 척 지어낸다.
    if (cmd.presetId === RECALL_PRESET_ID) {
      if (!rest.trim()) return;
      try {
        const { hits, prompt } = await recall(rest, settings);
        if (!hits.length) {
          chat.setError(t('mem.search.none'));
          return;
        }
        void chat.send(prompt, settings);
      } catch (e) {
        chat.setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    // 페이지·화면이 필요한 커맨드는 먼저 첨부를 확보한다.
    if (cmd.needs === 'page' || cmd.needs === 'screen') {
      if (!tab) return;
      const granted =
        cmd.needs === 'screen' ? await ensureCapture() : await ensureAccess(tab.url);
      if (!granted) return;

      const ok =
        cmd.needs === 'screen'
          ? await chat.attachScreenshot(tab.tabId)
          : await chat.attachPage(tab.tabId, settings);
      if (!ok) return;
    }

    const text = expandCommand(cmd, rest, customs);
    if (text.trim()) void chat.send(text, settings);
  };

  /**
   * 오류 배너의 해결 버튼. 계획서 Phase 7-2
   *
   * ★ 권한 요청은 이 핸들러의 첫 동작이어야 한다. 앞에 await가 끼면
   *   사용자 제스처가 소실돼 크롬이 요청을 거부한다(permissions.ts).
   */
  const handleErrorAction = (action: 'retry' | 'grant-host' | 'grant-all' | 'open-settings') => {
    switch (action) {
      case 'grant-host': {
        // 본문 뷰어처럼 탭과 다른 주소가 필요하면 그 주소를 요청한다. 탭 주소는 이미 허용돼 있어 다시 요청해도 소용없다.
        const origins = chat.error?.origins;
        if (origins?.length) void requestOriginsAccess(tab ? [tab.url, ...origins] : origins).then((ok) => ok && chat.clearError());
        else if (tab) void requestHostAccess(tab.url).then((ok) => ok && chat.clearError());
        break;
      }
      case 'grant-all':
        void requestAllUrls().then((ok) => ok && chat.clearError());
        break;
      case 'open-settings':
        chrome.runtime.openOptionsPage();
        break;
      case 'retry':
        chat.clearError();
        void refresh();
        break;
    }
  };

  const pickConversation = async (c: Conversation) => {
    await chat.openConversation(c);
    setMenuOpen(false);
  };

  const attachEstimate = estimateTtfbSeconds(settings.pageTokenBudget + 300);
  const attachSec = Math.max(1, Math.round(attachEstimate));

  // 페이지 유형별 제안 (Phase 4-5). URL만으로 판단한다 —
  // 본문을 읽어야 아는 분류는 그 자체로 프리필 15초를 물게 된다.
  const pageKind = detectPageKind(tab?.url ?? '');
  const presetOrder = suggestedOrder(pageKind);
  const hint = kindHint(pageKind);

  // 대화가 시작된 뒤에도 페이지를 붙일 수 있어야 한다.
  const showAttach = !chat.page && canReadPage && chat.messages.length > 0;
  const showScreen = !chat.screenshot && canReadPage && chat.messages.length > 0;
  const showRegen = chat.messages.some((m) => m.role === 'assistant');

  // 에이전트는 조작할 페이지가 있어야 의미가 있다. chrome:// 에서는 숨긴다.
  const canRunAgent = settings.agentEnabled && agentAllowed(tab);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <SaideIcon size={20} />
          <Wordmark />
        </div>
        <button
          className="model-chip"
          onClick={() => chrome.runtime.openOptionsPage()}
          title={`내 PC · Ollama · ${settings.model}`}
          aria-label={`현재 모델: 내 PC Ollama ${settings.model}. 모델 설정 열기`}
        >
          <span className="model-chip-dot" aria-hidden="true" />
          <span className="model-chip-text">내 PC · {settings.model}</span>
        </button>
        {chat.conversation && chat.messages.length > 0 && (
          <span className="conv-chip">{chat.conversation.title}</span>
        )}
        <div className="spacer" />
        <button className="icon-btn" onClick={() => { setDraft(''); void chat.resetConversation(); }}
          disabled={chat.loading || (!chat.messages.length && !chat.streaming && !chat.page && !chat.screenshot)}
          title={t('panel.resetConversation')} aria-label={t('panel.resetConversation')}>
          <ResetIcon />
        </button>
        <button className="icon-btn" onClick={() => setMenuOpen(true)} title={t('panel.conversations')} aria-label={t('panel.conversations')}>
          <ListIcon />
        </button>
        <button className="icon-btn" onClick={() => chrome.runtime.openOptionsPage()} title={t('ui.settings')} aria-label={t('ui.settings')}>
          <GearIcon />
        </button>
      </header>

      <nav className="view-tabs" role="tablist" aria-label={t('view.tabs')}>
        <button type="button" role="tab" aria-selected={view === 'ai'} className={`view-tab ${view === 'ai' ? 'on' : ''}`} onClick={() => setView('ai')}>
          {t('view.ai')}
        </button>
        <button type="button" role="tab" aria-selected={view === 'automation'} className={`view-tab auto ${view === 'automation' ? 'on' : ''}`} onClick={() => setView('automation')}>
          {t('view.automation')}
          {runningJobs > 0 && <span className="view-tab-count">{t('view.running', { n: runningJobs })}</span>}
        </button>
      </nav>

      {view === 'automation' ? (
        <>
          {automationError && (
            <ErrorBanner error={automationError} model={settings.model} onClose={() => setAutomationError(null)} onAction={handleErrorAction} />
          )}
          <main className="app-main">
            <AutomationPanel tab={tab} onDownloadLink={(action, downloadId) => openDownload(action, downloadId, setAutomationError)} />
          </main>
        </>
      ) : (
      <>

      <HealthBanner health={health} model={settings.model} onRetry={refresh} />
      {warming && <WarmupProgress seconds={MEASURED_COLD_LOAD_SEC} />}

      {chat.error && (
        <ErrorBanner
          error={chat.error}
          model={settings.model}
          onClose={chat.clearError}
          onAction={handleErrorAction}
        />
      )}

      <main className="app-main">
        {chat.messages.length === 0 ? (
          <EmptyState
            health={health}
            settings={settings}
            canReadPage={canReadPage}
            tab={tab}
            extracting={chat.extracting}
            attached={Boolean(chat.page || chat.screenshot)}
            estimatedSec={attachEstimate}
            blocked={blocked}
            order={presetOrder}
            kindHint={hint}
            onRun={runPageAction}
          />
        ) : (
          <MessageList
            messages={chat.messages}
            dark={dark}
            showThinking={settings.thinkMode !== 'off'}
            deleteDisabled={chat.streaming || chat.loading}
            onDelete={chat.removeMessage}
            onDownloadLink={(action, downloadId) => openDownload(action, downloadId, chat.setError)}
          />
        )}
      </main>

      {/* 승인 대기 중에는 진행 표시를 내린다 — 지금 기다리는 것은 모델이 아니라 사용자다. */}
      {chat.streaming && !chat.pendingApproval && (
        <StreamingBar
          documentProgress={chat.documentProgress}
          extracting={chat.extracting}
          startedAt={chat.startedAt}
          expectedSec={chat.expectedPrefillSec}
          agentTurn={chat.agentTurn}
          maxTurns={settings.agentMaxTurns}
          onStop={chat.stop}
        />
      )}

      <div className="footer-bar">
        {chat.page && <PageContextChip page={chat.page} onDetach={chat.detachPage} />}
        {chat.screenshot && (
          <ScreenshotChip data={chat.screenshot} onDetach={chat.detachScreenshot} />
        )}

        {/*
          보조 동작은 한 줄에 모은다. 세로로 쌓으면 좁은 사이드패널에서
          입력창이 밀려 올라가고 대화가 보이는 높이가 줄어든다.
        */}
        {!chat.streaming && (showAttach || showScreen || showRegen) && (
          <div className="footer-actions">
            {showAttach && (
              <button
                className="minibtn"
                disabled={blocked || chat.extracting}
                onClick={attachCurrentPage}
                title={t('panel.attachPageHint', { sec: attachSec })}
              >
                <PageIcon />
                {chat.extracting ? t('panel.reading') : t('panel.attachPage')}
                {!chat.extracting && (
                  <span className="cost">{t('panel.secShort', { sec: attachSec })}</span>
                )}
              </button>
            )}
            {showScreen && (
              <button
                className="minibtn"
                disabled={blocked || chat.extracting}
                onClick={attachCurrentScreen}
                title={t('panel.attachScreenHint')}
              >
                <CameraIcon />
                {t('panel.attachScreen')}
                <span className="cost">{t('panel.secShort', { sec: 5 })}</span>
              </button>
            )}
            {showRegen && (
              <button className="minibtn" onClick={() => chat.regenerate(settings)} title={t('panel.regenerateHint')}>
                <RetryIcon />
                {t('panel.regenerate')}
              </button>
            )}
            {canRunAgent && (
              <button
                className={`minibtn agent-toggle ${agentMode ? 'on' : ''}`}
                aria-pressed={agentMode}
                disabled={blocked}
                onClick={() => setAgentMode((v) => !v)}
                title={
                  agentMode
                    ? t('agent.toggleOff')
                    : t('agent.toggleOn')
                }
              >
                <AgentIcon />
                {t('agent.label')}
                {agentMode && <span className="cost">{t('agent.on')}</span>}
              </button>
            )}
          </div>
        )}

        {/*
          승인 카드는 입력창 바로 위에 둔다. 화면을 덮는 대화상자로 만들면
          사용자가 무엇에 대한 승인인지(직전 대화 맥락) 볼 수 없게 된다.
        */}
        {chat.pendingApproval && (
          <ApprovalCard
            request={chat.pendingApproval.request}
            onDecide={chat.resolveApproval}
          />
        )}

        <Composer
          streaming={chat.streaming}
          disabled={blocked}
          value={draft}
          commands={commands}
          agentMode={agentMode}
          onChange={setDraft}
          onSend={(t) => {
            setDraft('');
            if (agentMode) void startAgent(t);
            else void chat.send(t, settings);
          }}
          onSlash={runSlash}
          onStop={chat.stop}
        />
      </div>

      </>
      )}

      {menuOpen && (
        <ConversationMenu
          currentId={chat.conversation?.id ?? null}
          onPick={pickConversation}
          onClose={() => setMenuOpen(false)}
          onDeleted={(id) => {
            useChat.forgetConversation(id);
            if (chat.conversation?.id === id) {
              if (tab) void chat.openForTab(tab.tabId, tab.url);
            }
          }}
        />
      )}
    </div>
  );
}

/** 답변·자동화 기록의 파일 링크. 클릭 중 첫 동작으로 호출해야 chrome.downloads.open의 사용자 제스처 조건을 만족한다. */
function openDownload(action: DownloadLinkAction, downloadId: number, onError: (error: AppError) => void) {
  void runDownloadLink(action, downloadId).catch((error: unknown) =>
    onError({ code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) }));
}

/* ── 진행 표시 ─────────────────────────────────────────── */

/**
 * 계획서 §6: 5초 이상 걸리는 작업은 경과와 예상 시간을 반드시 보여준다.
 * CPU 추론에서 무반응 스피너는 고장으로 오인된다.
 *
 * expectedSec은 접두사 캐시 적중분을 뺀 값이라, 페이지를 붙인 후속 질문에서는
 * 0에 가깝게 나온다 — 실제로도 빠르므로 정직한 표시다.
 */
function StreamingBar({
  documentProgress,
  extracting,
  startedAt,
  expectedSec,
  agentTurn,
  maxTurns,
  onStop,
}: {
  documentProgress?: string | null;
  extracting: boolean;
  startedAt: number | null;
  expectedSec: number;
  /** 0이면 일반 생성. 1 이상이면 에이전트 루프의 현재 턴. */
  agentTurn: number;
  maxTurns: number;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const t = useT();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const sec = startedAt ? (now - startedAt) / 1000 : 0;
  const showEta = !extracting && expectedSec >= 3 && sec < expectedSec;

  // 에이전트는 몇 턴째인지 알려준다. 1턴 25초라 진행감이 없으면 고장으로 보인다.
  const label = extracting ? t('panel.readingPage') : agentTurn > 0
    ? t('agent.turn', { turn: agentTurn, max: maxTurns })
    : showEta
      ? t('panel.readingPage')
      : t('panel.generating');

  return (
    <div className="progress" role="status" aria-live="polite">
      <span>{documentProgress || label}</span>
      <div className="track">
        {showEta ? (
          <div className="fill" style={{ width: `${Math.min(97, (sec / expectedSec) * 100)}%` }} />
        ) : (
          <div className="fill indeterminate" />
        )}
      </div>
      <span className="eta">
        {showEta
          ? t('health.aboutSec', { sec: Math.max(1, Math.ceil(expectedSec - sec)) })
          : t('panel.elapsedSec', { sec: sec.toFixed(1) })}
      </span>
      <button className="btn-sm" onClick={onStop}>
        {t('composer.stopShort')}
      </button>
    </div>
  );
}

function WarmupProgress({ seconds }: { seconds: number }) {
  const t = useT();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 0.25), 250);
    return () => clearInterval(id);
  }, []);

  const pct = Math.min(97, (elapsed / seconds) * 100);
  const left = Math.max(0, Math.ceil(seconds - elapsed));

  return (
    <div className="progress" role="status" aria-live="polite">
      <span>{t('health.warming')}</span>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="eta">{t('health.aboutSec', { sec: left })}</span>
    </div>
  );
}

function EmptyState({
  health,
  settings,
  canReadPage,
  tab,
  extracting,
  attached,
  estimatedSec,
  blocked,
  order,
  kindHint,
  onRun,
}: {
  health: HealthReport;
  settings: Settings;
  canReadPage: boolean;
  tab: TabSummary | null;
  extracting: boolean;
  attached: boolean;
  estimatedSec: number;
  blocked: boolean;
  order: string[];
  kindHint: string | null;
  onRun: (id: string) => void;
}) {
  const t = useT();
  return (
    <div className="empty">
      <SaideIcon size={48} />
      <h2>{health.state === 'ok' ? t('panel.empty.ready') : '온나라 sAIde'}</h2>
      <p>
        {health.state === 'ok'
          ? t('panel.empty.readyBody')
          : t('panel.empty.body')}
      </p>

      {canReadPage ? (
        <PageActions
          disabled={blocked}
          extracting={extracting}
          attached={attached}
          estimatedSec={estimatedSec}
          order={order}
          kindHint={kindHint}
          onRun={onRun}
        />
      ) : (
        tab && (
          <div className="pageactions-hint restricted">{t('panel.restrictedHint')}</div>
        )
      )}

      <div className="meta">
        {settings.model} · num_ctx {settings.numCtx.toLocaleString()}
        {health.resident && ` · ${health.onGpu ? 'GPU' : 'CPU'}`}
      </div>
    </div>
  );
}

/* ── 아이콘 ────────────────────────────────────────────── */

function CameraIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4M9 14h.01M15 14h.01" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3.5-7.1" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.65.73.85.3.19.65.29 1 .29H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
