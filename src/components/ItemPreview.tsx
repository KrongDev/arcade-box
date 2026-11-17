import type { ShopItem } from '../game/catalog';

/** 상점 아이템 미리보기 — 실제 게임 색으로 그린 작은 그림 */
export function ItemPreview({ item }: { item: ShopItem }) {
  const gid = `g-${item.id.replace(/\./g, '-')}`;

  if (item.slot === 'table') {
    const l = item.look;
    return (
      <svg viewBox="0 0 80 100" className="item-preview" aria-hidden="true">
        <rect width="80" height="100" fill={l.page} />
        <rect x="8" y="8" width="64" height="84" rx="10" fill={l.table} stroke={l.wall} strokeWidth="2" />
        <circle cx="28" cy="32" r="7" fill={l.bumper} />
        <circle cx="52" cy="32" r="7" fill={l.bumper} />
        <circle cx="40" cy="50" r="7" fill={l.bumper} />
        <circle cx="28" cy="32" r="3.5" fill="none" stroke={l.bumperRing} strokeWidth="1.5" />
        <circle cx="52" cy="32" r="3.5" fill="none" stroke={l.bumperRing} strokeWidth="1.5" />
        <circle cx="40" cy="50" r="3.5" fill="none" stroke={l.bumperRing} strokeWidth="1.5" />
        <circle cx="58" cy="60" r="3.5" fill={l.coin} />
        <line x1="22" y1="80" x2="34" y2="85" stroke={l.flipper} strokeWidth="4" strokeLinecap="round" />
        <line x1="58" y1="80" x2="46" y2="85" stroke={l.flipper} strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (item.slot === 'ball') {
    const l = item.look;
    return (
      <svg viewBox="0 0 80 100" className="item-preview" aria-hidden="true">
        <defs>
          <radialGradient id={gid} cx="40%" cy="38%" r="65%">
            <stop offset="0%" stopColor={l.ballLight} />
            <stop offset="100%" stopColor={l.ballDark} />
          </radialGradient>
        </defs>
        <rect width="80" height="100" fill="#1b1d38" />
        <circle cx="40" cy="50" r="20" fill={`url(#${gid})`} />
      </svg>
    );
  }

  const l = item.look;
  const tiles = [0, 1, 0, 1, 1, 0, 0, 1, 1];
  return (
    <svg viewBox="0 0 80 100" className="item-preview" aria-hidden="true">
      <rect width="80" height="100" fill={l.bg} />
      {tiles.map((open, i) => {
        const x = 10 + (i % 3) * 21;
        const y = 20 + Math.floor(i / 3) * 21;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width="19"
            height="19"
            rx="4"
            fill={open ? l.open : l.closed}
            stroke={open ? l.openEdge : l.closedEdge}
            strokeWidth="1"
          />
        );
      })}
      <circle cx="40.5" cy="50.5" r="3" fill="#3b5bdb" />
      <circle cx="61.5" cy="71.5" r="3" fill="#2b8a3e" />
    </svg>
  );
}
