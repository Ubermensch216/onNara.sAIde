/**
 * 설정 화면. 계획서 §5 Phase 1-7
 *
 * 설계 의도: 성능에 영향을 주는 값(num_ctx, 본문 예산, thinking)은
 * **비용을 숨기지 않는다.** 슬라이더 옆에 실측 기반 예상 대기시간을
 * 실시간으로 보여주고, 사용자가 알고 늘리게 한다.
 */

import { useEffect, useRef, useState } from 'react';
import { checkHealth } from '@/lib/ollama/client';
import type { ModelInfo } from '@/types/ollama';
import {
  DEFAULT_SETTINGS,
  estimateTtfbSeconds,
  loadSettings,
  onSettingsChanged,
  resetSettings,
  saveSettings,
  MEASURED_PREFILL_TOK_PER_SEC,
  type Settings,
  type Locale,
  type ThemePref,
  type ThinkMode,
} from '@/lib/storage/settings';
import { setLocale, useRichT, useT } from '@/lib/i18n';
import { SaideIcon } from '../sidepanel/components/BrandMark';
import { PresetEditor } from './PresetEditor';
import { PerfDashboard } from './PerfDashboard';
import { QualityPanel } from './QualityPanel';
import { MemoryPanel } from './MemoryPanel';
import {
  grantedOrigins,
  hasAllUrls,
  requestAllUrls,
  revokeAllSites,
  revokeOrigin,
} from '@/lib/permissions';

