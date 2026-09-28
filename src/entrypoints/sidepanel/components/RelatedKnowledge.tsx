/**
 * 조치카드 아래 "관련 내 자료" — 공문 제목으로 TONGDAL.ai를 찾아 최대 3건을 보인다(계획서 O6).
 *
 * ★ 질의는 코드가 만든다(공문 제목 그대로). 모델에게 검색어를 짓게 하면 한 번 더 기다려야 하고,
 *   무엇으로 찾았는지 사용자가 알 수 없다.
 * ★ 찾은 것이 없거나 TONGDAL을 쓸 수 없으면 아무것도 그리지 않는다. 조치카드 자체가 본론이고,
 *   이 칸은 덤이다 — 비어 있는 칸이 카드 아래를 차지하지 않게 한다.
 * ★ 같은 제목은 패널이 열려 있는 동안 한 번만 찾는다. 대화 목록을 다시 그릴 때마다 검색하지 않는다.
 */

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { openInTongdal, search } from '@/lib/tongdal/client';
import { isPaired, loadConnection } from '@/lib/tongdal/connection';
import { locationOf } from '@/lib/tongdal/evidence';
import { dedupeByDocument, splitByMatch } from '@/lib/tongdal/match';
import type { TongdalSearchHit } from '@/lib/tongdal/types';

const LIMIT = 3;
const cache = new Map<string, Promise<TongdalSearchHit[]>>();

function related(title: string): Promise<TongdalSearchHit[]> {
  const query = title.replace(/\s+/g, ' ').trim().slice(0, 200);
  let found = cache.get(query);
  if (!found) {
    found = (async () => {
      const connection = await loadConnection();
      if (!isPaired(connection) || !query) return [];
      const result = await search(connection, { query, topK: LIMIT + 3, maxChars: 1500 });
      // 같은 문서의 여러 절은 하나로, 공문 제목의 낱말이 하나도 들지 않은 결과(의미만 가까운 것)는 뺀다.
      // 벡터 검색은 관계없는 문서도 "가장 가까운 것"으로 돌려주므로, 그대로 보이면 "관련"이 거짓말이 된다.
      return splitByMatch(dedupeByDocument(result.results), query).matched.slice(0, LIMIT);
    })().catch(() => {
      cache.delete(query); // 실패는 기억하지 않는다. TONGDAL을 켠 뒤에는 다시 찾아야 한다.
      return [];
    });
    cache.set(query, found);
  }
  return found;
}

export function RelatedKnowledge({ title }: { title: string }) {
  const t = useT();
  const [hits, setHits] = useState<TongdalSearchHit[]>([]);

  useEffect(() => {
    let alive = true;
    void related(title).then(result => { if (alive) setHits(result); });
    return () => { alive = false; };
  }, [title]);

  if (!hits.length) return null;

  const open = (documentId: string) => {
    void loadConnection().then(connection => openInTongdal(connection, documentId)).catch(() => undefined);
  };

  return (
    <section className="kn-sources kn-related" aria-label={t('kn.related.h')}>
      <div className="kn-sources-head">{t('kn.related.h')}</div>
      <ul className="kn-sources-list">
        {hits.map((hit, index) => (
          <li key={`${hit.relativePath}#${index}`}>
            <span className="kn-sources-body">
              <span className="kn-sources-title">{hit.title}</span>
              <span className="kn-sources-meta">{locationOf(hit)}</span>
            </span>
            {hit.sourceDocumentId && (
              <button type="button" className="kn-link" onClick={() => open(hit.sourceDocumentId!)}>{t('kn.openInTongdal')}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
