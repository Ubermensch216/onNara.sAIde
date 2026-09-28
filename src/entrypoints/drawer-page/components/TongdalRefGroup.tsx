/**
 * 참고문서 선택의 세 번째 묶음 — TONGDAL 서고(계획서 tongdal-integration-workplan.md O5).
 *
 * ★ TONGDAL.ai와 연결하지 않은 사용자에게는 아무것도 보이지 않는다.
 * ★ 검색 결과를 고르면 서랍이 그 문서의 본문을 받아 온다(DrawerApp). 여기서는 고르기만 한다.
 *   선택 한도(3건)는 다른 두 묶음과 함께 센다.
 * ★ 고른 항목은 **그 자리에서** 체크된다. 고른 것을 목록 밖으로 옮기면 클릭한 곳과 다른 곳에
 *   체크가 생긴 것처럼 보인다. 지금 목록에 없는(이전 검색에서 고른) 것만 위에 따로 모은다.
 * ★ 낱말이 든 결과만 기본으로 보인다. 벡터 검색은 관계없는 문서도 "가장 가까운 것"으로 돌려주므로,
 *   낱말 일치가 없으면 "없다"고 먼저 말한다(lib/tongdal/match.ts).
 */

import { useRef, useState, type FormEvent } from 'react';
import { MaterialIcon } from './MaterialIcon';
import { search, TongdalError } from '@/lib/tongdal/client';
import { locationOf } from '@/lib/tongdal/evidence';
import { dedupeByDocument, splitByMatch } from '@/lib/tongdal/match';
import type { TongdalSearchHit } from '@/lib/tongdal/types';
import { useTongdal } from '@/lib/tongdal/useTongdal';

export const tongdalKey = (documentId: string) => `tongdal:${documentId}`;

/** 서랍이 들고 있는 TONGDAL 참고문서. 본문은 고른 뒤에 받아 온다. */
export interface TongdalRef {
  key: string;
  documentId: string;
  title: string;
  location: string;
  text: string | null;
  loading: boolean;
  error: string | null;
}

type DocHit = TongdalSearchHit & { sourceDocumentId: string };

interface SearchState {
  query: string;
  matched: DocHit[];
  related: DocHit[];
  keywordOnly: boolean;
}

const STATE_TEXT: Record<string, string> = {
  offline: 'TONGDAL.ai가 실행 중이 아니거나 연결 창구가 꺼져 있습니다.',
  version_mismatch: 'TONGDAL.ai 판본이 이 확장과 맞지 않습니다. 둘 중 하나를 업데이트하세요.',
  no_space: 'TONGDAL.ai에서 지식 공간을 먼저 선택하세요.',
  starting: 'TONGDAL.ai 처리 엔진을 준비하고 있습니다.',
  engine_error: 'TONGDAL.ai 처리 엔진을 시작하지 못했습니다.',
};

function RefStatus({ item }: { item: TongdalRef | undefined }) {
  if (!item) return null;
  if (item.loading) return <span className="text-[11px] text-blue-700 animate-pulse shrink-0">본문 받는 중</span>;
  if (item.error) return <span className="text-rose-600 flex items-center shrink-0" title={item.error}><MaterialIcon name="warning" size={15} /></span>;
  return <span className="text-blue-600 flex items-center shrink-0" title="본문을 받았습니다"><MaterialIcon name="checkCircle" size={16} /></span>;
}

