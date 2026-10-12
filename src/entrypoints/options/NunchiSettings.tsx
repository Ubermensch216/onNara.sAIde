/**
 * 설정 › 눈치코치 연동.
 *
 * ★ 연결은 눈치코치(설정 › 시스템 › onNara.sAIde 연결)에서 만든 6자리 코드로 한다.
 *   코드가 맞으면 눈치코치가 곧바로 답한다 — TONGDAL.ai와 달리 허용 확인 창을 기다리지 않는다.
 * ★ 토큰은 화면에 보이지 않는다. 연결됨·권한·연결 시각만 보인다.
 * ★ 연결하지 않아도 꾸러미 내보내기는 된다. 이 연결은 눈치코치의 상태를 확인하고
 *   (앞으로) 꾸러미가 준비됐음을 알리는 데 쓴다.
 */

import { useEffect, useRef, useState } from 'react';
import { useT, type MessageKey } from '@/lib/i18n';
import { pairNunchi } from '@/lib/nunchi/client';
import { forgetNunchiToken, isNunchiPaired, normalizeBridgeUrl, saveNunchi, type NunchiScope } from '@/lib/nunchi/connection';
import type { NunchiState } from '@/lib/nunchi/status';
import { useNunchi } from '@/lib/nunchi/useNunchi';

const STATE_KEYS: Record<NunchiState, MessageKey> = {
  unpaired: 'nunchi.state.unpaired',
  offline: 'nunchi.state.offline',
  version_mismatch: 'nunchi.state.versionMismatch',
  ready: 'nunchi.state.ready',
};

const SCOPE_KEYS: Record<NunchiScope, MessageKey> = {
  read: 'opt.nunchi.scope.read',
  write: 'opt.nunchi.scope.write',
};

export function NunchiSettings() {
  const t = useT();
  const { connection, health, loading, refresh } = useNunchi();
  const [url, setUrl] = useState(connection.baseUrl);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);

  useEffect(() => { setUrl(connection.baseUrl); }, [connection.baseUrl]);
  useEffect(() => () => pending.current?.abort(), []);

  const paired = isNunchiPaired(connection);

  const saveUrl = async () => {
    setError(''); setNote('');
    const next = normalizeBridgeUrl(url);
    if (!next) { setError(t('opt.nunchi.urlInvalid')); return; }
    if (next === connection.baseUrl) return;
    // 주소가 바뀌면 다른 프로그램일 수 있다. 토큰을 그대로 보내지 않도록 연결을 푼다.
    await saveNunchi({ ...connection, baseUrl: next, token: null, clientId: null, scopes: [], pairedAt: null });
    setNote(t('opt.nunchi.urlSaved'));
  };

  const connect = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) { setError(t('opt.nunchi.codeInvalid')); return; }
    setError(''); setNote(''); setBusy(true);
    const controller = new AbortController();
    pending.current = controller;
    try {
      const result = await pairNunchi(connection, digits, 'onNara.sAIde', controller.signal);
      await saveNunchi({ ...connection, token: result.token, clientId: result.clientId, scopes: result.scopes, pairedAt: Date.now() });
      setCode('');
      setNote(t('opt.nunchi.pairedNow'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = null;
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(t('opt.nunchi.unpairConfirm'))) return;
    await forgetNunchiToken();
    setNote(t('opt.nunchi.unpaired'));
  };

  if (loading) return null;

  return (
    <section>
      <h2>{t('opt.nunchi.h')}</h2>
      {error && <p className="warn" role="alert">{error}</p>}
      <div className="field"><p className="desc">{t('opt.nunchi.desc')}</p></div>

      <div className="field">
        <div className="row">
          <label htmlFor="nunchi-url">{t('opt.nunchi.url')}</label>
          <input id="nunchi-url" type="text" value={url} disabled={busy}
            onChange={e => setUrl(e.target.value)} onBlur={() => void saveUrl()} />
        </div>
        <p className="desc">{t('opt.nunchi.urlDesc')}</p>
      </div>

      {paired ? (
        <div className="field">
          <p className="desc" role="status">
            {t('opt.nunchi.paired', {
              date: connection.pairedAt ? new Date(connection.pairedAt).toLocaleString() : '—',
              scopes: connection.scopes.map(scope => t(SCOPE_KEYS[scope])).join(', ') || '—',
            })}
          </p>
          <p className="desc" role="status">{t(STATE_KEYS[health.state])}{health.project ? ` · ${health.project}` : ''}</p>
          <div className="row">
            <button className="btn" onClick={() => void refresh()}>{t('opt.nunchi.check')}</button>
            <button className="btn" onClick={() => void disconnect()}>{t('opt.nunchi.unpair')}</button>
          </div>
        </div>
      ) : (
        <div className="field">
          <div className="row">
            <label htmlFor="nunchi-code">{t('opt.nunchi.code')}</label>
            <input id="nunchi-code" type="text" inputMode="numeric" autoComplete="off" maxLength={7} value={code} disabled={busy}
              placeholder="000000" onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void connect(); }} />
            <button className="btn" onClick={() => void connect()} disabled={busy}>{t('opt.nunchi.pair')}</button>
          </div>
          <p className="desc">{t('opt.nunchi.codeDesc')}</p>
        </div>
      )}

      {note && <p className="desc" role="status">{note}</p>}
    </section>
  );
}
