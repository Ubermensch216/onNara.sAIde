/**
 * 첫 실행 안내 (B3).
 *
 * ★ 왜 필요한가.
 *   `/`와 `@`를 가르는 규칙(결과가 AI 창에 남는가, 다른 탭에 남는가)은 이 제품의 중심 설계인데,
 *   처음 여는 사람에게는 **설명 없는 규칙**이다. 입력창에 `/`를 쳐야 목록이 뜬다는 사실조차
 *   아무도 알려 주지 않았다.
 *
 * ★ 세 장을 넘지 않는다. 읽지 않고 닫는 안내는 없는 것과 같다.
 *   ① 목록에서 체크하고 명령 ② `/`와 `@`의 차이 ③ 기한은 일정 탭으로 — 이 셋이면 첫 하루가 된다.
 *
 * ★ 길을 막지 않는다. 어느 장에서든 건너뛸 수 있고, `Esc`로도 닫힌다.
 *   설정에서 언제든 다시 열 수 있으므로 "지금 꼭 읽어야 하는" 화면이 아니다.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { markOnboardingSeen } from '@/lib/storage/onboarding';

interface Props {
  onClose: () => void;
}

const STEPS = 3;

export function Onboarding({ onClose }: Props) {
  const t = useT();
  const [step, setStep] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  const finish = () => {
    void markOnboardingSeen();
    onClose();
  };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // finish는 매 렌더 새로 만들어지지만 하는 일이 같다. 처리기를 다시 걸 이유가 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = [
    { title: t('onboard.1.title'), lines: [t('onboard.1.a'), t('onboard.1.b')] },
    { title: t('onboard.2.title'), lines: [t('onboard.2.a'), t('onboard.2.b')] },
    { title: t('onboard.3.title'), lines: [t('onboard.3.a'), t('onboard.3.b')] },
  ][step]!;

  return (
    <div className="onboard-backdrop" role="dialog" aria-modal="true" aria-label={t('onboard.title')}>
      <div className="onboard">
        <div className="onboard-head">
          <span className="onboard-step">{t('onboard.step', { n: step + 1, total: STEPS })}</span>
          <button ref={closeRef} type="button" className="onboard-skip" onClick={finish}>
            {t('onboard.skip')}
          </button>
        </div>

        <h2 className="onboard-title">{body.title}</h2>
        <ul className="onboard-lines">
          {body.lines.map(line => <li key={line}>{line}</li>)}
        </ul>

        <div className="onboard-dots" aria-hidden="true">
          {Array.from({ length: STEPS }, (_, index) => (
            <span key={index} className={`onboard-dot ${index === step ? 'on' : ''}`} />
          ))}
        </div>

        <div className="onboard-actions">
          {step > 0 && (
            <button type="button" className="minibtn" onClick={() => setStep(value => value - 1)}>
              {t('onboard.prev')}
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="onboard-next"
            onClick={() => (step + 1 < STEPS ? setStep(value => value + 1) : finish())}>
            {step + 1 < STEPS ? t('onboard.next') : t('onboard.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
