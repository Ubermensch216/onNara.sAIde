/**
 * 기안기 전용 안전 통신 프로토콜 및 메시지 검증기.
 *
 * 확장 iframe <-> 콘텐츠 스크립트 <-> 서비스 워커 간
 * 문서 바인딩, 승인 토큰, 출처(origin) 위조 방지 검증을 담당한다.
 */

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
  | { type: 'DRAFT_GET_CONTEXT'; requestId: string; target: TargetRef }
  | {
      type: 'DRAFT_PREPARE_INSERT';
      requestId: string;
      target: TargetRef;
      payload: { text: string; mode: InsertMode; expectedEditorRevision: string };
    }
  | {
      type: 'DRAFT_APPLY_INSERT';
      requestId: string;
      target: TargetRef;
      approvalToken: string;
    }
  | {
      type: 'DRAFT_VERIFY_INSERT';
      requestId: string;
      target: TargetRef;
      operationId: string;
    }
  | { type: 'DRAFT_CANCEL'; requestId: string; target: TargetRef }
  | { type: 'SAIDE_START_CLICK_TARGET'; text: string }
  | { type: 'SAIDE_CANCEL_CLICK_TARGET' }
  | { type: 'SAIDE_INSERT_LAST_FOCUSED'; text: string };

export type DraftResponse =
  | {
      type: 'DRAFT_CONTEXT_RESPONSE';
      requestId: string;
      title: string;
      documentKey: string;
      editorRevision: string;
      capability: 'read-only' | 'copy-only' | 'cursor' | 'selection' | 'append';
      bodySnippet?: string;
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
    return new URL(expectedOrigin).origin.toLowerCase() === new URL(actualOrigin).origin.toLowerCase();
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
