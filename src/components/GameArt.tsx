/**
 * 홈 게임 카드의 표지 그림 — 게임 화면과 같은 색으로 그린 장식용 SVG.
 * 글자 대신 그림이라 aria-hidden이다(게임 이름은 카드 글자로 따로 읽힌다).
 */

const svgProps = {
  viewBox: '0 0 320 132',
  preserveAspectRatio: 'xMidYMid slice',
  width: '100%',
  height: '100%',
  'aria-hidden': true,
} as const;

export function PinballArt() {
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id="pa-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1b1d38" />
          <stop offset="1" stopColor="#2c2166" />
        </linearGradient>
        <filter id="pa-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="pa-ball" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#9aa3b8" />
        </radialGradient>
      </defs>
      <rect width="320" height="132" fill="url(#pa-bg)" />
      <g stroke="#a594ff" strokeOpacity="0.08">
        {Array.from({ length: 16 }, (_, i) => (
          <line key={i} x1={i * 24 - 60} y1="0" x2={i * 24 + 72} y2="132" />
        ))}
      </g>
      <path d="M24 140 V54 Q24 16 64 16 H256 Q296 16 296 54 V140" fill="none" stroke="#a594ff" strokeWidth="4" filter="url(#pa-glow)" />
      <g filter="url(#pa-glow)">
        <circle cx="128" cy="58" r="17" fill="#ff5c86" />
        <circle cx="192" cy="58" r="17" fill="#ff5c86" />
        <circle cx="160" cy="94" r="17" fill="#ff5c86" />
        <circle cx="238" cy="92" r="9" fill="#ffc53d" />
      </g>
      <g fill="none" stroke="#ffc2d2" strokeWidth="3">
        <circle cx="128" cy="58" r="9" />
        <circle cx="192" cy="58" r="9" />
        <circle cx="160" cy="94" r="9" />
      </g>
      <circle cx="238" cy="92" r="5" fill="none" stroke="#fff0b3" strokeWidth="2" />
      <g fill="#ffffff">
        <circle cx="62" cy="40" r="3" opacity="0.15" />
        <circle cx="70" cy="52" r="4" opacity="0.22" />
        <circle cx="78" cy="64" r="5" opacity="0.3" />
      </g>
      <circle cx="88" cy="78" r="9" fill="url(#pa-ball)" />
      <g fill="#fff0b3">
        <path d="M268 40 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z" />
        <path d="M48 104 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" opacity="0.8" />
      </g>
    </svg>
  );
}

const MS_ROWS = [
  'cc1oo1ccc1',
  'c2oooo1cc2',
  'f1o12ofc1o',
  'c2oob1cc2o',
];

export function MinesweeperArt() {
  const size = 25;
  const gap = 4;
  const cols = MS_ROWS[0].length;
  const left = (320 - (size * cols + gap * (cols - 1))) / 2;
  const top = (132 - (size * 4 + gap * 3)) / 2;
  const numberColor: Record<string, string> = { '1': '#3b5bdb', '2': '#2b8a3e', '3': '#e03131' };
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id="ma-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#dcf7f3" />
          <stop offset="1" stopColor="#ece6ff" />
        </linearGradient>
      </defs>
      <rect width="320" height="132" fill="url(#ma-bg)" />
      {MS_ROWS.map((row, r) =>
        [...row].map((ch, c) => {
          const x = left + c * (size + gap);
          const y = top + r * (size + gap);
          const closed = ch === 'c' || ch === 'f';
          return (
            <g key={`${r}-${c}`}>
              {closed ? (
                <>
                  <rect x={x} y={y} width={size} height={size} rx="7" fill="#b4bfd3" />
                  <rect x={x} y={y} width={size} height={size - 3} rx="7" fill="#c7d1e2" />
                </>
              ) : (
                <rect x={x} y={y} width={size} height={size} rx="7" fill="#ffffff" stroke="#e3e8f0" />
              )}
              {numberColor[ch] && (
                <text x={x + size / 2} y={y + size / 2 + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill={numberColor[ch]} fontFamily="-apple-system, system-ui, sans-serif">
                  {ch}
                </text>
              )}
              {ch === 'f' && (
                <>
                  <line x1={x + 9} y1={y + 6} x2={x + 9} y2={y + 19} stroke="#4e5968" strokeWidth="2.2" strokeLinecap="round" />
                  <path d={`M${x + 10} ${y + 6} L${x + 19} ${y + 10} L${x + 10} ${y + 14} Z`} fill="#f03e3e" />
                </>
              )}
              {ch === 'b' && (
                <>
                  <circle cx={x + size / 2} cy={y + size / 2 + 1} r="7" fill="#1f1a3d" />
                  <circle cx={x + size / 2 - 2.5} cy={y + size / 2 - 1.5} r="1.8" fill="#ffffff" opacity="0.7" />
                  <path d={`M${x + 17} ${y + 6} l2 -3`} stroke="#ff922b" strokeWidth="2.2" strokeLinecap="round" />
                </>
              )}
            </g>
          );
        }),
      )}
    </svg>
  );
}

export function GameArt({ id }: { id: string }) {
  if (id === 'pinball') return <PinballArt />;
  if (id === 'minesweeper') return <MinesweeperArt />;
  return null;
}
