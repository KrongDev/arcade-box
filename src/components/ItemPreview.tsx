import type { CSSProperties } from 'react';
import type { ShopItem, TileLook } from '../game/catalog';

/** 상점 아이템 미리보기 — 실제 게임 색으로 그린 작은 그림. 이펙트가 있으면 함께 보여 준다 */
export function ItemPreview({ item }: { item: ShopItem }) {
  const gid = `g-${item.id.replace(/\./g, '-')}`;

  if (item.slot === 'table') {
    const l = item.look;
    const fx = item.effect?.table;
    return (
      <svg viewBox="0 0 80 100" className="item-preview" aria-hidden="true">
        <rect width="80" height="100" fill={l.page} />
        <rect x="8" y="8" width="64" height="84" rx="10" fill={l.table} stroke={l.wall} strokeWidth={fx === 'neon' ? 3 : 2} />
        {fx === 'neon' && <rect x="8" y="8" width="64" height="84" rx="10" fill="none" stroke={l.wall} strokeWidth="6" opacity="0.25" />}
        {fx === 'stars' && (
          <g fill="#ffffff">
            {[
              [16, 20, 1],
              [62, 16, 1.2],
              [20, 64, 0.8],
              [66, 52, 1],
              [44, 70, 0.8],
              [34, 14, 0.9],
            ].map(([x, y, r]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={r} opacity="0.85" />
            ))}
            <line x1="50" y1="22" x2="62" y2="16" stroke="#ffffff" strokeWidth="1" opacity="0.7" />
          </g>
        )}
        <circle cx="28" cy="32" r="7" fill={l.bumper} />
        <circle cx="52" cy="32" r="7" fill={l.bumper} />
        <circle cx="40" cy="50" r="7" fill={l.bumper} />
        <circle cx="28" cy="32" r="3.5" fill="none" stroke={l.bumperRing} strokeWidth="1.5" />
        <circle cx="52" cy="32" r="3.5" fill="none" stroke={l.bumperRing} strokeWidth="1.5" />
        <circle cx="40" cy="50" r="3.5" fill="none" stroke={l.bumperRing} strokeWidth="1.5" />
        <circle cx="58" cy="62" r="3.5" fill={l.coin} />
        <circle cx="22" cy="60" r="3.5" fill={l.coin} opacity={item.ability?.coinSpawn ? 1 : 0} />
        <line x1="22" y1="80" x2="34" y2="85" stroke={l.flipper} strokeWidth="4" strokeLinecap="round" />
        <line x1="58" y1="80" x2="46" y2="85" stroke={l.flipper} strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (item.slot === 'ball') {
    const l = item.look;
    const trail = item.effect?.trail;
    return (
      <svg viewBox="0 0 80 100" className="item-preview" aria-hidden="true">
        <defs>
          <radialGradient id={gid} cx="40%" cy="38%" r="65%">
            <stop offset="0%" stopColor={l.ballLight} />
            <stop offset="100%" stopColor={l.ballDark} />
          </radialGradient>
        </defs>
        <rect width="80" height="100" fill="#1b1d38" />
        {!trail && (
          <g fill="#ffffff">
            <circle cx="22" cy="22" r="4" opacity="0.08" />
            <circle cx="28" cy="32" r="6" opacity="0.14" />
          </g>
        )}
        {trail === 'sparkle' && (
          <g fill="#ffe3ea">
            {[
              [18, 18, 1.6],
              [26, 26, 2.2],
              [16, 34, 1.4],
              [30, 38, 1.8],
              [22, 44, 1.2],
            ].map(([x, y, r]) => (
              <path key={`${x}-${y}`} d={`M${x} ${y - r * 2} L${x + r * 0.6} ${y - r * 0.6} L${x + r * 2} ${y} L${x + r * 0.6} ${y + r * 0.6} L${x} ${y + r * 2} L${x - r * 0.6} ${y + r * 0.6} L${x - r * 2} ${y} L${x - r * 0.6} ${y - r * 0.6} Z`} />
            ))}
          </g>
        )}
        {trail === 'fire' && (
          <g>
            <path d="M14 14 Q26 26 32 40 Q24 34 18 30 Q22 26 14 14 Z" fill="#ff922b" opacity="0.8" />
            <path d="M22 18 Q32 30 36 42 Q28 36 24 32 Q28 28 22 18 Z" fill="#ffd43b" opacity="0.85" />
            <circle cx="20" cy="22" r="2" fill="#f03e3e" opacity="0.8" />
          </g>
        )}
        {trail === 'lightning' && (
          <polyline points="12,12 22,20 17,24 28,32 23,36 34,44" fill="none" stroke="#74c0fc" strokeWidth="3" strokeLinejoin="round" opacity="0.95" />
        )}
        <circle cx="42" cy="54" r="18" fill={`url(#${gid})`} />
        <circle cx="36" cy="48" r="4" fill="#ffffff" opacity="0.7" />
        {item.effect?.hit === 'boom' && <circle cx="42" cy="54" r="26" fill="none" stroke="#74c0fc" strokeWidth="2" opacity="0.6" />}
      </svg>
    );
  }

  if (item.slot === 'tile') {
    const l = item.look;
    const tiles = [0, 1, 0, 1, 1, 0, 0, 1, 0];
    return (
      <svg viewBox="0 0 80 100" className="item-preview" aria-hidden="true">
        <defs>
          <TilePatternDefs id={gid} look={l} />
        </defs>
        <rect width="80" height="100" fill="#eef1f6" />
        {tiles.map((open, i) => {
          const x = 9 + (i % 3) * 21;
          const y = 19 + Math.floor(i / 3) * 21;
          return (
            <g key={i}>
              <rect x={x} y={y} width="20" height="20" rx="4" fill={open ? l.open : l.closed} stroke={open ? l.openEdge : l.closedEdge} strokeWidth="1" />
              {!open && l.pattern !== 'none' && <rect x={x} y={y} width="20" height="20" rx="4" fill={`url(#${gid})`} />}
            </g>
          );
        })}
        <text x="40" y="33.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#3b5bdb" fontFamily="-apple-system, system-ui, sans-serif">
          1
        </text>
        <text x="19" y="54.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#2b8a3e" fontFamily="-apple-system, system-ui, sans-serif">
          2
        </text>
        {item.ability?.shield ? (
          <path d="M61 85 l7 3 q-1 7 -7 10 q-6 -3 -7 -10 Z" fill="#6c4cf1" stroke="#ffffff" strokeWidth="1.2" />
        ) : null}
      </svg>
    );
  }

  const l = item.look;
  const coins = item.ability?.extraCoins ? 3 + Math.min(4, item.ability.extraCoins[0]) : 2;
  return (
    <span className="item-preview item-preview-map" style={{ background: l.bg } as CSSProperties} aria-hidden="true">
      {l.motif && <span className="item-preview-motif tf">{l.motif}</span>}
      <span className="item-preview-grid">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="item-preview-cell">
            {i < coins && i % 2 === 0 ? <span className={item.effect?.coinGlow ? 'item-preview-coin is-glow' : 'item-preview-coin'} /> : null}
          </span>
        ))}
      </span>
    </span>
  );
}

