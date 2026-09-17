/**
 * 페이지 빠른 작업. 계획서 §5 Phase 3-4 / 4-5
 *
 * ★ 페이지를 자동으로 붙이지 않는다.
 *   프리필 131 tok/s에서 2,000토큰 본문은 약 15초다. 모든 메시지에 그 비용을
 *   물리면 짧은 질문조차 15초가 걸린다. 사용자가 필요할 때만 붙인다.
 *
 *   한 번 붙인 뒤의 후속 질문은 접두사 캐시 덕에 거의 공짜다(실측 183ms).
 *   그래서 "붙이기"는 비싸고 "이어 묻기"는 싸다 — UI도 그 구조를 따른다.
 */

import { useT } from '@/lib/i18n';
import { PAGE_PRESETS } from '@/lib/prompts/presets';

interface Props {
  disabled: boolean;
  extracting: boolean;
  /** 페이지·화면이 이미 붙어 있는가 — 그러면 비용 안내를 바꾼다 */
  attached: boolean;
  estimatedSec: number;
  /**
   * 표시 순서(프리셋 id). 페이지 유형별 제안 — Phase 4-5.
   * 목록에서 빼지는 않고 순서만 바꾼다. 추론이 틀렸을 때 사용자가 원하는
   * 버튼을 못 찾는 상황을 만들지 않기 위해서다.
   */
  order?: string[];
  /** 유형별 한 줄 안내 */
  kindHint?: string | null;
  onRun: (presetId: string) => void;
}

export function PageActions({
  disabled,
  extracting,
  attached,
  estimatedSec,
  order,
  kindHint,
  onRun,
}: Props) {
  const t = useT();
  const presets = order
    ? [...PAGE_PRESETS].sort((a, b) => rank(order, a.id) - rank(order, b.id))
    : PAGE_PRESETS;

  return (
    <div className="pageactions">
      <div className="pageactions-row">
        {presets.map((p) => (
          <button
            key={p.id}
            className="chipbtn"
            disabled={disabled || extracting}
            onClick={() => onRun(p.id)}
            title={p.hint}
          >
            {p.label}
          </button>
        ))}
      </div>

      {extracting ? (
        <div className="pageactions-hint">{t('page.reading')}</div>
      ) : (
        <>
          <div className="pageactions-hint">
            {attached
              ? t('page.attached')
              : t('page.costHint', { sec: Math.max(1, Math.round(estimatedSec)) })}
          </div>
          {kindHint && <div className="pageactions-hint kind">{kindHint}</div>}
        </>
      )}
    </div>
  );
}

function rank(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i < 0 ? order.length : i;
}
