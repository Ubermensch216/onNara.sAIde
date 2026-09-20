/**
 * 정확도 기록과 분석 캐시 (B4 · B1).
 *
 * ★ 왜 설정 화면에 두는가.
 *   이 수치는 매일 볼 것이 아니라 **가끔 확인하고 판단할 근거**다. 모델을 바꿔도 되는가,
 *   기관에 도입 근거로 낼 수 있는가 — 성능 대시보드(PerfDashboard)와 같은 성격이라 나란히 둔다.
 *
 * ★ 수치는 정직하게 보인다.
 *   평가가 하나도 없으면 정확도를 0%로 쓰지 않고 "아직 없음"이라고 쓴다. 표본 수를 함께
 *   보이는 것도 같은 이유다 — 3건 중 3건 맞춘 100%는 100%가 아니다.
 */

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { clearAllFeedback, feedbackSummary, type FeedbackSummary } from '@/lib/feedback/store';
import { clearDocResults, docResultStats, type DocResultStats } from '@/lib/cache/doc-results';
import { resetOnboarding } from '@/lib/storage/onboarding';

/** 표본이 이보다 적으면 정확도 옆에 "표본 부족"을 붙인다. */
const ENOUGH_SAMPLES = 20;

export function QualityPanel() {
  const t = useT();
  const [feedback, setFeedback] = useState<FeedbackSummary | null>(null);
  const [cache, setCache] = useState<DocResultStats | null>(null);
  const [guideReset, setGuideReset] = useState(false);

  const load = useCallback(async () => {
    setFeedback(await feedbackSummary());
    setCache(await docResultStats());
  }, []);

  useEffect(() => { void load(); }, [load]);

  const accuracy = feedback?.accuracy;

  return (
    <section>
      <h2>{t('quality.h')}</h2>
      <p className="desc">{t('quality.intro')}</p>

      <div className="field">
        <div className="row">
          <label>{t('quality.accuracy')}</label>
          <span className="status">
            {accuracy === null || accuracy === undefined
              ? t('quality.noSamples')
              : t('quality.accuracyValue', { pct: Math.round(accuracy * 100), n: feedback!.total })}
          </span>
        </div>
        <p className="desc">
          {feedback && feedback.total > 0 && feedback.total < ENOUGH_SAMPLES
            ? t('quality.fewSamples', { n: ENOUGH_SAMPLES })
            : t('quality.accuracyDesc')}
        </p>
      </div>

      {feedback && feedback.buckets.length > 0 && (
        <table className="perf-table">
          <thead>
            <tr>
              <th>{t('quality.col.kind')}</th>
              <th>{t('quality.col.good')}</th>
              <th>{t('quality.col.bad')}</th>
              <th>{t('quality.col.rate')}</th>
            </tr>
          </thead>
          <tbody>
            {feedback.buckets.map(bucket => (
              <tr key={bucket.kind}>
                <td>{t(`quality.kind.${bucket.kind}` as 'quality.kind.action-card')}</td>
                <td>{bucket.good}</td>
                <td>{bucket.bad}</td>
                <td>{Math.round((bucket.good / (bucket.good + bucket.bad)) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="field">
        <div className="row">
          <label>{t('quality.cache')}</label>
          <span className="status">{t('quality.cacheValue', { n: cache?.entries ?? 0 })}</span>
        </div>
        <p className="desc">{t('quality.cacheDesc')}</p>
      </div>

      <div className="field">
        <div className="row">
          <button className="btn-sm" onClick={async () => { await clearDocResults(); await load(); }}>
            {t('quality.clearCache')}
          </button>
          <button className="btn-sm" onClick={async () => { await clearAllFeedback(); await load(); }}>
            {t('quality.clearFeedback')}
          </button>
          <button className="btn-sm" onClick={async () => { await resetOnboarding(); setGuideReset(true); }}>
            {t('quality.showGuide')}
          </button>
        </div>
        <p className="desc" role="status">
          {guideReset ? t('quality.showGuideDone') : t('quality.clearDesc')}
        </p>
      </div>
    </section>
  );
}