/** 닫힌 칸 무늬 — 상점 미리보기와 게임 판이 같은 모양을 쓴다(게임은 CSS로 같은 무늬를 그린다) */
function TilePatternDefs({ id, look }: { id: string; look: TileLook }) {
  const ink = 'rgba(255,255,255,0.55)';
  switch (look.pattern) {
    case 'dots':
      return (
        <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.1" fill={ink} />
        </pattern>
      );
    case 'check':
      return (
        <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill={ink} />
          <rect x="5" y="5" width="5" height="5" fill={ink} />
        </pattern>
      );
    case 'stars':
      return (
        <pattern id={id} width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="3" r="0.9" fill="#ffe066" />
          <circle cx="7.5" cy="7.5" r="0.6" fill="#ffffff" />
        </pattern>
      );
    case 'diamond':
      return (
        <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M4 0.5 L7.5 4 L4 7.5 L0.5 4 Z" fill="rgba(255,255,255,0.45)" />
        </pattern>
      );
    case 'leaf':
      return (
        <pattern id={id} width="9" height="9" patternUnits="userSpaceOnUse">
          <ellipse cx="4.5" cy="4.5" rx="2.6" ry="1.2" transform="rotate(-35 4.5 4.5)" fill={ink} />
        </pattern>
      );
    default:
      return null;
  }
}
