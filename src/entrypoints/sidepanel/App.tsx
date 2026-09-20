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
import { isRestrictedUrl, sendToSW } from '@/lib/messaging/protocol';
import { decideTabChange } from '@/lib/browser/panel-sync';
import type { SWToPanel, TabSummary } from '@/lib/messaging/protocol';
import {
  builtinCommands,
  customCommands,
  expandCommand,
  findPreset,
  type CustomPreset,
  type SlashCommand,
} from '@/lib/prompts/presets';
import { loadCustomPresets, onCustomPresetsChanged } from '@/lib/storage/presets';
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
import { findDocumentCommand, type DocumentCommandId } from '@/lib/onnara/commands';
import { ScreenshotChip } from './components/ScreenshotChip';
import { AutomationPanel } from './components/AutomationPanel';
import { SchedulePanel } from './components/SchedulePanel';
import { ScheduleIntentCard } from './components/ScheduleIntentCard';
import { Onboarding } from './components/Onboarding';
import { shouldShowOnboarding } from '@/lib/storage/onboarding';
import { SCHEDULE_ALIASES, SCHEDULE_PRESET_ID, SCHEDULE_SLASH } from '@/lib/schedule/intent';
import type { PanelLink } from '@/lib/panel/links';
import { focusJob, useAutomation } from '@/lib/automation/jobs';
import { focusSchedule, focusScheduleTask, refreshTasks, useSchedule } from '@/lib/schedule/store';
import { takeInboxViewRequest } from '@/lib/inbox/schedule';
import { BRIEFING_ALIASES, BRIEFING_PRESET_ID, BRIEFING_SLASH, collectAndBrief, focusInboxDoc, loadInbox, pendingDocs, useInbox } from '@/lib/inbox/panel';
import { InboxPanel } from './components/InboxPanel';
import { urgentCount } from '@/lib/schedule/task';
import type { DownloadLinkAction } from '@/lib/downloads/links';
import type { AppError } from '@/lib/messaging/protocol';

type View = 'inbox' | 'ai' | 'schedule' | 'automation';
const VIEW_KEY = 'saide.view';
// ★ 공유/공람이 맨 앞이다. 매일 열 이유를 만드는 탭이라 첫 자리에 둔다(N1).
const VIEWS: View[] = ['inbox', 'ai', 'schedule', 'automation'];

