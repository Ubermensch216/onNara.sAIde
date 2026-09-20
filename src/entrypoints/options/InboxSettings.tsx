/**
 * 접수함 브리핑 설정(N1).
 *
 * ★ 이 화면이 다루는 것 중 되돌릴 수 없는 항목은 하나다 — 열람 정책. 그래서 그 항목에만
 *   경고를 붙이고, 기본값은 상태를 바꾸지 않는 쪽에 둔다.
 *
 * ★ 대상 화면(접수함 위치)은 여기서 정하지 않는다. 온나라 목록을 보고 있어야 잡을 수 있어
 *   사이드패널의 접수함 탭에서 지정한다. 여기서는 무엇이 지정돼 있는지만 보인다.
 */

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { clearInboxLocation, loadInboxLocation, onInboxLocationChanged, type InboxLocation } from '@/lib/inbox/location';
import { clearInbox, inboxStats, type InboxStats } from '@/lib/inbox/store';
import type { Settings } from '@/lib/storage/settings';

interface Props {
  s: Settings;
  patch: (next: Partial<Settings>) => void;
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
          <label htmlFor="briefingHour">{t('opt.inbox.hour')}</label>
          <select id="briefingHour" value={s.briefingHour} disabled={!s.briefingEnabled}
            onChange={event => patch({ briefingHour: Number(event.target.value) })}>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>{t('opt.alert.hourValue', { hour })}</option>
            ))}
          </select>
        </div>
        <p className="desc">{t('opt.inbox.hourDesc')}</p>
      </div>

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
