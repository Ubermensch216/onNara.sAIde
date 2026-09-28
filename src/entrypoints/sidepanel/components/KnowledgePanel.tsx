/**
 * 내 지식 탭 — TONGDAL.ai 지식 공간의 검색·분류 보기(계획서 tongdal-integration-workplan.md §5, O3).
 *
 * ★ 가벼운 허브다. 지식을 정리하는 일(분류 승인·카테고리 편집·그래프·위키)은 TONGDAL에서만 한다.
 *   여기서는 찾고, 읽고, AI에게 물을 거리로 넘기고, 필요하면 TONGDAL 창으로 보낸다.
 * ★ 쓸 수 없는 상태를 빈 결과처럼 보이게 두지 않는다. 연결 상태가 ready가 아니면 이유와 해결 방법을 먼저 보인다.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useT, type MessageKey } from '@/lib/i18n';
import { getDocument, listDocuments, listShelves, openInTongdal, search, TongdalError } from '@/lib/tongdal/client';
import { locationOf } from '@/lib/tongdal/evidence';
import { splitByMatch } from '@/lib/tongdal/match';
import type { TongdalState } from '@/lib/tongdal/status';
import type { TongdalDocumentDetail, TongdalDocumentSummary, TongdalSearchHit, TongdalSearchResult, TongdalShelf } from '@/lib/tongdal/types';
import type { UseTongdal } from '@/lib/tongdal/useTongdal';

type Mode = 'search' | 'browse';
const PAGE = 30;

const STATE_KEYS: Record<Exclude<TongdalState, 'ready'>, MessageKey> = {
  unpaired: 'tongdal.state.unpaired',
  offline: 'tongdal.state.offline',
  version_mismatch: 'tongdal.state.versionMismatch',
  no_space: 'tongdal.state.noSpace',
  starting: 'tongdal.state.starting',
  engine_error: 'tongdal.state.engineError',
};

interface Props {
  tongdal: UseTongdal;
  onOpenSettings: () => void;
  /** 검색어를 AI 탭으로 넘겨 "내 지식 포함"으로 묻는다. */
  onAsk: (question: string) => void;
}

