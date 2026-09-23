/**
 * 기안기 2단계 승인 트랜잭션 컨트롤러.
 *
 * 1단계: PREPARE (미리보기, 예상 변경 범위, 일회용 승인 토큰 발급)
 * 2단계: APPLY (사용자 명시적 승인 후 단 1회 삽입 시도 및 VERIFY)
 */

import type { DraftContext } from './draft-context';
import { computeRevisionHash, isSameDraftContext } from './draft-context';
import type { DraftEditorAdapter, EditorCapability } from './draft-editor';
import { resolveEditorAdapter } from './draft-editor';
import type { InsertMode } from '../messaging/draft-protocol';

export interface DraftApprovalToken {
  token: string;
  documentKey: string;
  editorRevision: string;
  textDigest: string;
  mode: InsertMode;
  expiresAt: number;
  used: boolean;
}

export interface PreparedInsertPlan {
  approvalToken: string;
  targetLabel: string;
  expectedRevision: string;
  preview: string;
  capability: EditorCapability;
  expiresAt: number;
}

export interface InsertionCommitResult {
  ok: boolean;
  status: 'applied' | 'unconfirmed' | 'failed';
  message: string;
  verified?: boolean;
}

export class DraftTransactionController {
  private tokens = new Map<string, DraftApprovalToken>();

  /** 만료된 토큰 정리 */
  private cleanupExpired() {
    const now = Date.now();
    for (const [token, info] of this.tokens) {
      if (info.expiresAt <= now || info.used) {
        this.tokens.delete(token);
      }
    }
  }

  /** 1단계: 삽입 준비 및 승인 토큰 발급 */
  async prepare(
    ctx: DraftContext,
    text: string,
    mode: InsertMode,
    doc: Document = document
  ): Promise<PreparedInsertPlan> {
    this.cleanupExpired();

    const { adapter, capability } = await resolveEditorAdapter(ctx, doc);
    const prepared = await adapter.prepare(ctx, text, mode, doc);

    const token = `draft_tok_${Math.random().toString(36).substring(2)}_${Date.now()}`;
    const tokenInfo: DraftApprovalToken = {
      token,
      documentKey: ctx.documentKey || 'unidentified-doc',
      editorRevision: ctx.editorRevision,
      textDigest: computeRevisionHash(text),
      mode,
      expiresAt: Date.now() + 30_000, // 30초 유효
      used: false,
    };

    this.tokens.set(token, tokenInfo);

    return {
      approvalToken: token,
      targetLabel: prepared.targetLabel,
      expectedRevision: prepared.expectedRevision,
      preview: prepared.preview,
      capability,
      expiresAt: tokenInfo.expiresAt,
    };
  }

  /** 2단계: 승인된 작업 실행 및 사후 검증 */
  async commit(
    ctx: DraftContext,
    token: string,
    text: string,
    doc: Document = document
  ): Promise<InsertionCommitResult> {
    this.cleanupExpired();

    const tokenInfo = this.tokens.get(token);
    if (!tokenInfo) {
      return { ok: false, status: 'failed', message: '승인 토큰이 만료되었거나 존재하지 않습니다.' };
    }

    if (tokenInfo.used) {
      return { ok: false, status: 'failed', message: '이미 사용된 승인 토큰입니다. 다시 준비하세요.' };
    }

    // 문서 변경 여부 확인
    if (tokenInfo.documentKey !== (ctx.documentKey || 'unidentified-doc')) {
      this.tokens.delete(token);
      return { ok: false, status: 'failed', message: '문서가 변경되어 이전 승인이 무효화되었습니다.' };
    }

    // 텍스트 다이제스트 일치 확인
    if (tokenInfo.textDigest !== computeRevisionHash(text)) {
      this.tokens.delete(token);
      return { ok: false, status: 'failed', message: '삽입 대상 내용이 변경되었습니다.' };
    }

    // 일회용 토큰 소모
    tokenInfo.used = true;
    this.tokens.delete(token);

    const { adapter } = await resolveEditorAdapter(ctx, doc);
    const op = { text, mode: tokenInfo.mode, approvalToken: token };

    const applyResult = await adapter.apply(ctx, op, doc);

    let verified = false;
    if (applyResult.status === 'applied' && adapter.verify) {
      const v = await adapter.verify(ctx, op, doc);
      verified = Boolean(v.verified);
    }

    return {
      ok: applyResult.status === 'applied',
      status: applyResult.status,
      message: applyResult.message || '작업이 완료되었습니다.',
      verified,
    };
  }

  /** 모든 토큰 무효화 (문서 전환 또는 팝업 닫힘 시) */
  invalidateAll() {
    this.tokens.clear();
  }
}
