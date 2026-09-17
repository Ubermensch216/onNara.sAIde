/**
 * 브랜드 마크. 계획서 §8
 *
 * 아이콘은 크기별로 두 벌을 운용한다 — 32px 이하는 페이지 선 2줄 + 원형 점,
 * 48px 이상은 3줄 + 4각 스파크. 스파크가 작은 크기에서 뭉개지기 때문이다.
 * 여기서는 size로 자동 전환한다.
 */

export function SaideIcon({ size = 20 }: { size?: number }) {
  const small = size <= 32;
  const gid = small ? 'saideGradS' : 'saideGrad';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="온나라 sAIde"
      style={{ display: 'block', flex: 'none' }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2E6FC2" />
          <stop offset="1" stopColor="#0B2545" />
        </linearGradient>
      </defs>

      {small ? (
        <>
          <rect width="64" height="64" rx="14" fill={`url(#${gid})`} />
          <g fill="#FFFFFF" opacity="0.5">
            <rect x="8" y="21" width="24" height="6" rx="3" />
            <rect x="8" y="37" width="17" height="6" rx="3" />
          </g>
          <rect x="39" y="9" width="17" height="46" rx="8.5" fill="#FFFFFF" />
          <circle cx="47.5" cy="32" r="5" fill="#1A4FA0" />
        </>
      ) : (
        <>
          <rect width="64" height="64" rx="15" fill={`url(#${gid})`} />
          <g fill="#FFFFFF" opacity="0.45">
            <rect x="9" y="20" width="22" height="4.5" rx="2.25" />
            <rect x="9" y="29.75" width="15" height="4.5" rx="2.25" />
            <rect x="9" y="39.5" width="19" height="4.5" rx="2.25" />
          </g>
          <rect x="39" y="11" width="16" height="42" rx="8" fill="#FFFFFF" />
          <path
            d="M47 25.5 L48.7 30.3 L53.5 32 L48.7 33.7 L47 38.5 L45.3 33.7 L40.5 32 L45.3 30.3 Z"
            fill="#1A4FA0"
          />
        </>
      )}
    </svg>
  );
}

/** 워드마크 — AI 두 글자만 강조한다. 그 외 어떤 장식도 넣지 않는다. */
export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="product-prefix">온나라</span> s<b>AI</b>de
    </span>
  );
}
