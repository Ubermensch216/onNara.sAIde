/**
 * 성능 계측 대시보드. 계획서 §5 Phase 7-1 / §6
 *
 * ★ 목표와 실측을 **나란히** 보여주는 것이 요점이다.
 *   숫자만 늘어놓으면 빠른 건지 느린 건지 알 수 없다. §6이 정한 목표를 옆에
 *   두어야 사용자가 "이 정도면 정상"인지 판단할 수 있고, 하드웨어를 바꿨을 때
 *   무엇이 좋아졌는지도 보인다.
 *
 * ★ 별도 계측을 돌리지 않는다. 실사용 중 이미 쌓인 기록만 읽는다 —
 *   측정하겠다고 CPU를 20초씩 더 쓰는 것은 이 하드웨어에서 사치다.
 */

import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { listPerfSamples } from '@/lib/storage/db';
import { summarize, type PerfSummary } from '@/lib/perf/stats';
import {
  MEASURED_DECODE_TOK_PER_SEC,
  MEASURED_PREFILL_TOK_PER_SEC,
} from '@/lib/storage/settings';

export function PerfDashboard() {
  const t = useT();
  const [summary, setSummary] = useState<PerfSummary | null>(null);

  const load = useCallback(async () => {
    setSummary(summarize(await listPerfSamples()));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!summary) return null;

  if (summary.total === 0) {
    return (
      <section>
        <h2>{t('perf.h')}</h2>
        <p className="desc">{t('perf.empty')}</p>
      </section>
    );
  }

  return (
    <section>
      <h2>{t('perf.h')}</h2>

      <p className="desc">
        {t('perf.intro', {
          total: summary.total.toLocaleString(),
          cold: summary.coldCount,
        })}
      </p>

      <table className="perf-table">
        <thead>
          <tr>
            <th>{t('perf.col.bucket')}</th>
            <th>{t('perf.col.count')}</th>
            <th>{t('perf.col.median')}</th>
            <th>{t('perf.col.target')}</th>
          </tr>
        </thead>
        <tbody>
          {summary.buckets.map((b) => (
            <tr key={b.id}>
              <td>{t(`perf.bucket.${b.id}`)}</td>
              <td className="num">{b.count}</td>
              <td className="num">
                {b.count === 0 ? '—' : t('perf.sec', { n: b.medianTtfbSec })}
                {b.meetsTarget === false && <span className="miss">{t('perf.miss')}</span>}
                {b.meetsTarget === true && <span className="meet">{t('perf.meet')}</span>}
              </td>
              <td className="num">{t('perf.sec', { n: b.targetTtfbSec })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="perf-grid">
        <div>
          <dt>{t('perf.prefill')}</dt>
          <dd>
            {summary.medianPrefillTokPerSec} tok/s
            <span className="base">{t('perf.base', { n: MEASURED_PREFILL_TOK_PER_SEC })}</span>
          </dd>
        </div>
        <div>
          <dt>{t('perf.decode')}</dt>
          <dd>
            {summary.medianDecodeTokPerSec} tok/s
            <span className="base">{t('perf.base', { n: MEASURED_DECODE_TOK_PER_SEC })}</span>
          </dd>
        </div>
        <div>
          <dt>{t('perf.tokensIn')}</dt>
          <dd>{summary.totalPromptTokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{t('perf.tokensOut')}</dt>
          <dd>{summary.totalOutputTokens.toLocaleString()}</dd>
        </div>
      </dl>

      {/*
        하드웨어가 바뀌면 기본값을 되돌릴 수 있다는 사실을 여기서 알린다.
        계획서 §11 리스크 6′ — 예산·think·num_ctx를 전부 설정으로 뺀 이유가 이것이다.
      */}
      {summary.looksFasterThanBaseline && (
        <p className="desc ok-note">{t('perf.fasterHw')}</p>
      )}

      <button className="btn" onClick={load}>
        {t('perf.refresh')}
      </button>
    </section>
  );
}
