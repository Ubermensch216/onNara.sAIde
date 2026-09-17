/**
 * 액션 실행기 — 루프와 브라우저 사이의 다리. 계획서 §5 Phase 5-2
 *
 * loop.ts는 chrome API를 모른다(테스트 가능해야 하므로). 실제 수행은 전부
 * 여기서 서비스 워커에 위임한다. 사이드패널 문서에서만 동작한다.
 *
 * ★ 권한은 여기서 요청하지 않는다.
 *   chrome.permissions.request는 사용자 제스처를 요구하는데, 루프 3번째 턴은
 *   제스처가 아니다(§0.7, permissions.ts 참조). 그래서 에이전트를 시작하는
 *   버튼 핸들러에서 미리 확보하고, 여기서는 없으면 실패로 되돌린다.
 */

import { t } from '@/lib/i18n';
import { isRestrictedUrl, requiresApproval, sendToSW } from '@/lib/messaging/protocol';
import type { ActionResult, AppError, TabSummary } from '@/lib/messaging/protocol';
import type { ToolOutcome } from './loop';
import { isPageAction, signatureOf, type AgentAction } from './tools';

/** 모델에게 돌려줄 탭 목록의 상한. 20개를 넘기면 프리필만 비싸진다. */
const MAX_TABS = 20;

export function createBrowserTools(getTabId: () => number, getUrl: () => string) {
  const approvals = new Map<string, string>();
  return { execute: createExecutor(getTabId, getUrl, approvals), describeTarget: createTargetDescriber(getTabId, getUrl, approvals) };
}

export function createExecutor(getTabId: () => number, getUrl = () => '', approvals = new Map<string, string>()) {
  return async function execute(action: AgentAction, signal?: AbortSignal): Promise<ToolOutcome> {
    signal?.throwIfAborted();
    const control = { id: '', deadline: 0, expectedUrl: getUrl() || undefined };
    const tabId = getTabId();
    if (tabId < 0) {
      return { ok: false, detail: t('exec.noTab') };
    }

    switch (action.kind) {
      case 'list_tabs': {
        const res = await sendToSW({ type: 'LIST_TABS' }, signal);
        if (res.type === 'ERROR') return fail(res.error);
        if (res.type !== 'TABS') return { ok: false, detail: t('exec.tabsFailed') };
        return { ok: true, detail: formatTabs(res.tabs) };
      }

      case 'screenshot': {
        const res = await sendToSW({ type: 'CAPTURE_SCREENSHOT', tabId, control }, signal);
        if (res.type === 'ERROR') return fail(res.error);
        if (res.type !== 'SCREENSHOT') return { ok: false, detail: t('exec.captureFailed') };
        return {
          ok: true,
          detail: t('exec.captured'),
          // Ollama의 images는 순수 base64만 받는다.
          image: res.dataUrl.replace(/^data:image\/\w+;base64,/, ''),
        };
      }

      default: {
        if (!isPageAction(action)) return { ok: false, detail: t('exec.unknownAction') };
        const approvalToken = approvals.get(signatureOf(action));
        approvals.delete(signatureOf(action));
        if (requiresApproval(action) && !approvalToken) return { ok: false, detail: '대상 확인과 승인이 필요합니다. 다시 요청하세요.' };
        const res = await sendToSW({ type: 'EXEC_ACTION', tabId, action, control: { ...control, approvalToken } }, signal);
        if (res.type === 'ERROR') return fail(res.error);
        if (res.type !== 'ACTION_RESULT') return { ok: false, detail: t('exec.actionFailed') };
        return { ok: res.result.ok, detail: renderResult(res.result) };
      }
    }
  };
}

/**
 * 승인 카드에 넣을 대상 요소 설명을 미리 확인한다.
 *
 * ★ 부작용이 없는 조회다. 승인 **전에** 부르는 유일한 페이지 접근이며,
 *   사용자가 "무엇을 클릭하는지" 보고 판단할 수 있게 하는 근거다(§7).
 */
export function createTargetDescriber(getTabId: () => number, getUrl = () => '', approvals = new Map<string, string>()) {
  return async function describeTarget(action: AgentAction, signal?: AbortSignal): Promise<string | undefined> {
    if (!isPageAction(action) || !requiresApproval(action)) return undefined;
    approvals.delete(signatureOf(action));
    const res = await sendToSW({ type: 'PREPARE_ACTION', tabId: getTabId(), action,
      control: { id: '', deadline: 0, expectedUrl: getUrl() || undefined },
    }, signal);
    if (res.type !== 'ACTION_PREPARED') throw new Error(res.type === 'ERROR' ? res.error.message : '대상을 확인할 수 없습니다.');
    approvals.set(signatureOf(action), res.token);
    return res.label;
  };
}

/** 에이전트를 시작할 수 있는 탭인지. chrome:// 등에서는 아무것도 못 한다. */
export function canRunAgent(tab: TabSummary | null): boolean {
  return Boolean(tab && tab.tabId >= 0 && !isRestrictedUrl(tab.url));
}

/**
 * 주입 스크립트가 돌려준 코드를 사용자의 언어로 편다.
 *
 * ★ 번역 지점이 여기 하나뿐이어야 한다. 이 문자열은 화면(실행 단계 목록)과
 *   모델(툴 결과) 양쪽으로 가는데, 둘 다 같은 로케일을 따라야 한다.
 *
 * ★ read_page의 본문은 번역 대상이 아니다 — 페이지에서 읽어온 데이터다.
 */
export function renderResult(r: ActionResult): string {
  if (r.code === 'read') return r.text ?? '';
  // describe_target은 승인 카드용이라 문장으로 감싸지 않는다.
  if (r.code === 'described') return r.vars?.target ?? '';
  return t(`act.${r.code}`, r.vars);
}

function fail(error: AppError): ToolOutcome {
  // 힌트까지 붙여야 모델이 "권한이 없다"와 "요소가 없다"를 구분해 다르게 시도한다.
  return { ok: false, detail: error.hint ? `${error.message} ${error.hint}` : error.message };
}

function formatTabs(tabs: TabSummary[]): string {
  const lines = tabs
    .slice(0, MAX_TABS)
    .map((tab, i) => `${i + 1}. ${tab.title}${tab.active ? t('exec.currentTab') : ''} — ${tab.url}`);
  if (tabs.length > MAX_TABS) lines.push(t('exec.moreTabs', { n: tabs.length - MAX_TABS }));
  return lines.join('\n');
}
