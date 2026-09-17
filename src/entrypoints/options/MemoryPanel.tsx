/**
 * 기억 통제 — 저장 범위·보관 기간·전량 삭제. 계획서 §5 Phase 6-3 / 6-4
 *
 * ★ 계획서가 "6-3은 선택 사항이 아니다"라고 못박은 이유를 그대로 따른다.
 *   방문 기록을 로컬에 쌓는 기능은 통제 UI 없이 내보내지 않는다. "로컬이니까
 *   안전하다"는 기기를 공유하는 상황에서 성립하지 않는다.
 *
 * ★ 그래서 이 화면은 **지금 무엇이 저장돼 있는지**를 먼저 보여준다.
 *   토글만 있고 내용은 안 보이는 통제는 통제가 아니다.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRichT, useT } from '@/lib/i18n';
import {
  clearAll,
  forgetDomain,
  stats,
  type MemoryStats,
} from '@/lib/memory/store';
import { loadSettings, normalizeSettings, onSettingsChanged, saveSettings, type Settings } from '@/lib/storage/settings';

const RETENTION_CHOICES = [7, 30, 90, 0];

export function MemoryPanel() {
  const t = useT();
  const rt = useRichT();
  const [s, setS] = useState<Settings | null>(null);
  const [info, setInfo] = useState<MemoryStats | null>(null);
  const [domain, setDomain] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const run = async (work: () => Promise<unknown>) => {
    try { setError(''); await work(); } catch (error) { setError(String(error)); }
  };

  const refresh = useCallback(async () => {
    try { setInfo(await stats()); } catch (error) { setError(String(error)); }
  }, []);

  useEffect(() => {
    void loadSettings().then(setS).catch(error => setError(String(error)));
    void refresh();
    return onSettingsChanged(settings => { setS(settings); void refresh(); });
  }, [refresh]);

  if (!s) return null;

  const patch = async (p: Partial<Settings>) => setS(await saveSettings(p));

  const addDomain = async () => {
    const d = domain.trim().toLowerCase().replace(/^\.+/, '');
    if (!d || s.memoryExcludedDomains.includes(d)) return;
    if (!normalizeSettings({ memoryExcludedDomains: [d] }).memoryExcludedDomains.includes(d)) throw new Error('example.com 형태의 도메인을 입력하세요.');
    await patch({ memoryExcludedDomains: [...s.memoryExcludedDomains, d] });
    // ★ 제외 목록에 넣는 것은 "앞으로 저장하지 말라"가 아니라 "이 도메인은
    //   기억하지 말라"는 뜻이다. 이미 쌓인 것을 남겨 두면 통제가 절반이다.
    await forgetDomain(d);
    setDomain('');
    await refresh();
  };

  const removeDomain = async (d: string) => {
    await patch({ memoryExcludedDomains: s.memoryExcludedDomains.filter((x) => x !== d) });
  };

  return (
    <section>
      <h2>{t('mem.h')}</h2>
      {error && <p className="warn" role="alert">{error}</p>}

      <div className="field">
        <div className="row">
          <label htmlFor="mem">{t('mem.enable')}</label>
          <input
            id="mem"
            type="checkbox"
            checked={s.memoryEnabled}
            onChange={(e) => { const checked = e.target.checked; void run(() => patch({ memoryEnabled: checked })); }}
          />
        </div>
        <p className="desc">{t('mem.enableDesc')}</p>
        {/*
          "무엇을 기억하는가"를 흐리지 않는다. 이 확장은 모든 방문 페이지를
          기억할 수 없다 — 상시 주입을 하지 않기 때문이다. 사용자가 그 사실을
          알아야 기대와 실제가 어긋나지 않는다.
        */}
        <p className="desc">{rt('mem.scopeDesc')}</p>
      </div>

      <div className="field">
        <div className="row">
          <label>{t('mem.stored')}</label>
          <span className="status">
            {info ? t('mem.count', { pages: info.pages, chunks: info.chunks }) : '…'}
          </span>
        </div>
        {info?.oldestAt ? (
          <p className="desc">
            {t('mem.oldest', { date: new Date(info.oldestAt).toLocaleDateString() })}
          </p>
        ) : null}
      </div>

      <div className="field">
        <div className="row">
          <label htmlFor="retention">{t('mem.retention')}</label>
          <select
            id="retention"
            value={s.memoryRetentionDays}
            onChange={(e) => { const days = Number(e.target.value); void run(() => patch({ memoryRetentionDays: days })); }}
          >
            {RETENTION_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? t('mem.retention.forever') : t('mem.retention.days', { n: d })}
              </option>
            ))}
          </select>
        </div>
        <p className="desc">{t('mem.retentionDesc')}</p>
      </div>

      <div className="field">
        <div className="row">
          <label htmlFor="exdomain">{t('mem.excluded')}</label>
          <input
            id="exdomain"
            type="text"
            value={domain}
            placeholder={t('mem.excludedPlaceholder')}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run(addDomain);
            }}
          />
          <button className="btn-sm" onClick={() => void run(addDomain)}>
            {t('mem.add')}
          </button>
        </div>
        <p className="desc">{t('mem.excludedDesc')}</p>

        {s.memoryExcludedDomains.length === 0 ? (
          <p className="desc">{t('mem.excludedNone')}</p>
        ) : (
          <ul className="origin-list">
            {s.memoryExcludedDomains.map((d) => (
              <li key={d}>
                <code>{d}</code>
                <button className="btn-sm" onClick={() => void run(() => removeDomain(d))}>
                  {t('ui.delete')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        전량 삭제(6-4)는 한 번 더 묻는다. 되돌릴 수 없는데 버튼 하나로
        사라지면, 눌러 보려던 사람이 기록을 잃는다.
      */}
      <div className="field">
        {confirming ? (
          <div className="row">
            <span className="warn">{t('mem.clearConfirm')}</span>
            <button
              className="btn"
              onClick={() => void run(async () => {
                await clearAll();
                setConfirming(false);
                await refresh();
              })}
            >
              {t('mem.clearYes')}
            </button>
            <button className="btn-sm" onClick={() => setConfirming(false)}>
              {t('mem.clearNo')}
            </button>
          </div>
        ) : (
          <button
            className="btn"
            disabled={!info || info.chunks === 0}
            onClick={() => setConfirming(true)}
          >
            {t('mem.clear')}
          </button>
        )}
      </div>
    </section>
  );
}
