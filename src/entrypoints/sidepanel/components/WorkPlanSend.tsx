/**
 * 업무계획 답변 아래의 "회신 기안으로 보내기"(업무계획 4번 칸).
 *
 * ★ 사이드패널에서는 기안기 편집기를 만질 수 없다. 삽입은 기안기 화면의 기안 코파일럿(드로어)이
 *   2단계 승인을 거쳐 한다. 여기서는 원문 대조를 마친 회신 요구사항·기한을 드로어로 넘기기만 한다.
 * ★ 보내는 것은 작성 요청의 재료다. 초안을 만들지도, 온나라 화면을 열지도 않는다.
 */

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import type { WorkPlanHandoff } from '@/lib/ai/work-plan';
import { sendHandoff } from '@/lib/storage/work-plan-handoff';

export function WorkPlanSend({ handoff }: { handoff: WorkPlanHandoff }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'sent' | { error: string }>('idle');

  const send = async () => {
    try {
      await sendHandoff(handoff);
      setState('sent');
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="task-register">
      <button type="button" className="minibtn" onClick={() => void send()} title={t('workplan.sendHint')}>
        <SendIcon />{t('workplan.send')}
      </button>
      {state === 'sent' && <span className="task-register-done" role="status">{t('workplan.sent')}</span>}
      {typeof state === 'object' && (
        <span className="task-register-done" role="alert">{t('workplan.sendFailed', { reason: state.error })}</span>
      )}
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h12M12 6l6 6-6 6" /><path d="M20 5v14" />
    </svg>
  );
}
