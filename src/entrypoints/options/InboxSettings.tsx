/**
 * 공유/공람 브리핑 설정(N1).
 *
 * ★ 이 화면이 다루는 것 중 되돌릴 수 없는 항목은 하나다 — 열람 정책. 그래서 그 항목에만
 *   경고를 붙이고, 기본값은 상태를 바꾸지 않는 쪽에 둔다.
 *
 * ★ 대상 화면(브리핑 대상 위치)은 여기서 정하지 않는다. 온나라 목록을 보고 있어야 잡을 수 있어
 *   사이드패널의 공유/공람 탭에서 지정한다. 여기서는 무엇이 지정돼 있는지만 보인다.
 */

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { clearInboxLocation, loadInboxLocation, onInboxLocationChanged, type InboxLocation } from '@/lib/inbox/location';
import { clearInbox, inboxStats, type InboxStats } from '@/lib/inbox/store';
import { BRIEFING_INTERVALS, type Settings } from '@/lib/storage/settings';

interface Props {
  s: Settings;
  patch: (next: Partial<Settings>) => void;
}

/** 주기 한 개의 이름. 60분 이상은 시간으로 읽는 편이 짧고 분명하다. */
function intervalLabel(t: ReturnType<typeof useT>, minutes: number): string {
  if (!minutes) return t('opt.inbox.intervalDaily');
  return minutes < 60 ? t('opt.inbox.intervalMin', { n: minutes }) : t('opt.inbox.intervalHour', { h: minutes / 60 });
}

/**
 * 시작 시각을 옮긴다.
 *
 * ★ 종료 시각을 함께 민다. 시작이 종료를 넘어서면 업무시간 창이 비고, 화면에는
 *   고를 수 없는 값이 남는다 — 사용자는 아무것도 잘못하지 않았는데 기능이 멈춘다.
 */
function startHourPatch(s: Settings, hour: number): Partial<Settings> {
  return hour < s.briefingEndHour
    ? { briefingHour: hour }
    : { briefingHour: hour, briefingEndHour: Math.min(23, hour + 1) };
}

/** 쉼표·줄바꿈으로 나눈 키워드. 사용자가 적은 글자는 그대로 둔다. */
function splitKeywords(value: string): string[] {
  return value.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
}