export function KnowledgePanel({ tongdal, onOpenSettings, onAsk }: Props) {
  const t = useT();
  const { connection, health } = tongdal;
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; mode: TongdalSearchResult['searchMode']; matched: TongdalSearchHit[]; related: TongdalSearchHit[] } | null>(null);
  const [showRelated, setShowRelated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shelves, setShelves] = useState<TongdalShelf[]>([]);
  const [shelfId, setShelfId] = useState('');
  const [docs, setDocs] = useState<{ total: number; items: TongdalDocumentSummary[] } | null>(null);
  const [detail, setDetail] = useState<TongdalDocumentDetail | null>(null);
  const request = useRef<AbortController | null>(null);

  const ready = health.state === 'ready' && health.canRead;

  const run = async <T,>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError('');
    try {
      return await work(controller.signal);
    } catch (e) {
      if (e instanceof TongdalError && e.code === 'aborted') return null;
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };

  useEffect(() => () => request.current?.abort(), []);

  // 분류 보기로 처음 들어오면 분류와 첫 쪽을 읽는다.
  useEffect(() => {
    if (mode !== 'browse' || !ready) return;
    void run(async signal => {
      const [shelfList, list] = await Promise.all([
        listShelves(connection, signal),
        listDocuments(connection, { shelfId: shelfId || null, limit: PAGE }, signal),
      ]);
      setShelves(shelfList.shelves);
      setDocs({ total: list.total, items: list.documents });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 분류를 바꿀 때만 다시 읽는다
  }, [mode, shelfId, ready, connection.token]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (!text || !ready) return;
    setDetail(null);
    setShowRelated(false);
    void run(async signal => {
      const data = await search(connection, { query: text, topK: 8, maxChars: 1500 }, signal);
      setResult({ query: text, mode: data.searchMode, ...splitByMatch(data.results, text) });
    });
  };

  /** 검색어와 결과를 지운다. 진행 중인 검색도 멈춘다. */
  const clearSearch = () => {
    request.current?.abort();
    setQuery(''); setResult(null); setShowRelated(false); setError('');
  };

  const loadMore = () => {
    if (!docs) return;
    void run(async signal => {
      const list = await listDocuments(connection, { shelfId: shelfId || null, limit: PAGE, offset: docs.items.length }, signal);
      setDocs({ total: list.total, items: [...docs.items, ...list.documents] });
    });
  };

  const showDocument = (id: string) => {
    void run(async signal => setDetail(await getDocument(connection, id, { includeText: true, maxChars: 8000 }, signal)));
  };

  const open = (id: string) => {
    void openInTongdal(connection, id).catch(e => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="kn">
      <div className="kn-head">
        <h2 className="kn-title">{t('view.knowledge')}</h2>
        {health.spaceName && <span className="kn-space" title={t('kn.spaceHint')}>{health.spaceName}</span>}
        <button type="button" className="minibtn" onClick={() => void tongdal.refresh()}>{t('ui.retry')}</button>
      </div>

      {health.state !== 'ready' ? (
        <div className="kn-state" role="status">
          <p>{t(STATE_KEYS[health.state])}</p>
          {health.error && health.state === 'offline' && <p className="kn-muted">{health.error.message}</p>}
          <div className="kn-actions">
            <button type="button" className="minibtn" onClick={onOpenSettings}>{t('kn.openSettings')}</button>
          </div>
        </div>
      ) : !health.canRead ? (
        <div className="kn-state" role="status"><p>{t('tongdal.state.noReadScope')}</p></div>
      ) : (
        <>
          {(health.keywordOnly || health.indexing > 0) && (
            <p className="notice kn-notice">
              {[health.keywordOnly ? t('tongdal.state.keywordOnly') : '', health.indexing > 0 ? t('tongdal.state.indexing', { n: health.indexing }) : ''].filter(Boolean).join(' ')}
            </p>
          )}

          <div className="kn-modes" role="tablist" aria-label={t('view.knowledge')}>
            {(['search', 'browse'] as Mode[]).map(item => (
              <button key={item} type="button" role="tab" aria-selected={mode === item}
                className={`kn-mode ${mode === item ? 'on' : ''}`} onClick={() => { setMode(item); setDetail(null); }}>
                {t(item === 'search' ? 'kn.mode.search' : 'kn.mode.browse')}
              </button>
            ))}
          </div>

          {error && <p className="kn-error" role="alert">{error}</p>}

          {detail ? (
            <DocumentView detail={detail} onBack={() => setDetail(null)} onOpen={open} />
          ) : mode === 'search' ? (
            <>
              <form className="kn-search" onSubmit={submit}>
                <input
                  type="search"
                  value={query}
                  maxLength={500}
                  placeholder={t('kn.search.placeholder')}
                  aria-label={t('kn.search.placeholder')}
                  onChange={e => { setQuery(e.target.value); if (!e.target.value) clearSearch(); }}
                />
                <button type="submit" className="minibtn" disabled={busy || !query.trim()}>{t('kn.search.btn')}</button>
              </form>
              {busy && <p className="kn-muted" role="status">{t('kn.loading')}</p>}
              {result && !busy && (
                <section className="kn-results" aria-live="polite">
                  <div className="kn-results-head">
                    <span className="kn-results-query">{t('kn.resultsFor', { q: result.query, n: result.matched.length })}</span>
                    {result.mode === 'keyword' && <span className="kn-badge">{t('kn.mode.keyword')}</span>}
                    <button type="button" className="kn-link kn-clear" onClick={clearSearch}>{t('kn.clear')}</button>
                  </div>
                  {result.matched.length > 0 && (
                    <button type="button" className="minibtn kn-ask" onClick={() => onAsk(result.query)} title={t('kn.askHint')}>{t('kn.ask')}</button>
                  )}
                  {result.matched.length === 0 && <p className="kn-muted" role="status">{t('kn.search.noMatch', { q: result.query })}</p>}
                  {result.related.length > 0 && result.mode !== 'keyword' && (
                    <button type="button" className="kn-link" onClick={() => setShowRelated(v => !v)}>
                      {showRelated ? t('kn.related.hide') : t('kn.related.show', { n: result.related.length })}
                    </button>
                  )}
                  {(result.matched.length > 0 || showRelated) && (
                    <ul className="kn-list">
                      {[...result.matched, ...(showRelated ? result.related : [])].map((hit, index) => (
                        <li key={`${hit.relativePath}#${hit.sectionPath}#${index}`} className="kn-item">
                          {index >= result.matched.length && <span className="kn-badge kn-badge-related">{t('kn.related.badge')}</span>}
                          <button type="button" className="kn-item-title" disabled={!hit.sourceDocumentId}
                            onClick={() => hit.sourceDocumentId && showDocument(hit.sourceDocumentId)}>
                            {hit.title}
                          </button>
                          <span className="kn-item-meta">{locationOf(hit)}</span>
                          <p className="kn-excerpt">{hit.text}</p>
                          {hit.sourceDocumentId && (
                            <button type="button" className="kn-link" onClick={() => open(hit.sourceDocumentId!)}>{t('kn.openInTongdal')}</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          ) : (
            <section className="kn-browse">
              <select value={shelfId} onChange={e => setShelfId(e.target.value)} aria-label={t('kn.shelf')}>
                <option value="">{t('kn.shelf.all')}</option>
                {shelves.map(shelf => <option key={shelf.id} value={shelf.id}>{`${shelf.name} (${shelf.documentCount})`}</option>)}
              </select>
              {docs && docs.items.length === 0 && !busy && <p className="kn-muted">{t('kn.docs.empty')}</p>}
              {docs && docs.items.length > 0 && (
                <ul className="kn-list">
                  {docs.items.map(doc => (
                    <li key={doc.id} className="kn-item">
                      <button type="button" className="kn-item-title" onClick={() => showDocument(doc.id)}>{doc.title}</button>
                      <span className="kn-item-meta">
                        {[doc.shelfName, doc.documentType, doc.metadata.year ? String(doc.metadata.year) : '', doc.current?.versionLabel].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {busy && <p className="kn-muted" role="status">{t('kn.loading')}</p>}
              {docs && docs.items.length < docs.total && !busy && (
                <button type="button" className="minibtn kn-more" onClick={loadMore}>{t('kn.docs.more', { n: docs.total - docs.items.length })}</button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function DocumentView({ detail, onBack, onOpen }: { detail: TongdalDocumentDetail; onBack: () => void; onOpen: (id: string) => void }) {
  const t = useT();
  const { document, text } = detail;
  const current = document.versions.find(version => version.isCurrent) ?? document.versions[0];
  return (
    <article className="kn-doc">
      <div className="kn-actions">
        <button type="button" className="minibtn" onClick={onBack}>{t('kn.doc.back')}</button>
        <button type="button" className="minibtn" onClick={() => onOpen(document.id)}>{t('kn.openInTongdal')}</button>
      </div>
      <h3 className="kn-doc-title">{document.title}</h3>
      <p className="kn-item-meta">
        {[document.shelfName, document.documentType, current?.relativePath, current?.versionLabel].filter(Boolean).join(' · ')}
      </p>
      {!text || !text.indexed ? (
        <p className="kn-muted">{t('kn.doc.notIndexed')}</p>
      ) : (
        <>
          <pre className="kn-doc-text">{text.content}</pre>
          {text.truncated && <p className="kn-muted">{t('kn.doc.truncated')}</p>}
        </>
      )}
    </article>
  );
}
