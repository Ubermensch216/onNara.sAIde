interface Props {
  direction: 'up' | 'down';
}

/** 피드백 버튼에서 공통으로 쓰는 손가락 아이콘. 버튼의 이름은 aria-label이 제공한다. */
export function ThumbIcon({ direction }: Props) {
  return (
    <svg className={`feedback-thumb ${direction}`} viewBox="0 0 24 24" width="16" height="16"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 3a3.13 3.13 0 0 1 3 2.88Z" />
    </svg>
  );
}
