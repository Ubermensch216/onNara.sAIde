/**
 * 설정 › TONGDAL.ai 연동(계획서 tongdal-integration-workplan.md O2).
 *
 * ★ 연결은 TONGDAL에서 만든 6자리 코드로 한다. 코드를 보내면 TONGDAL 창에 허용 확인이 뜨고,
 *   사용자가 [허용]을 누를 때까지 요청이 기다린다. 그 사이 이 화면은 "허용을 기다리는 중"을 보인다.
 * ★ 토큰은 화면에 보이지 않는다. 연결됨·권한·연결 시각만 보인다.
 */

import { useEffect, useRef, useState } from 'react';
import { useT, type MessageKey } from '@/lib/i18n';
import { pair } from '@/lib/tongdal/client';
import { forgetToken, isPaired, normalizeBridgeUrl, saveConnection } from '@/lib/tongdal/connection';
import type { TongdalState } from '@/lib/tongdal/status';
import type { TongdalScope } from '@/lib/tongdal/types';
import { useTongdal } from '@/lib/tongdal/useTongdal';

const STATE_KEYS: Record<TongdalState, MessageKey> = {
  unpaired: 'tongdal.state.unpaired',
  offline: 'tongdal.state.offline',
  version_mismatch: 'tongdal.state.versionMismatch',
  no_space: 'tongdal.state.noSpace',
  starting: 'tongdal.state.starting',
  engine_error: 'tongdal.state.engineError',
  ready: 'tongdal.state.ready',
};

const SCOPE_KEYS: Record<TongdalScope, MessageKey> = {
  read: 'opt.tongdal.scope.read',
  write: 'opt.tongdal.scope.write',
  delete: 'opt.tongdal.scope.delete',
};

export function TongdalSettings() {
  const t = useT();
  const { connection, health, loading, refresh } = useTongdal();
  const [url, setUrl] = useState(connection.baseUrl);
  const [code, setCode] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);

  useEffect(() => { setUrl(connection.baseUrl); }, [connection.baseUrl]);
  useEffect(() => () => pending.current?.abort(), []);

  const paired = isPaired(connection);

  const saveUrl = async () => {
    setError(''); setNote('');
    const next = normalizeBridgeUrl(url);
    if (!next) { setError(t('opt.tongdal.urlInvalid')); return; }
    if (next === connection.baseUrl) return;
    // 주소가 바뀌면 다른 TONGDAL일 수 있다. 토큰을 그대로 보내지 않도록 연결을 푼다.
    await saveConnection({ ...connection, baseUrl: next, token: null, clientId: null, scopes: [], pairedAt: null });
    setNote(t('opt.tongdal.urlSaved'));
  };

  const connect = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) { setError(t('opt.tongdal.codeInvalid')); return; }
    setError(''); setNote(''); setWaiting(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const result = await pair(connection, digits, 'onNara.sAIde', controller.signal);
      await saveConnection({ ...connection, token: result.token, clientId: result.clientId, scopes: result.scopes, pairedAt: Date.now() });
      setCode('');
      setNote(t('opt.tongdal.pairedNow'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = null;
      setWaiting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(t('opt.tongdal.unpairConfirm'))) return;
    await forgetToken();
    setNote(t('opt.tongdal.unpaired'));
  };

  if (loading) return null;

  return (
    <section>
      <h2>{t('opt.tongdal.h')}</h2>
      {error && <p className="warn" role="alert">{error}</p>}
      <div className="field"><p className="desc">{t('opt.tongdal.desc')}</p></div>

      <div className="field">
        <div className="row">
          <label htmlFor="tongdal-url">{t('opt.tongdal.url')}</label>
          <input id="tongdal-url" type="text" value={url} disabled={waiting}
            onChange={e => setUrl(e.target.value)} onBlur={() => void saveUrl()} />
        </div>
        <p className="desc">{t('opt.tongdal.urlDesc')}</p>
      </div>

      {paired ? (
        <div className="field">
          <p className="desc" role="status">
            {t('opt.tongdal.paired', {
              date: connection.pairedAt ? new Date(connection.pairedAt).toLocaleString() : '—',
              scopes: connection.scopes.map(scope => t(SCOPE_KEYS[scope])).join(', ') || '—',
            })}
          </p>
          <p className="desc" role="status">{t(STATE_KEYS[health.state])}{health.spaceName ? ` · ${health.spaceName}` : ''}</p>
          <div className="row">
            <button className="btn" onClick={() => void refresh()}>{t('opt.tongdal.check')}</button>
            <button className="btn" onClick={() => void disconnect()}>{t('opt.tongdal.unpair')}</button>
          </div>
        </div>
      ) : (
        <div className="field">
          <div className="row">
            <label htmlFor="tongdal-code">{t('opt.tongdal.code')}</label>
            <input id="tongdal-code" type="text" inputMode="numeric" autoComplete="off" maxLength={7} value={code} disabled={waiting}
              placeholder="000000" onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void connect(); }} />
            <button className="btn" onClick={() => void connect()} disabled={waiting}>{t('opt.tongdal.pair')}</button>
          </div>
          <p className="desc">{waiting ? t('opt.tongdal.waiting') : t('opt.tongdal.codeDesc')}</p>
        </div>
      )}

      {note && <p className="desc" role="status">{note}</p>}
    </section>
  );
}
