/**
 * 홈 게임 카드의 표지 그림 — 게임 화면 속 물건(범퍼·공·칸·깃발)을 같은 그림체로 모아 그린다.
 * 그림체는 ArcadeIcon과 같다: 윤곽선·번짐 없이 면 색과 그 아래 진한 띠 두 톤.
 * 글자 대신 그림이라 aria-hidden이다(게임 이름은 카드 글자로 따로 읽힌다).
 */

const svgProps = {
  viewBox: '0 0 320 132',
  preserveAspectRatio: 'xMidYMid slice',
  width: '100%',
  height: '100%',
  'aria-hidden': true,
} as const;

/** 범퍼 하나: 판 그림자 → 고무 링(두 톤) → 뚜껑(두 톤) → 가운데 고리 */
function Bumper({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <ellipse cx={x} cy={y + 7} rx={r + 4} ry={r} fill="#000000" opacity="0.25" />
      <circle cx={x} cy={y + 5} r={r + 3} fill="#c2185b" />
      <circle cx={x} cy={y} r={r + 3} fill="#ffb3c8" />
      <circle cx={x} cy={y + 2} r={r - 2} fill="#c9305e" />
      <circle cx={x} cy={y - 1} r={r - 2} fill="#ff5c86" />
      <circle cx={x} cy={y - 2} r={r * 0.42} fill="none" stroke="#ffd6e0" strokeWidth="3" />
    </g>
  );
}

export function PinballArt() {
  return (
    <svg {...svgProps}>
      <rect width="320" height="132" fill="#2b2163" />
      <circle cx="160" cy="88" r="96" fill="#33287a" />
      <circle cx="160" cy="88" r="64" fill="#3a2e88" />
      {/* 레일: 아래 진한 띠 + 위 면 */}
      <path d="M24 146 V58 Q24 20 64 20 H256 Q296 20 296 58 V146" fill="none" stroke="#6b56d6" strokeWidth="7" transform="translate(0 4)" />
      <path d="M24 146 V58 Q24 20 64 20 H256 Q296 20 296 58 V146" fill="none" stroke="#a594ff" strokeWidth="7" />
      <Bumper x={128} y={56} r={16} />
      <Bumper x={194} y={56} r={16} />
      <Bumper x={161} y={92} r={16} />
      {/* 동전 */}
      <circle cx="244" cy="96" r="10" fill="#d98a00" />
      <circle cx="244" cy="93" r="10" fill="#ffc53d" />
      <circle cx="244" cy="93" r="5.6" fill="none" stroke="#d98a00" strokeWidth="2" />
      {/* 날아가는 공과 속도선 */}
      <g stroke="#a594ff" strokeWidth="4" strokeLinecap="round" opacity="0.7">
        <path d="M52 50 L70 66" />
        <path d="M46 66 L60 78" />
      </g>
      <ellipse cx="90" cy="92" rx="10" ry="7" fill="#000000" opacity="0.25" />
      <circle cx="88" cy="84" r="11" fill="#9aa3b8" />
      <circle cx="86.4" cy="82" r="11" fill="#e4e7ef" />
      <ellipse cx="83.5" cy="79" rx="3.4" ry="2.4" fill="#ffffff" transform="rotate(-35 83.5 79)" />
      {/* 왼쪽 아래 플리퍼 */}
      <path d="M40 120 L104 132 L100 140 L36 132 Z" fill="#000000" opacity="0.2" />
      <path d="M38 112 a9 9 0 0 1 8 -11 L106 121 a5 5 0 0 1 -2 9.6 L44 125 a9 9 0 0 1 -6 -13 Z" fill="#b9a8ff" transform="translate(0 4)" />
      <path d="M38 112 a9 9 0 0 1 8 -11 L106 121 a5 5 0 0 1 -2 9.6 L44 125 a9 9 0 0 1 -6 -13 Z" fill="#f4f1ff" />
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
      <rect width="320" height="132" fill="#e3f4ef" />
      <circle cx="20" cy="118" r="60" fill="#d3eee6" />
      <circle cx="306" cy="10" r="48" fill="#ece6ff" />
      {MS_ROWS.map((row, r) =>
        [...row].map((ch, c) => {
          const x = left + c * (size + gap);
          const y = top + r * (size + gap);
          const closed = ch === 'c' || ch === 'f';
          const cx = x + size / 2;
          const cy = y + size / 2;
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
                <text x={cx} y={cy + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill={numberColor[ch]} fontFamily="-apple-system, system-ui, sans-serif">
                  {ch}
                </text>
              )}
              {ch === 'f' && (
                <>
                  <rect x={x + 7.5} y={y + 4.5} width="2.6" height="15" rx="1.3" fill="#4b4570" />
                  <path d={`M${x + 10} ${y + 5.5} C${x + 13} ${y + 4.5} ${x + 15} ${y + 7} ${x + 19.5} ${y + 6} L${x + 17.5} ${y + 9.8} L${x + 19.5} ${y + 13.6} C${x + 15} ${y + 14.6} ${x + 13} ${y + 12} ${x + 10} ${y + 13} Z`} fill="#dc3a44" />
                  <path d={`M${x + 10} ${y + 4.5} C${x + 13} ${y + 3.5} ${x + 15} ${y + 6} ${x + 19.5} ${y + 5} L${x + 17.5} ${y + 8.8} L${x + 19.5} ${y + 12.6} C${x + 15} ${y + 13.6} ${x + 13} ${y + 11} ${x + 10} ${y + 12} Z`} fill="#ff5d61" />
                </>
              )}
              {ch === 'b' && (
                <>
                  <path d={`M${cx + 3} ${cy - 5} q2 -4 5 -3`} fill="none" stroke="#a46a3a" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx={cx} cy={cy + 2} r="7.5" fill="#2a2450" />
                  <circle cx={cx} cy={cy} r="7.5" fill="#3d3768" />
                  <circle cx={cx - 2.6} cy={cy - 2.6} r="1.8" fill="#5a5390" />
                  <circle cx={cx + 8.5} cy={cy - 8.5} r="2.2" fill="#ffc53d" />
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
