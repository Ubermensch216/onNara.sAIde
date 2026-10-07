import type { ChatRequest } from '@/types/ollama';
/**
 * 기안기 전용 안전 통신 프로토콜 및 메시지 검증기.
 *
 * 확장 iframe <-> 콘텐츠 스크립트 <-> 서비스 워커 간
 * 문서 바인딩, 승인 토큰, 출처(origin) 위조 방지 검증을 담당한다.
 */

import type { RelatedDocInfo } from '../onnara/related-info';

export interface TargetRef {
  tabId: number;
  frameId: number;
  documentId?: string;
  origin: string;
  documentKey: string;
  sessionEpoch: number;
}

export type InsertMode = 'cursor' | 'replace-selection' | 'append';

export type DraftRequest =
  | { type: 'DRAFT_GET_CONTEXT'; requestId: string; target?: TargetRef }
  | {
      type: 'DRAFT_PREPARE_INSERT';
      requestId: string;
      target?: TargetRef;
      payload: { text: string; mode: InsertMode; expectedEditorRevision?: string };
    }
  | {
      type: 'DRAFT_APPLY_INSERT';
      requestId: string;
      target?: TargetRef;
      approvalToken: string;
      text?: string;
    }
  | {
      type: 'DRAFT_VERIFY_INSERT';
      requestId: string;
      target?: TargetRef;
      operationId: string;
    }
  | { type: 'DRAFT_CANCEL'; requestId: string; target?: TargetRef }
  | { type: 'DRAFT_FETCH_RELATED_DOC'; doc: RelatedDocInfo }
  | { type: 'SAIDE_START_CLICK_TARGET'; text: string }
  | { type: 'SAIDE_CANCEL_CLICK_TARGET' }
  | { type: 'SAIDE_INSERT_LAST_FOCUSED'; text: string }
  | { type: 'DRAFT_APPLY_TITLE'; title: string };

export type DraftResponse =
  | {
      type: 'DRAFT_CONTEXT_RESPONSE';
      requestId?: string;
      title: string;
      documentKey: string;
      editorRevision: string;
      capability: 'read-only' | 'copy-only' | 'cursor' | 'selection' | 'append';
      bodySnippet?: string;
      needsOpenBody?: boolean;
      hasWriteBodyBtn?: boolean;
      reason?: string;
      relatedDocs?: RelatedDocInfo[];
    }
  | {
      type: 'DRAFT_RELATED_DOC_CONTENT';
      title: string;
      content: string;
      documentTitle?: string;
      attachments?: string[];
      docId?: string;
      error?: string;
    }
  | {
      type: 'DRAFT_PREPARED_RESPONSE';
      requestId: string;
      approvalToken: string;
      targetLabel: string;
      preview: string;
      expiresAt: number;
    }
  | {
      type: 'DRAFT_APPLY_RESPONSE';
      requestId: string;
      status: 'applied' | 'unconfirmed' | 'failed';
      observedRevision?: string;
      message?: string;
    }
  | {
      type: 'DRAFT_VERIFIED_RESPONSE';
      requestId: string;
      verified: boolean;
      reason?: string;
    }
  | {
      type: 'DRAFT_ERROR_RESPONSE';
      requestId: string;
      code: string;
      message: string;
    }
  | {
      type: 'SAIDE_TARGET_INSERT_RESULT';
      status: 'applied' | 'clipboard-fallback' | 'cancelled' | 'failed';
      message: string;
    }
  | {
      type: 'SAIDE_FOCUS_STATUS';
      hasFocus: boolean;
      targetLabel?: string;
    }
  | {
      type: 'DRAFT_APPLY_TITLE_RESULT';
      success: boolean;
      title: string;
      message: string;
      fallbackCopied?: boolean;
    };

/** TargetRef 유효성 검사 */
export function isValidTargetRef(target: unknown): target is TargetRef {
  if (!target || typeof target !== 'object') return false;
  const t = target as Record<string, unknown>;
  return (
    typeof t.tabId === 'number' &&
    typeof t.frameId === 'number' &&
    typeof t.origin === 'string' &&
    t.origin.length > 0 &&
    typeof t.documentKey === 'string' &&
    typeof t.sessionEpoch === 'number'
  );
}

/** 발신 출처(Origin) 일치 검사 */
export function isAllowedOriginMatch(expectedOrigin: string, actualOrigin: string): boolean {
  try {
    const expected = messageOrigin(expectedOrigin);
    return expected !== null && expected === messageOrigin(actualOrigin);
  } catch {
    return false;
  }
}

/** postMessage 이벤트 검증 */
export function validatePostMessageEvent(
  event: MessageEvent,
  expectedOrigin: string,
  expectedSourceWindow?: Window | null
): boolean {
  if (!event || !event.data || typeof event.data !== 'object') return false;

  // 1. origin 검증 (와일드카드 불허)
  if (!isAllowedOriginMatch(expectedOrigin, event.origin)) {
    return false;
  }

  // 2. source window 검증 (명시된 경우)
  if (expectedSourceWindow && event.source !== expectedSourceWindow) {
    return false;
  }

  return true;
}

/** URL.origin이 확장 스킴에 null을 반환하는 환경에서도 확장 ID를 비교한다. */
export function messageOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === 'chrome-extension:' && url.hostname && !url.username && !url.password && !url.port) return url.protocol + '//' + url.hostname;
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

const boundedText = (value: unknown, max = 200_000): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
export function validDraftHostRequest(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, any>;
  switch (v.type) {
    case 'SAIDE_CLOSE_DRAWER': case 'DRAFT_GET_CONTEXT': case 'SAIDE_CLICK_OPEN_BODY': case 'SAIDE_CANCEL_CLICK_TARGET': return true;
    case 'SAIDE_START_CLICK_TARGET': return boundedText(v.text);
    case 'DRAFT_APPLY_TITLE': return boundedText(v.title, 500);
    case 'DRAFT_FETCH_RELATED_DOC': return v.doc && boundedText(v.doc.title, 500);
    case 'DRAFT_PREPARE_INSERT': return v.payload && boundedText(v.payload.text) && ['cursor', 'replace-selection', 'append'].includes(v.payload.mode);
    case 'DRAFT_APPLY_INSERT': return boundedText(v.approvalToken, 100) && boundedText(v.text);
    default: return false;
  }
}

/** 기안기 특권 동작은 실제 기안 탭의 콘텐츠 스크립트 요청만 받는다. */
export function trustedDraftContent(sender: chrome.runtime.MessageSender, isDraftPath: (url: string) => boolean): boolean {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || !sender.url) return false;
  const origin = messageOrigin(sender.url);
  return Boolean(origin && /^https?:/.test(origin) && sender.tab?.url && isDraftPath(sender.tab.url));
}

export type BubbleChatBody = Omit<ChatRequest, 'stream'> & { stream?: boolean };
export function validBubbleBody(raw: unknown): raw is BubbleChatBody {
  const b = raw as Partial<BubbleChatBody> | null;
  return Boolean(b && typeof b.model === 'string' && /^[\w.:/-]{1,200}$/.test(b.model) && !b.tools &&
    Array.isArray(b.messages) && b.messages.length >= 1 && b.messages.length <= 10 && b.messages.every(m =>
      m && ['user', 'assistant', 'system'].includes(m.role) && typeof m.content === 'string' && m.content.length <= 100_000 && !m.images && !m.tool_calls));
}