export function TongdalRefGroup({ selectedKeys, full, refs, onToggle }: {
  selectedKeys: string[];
  full: boolean;
  /** 이미 고른 TONGDAL 참고문서(본문 받는 중 포함). */
  refs: TongdalRef[];
  /** 고르거나 뺀다. 고를 때는 검색 결과(hit)를 함께 넘겨 제목·위치를 남긴다. */
  onToggle: (documentId: string, hit?: TongdalSearchHit) => void;
}) {
  const { connection, health, loading } = useTongdal();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchState | null>(null);
  const [showRelated, setShowRelated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** 마지막으로 보낸 검색. 늦게 도착한 앞선 응답이 새 결과를 덮어쓰지 않게 한다. */
  const latest = useRef(0);

  if (loading || health.state === 'unpaired') return null;

  const clear = () => {
    ++latest.current;
    setQuery(''); setResult(null); setShowRelated(false); setError(''); setBusy(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (!text) { clear(); return; }
    const mine = ++latest.current;
    setBusy(true); setError(''); setShowRelated(false);
    try {
      // 낱말 일치를 가리려면 발췌가 넉넉해야 한다. 화면에는 두 줄만 보인다.
      const found = await search(connection, { query: text, topK: 8, maxChars: 1500 });
      if (mine !== latest.current) return;
      const hits = dedupeByDocument(found.results.filter((hit): hit is DocHit => Boolean(hit.sourceDocumentId)));
      setResult({ query: text, ...splitByMatch(hits, text), keywordOnly: found.searchMode === 'keyword' });
    } catch (e) {
      if (mine !== latest.current) return;
      setResult(null);
      if (!(e instanceof TongdalError && e.code === 'aborted')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === latest.current) setBusy(false);
    }
  };

  const visible = result ? [...result.matched, ...(showRelated ? result.related : [])] : [];
  const visibleIds = new Set(visible.map(hit => hit.sourceDocumentId));
  // 지금 목록에 없는 선택만 위에 모은다. 목록에 있는 것은 그 자리에서 체크된다.
  const elsewhere = refs.filter(ref => selectedKeys.includes(ref.key) && !visibleIds.has(ref.documentId));

  const row = (hit: DocHit, related: boolean) => {
    const key = tongdalKey(hit.sourceDocumentId);
    const checked = selectedKeys.includes(key);
    const disabled = !checked && full;
    return (
      <label key={hit.sourceDocumentId}
        className={`block p-2 rounded-lg border transition ${checked ? 'bg-blue-50/40 border-blue-300 shadow-2xs' : 'bg-white border-slate-200 hover:border-slate-300'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
        title={disabled ? '참고문서는 최대 3건까지 선택할 수 있습니다' : undefined}>
        <span className="flex items-center gap-1.5 min-w-0">
          <input type="checkbox" checked={checked} disabled={disabled}
            onChange={() => onToggle(hit.sourceDocumentId, checked ? undefined : hit)}
            className="accent-blue-600 h-4 w-4 cursor-pointer shrink-0 disabled:cursor-not-allowed" />
          {related && <span className="text-[10.5px] font-semibold text-amber-800 bg-amber-50 px-1 py-0.5 rounded border border-amber-200 shrink-0">의미만 가까움</span>}
          <span className="text-xs sm:text-[13px] font-medium text-slate-900 truncate flex-1" title={hit.title}>{hit.title}</span>
          {checked && <RefStatus item={refs.find(ref => ref.key === key)} />}
        </span>
        <span className="block text-[11px] text-slate-500 truncate mt-0.5" title={locationOf(hit)}>{locationOf(hit)}</span>
        <span className="block text-[11px] text-slate-600 mt-0.5 line-clamp-2">{hit.text}</span>
        {checked && refs.find(ref => ref.key === key)?.error && (
          <span className="block text-[11px] text-rose-700 mt-1">{refs.find(ref => ref.key === key)!.error}</span>
        )}
      </label>
    );
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[11.5px] font-semibold text-slate-600">
        TONGDAL 서고{health.spaceName && <span className="font-normal text-slate-500"> ({health.spaceName})</span>}
      </div>

      {health.state !== 'ready' ? (
        <div className="p-2.5 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-xs text-slate-600" role="status">
          {STATE_TEXT[health.state] ?? 'TONGDAL.ai에 연결할 수 없습니다.'}
        </div>
      ) : (
        <>
          <form onSubmit={(e) => void submit(e)} className="flex gap-1.5">
            <input
              type="search"
              value={query}
              maxLength={500}
              // 입력을 모두 지우면(× 단추 포함) 결과도 지운다.
              onChange={(e) => { setQuery(e.target.value); if (!e.target.value) clear(); }}
              placeholder="내 자료에서 찾기 (예: 2026 예산편성 지침)"
              aria-label="TONGDAL 서고에서 참고문서 찾기"
              className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button type="submit" disabled={busy || !query.trim()}
              className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded text-xs font-medium disabled:opacity-50 cursor-pointer">
              {busy ? '찾는 중…' : '찾기'}
            </button>
          </form>
          {health.keywordOnly && <p className="text-[11px] text-amber-700">Ollama를 쓸 수 없어 낱말 일치로만 찾습니다.</p>}
          {error && <p className="text-[11px] text-rose-700" role="alert">{error}</p>}
        </>
      )}

      {elsewhere.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-slate-500">앞서 고른 서고 자료</div>
          {elsewhere.map((ref) => (
            <div key={ref.key} className="p-2 rounded-lg border bg-blue-50/40 border-blue-300 shadow-2xs">
              <label className="flex items-center gap-1.5 cursor-pointer min-w-0">
                <input type="checkbox" checked onChange={() => onToggle(ref.documentId)}
                  className="accent-blue-600 h-4 w-4 cursor-pointer shrink-0" />
                <span className="text-xs sm:text-[13px] font-medium text-slate-900 truncate flex-1" title={ref.title}>{ref.title}</span>
                <RefStatus item={ref} />
              </label>
              <div className="text-[11px] text-slate-500 truncate mt-0.5" title={ref.location}>{ref.location}</div>
              {ref.error && <p className="text-[11px] text-rose-700 mt-1">{ref.error}</p>}
            </div>
          ))}
        </div>
      )}

      {result && !busy && (
        <div className="space-y-1.5" aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
            <span className="min-w-0 truncate">
              ‘<strong className="font-semibold text-slate-800">{result.query}</strong>’ 검색 결과 {result.matched.length}건
            </span>
            <button type="button" onClick={clear}
              className="shrink-0 text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer" title="검색어와 결과 목록 지우기">
              결과 지우기
            </button>
          </div>

          {result.matched.length === 0 && (
            <p className="p-2.5 bg-slate-50 border border-dashed border-slate-200 rounded-lg text-xs text-slate-600" role="status">
              ‘{result.query}’이(가) 들어간 자료를 찾지 못했습니다. 다른 낱말로 찾아보세요.
            </p>
          )}

          {result.matched.map(hit => row(hit, false))}

          {result.related.length > 0 && !result.keywordOnly && (
            <button type="button" onClick={() => setShowRelated(v => !v)}
              className="text-xs text-blue-700 hover:text-blue-900 underline cursor-pointer">
              {showRelated ? '의미만 가까운 자료 접기' : `낱말은 없지만 의미가 가까운 자료 ${result.related.length}건 보기`}
            </button>
          )}
          {showRelated && result.related.map(hit => row(hit, true))}
        </div>
      )}
    </div>
  );
}
