/**
 * 게임 화면 전용 아이콘 — icons.tsx와 같은 규격(24 뷰박스, currentColor).
 */

type IconProps = {
  size?: string | number;
};

export function Pause({ size = '1em' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.5" />
      <rect x="14" y="5" width="4" height="14" rx="1.5" />
    </svg>
  );
}

/** 게임 코인 — 판 위 동전과 같은 금색. 글자와 같은 높이로 나란히 놓인다 */
export function Coin({ size = '1em' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-0.15em' }}
    >
      <circle cx="12" cy="12" r="10" fill="#f5b70a" />
      <circle cx="12" cy="12" r="7" fill="#ffd54d" stroke="#e0a000" strokeWidth="1.5" />
      <path d="M9.5 9.5 L12 7.5 L14.5 9.5 L14.5 14.5 L12 16.5 L9.5 14.5 Z" fill="#f5b70a" />
    </svg>
  );
}