/** 마지막으로 연 탭은 이 브라우저에서만 기억한다. 저장소를 못 쓰면 AI 도우미로 시작한다. */
function initialView(): View {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    return VIEWS.find(view => view === stored) ?? 'ai';
  } catch { return 'ai'; }
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
  /** 첫 실행 안내(B3). 저장소를 읽어 한 번만 켠다. */
  const [onboarding, setOnboarding] = useState(false);
  const runningJobs = useAutomation(state => state.jobs.filter(job => job.status === 'queued' || job.status === 'running').length);
  // 기한이 임박한 일정은 어느 탭에 있든 보여야 한다. 그러려고 배지를 헤더가 아니라 탭에 둔다.
  const dueTasks = useSchedule(state => urgentCount(state.tasks));
  // 공유/공람 배지도 탭을 열지 않아도 맞아야 한다. 아직 손대지 않은 문서의 수다.
  const inboxPending = useInbox(state => pendingDocs(state.docs).length);
  const warmedFor = useRef('');

  const t = useT();
  const chat = useChat();

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* 기억하지 못해도 동작에는 지장 없다 */ }
  }, [view]);

  // 일정 배지는 탭을 열지 않아도 맞아야 한다. 패널을 열 때 한 번 읽어 둔다.
  useEffect(() => { void refreshTasks(); }, []);
  useEffect(() => { void loadInbox(); }, []);
  // 알림을 눌러 연 패널은 공유/공람 탭을 편다(N1). 표시는 한 번 쓰고 지운다.
  useEffect(() => { void takeInboxViewRequest().then(open => { if (open) setView('inbox'); }); }, []);

  // 처음 여는 사람에게는 `/`와 `@`의 규칙을 아무도 알려 주지 않았다(B3).
  useEffect(() => { void shouldShowOnboarding().then(setOnboarding); }, []);


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
  /** 이 패널이 들어 있는 창. 다른 창에서 벌어지는 탭 전환은 이 패널의 일이 아니다. */
  const panelWindowId = useRef<number | null>(null);
  const aliveRef = useRef(true);

  /**
   * 탭 이벤트 하나를 처리한다.
   *
   * ★ 세 가지뿐이다 — 무시 / 따라가기 / 갈아끼우기.
   *   ignore: 다른 창의 탭 전환. 온나라 문서 팝업이 다른 창에 떠도 이 패널은 흔들리지 않는다.
   *   follow: 같은 작업의 연장(문서 팝업, 같은 문서 재방문). 대화는 그대로 두고 대상 탭만 옮긴다.
   *   switch: 다른 문서. 그 문서의 대화로 갈아끼운다. 숨겨진 세션의 작업은 계속된다.
   */
  const routeTab = useCallback((t: TabSummary | null) => {
    if (!aliveRef.current || !t) return;
    const decision = decideTabChange({ windowId: panelWindowId.current, tab: currentTab.current }, t);
    if (decision === 'ignore') return;
    const previous = currentTab.current;
    currentTab.current = t;
    setTab(t);
    if (decision === 'follow') {
      if (previous && previous.tabId !== t.tabId) void chat.followTab(t.tabId, t.url);
      return;
    }
    void chat.openForTab(t.tabId, t.url);
    // chat은 zustand 스토어라 참조가 안정적이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 자동화 탭이 다시 찾은 탭으로 패널 전체를 맞춘다. 같은 문서면 세션을 갈아끼우지 않는다. */
  const adoptTab = routeTab;

  useEffect(() => {
    aliveRef.current = true;

    /** 붙들던 탭이 사라졌을 때, 이 패널이 있는 창에서 지금 보이는 탭으로 되돌아온다. */
    const resync = async () => {
      const windowId = panelWindowId.current ?? undefined;
      const res = await sendToSW({ type: 'GET_ACTIVE_TAB', ...(windowId === undefined ? {} : { windowId }) })
        .catch(() => null);
      if (res?.type !== 'ACTIVE_TAB') return;
      // 창을 알아내지 못했더라도 지금 보고 있는 탭의 창이 곧 이 패널의 창이다.
      if (panelWindowId.current === null && typeof res.tab?.windowId === 'number') panelWindowId.current = res.tab.windowId;
      routeTab(res.tab);
    };

    void (async () => {
      // 창을 먼저 확인한다. 이 값이 없으면 다른 창의 팝업까지 따라가 대화가 뒤바뀐다.
      const id = await chrome.windows?.getCurrent?.().then(w => w?.id ?? null).catch(() => null);
      if (!aliveRef.current) return;
      if (typeof id === 'number') panelWindowId.current = id;
      await resync();
    })();

    const listener = (msg: SWToPanel) => {
      if (msg.type === 'TAB_CHANGED') {
        routeTab(msg.tab);
      } else if (msg.type === 'TAB_CLOSED') {
        if (currentTab.current?.tabId === msg.tabId) void resync();
      } else if (msg.type === 'SCREEN_CHANGED') {
        // 탭 주소가 그대로여도 화면은 바뀐다. 붙어 있는 본문이 지난 화면의 것이면 떼어낸다.
        if (currentTab.current?.tabId === msg.tabId) chat.noteScreenChange(msg.frameId);
      } else if (msg.type === 'CONTEXT_MENU') {
        handleContextMenu(msg.preset, msg.selectionText);
      } else if (msg.type === 'BRIEFING_DUE') {
        // ★ 패널이 열려 있으면 브리핑은 패널이 한다. 서비스 워커가 직접 하는 것은
        //   패널이 닫혀 있을 때뿐이다(모델도 화면도 여기에 있다).
        void loadSettings().then(current => collectAndBrief(currentTab.current, current, 'alarm'));
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      aliveRef.current = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
    // chat은 zustand 스토어라 참조가 안정적이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTab]);

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
   * 문서등록대장 목록 명령 실행(버튼·명령 공통).
   *
   * ★ 권한 요청이 첫 동작이어야 한다. 앞에 await가 끼면 사용자 제스처가 사라져
   *   크롬이 사이트 접근 요청을 거부한다(permissions.ts).
   */
  const runDocumentCommand = async (command: DocumentCommandId, args = '') => {
    if (!tab || chat.streaming) return;
    if (!(await ensureAccess(tab.url))) return;
    const slash = findDocumentCommand(command)?.slash ?? '';
    const typed = args.trim() ? `${slash} ${args.trim()}` : slash;
    // ★ `@` 명령이라고 화면을 옮기지 않는다. 결과는 AI 창에 남고, 그 탭으로 가는 길은
    //   답변 안의 링크다(lib/panel/links.ts). 갈지 말지는 누르는 사람이 정한다.
    await chat.runCommand(typed, command, args, settings);
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

  /**
   * 답변 안의 `일정 탭에서 보기` · `도구 탭에서 보기` 링크를 눌렀을 때.
   *
   * ★ 여기서만 화면이 옮겨진다. 어디를 볼지는 스토어에 남기고(focus), 그 탭이 스스로
   *   반영한 뒤 비운다. 옮기는 일과 맞추는 일을 나눠 두면, 탭이 열려 있든 아니든 같다.
   */
  const followPanelLink = (link: PanelLink) => {
    if (link.tab === 'inbox') {
      if ('docKey' in link) focusInboxDoc(link.docKey);
      setView('inbox');
      return;
    }
    if (link.tab === 'automation') {
      if ('jobId' in link) focusJob(link.jobId);
      setView('automation');
      return;
    }
    if ('taskId' in link) focusScheduleTask(link.taskId);
    else if ('cursor' in link) focusSchedule(link.cursor, link.mode);
    setView('schedule');
  };

  /* ── 슬래시 커맨드 (Phase 4-3) ── */
  const commands = useMemo(
    () => [
      ...builtinCommands(),
      // ★ 기억이 꺼져 있어도 목록에서 빼지 않는다. 빼 두면 `/기억`이 명령으로
      //   잡히지 않고 그대로 모델에게 문장으로 전송된다 — 명령이 사라진 것처럼
      //   보이고 토큰까지 쓴다. resolveTyped가 옛 접두 문자를 잡아 주는 것과 같은
      //   이유다. 대신 꺼져 있다는 사실과 켜는 길을 안내한다(runSlash).
      {
        // 찾은 내용을 AI 창에서 바로 읽는 명령이다.
        prefix: '/' as const,
        slash: RECALL_SLASH,
        label: t('mem.search.title'),
        hint: settings.memoryEnabled ? t('mem.search.hint') : t('mem.search.disabled'),
        presetId: RECALL_PRESET_ID,
        needs: 'selection' as const,
        aliases: RECALL_ALIASES,
      },
      {
        // 공유/공람을 수시로 확인한다. 주화면이 공유/공람 탭이므로 `@` 그룹이다.
        prefix: '@' as const,
        slash: BRIEFING_SLASH,
        label: t('inbox.command'),
        hint: t('inbox.commandHint'),
        presetId: BRIEFING_PRESET_ID,
        needs: 'none' as const,
        aliases: BRIEFING_ALIASES,
        opensTab: 'inbox' as const,
      },
      {
        // 주화면이 일정 탭이므로 `@` 그룹이다. 결과가 어디에 나타나는지를 이름이 알린다.
        prefix: '@' as const,
        slash: SCHEDULE_SLASH,
        label: t('sint.command'),
        hint: t('sint.commandHint'),
        presetId: SCHEDULE_PRESET_ID,
        needs: 'none' as const,
        aliases: SCHEDULE_ALIASES,
        opensTab: 'schedule' as const,
      },
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
      // 꺼져 있으면 찾을 기억 자체가 없다. 켜는 길을 배너의 버튼으로 준다.
      if (!settings.memoryEnabled) {
        chat.setError({ code: 'MEMORY_OFF', message: '' });
        return;
      }
      /*
       * ★ 찾을 말이 없으면 입력창을 되돌린다.
       *
       *   예전에는 여기서 그냥 return이었다. 위에서 이미 setDraft('')를 한 뒤라
       *   입력만 사라지고 아무 일도 일어나지 않았다 — 사용자에게는 명령이 먹통인
       *   것과 구별되지 않는다. 이름을 남겨 두면 그 자리에서 이어 칠 수 있다.
       */
      if (!rest.trim()) {
        setDraft(`${RECALL_SLASH} `);
        chat.setError({ code: 'MEMORY_QUERY_REQUIRED', message: '' });
        return;
      }
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

    /**
     * `@일정`은 온나라 화면과 무관하다. 탭 권한도 본문도 필요 없다.
     *
     * ★ 그래서 ensureAccess를 타지 않는다. 일정을 적겠다는데 사이트 접근 권한을 물으면
     *   사용자는 무엇을 허용하는지 알 수 없다.
     */
    /**
     * `@브리핑`도 온나라 화면과 무관하다. 지정해 둔 브리핑 대상 위치를 쓰므로,
     * 지금 어느 탭을 보고 있든 동작한다.
     */
    if (cmd.presetId === BRIEFING_PRESET_ID) {
      setView('inbox');
      await collectAndBrief(tab, settings, 'manual');
      return;
    }

    if (cmd.presetId === SCHEDULE_PRESET_ID) {
      // 이름만 치고 보낸 경우다. `/기억`과 같은 규칙 — 입력창을 되돌리고 예문을 보인다.
      if (!rest.trim()) {
        setDraft(`${SCHEDULE_SLASH} `);
        chat.setError({ code: 'SCHEDULE_INPUT_REQUIRED', message: '' });
        return;
      }
      await chat.runSchedule(rest, settings);
      return;
    }

    // 목록 명령은 무엇을 할지 명령 id가 정한다. 문장으로 다시 짐작하지 않는다.
    if (cmd.needs === 'documents') {
      await runDocumentCommand(cmd.presetId as DocumentCommandId, rest);
      return;
    }

    // 사용자가 만든 프리셋은 페이지·화면을 요구할 수 있다. 먼저 첨부를 확보한다.
    if (cmd.needs === 'page' || cmd.needs === 'screen') {
      if (!tab) return;
      const granted = cmd.needs === 'screen' ? await ensureCapture() : await ensureAccess(tab.url);
      if (!granted) return;
      const ok = cmd.needs === 'screen'
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
        <button type="button" role="tab" aria-selected={view === 'inbox'} onClick={() => setView('inbox')}
          className={`view-tab inbox ${view === 'inbox' ? 'on' : ''}`}
          {...(inboxPending > 0 ? { 'aria-label': t('view.inboxLabel', { n: inboxPending }) } : {})}>
          {t('view.inbox')}
          {inboxPending > 0 && <span className="view-tab-count">{inboxPending}</span>}
        </button>
        <button type="button" role="tab" aria-selected={view === 'schedule'} onClick={() => setView('schedule')}
          className={`view-tab sched ${view === 'schedule' ? 'on' : ''}`}
          {...(dueTasks > 0 ? { 'aria-label': t('view.dueLabel', { n: dueTasks }) } : {})}>
          {t('view.schedule')}
          {/* 배지는 숫자만 둔다. 탭이 셋이라 문장을 넣으면 좁은 폭에서 글자가 잘린다. */}
          {dueTasks > 0 && <span className="view-tab-count due">{t('view.due', { n: dueTasks })}</span>}
        </button>
        <button type="button" role="tab" aria-selected={view === 'automation'} className={`view-tab auto ${view === 'automation' ? 'on' : ''}`} onClick={() => setView('automation')}>
          {t('view.automation')}
          {runningJobs > 0 && <span className="view-tab-count">{t('view.running', { n: runningJobs })}</span>}
        </button>
      </nav>

      {view === 'inbox' ? (
        <main className="app-main">
          <InboxPanel tab={tab} settings={settings}
            onOpenSchedule={taskId => { focusScheduleTask(taskId); setView('schedule'); }} />
        </main>
      ) : view === 'schedule' ? (
        <main className="app-main"><SchedulePanel /></main>
      ) : view === 'automation' ? (
        <>
          {automationError && (
            <ErrorBanner error={automationError} model={settings.model} onClose={() => setAutomationError(null)} onAction={handleErrorAction} />
          )}
          <main className="app-main">
            <AutomationPanel tab={tab} onTabChange={adoptTab}
              onDownloadLink={(action, downloadId) => openDownload(action, downloadId, setAutomationError)} />
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
            blocked={blocked}
            onRun={runDocumentCommand}
          />
        ) : (
          <MessageList
            messages={chat.messages}
            dark={dark}
            model={settings.model}
            showThinking={settings.thinkMode !== 'off'}
            deleteDisabled={chat.streaming || chat.loading}
            onDelete={chat.removeMessage}
            onOpenSchedule={() => setView('schedule')}
            onPanelLink={followPanelLink}
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
          캐시에서 꺼낸 결과가 섞여 있으면 그 사실과 되돌릴 길을 함께 보인다(B1).
          ★ 메시지마다 버튼을 달지 않는다 — 문서 한 건만 다시 돌리려면 그 문서가 체크된 상태를
            되살려야 하는데, 그 사이 목록은 이미 달라져 있을 수 있다.
        */}
        {!chat.streaming && chat.cacheReused > 0 && chat.lastCommand && (
          <div className="cache-bar" role="status">
            <span>{t('cache.reused', { n: chat.cacheReused })}</span>
            <button type="button" className="minibtn" onClick={() => void chat.rerunLastCommand(settings)}>
              {t('cache.rerun')}
            </button>
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

        {/* `@일정`의 쓰기는 예외 없이 이 카드를 거친다. 누르기 전에는 아무것도 저장되지 않는다. */}
        {chat.pendingSchedule && chat.pendingSchedule.plan.kind !== 'list' && chat.pendingSchedule.plan.kind !== 'none' && (
          <ScheduleIntentCard
            plan={chat.pendingSchedule.plan}
            onDecide={(ids) => void chat.commitSchedule(ids)}
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

      {/* 첫 실행 안내(B3). 설정에서 "사용법 다시 보기"를 누르면 다시 뜬다. */}
      {onboarding && <Onboarding onClose={() => setOnboarding(false)} />}

      {menuOpen && (
        <ConversationMenu
          currentId={chat.conversation?.id ?? null}
          onPick={pickConversation}
          onClose={() => setMenuOpen(false)}
          onRenamed={(id, title) => useChat.renameConversation(id, title)}
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
  blocked,
  onRun,
}: {
  health: HealthReport;
  settings: Settings;
  canReadPage: boolean;
  tab: TabSummary | null;
  extracting: boolean;
  blocked: boolean;
  onRun: (command: DocumentCommandId) => void;
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
        <PageActions disabled={blocked} extracting={extracting} onRun={onRun} />
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