export function InboxSettings({ s, patch }: Props) {
  const t = useT();
  const [location, setLocation] = useState<InboxLocation | null>(null);
  const [stats, setStats] = useState<InboxStats>({ docs: 0, briefed: 0, oldestAt: null });

  useEffect(() => {
    void loadInboxLocation().then(setLocation);
    void inboxStats().then(setStats);
    return onInboxLocationChanged(setLocation);
  }, []);

  return (
    <section>
      <h2>{t('opt.inbox.h')}</h2>

      <div className="field">
        <div className="row">
          <label htmlFor="briefingEnabled">{t('opt.inbox.on')}</label>
          <input id="briefingEnabled" type="checkbox" checked={s.briefingEnabled}
            onChange={event => patch({ briefingEnabled: event.target.checked })} />
        </div>
        <p className="desc">{t('opt.inbox.onDesc')}</p>
      </div>

      <div className="field">
        <div className="row">
          <label htmlFor="briefingInterval">{t('opt.inbox.interval')}</label>
          <select id="briefingInterval" value={s.briefingIntervalMinutes} disabled={!s.briefingEnabled}
            onChange={event => patch({ briefingIntervalMinutes: Number(event.target.value) })}>
            {BRIEFING_INTERVALS.map(minutes => (
              <option key={minutes} value={minutes}>{intervalLabel(t, minutes)}</option>
            ))}
          </select>
        </div>
        <p className="desc">{t('opt.inbox.intervalDesc')}</p>
      </div>

      <div className="field">
        <div className="row">
          <label htmlFor="briefingHour">{t('opt.inbox.hour')}</label>
          <select id="briefingHour" value={s.briefingHour} disabled={!s.briefingEnabled}
            onChange={event => patch(startHourPatch(s, Number(event.target.value)))}>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>{t('opt.alert.hourValue', { hour })}</option>
            ))}
          </select>
        </div>
        <p className="desc">{t('opt.inbox.hourDesc')}</p>
      </div>

      {/* ★ 업무시간의 끝과 주말 제외는 주기 확인에만 쓰인다. 하루 한 번 모드에서는 아예 보이지 않는 편이
          "왜 저녁에 브리핑이 안 오지"를 만들지 않는다. */}
      {s.briefingIntervalMinutes > 0 && (
        <>
          <div className="field">
            <div className="row">
              <label htmlFor="briefingEndHour">{t('opt.inbox.endHour')}</label>
              <select id="briefingEndHour" value={s.briefingEndHour} disabled={!s.briefingEnabled}
                onChange={event => patch({ briefingEndHour: Number(event.target.value) })}>
                {/* 시작 시각보다 앞선 종료 시각은 고를 수 없다 — 창이 비면 영영 확인하지 않는다. */}
                {Array.from({ length: 24 }, (_, hour) => hour).filter(hour => hour > s.briefingHour).map(hour => (
                  <option key={hour} value={hour}>{t('opt.alert.hourValue', { hour })}</option>
                ))}
              </select>
            </div>
            <p className="desc">{t('opt.inbox.endHourDesc')}</p>
          </div>

          <div className="field">
            <div className="row">
              <label htmlFor="briefingSkipWeekend">{t('opt.inbox.skipWeekend')}</label>
              <input id="briefingSkipWeekend" type="checkbox" checked={s.briefingSkipWeekend}
                disabled={!s.briefingEnabled}
                onChange={event => patch({ briefingSkipWeekend: event.target.checked })} />
            </div>
            <p className="desc">{t('opt.inbox.skipWeekendDesc')}</p>
          </div>
        </>
      )}

      <div className="field">
        <div className="row">
          <label>{t('opt.inbox.target')}</label>
          <span className="desc">{location ? location.listName : t('opt.inbox.targetNone')}</span>
        </div>
        <p className="desc">{t('opt.inbox.targetDesc')}</p>
        {location && (
          <button type="button" className="btn-sm" onClick={() => { void clearInboxLocation(); }}>
            {t('opt.inbox.targetClear')}
          </button>
        )}
      </div>

      {/* ── 대상 범위 ── */}
      <div className="field">
        <div className="row">
          <label htmlFor="briefingScope">{t('opt.inbox.scope')}</label>
          <select id="briefingScope" value={s.briefingScope}
            onChange={event => patch({ briefingScope: event.target.value as Settings['briefingScope'] })}>
            <option value="all">{t('opt.inbox.scopeAll')}</option>
            <option value="keywords">{t('opt.inbox.scopeKeywords')}</option>
          </select>
        </div>
        <p className="desc">{t('opt.inbox.scopeDesc')}</p>
      </div>

      <div className="field">
        <label htmlFor="briefingKeywords">{t('opt.inbox.keywords')}</label>
        <textarea id="briefingKeywords" rows={2} defaultValue={s.briefingKeywords.join(', ')}
          onBlur={event => patch({ briefingKeywords: splitKeywords(event.target.value) })} />
        <p className="desc">{t('opt.inbox.keywordsDesc')}</p>
      </div>

      <div className="field">
        <label htmlFor="briefingExclude">{t('opt.inbox.exclude')}</label>
        <textarea id="briefingExclude" rows={2} defaultValue={s.briefingExcludeKeywords.join(', ')}
          onBlur={event => patch({ briefingExcludeKeywords: splitKeywords(event.target.value) })} />
        <p className="desc">{t('opt.inbox.excludeDesc')}</p>
      </div>

      {/* ── 열람 정책 — 이 화면에서 유일하게 되돌릴 수 없는 항목 ── */}
      <div className="field">
        <div className="row">
          <label htmlFor="briefingReadPolicy">{t('opt.inbox.read')}</label>
          <select id="briefingReadPolicy" value={s.briefingReadPolicy}
            onChange={event => patch({ briefingReadPolicy: event.target.value as Settings['briefingReadPolicy'] })}>
            <option value="keep-unread">{t('opt.inbox.readKeep')}</option>
            <option value="mark-read">{t('opt.inbox.readMark')}</option>
          </select>
        </div>
        <p className="desc">{t('opt.inbox.readDesc')}</p>
        {s.briefingReadPolicy === 'mark-read' && <p className="warn">{t('opt.inbox.readWarn')}</p>}
      </div>

      {s.briefingReadPolicy === 'mark-read' && (
        <div className="field">
          <div className="row">
            <label htmlFor="briefingOpenLimit">{t('opt.inbox.openLimit')}</label>
            <input id="briefingOpenLimit" type="number" min={1} max={20} value={s.briefingOpenLimit}
              onChange={event => patch({ briefingOpenLimit: Number(event.target.value) })} />
          </div>
          <p className="desc">{t('opt.inbox.openLimitDesc')}</p>
        </div>
      )}

      {/* ── 보관 ── */}
      <div className="field">
        <div className="row">
          <label htmlFor="briefingRetentionDays">{t('opt.inbox.retention')}</label>
          <input id="briefingRetentionDays" type="number" min={7} max={365} value={s.briefingRetentionDays}
            onChange={event => patch({ briefingRetentionDays: Number(event.target.value) })} />
        </div>
        <p className="desc">{t('opt.inbox.retentionDesc')}</p>
      </div>

      <div className="field">
        <div className="row">
          <label>{t('opt.inbox.stored')}</label>
          <span className="desc">{t('opt.inbox.storedValue', { n: stats.docs, briefed: stats.briefed })}</span>
        </div>
        <p className="desc">{t('opt.inbox.storedDesc')}</p>
        <button type="button" className="btn-sm"
          onClick={() => { void clearInbox().then(() => inboxStats().then(setStats)); }}>
          {t('opt.inbox.clear')}
        </button>
      </div>
    </section>
  );
}
