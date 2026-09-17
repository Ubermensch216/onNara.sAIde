/**
 * 오류 배너. 계획서 §5 Phase 7-2
 *
 * 문구는 만들지 않는다 — `lib/errors/describe.ts`가 만든 것을 그리기만 한다.
 * 여기서 문구를 짜기 시작하면 코드별 전수 확인이 다시 불가능해진다.
 *
 * ★ 해결 버튼은 배너가 직접 실행하지 않고 부모에게 종류만 알린다.
 *   권한 요청은 **사용자 제스처의 첫 동작**이어야 해서(permissions.ts),
 *   중간에 다른 처리가 끼면 크롬이 거부한다.
 */

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { presentError, type ErrorPresentation } from '@/lib/errors/describe';
import type { AppError } from '@/lib/messaging/protocol';

interface Props {
  error: AppError;
  model: string;
  onClose: () => void;
  onAction: (action: NonNullable<ErrorPresentation['action']>) => void;
}

export function ErrorBanner({ error, model, onClose, onAction }: Props) {
  const t = useT();
  const p = presentError(error, model);
  if (p.silent) return null;

  // 막힌 오류는 붉게, 그 외에는 경고색. 전부 붉게 칠하면 경고가 무뎌진다.
  const kind = p.severity === 'blocked' ? 'down' : p.severity === 'failed' ? 'cors' : 'cold';

  return (
    <div className={`banner banner-${kind}`} role="alert">
      <div className="body">
        <div className="title">{p.title}</div>
        {p.body && <div className="hint">{p.body}</div>}
        {p.command && <CopyableCommand command={p.command} />}
      </div>

      <div className="banner-actions">
        {p.action && (
          <button className="btn-sm" onClick={() => onAction(p.action!)}>
            {p.actionLabel ?? t('ui.resolve')}
          </button>
        )}
        <button className="btn-sm" onClick={onClose} aria-label={t('err.close')}>
          {t('ui.close')}
        </button>
      </div>
    </div>
  );
}

function CopyableCommand({ command }: { command: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="cmd">
      <code>{command}</code>
      <button className="btn-sm" onClick={copy}>
        {copied ? t('ui.copied') : t('ui.copy')}
      </button>
    </div>
  );
}
