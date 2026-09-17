/**
 * 헬스체크 배너. 계획서 §5 Phase 1-8 / 7-2 / 7-4
 *
 * 상태별로 **다른** 해결 방법을 보여주는 것이 핵심이다. "연결 실패"
 * 한 줄로 뭉뚱그리면 사용자는 무엇을 고쳐야 할지 알 수 없다.
 * 특히 CORS_BLOCKED와 OLLAMA_DOWN은 증상이 같지만 해결법이 완전히 다르다.
 * (errors.ts의 no-cors 프로브가 이 둘을 갈라낸다.)
 *
 * ★ 문구를 여기서 만들지 않는다.
 *   헬스 상태는 결국 ErrorCode로 환원된다. 문구를 여기에도 두면 같은 오류가
 *   배너와 오류창에서 서로 다른 말을 하게 된다 — 실제로 Phase 7-2가 문구를
 *   describe.ts로 모은 뒤에도 이 파일에 사본이 남아 있었다.
 *   유일한 예외는 'cold'다. 이건 오류가 아니라 진행 상태라 ErrorCode가 없다.
 */

import { useState } from 'react';
import type { HealthReport } from '@/lib/ollama/client';
import { presentError, type ErrorPresentation } from '@/lib/errors/describe';
import { useT } from '@/lib/i18n';

interface Props {
  health: HealthReport;
  model: string;
  onRetry: () => void;
}

/** 헬스 상태를 오류 코드로 환원한다. cold만 코드가 없다. */
function codeOf(state: HealthReport['state']) {
  switch (state) {
    case 'down':
      return 'OLLAMA_DOWN' as const;
    case 'cors-blocked':
      return 'CORS_BLOCKED' as const;
    case 'model-missing':
      return 'MODEL_MISSING' as const;
    default:
      return null;
  }
}

export function HealthBanner({ health, model, onRetry }: Props) {
  const t = useT();

  // 정상이거나 확인 중이면 배너를 띄우지 않는다. 조용한 성공이 옳다.
  if (health.state === 'ok' || health.state === 'checking') return null;

  if (health.state === 'cold') {
    return (
      <div className="banner banner-cold" role="status">
        <div className="body">
          <div className="title">{t('health.cold.title')}</div>
          <div className="hint">
            {health.onGpu ? t('health.cold.gpu') : t('health.cold.cpu')}
          </div>
        </div>
      </div>
    );
  }

  const code = codeOf(health.state);
  if (!code) return null;

  const p = presentError({ code, message: '' }, model);
  // 모델 다운로드 크기는 이 화면에서만 의미가 있다(설치 안내 맥락).
  const extra = code === 'MODEL_MISSING' ? ` ${t('health.model.size')}` : '';

  return <Banner p={p} extra={extra} onRetry={onRetry} />;
}

const KIND: Record<string, string> = {
  OLLAMA_DOWN: 'down',
  CORS_BLOCKED: 'cors',
  MODEL_MISSING: 'model-missing',
};

function Banner({
  p,
  extra,
  onRetry,
}: {
  p: ErrorPresentation;
  extra: string;
  onRetry: () => void;
}) {
  const t = useT();

  return (
    <div className={`banner banner-${KIND[p.code] ?? 'down'}`} role="status">
      <div className="body">
        <div className="title">{p.title}</div>
        <div className="hint">
          {p.body}
          {extra}
        </div>
        {p.command && <CopyableCommand command={p.command} />}
      </div>
      {p.action === 'retry' && (
        <button className="btn-sm" onClick={onRetry}>
          {p.actionLabel ?? t('ui.retry')}
        </button>
      )}
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
