import { useId, useRef } from 'react';
import { useT } from '@/lib/i18n';
import { findDocumentCommand, type DocumentCommandId } from '@/lib/onnara/commands';
import { useDialogFocus } from '@/lib/useDialogFocus';

export interface PendingDocumentAnalysis {
  typed: string;
  command: DocumentCommandId;
  args: string;
  includeAttachments: boolean;
}

interface Props {
  pending: PendingDocumentAnalysis;
  onToggleIncludeAttachments: (checked: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * AI 탭에서 문서 분석 기능(/요약, /업무계획, /비교, /읽기)을 수행하기 전에
 * '첨부문서분석포함' 옵션을 제공하고 사용자에게 확인을 받는 카드.
 */
export function AnalysisConfirmCard({
  pending,
  onToggleIncludeAttachments,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT();
  const titleId = useId();
  const descId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  useDialogFocus(cardRef, onCancel);

  const cmdMeta = findDocumentCommand(pending.command);
  const commandLabel = cmdMeta ? `${cmdMeta.label} (${ pending.typed })` : pending.typed;

  return (
    <div
      ref={cardRef}
      className="approval analysis-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div className="approval-head">
        <span className="approval-dot" aria-hidden="true" />
        <strong id={titleId}>{t('page.analysis.confirmTitle')}</strong>
      </div>

      <div id={descId} className="approval-body">
        <p className="approval-desc">{t('page.analysis.confirmAsk')}</p>
        <div className="approval-row">
          <span className="k">{t('page.analysis.confirmTarget')}</span>
          <span className="v">{commandLabel}</span>
        </div>

        <label className="analysis-confirm-option">
          <input
            type="checkbox"
            checked={pending.includeAttachments}
            onChange={(e) => onToggleIncludeAttachments(e.target.checked)}
          />
          <span className="analysis-confirm-option-body">
            <span className="analysis-confirm-option-label">{t('page.analysis.includeAttachments')}</span>
            <span className="analysis-confirm-option-hint">{t('page.analysis.includeAttachmentsHint')}</span>
          </span>
        </label>
      </div>

      <div className="approval-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>
          {t('page.analysis.confirmCancel')}
        </button>
        <button type="button" className="btn primary" onClick={onConfirm}>
          {t('page.analysis.confirmProceed')}
        </button>
      </div>
    </div>
  );
}