export default function OptionsApp() {
  const t = useT();
  const rt = useRichT();
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [conn, setConn] = useState<{ ok: boolean; text: string } | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);
  const [allSites, setAllSites] = useState(false);

  useEffect(() => {
    void loadSettings().then(settings => { setS(settings); setLocale(settings.locale); void probe(settings); });
    void reloadPermissions();
    return onSettingsChanged(settings => { setS(settings); setLocale(settings.locale); });
  }, []);

  const reloadPermissions = async () => {
    setOrigins(await grantedOrigins());
    setAllSites(await hasAllUrls());
  };

  useEffect(() => {
    const root = document.documentElement;
    if (s.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', s.theme);
  }, [s.theme]);

  /** 모델 목록을 /api/tags에서 동적으로 불러온다. 하드코딩하지 않는다. */
  const probeVersion = useRef(0);
  const probe = async (settings: Settings) => {
    const version = ++probeVersion.current;
    setConn(null);
    const h = await checkHealth(settings.endpoint, settings.model);
    if (version !== probeVersion.current) return;
    setModels(h.models);
    setConn(
      h.state === 'down' || h.state === 'cors-blocked' || h.state === 'model-missing'
        ? { ok: false, text: h.error?.message ?? t('opt.conn.failed') }
        : {
            ok: true,
            text:
              t('opt.conn.ok', { version: h.version ?? t('ui.unknown'), count: h.models.length }) +
              (h.resident
                ? t('opt.conn.resident', { processor: h.onGpu ? 'GPU' : 'CPU' })
                : ''),
          },
    );
  };

  const patch = async (p: Partial<Settings>) => {
    try { setS(await saveSettings(p)); }
    catch (error) { setConn({ ok: false, text: String(error) }); }
  };

  const budgetTtfb = estimateTtfbSeconds(s.pageTokenBudget + 300);
  const ctxFullTtfb = estimateTtfbSeconds(s.numCtx);

  return (
    <div className="wrap">
      <header className="opt-header">
        <SaideIcon size={28} />
        <span className="wordmark">
          <span className="product-prefix">온나라</span> s<b>AI</b>de
        </span>
        <span className="sub">{t('opt.title')}</span>
      </header>

      {/* ── 연결 ── */}
      <section>
        <h2>{t('opt.conn.h')}</h2>

        <div className="field">
          <div className="row">
            <label htmlFor="endpoint">{t('opt.conn.endpoint')}</label>
            <input
              id="endpoint"
              type="text"
              value={s.endpoint}
              onChange={(e) => setS(current => ({ ...current, endpoint: e.target.value }))}
              onBlur={(e) => void patch({ endpoint: e.target.value })}
            />
          </div>
          <p className="desc">{t('opt.conn.endpointDesc')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="model">{t('opt.conn.model')}</label>
            <select id="model" value={s.model} onChange={(e) => patch({ model: e.target.value })}>
              {!models.some(m => m.name === s.model) && <option value={s.model}>{s.model}</option>}
              {models
                .filter((m) => !m.capabilities?.includes('embedding'))
                .map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="row">
            <button className="btn" onClick={() => void probe(s)}>
              {t('opt.conn.check')}
            </button>
            {conn && <span className={`status ${conn.ok ? 'ok' : 'bad'}`}>{conn.text}</span>}
          </div>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="embed">{t('opt.conn.embed')}</label>
            <select
              id="embed"
              value={s.embedModel}
              onChange={(e) => patch({ embedModel: e.target.value })}
            >
              {!models.some(m => m.name === s.embedModel) && <option value={s.embedModel}>{s.embedModel}</option>}
              {models
                .filter((m) => m.capabilities?.includes('embedding'))
                .map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
          <p className="desc">{t('opt.conn.embedDesc')}</p>
        </div>
      </section>

      {/* ── 성능 ── */}
      <section>
        <h2>{t('opt.perf.h')}</h2>

        <div className="field">
          <div className="row">
            <label htmlFor="think">{t('opt.perf.think')}</label>
            <select
              id="think"
              value={s.thinkMode}
              onChange={(e) => patch({ thinkMode: e.target.value as ThinkMode })}
            >
              <option value="off">{t('opt.perf.think.off')}</option>
              <option value="agent-only">{t('opt.perf.think.agent')}</option>
              <option value="always">{t('opt.perf.think.always')}</option>
            </select>
          </div>
          <p className="desc">{rt('opt.perf.thinkDesc')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="budget">{t('opt.perf.budget')}</label>
            <input
              id="budget"
              type="range"
              min={500}
              max={8000}
              step={250}
              value={s.pageTokenBudget}
              onChange={(e) => patch({ pageTokenBudget: Number(e.target.value) })}
            />
            <span className="val">
              {t('opt.perf.budgetVal', { n: s.pageTokenBudget.toLocaleString() })}
            </span>
          </div>
          {/* 비용을 숨기지 않는다 — 계획서 §5 Phase 3-2 */}
          <p className={budgetTtfb > 30 ? 'warn' : 'desc'}>
            {rt('opt.perf.budgetCost', {
              chars: Math.round((s.pageTokenBudget * 2) / 100) * 100,
              sec: budgetTtfb,
            })}
            {budgetTtfb > 30 && t('opt.perf.budgetTooLong')}
          </p>
          <p className="desc">{t('opt.perf.budgetDesc')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="ctx">{t('opt.perf.ctx')}</label>
            <select
              id="ctx"
              value={s.numCtx}
              onChange={(e) => patch({ numCtx: Number(e.target.value) })}
            >
              {[2048, 4096, 8192, 16384, 32768].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()}
                </option>
              ))}
            </select>
          </div>
          <p className="desc">{t('opt.perf.ctxDesc', { sec: ctxFullTtfb })}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="keep">{t('opt.perf.keep')}</label>
            <select
              id="keep"
              value={s.keepAlive}
              onChange={(e) => patch({ keepAlive: e.target.value })}
            >
              <option value="5m">{t('opt.perf.keep.5m')}</option>
              <option value="10m">{t('opt.perf.keep.10m')}</option>
              <option value="30m">{t('opt.perf.keep.30m')}</option>
              <option value="-1">{t('opt.perf.keep.forever')}</option>
            </select>
          </div>
          <p className="desc">{t('opt.perf.keepDesc')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="warm">{t('opt.perf.warm')}</label>
            <input
              id="warm"
              type="checkbox"
              checked={s.warmupOnOpen}
              onChange={(e) => patch({ warmupOnOpen: e.target.checked })}
            />
          </div>
          <p className="desc">{t('opt.perf.warmDesc')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="temp">temperature</label>
            <input
              id="temp"
              type="range"
              min={0}
              max={1.5}
              step={0.1}
              value={s.temperature}
              onChange={(e) => patch({ temperature: Number(e.target.value) })}
            />
            <span className="val">{s.temperature.toFixed(1)}</span>
          </div>
          <p className="desc">{t('opt.perf.tempDesc')}</p>
        </div>
      </section>

      {/* ── 에이전트 (Phase 5) ── */}
      <section>
        <h2>{t('opt.agent.h')}</h2>

        <div className="field">
          <div className="row">
            <label htmlFor="agent">{t('opt.agent.enable')}</label>
            <input
              id="agent"
              type="checkbox"
              checked={s.agentEnabled}
              onChange={(e) => patch({ agentEnabled: e.target.checked })}
            />
          </div>
          <p className="desc">{rt('opt.agent.enableDesc')}</p>
          {/*
            자동 승인 옵션은 제공하지 않는다. 계획서 §7 — 승인 게이트가
            프롬프트 인젝션의 실질적 방어선이고, 무르게 하는 순간 사라진다.
          */}
          <p className="desc">{rt('opt.agent.approvalDesc')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="turns">{t('opt.agent.turns')}</label>
            <input
              id="turns"
              type="range"
              min={2}
              max={12}
              step={1}
              value={s.agentMaxTurns}
              onChange={(e) => patch({ agentMaxTurns: Number(e.target.value) })}
            />
            <span className="val">{t('opt.agent.turnsVal', { n: s.agentMaxTurns })}</span>
          </div>
          {/* 비용을 숨기지 않는다. 이 하드웨어에서 1턴이 약 25초다. */}
          <p className={s.agentMaxTurns * 25 > 240 ? 'warn' : 'desc'}>
            {rt('opt.agent.turnsDesc', { min: Math.round((s.agentMaxTurns * 25) / 6) / 10 })}
          </p>
        </div>

        <div className="field">
          <p className="desc">{t('opt.agent.idleDesc')}</p>
        </div>
      </section>

      <PerfDashboard />

      <QualityPanel />

      {/* ── 첨부 파일 저장 (B5) ── */}
      <section>
        <h2>{t('opt.files.h')}</h2>

        <div className="field">
          <div className="row">
            <label htmlFor="naming">{t('opt.files.naming')}</label>
            <select
              id="naming"
              value={s.attachmentNaming}
              onChange={(e) => patch({ attachmentNaming: e.target.value as typeof s.attachmentNaming })}
            >
              <option value="normalized">{t('opt.files.naming.normalized')}</option>
              <option value="browser">{t('opt.files.naming.browser')}</option>
            </select>
          </div>
          <p className="desc">{t('opt.files.namingDesc')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="folder">{t('opt.files.folder')}</label>
            <input
              id="folder"
              type="checkbox"
              checked={s.attachmentFolder}
              disabled={s.attachmentNaming !== 'normalized'}
              onChange={(e) => patch({ attachmentFolder: e.target.checked })}
            />
          </div>
          <p className="desc">{t('opt.files.folderDesc')}</p>
        </div>
      </section>

      <PresetEditor />

      <MemoryPanel />

      {/* ── 일정 기한 알림 (S07) ── */}
      <section>
        <h2>{t('opt.alert.h')}</h2>

        <div className="field">
          <div className="row">
            <label htmlFor="taskAlerts">{t('opt.alert.on')}</label>
            <input
              id="taskAlerts"
              type="checkbox"
              checked={s.taskAlerts}
              onChange={(e) => patch({ taskAlerts: e.target.checked })}
            />
          </div>
          <p className="desc">{t('opt.alert.onDesc')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="taskAlertHour">{t('opt.alert.hour')}</label>
            <select
              id="taskAlertHour"
              value={s.taskAlertHour}
              disabled={!s.taskAlerts}
              onChange={(e) => patch({ taskAlertHour: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>{t('opt.alert.hourValue', { hour })}</option>
              ))}
            </select>
          </div>
          <p className="desc">{t('opt.alert.hourDesc')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="jobAlerts">{t('opt.alert.job')}</label>
            <input
              id="jobAlerts"
              type="checkbox"
              checked={s.jobAlerts}
              onChange={(e) => patch({ jobAlerts: e.target.checked })}
            />
          </div>
          <p className="desc">{t('opt.alert.jobDesc')}</p>
        </div>
      </section>

      {/* ── 페이지 접근 권한 ── */}
      <section>
        <h2>{t('opt.access.h')}</h2>

        <div className="field">
          <p className="desc">{t('opt.access.intro')}</p>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="allsites">{t('opt.access.all')}</label>
            <input
              id="allsites"
              type="checkbox"
              checked={allSites}
              onChange={async (e) => {
                if (e.target.checked) await requestAllUrls();
                else await revokeAllSites();
                await reloadPermissions();
              }}
            />
          </div>
          <p className="desc">{t('opt.access.allDesc')}</p>
          <p className="desc">{rt('opt.access.captureDesc')}</p>
        </div>

        {!allSites && (
          <div className="field">
            <div className="row">
              <label>{t('opt.access.granted')}</label>
              <span className="status">{t('opt.access.count', { n: origins.length })}</span>
            </div>
            {origins.length === 0 ? (
              <p className="desc">{t('opt.access.none')}</p>
            ) : (
              <ul className="origin-list">
                {origins.map((o) => (
                  <li key={o}>
                    <code>{o}</code>
                    <button
                      className="btn-sm"
                      onClick={async () => {
                        await revokeOrigin(o);
                        await reloadPermissions();
                      }}
                    >
                      {t('opt.access.revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ── 표시 ── */}
      <section>
        <h2>{t('opt.display.h')}</h2>
        <div className="field">
          <div className="row">
            <label htmlFor="theme">{t('opt.display.theme')}</label>
            <select
              id="theme"
              value={s.theme}
              onChange={(e) => patch({ theme: e.target.value as ThemePref })}
            >
              <option value="system">{t('opt.display.theme.system')}</option>
              <option value="light">{t('opt.display.theme.light')}</option>
              <option value="dark">{t('opt.display.theme.dark')}</option>
            </select>
          </div>
        </div>

        <div className="field">
          <div className="row">
            <label htmlFor="locale">{t('opt.display.locale')}</label>
            <select
              id="locale"
              value={s.locale}
              onChange={(e) => patch({ locale: e.target.value as Locale })}
            >
              <option value="ko">한국어</option>
              <option value="en">English</option>
            </select>
          </div>
          <p className="desc">{t('opt.display.localeDesc')}</p>
        </div>
      </section>

      <section>
        <button
          className="btn"
          onClick={async () => {
            try { const settings = await resetSettings(); setS(settings); setLocale(settings.locale); void probe(settings); }
            catch (error) { setConn({ ok: false, text: String(error) }); }
          }}
        >
          {t('opt.reset')}
        </button>
        <p className="desc" style={{ marginTop: 8 }}>
          {t('opt.resetDesc', { rate: MEASURED_PREFILL_TOK_PER_SEC })}
        </p>
      </section>
    </div>
  );
}
