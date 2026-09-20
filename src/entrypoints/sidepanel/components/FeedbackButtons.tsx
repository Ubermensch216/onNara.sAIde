/**
 * 정확도 피드백 버튼 (B4).
 *
 * ★ 한 번 누르는 것으로 끝나야 한다.
 *   사유를 묻는 순간 아무도 누르지 않는다. 맞았는지 틀렸는지만 받고, 나머지는 수치로 본다.
 *
 * ★ 누른 것을 되돌릴 수 있다.
 *   같은 버튼을 다시 누르면 취소된다. 잘못 누른 값이 영구히 남으면 사용자는 아예 누르지 않게 된다.
 *
 * ★ 밖으로 나가지 않는다는 사실을 말해 준다(title). 공문을 다루는 사람에게 이 확인은 중요하다.
 */

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import {
  clearFeedbackFor,
  recordFeedback,
  type FeedbackKind,
  type FeedbackVerdict,
} from '@/lib/feedback/store';

interface Props {
  kind: FeedbackKind;
  /** 같은 대상을 다시 평가하면 덮어쓰기 위한 자리 식별자. */
  targetKey: string;
  model: string;
  /** 이미 걸려 있는 평가. 목록에서 한 번에 읽어 넘겨 줄 때 쓴다. */
  initial?: FeedbackVerdict | undefined;
  compact?: boolean;
}

export function FeedbackButtons({ kind, targetKey, model, initial, compact }: Props) {
  const t = useT();
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(initial ?? null);

  // 목록이 다시 불려 초기값이 바뀌면 따라간다(캐시에서 복원한 답변 등).
  useEffect(() => { setVerdict(initial ?? null); }, [initial, targetKey]);

  const choose = (next: FeedbackVerdict) => {
    if (verdict === next) {
      setVerdict(null);
      void clearFeedbackFor(kind, targetKey);
      return;
    }
    setVerdict(next);
    void recordFeedback({ kind, targetKey, verdict: next, model });
  };

  return (
    <span className={`feedback ${compact ? 'compact' : ''}`} role="group" aria-label={t('fb.label')}>
      {!compact && <span className="feedback-ask">{t('fb.ask')}</span>}
      <button type="button" className={`feedback-btn ${verdict === 'good' ? 'on good' : ''}`}
        onClick={() => choose('good')} title={t('fb.goodHint')} aria-pressed={verdict === 'good'}>
        {t('fb.good')}
      </button>
      <button type="button" className={`feedback-btn ${verdict === 'bad' ? 'on bad' : ''}`}
        onClick={() => choose('bad')} title={t('fb.badHint')} aria-pressed={verdict === 'bad'}>
        {t('fb.bad')}
      </button>
    </span>
  );
}
