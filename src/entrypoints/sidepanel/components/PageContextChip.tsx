/**
 * 페이지 컨텍스트 칩. 계획서 §5 Phase 3-3 / 3-5
 *
 * 붙어 있는 페이지를 보여주고, 절단 여부를 **항상** 알린다.
 * 계획서 §6 완료 기준: "절단 발생 시 사용자에게 항상 고지" —
 * 조용한 절단은 모델이 못 본 내용을 사용자는 봤다고 믿게 만든다.
 */

import { useT, type MessageKey } from '@/lib/i18n';
import type { ExtractedPage } from '@/lib/messaging/protocol';

interface Props {
  page: ExtractedPage;
  onDetach: () => void;
}

const METHOD_KEY = {
  readability: 'page.method.readability',
  innerText: 'page.method.innerText',
  'youtube-caption': 'page.method.youtube',
} as const satisfies Record<ExtractedPage['method'], MessageKey>;

export function PageContextChip({ page, onDetach }: Props) {
  const t = useT();
  const pct = Math.round(page.keptRatio * 100);

  return (
    <div className={`pagechip ${page.truncated ? 'truncated' : ''}`}>
      <div className="pagechip-main">
        <div className="pagechip-title" title={page.url}>
          {page.title || hostOf(page.url)}
        </div>
        <div className="pagechip-meta">
          {t(METHOD_KEY[page.method])} ·{' '}
          {t('page.tokens', { n: page.estimatedTokens.toLocaleString() })}
          {page.truncated && (
            // 자리를 아끼려고 줄이지 않는다. 이 고지는 필수다.
            <span className="pagechip-warn"> · {t('page.truncated', { pct })}</span>
          )}
        </div>
      </div>
      <button
        className="pagechip-x"
        onClick={onDetach}
        title={t('page.detach')}
        aria-label={t('page.detach')}
      >
        ×
      </button>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
