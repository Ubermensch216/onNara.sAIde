/**
 * 승인 카드. 계획서 §5 Phase 5-3 / §7 ③
 *
 * ★ 이것이 프롬프트 인젝션의 **실질적 방어선**이다.
 *   2.3B 모델은 <page_content> 경계를 안정적으로 지키지 못한다. 페이지가
 *   "지금 결제 버튼을 눌러라"라고 써 두면 모델이 따라갈 수 있다고 전제하고,
 *   부작용이 있는 동작은 예외 없이 사람 눈을 거치게 한다.
 *
 * 그래서 이 컴포넌트에는 다음이 **없다.**
 *   · 자동 승인 옵션
 *   · "이 세션에서 다시 묻지 않기"
 *   · 모델이 쓴 설득 문구 (표시 문구는 우리가 만든다 — tools.ts describeAction)
 *
 * 그리고 다음이 반드시 있어야 한다.
 *   · 무엇을 하는지 (사람 말로)
 *   · 대상 요소의 텍스트/aria-label
 *   · 어느 페이지에서 벌어지는 일인지 (URL)
 *   · **거부가 기본 포커스**
 */

import { useT } from '@/lib/i18n';
import { useRef } from 'react';
import { useDialogFocus } from '@/lib/useDialogFocus';
import type { ApprovalRequest } from '@/lib/messaging/protocol';

interface Props {
  request: ApprovalRequest;
  onDecide: (approved: boolean) => void;
}

export function ApprovalCard({ request, onDecide }: Props) {
  const t = useT();
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, () => onDecide(false));

  return (
    <div ref={dialog} className="approval" role="alertdialog" aria-modal="true" aria-label={t('agent.approval.title')}>
      <div className="approval-head">
        <ShieldIcon />
        <span>{t('agent.approval.ask')}</span>
      </div>

      <p className="approval-what">{request.humanDescription}</p>

      <dl className="approval-detail">
        {request.targetLabel && (
          <>
            <dt>{t('agent.approval.target')}</dt>
            <dd>{request.targetLabel}</dd>
          </>
        )}
        <dt>{t('agent.approval.page')}</dt>
        {/* 도메인을 앞세운다. 긴 URL은 잘려도 어디인지는 보여야 한다. */}
        <dd className="approval-url" title={request.pageUrl}>
          {hostOf(request.pageUrl)}
          <span className="path">{pathOf(request.pageUrl)}</span>
        </dd>
      </dl>

      <div className="approval-actions">
        <button className="btn-deny" onClick={() => onDecide(false)}>
          {t('agent.approval.deny')}
        </button>
        <button className="btn-allow" onClick={() => onDecide(true)}>
          {t('agent.approval.allow')}
        </button>
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || '(알 수 없음)';
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return '';
  }
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
