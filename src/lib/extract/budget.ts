/**
 * 토큰 예산 관리. 계획서 §5 Phase 3-2
 *
 * ★ 이 파일이 v2 계획에서 가장 크게 바뀐 지점이다.
 *
 * v2는 "컨텍스트 128K이므로 16K로 자른다"였다. 그러나 실측 프리필이
 * 131–161 tok/s라서 16K는 첫 토큰까지 약 2분을 의미한다. 사용 불가능하다.
 *
 * 실측 역산:
 *    700 tok →  5초
 *  1,400 tok → 10초
 *  2,800 tok → 20초  ← 채택 상한
 *  8,000 tok → 60초  ← 거부
 *
 * 그래서 본문 예산을 2,000토큰(≈4,000 한글자)으로 잡고, 초과분은 자른다.
 * map-reduce 요약은 5청크 × 20초 = 100초라 MVP에서 제외했다.
 * 단, GPU 이전 시 되살릴 수 있도록 예산은 설정값으로 노출한다.
 */

/** 실측: 한국어 5,960자 → 3,182 tok ≈ 1.87자/토큰. 안전하게 2.0으로 잡는다. */
export const CHARS_PER_TOKEN_KO = 2.0;
export const CHARS_PER_TOKEN_EN = 4.0;

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/g;

/**
 * 한글 비중으로 자·토큰 비율을 보간한다.
 * 정확한 Gemma 토크나이저를 번들하는 비용(수 MB)에 비해 이 근사로 충분하다 —
 * 예산은 어차피 안전 마진을 둔 값이기 때문이다.
 */
export function estimateCharsPerToken(text: string): number {
  if (!text) return CHARS_PER_TOKEN_EN;
  const hangul = text.match(HANGUL)?.length ?? 0;
  const ratio = hangul / text.length;
  return CHARS_PER_TOKEN_KO * ratio + CHARS_PER_TOKEN_EN * (1 - ratio);
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / estimateCharsPerToken(text));
}

export interface BudgetResult {
  text: string;
  truncated: boolean;
  /** 0~1. 원본 대비 남긴 비율. UI가 "앞부분 62%만 참조" 로 표시한다. */
  keptRatio: number;
  estimatedTokens: number;
}

/**
 * 본문을 예산 안으로 줄인다.
 *
 * 문장 중간에서 자르면 요약 품질이 눈에 띄게 나빠지므로 문단·문장 경계를
 * 찾아 자른다. 다만 경계가 너무 앞에 있으면(60% 미만) 버리는 양이 커지므로
 * 그때는 그냥 문자 단위로 자른다.
 */
export function fitToBudget(text: string, budgetTokens: number): BudgetResult {
  const clean = text.trim();
  if (!clean) {
    return { text: '', truncated: false, keptRatio: 1, estimatedTokens: 0 };
  }

  const ratio = estimateCharsPerToken(clean);
  const maxChars = Math.floor(budgetTokens * ratio);

  if (clean.length <= maxChars) {
    return {
      text: clean,
      truncated: false,
      keptRatio: 1,
      estimatedTokens: estimateTokens(clean),
    };
  }

  const cut = clean.slice(0, maxChars);
  const boundary = Math.max(
    cut.lastIndexOf('\n\n'),
    cut.lastIndexOf('다. '),
    cut.lastIndexOf('. '),
    cut.lastIndexOf('요. '),
  );
  const finalText = boundary > maxChars * 0.6 ? cut.slice(0, boundary + 1) : cut;

  return {
    text: finalText.trim(),
    truncated: true,
    keptRatio: finalText.length / clean.length,
    estimatedTokens: estimateTokens(finalText),
  };
}

/**
 * 절단 사실을 사용자에게 알리는 문구.
 *
 * ★ 계획서 §6 완료 기준: "절단 발생 시 사용자에게 항상 고지".
 *   조용한 절단은 신뢰를 깬다 — 모델이 못 본 내용을 사용자는 봤다고 믿게 된다.
 */
export function truncationNotice(r: BudgetResult): string | null {
  if (!r.truncated) return null;
  return `본문이 길어 앞부분 ${Math.round(r.keptRatio * 100)}%만 참조했습니다.`;
}
