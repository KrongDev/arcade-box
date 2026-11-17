/**
 * 아케이드박스 그림 아이콘 — 보상·게임·아이템처럼 "물건"을 보여 줄 때 쓴다.
 * 버튼 안의 조작 아이콘(설정·일시정지·닫기)은 gameIcons.tsx의 한 가지 색 선 아이콘을 쓴다.
 *
 * 그림체: 윤곽선·번짐·광택 없이 두 가지 톤만 쓴다. 면의 아래쪽에 같은 색의 진한 띠를 둬서
 * 두께를 보여 준다(<Solid>). 48×48 칸에 그리고 크기만 바꿔 쓴다.
 * 장식이라 기본은 aria-hidden이다. 뜻을 전해야 하면 label을 넘긴다.
 */
import { useId, type ReactNode } from 'react';

export type ArcadeIconName =
  | 'gift'
  | 'bag'
  | 'trophy'
  | 'coin'
  | 'pinball'
  | 'bomb'
  | 'flag'
  | 'shield'
  | 'shovel'
  | 'tv'
  | 'receipt'
  | 'signal'
  | 'party'
  | 'unlock'
  | 'boom'
  | 'sparkle'
  | 'medal1'
  | 'medal2'
  | 'medal3'
  | 'pine'
  | 'palm'
  | 'temple';

/** 면 색과 그 아래 띠 색 */
const P = {
  purple: ['#7a5af8', '#5b3fd6'],
  pink: ['#ff6b9a', '#e0457a'],
  gold: ['#ffc53d', '#eaa012'],
  mint: ['#3ccfa4', '#1fa682'],
  red: ['#ff5d61', '#dc3a44'],
  navy: ['#3d3768', '#2a2450'],
  silver: ['#e4e7ef', '#bcc3d3'],
  bronze: ['#eda673', '#c97f48'],
  blue: ['#5aaaff', '#3486e0'],
  wood: ['#c98b57', '#a46a3a'],
  paper: ['#ffffff', '#dfe2ec'],
  green: ['#4cc38a', '#2f9e6a'],
  sand: ['#ffd98a', '#f0bd5c'],
} as const;

type Tone = keyof typeof P;

/**
 * 두 톤 면. d(경로) 모양 안쪽에 진한 색을 깔고, 같은 모양을 위로 올려 밝은 색으로 덮는다.
 * 남는 아래 띠가 두께가 된다. 윤곽선은 없다.
 */
function Solid({ d, tone, depth = 3, transform }: { d: string; tone: Tone; depth?: number; transform?: string }) {
  const id = useId();
  const [face, side] = P[tone];
  return (
    <g transform={transform}>
      <clipPath id={id}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={side} />
      <path d={d} fill={face} clipPath={`url(#${id})`} transform={`translate(0 ${-depth})`} />
    </g>
  );
}

/** 원 경로 */
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;

/** 둥근 사각형 경로 */
const rrect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;

/** 별 경로 */
function starPath(cx: number, cy: number, r: number, inner = 0.48, points = 5) {
  const n = points * 2;
  return (
    Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / points;
      const rr = i % 2 === 0 ? r : r * inner;
      return `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`;
    }).join(' ') + ' Z'
  );
}

/** 네 갈래 반짝이 경로 */
const twinkle = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r} Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy} Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r} Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy} Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r} Z`;

function Medal({ rank }: { rank: 1 | 2 | 3 }) {
  const tone: Tone = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
  const ink = rank === 1 ? '#9a6200' : rank === 2 ? '#6b7387' : '#8a4f22';
  return (
    <>
      <path d="M14 3 H22 L27 19 L20 21 Z" fill={P.blue[0]} />
      <path d="M34 3 H26 L21 19 L28 21 Z" fill={P.pink[0]} />
      <Solid d={circle(24, 31, 13)} tone={tone} depth={3.5} />
      <circle cx="24" cy="29.3" r="8.6" fill="none" stroke={P[tone][1]} strokeWidth="2" />
      <text x="24" y="33.6" textAnchor="middle" fontSize="12.5" fontWeight="700" fill={ink} fontFamily="-apple-system, system-ui, sans-serif">
        {rank}
      </text>
    </>
  );
}

const SHAPES: Record<ArcadeIconName, () => ReactNode> = {
  gift: () => (
    <>
      <Solid d={rrect(9, 21, 30, 21, 4)} tone="pink" depth={3.5} />
      <rect x="21" y="21" width="6" height="21" fill={P.gold[1]} />
      {/* 살짝 들린 뚜껑 */}
      <Solid d={rrect(6, 13, 36, 10, 3.5)} tone="pink" transform="rotate(-5 24 18)" />
      <rect x="21" y="12" width="6" height="11" fill={P.gold[0]} transform="rotate(-5 24 18)" />
      <path d="M23.4 12.4 C17 3 8.5 7 13 12.6 Z" fill={P.gold[0]} />
      <path d="M24.2 12.2 C30 2.2 39.6 5.6 34.6 11.2 Z" fill={P.gold[1]} />
    </>
  ),
  bag: () => (
    <>
      <path d="M17 19 V14.5 a7 7 0 0 1 14 0 V19" fill="none" stroke={P.purple[1]} strokeWidth="3.4" strokeLinecap="round" />
      <Solid d="M10.8 17 H37.2 a2 2 0 0 1 2 2.2 L37.4 39.4 a3.4 3.4 0 0 1 -3.4 3.1 H14 a3.4 3.4 0 0 1 -3.4 -3.1 L8.8 19.2 a2 2 0 0 1 2 -2.2 Z" tone="purple" depth={3.5} />
      <Solid d={circle(24, 29, 5.6)} tone="gold" depth={2} />
    </>
  ),
  trophy: () => (
    <>
      <path d="M13.5 11.5 H9 a5 5 0 0 0 5.4 9.5" fill="none" stroke={P.gold[1]} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M34.5 11.5 H39 a5 5 0 0 1 -5.4 9.5" fill="none" stroke={P.gold[1]} strokeWidth="3.4" strokeLinecap="round" />
      <Solid d="M12.5 7 H35.5 V17 a11.5 11.5 0 0 1 -23 0 Z" tone="gold" depth={3.5} />
      <rect x="21" y="27.5" width="6" height="7" fill={P.gold[1]} />
      <Solid d={rrect(13, 34, 22, 9, 3)} tone="purple" />
      <path d={starPath(24, 16, 4.6)} fill="#fff3c4" />
    </>
  ),
  coin: () => (
    <>
      <Solid d={circle(24, 24, 18)} tone="gold" depth={4} />
      <circle cx="24" cy="22" r="11.5" fill="none" stroke={P.gold[1]} strokeWidth="2.4" />
      <path d={starPath(24, 22.4, 6.4, 0.5)} fill={P.gold[1]} />
    </>
  ),
  pinball: () => (
    <>
      <Solid d={circle(31, 14, 8.5)} tone="pink" depth={2.5} />
      <circle cx="31" cy="12.6" r="3.4" fill="#ffc2d4" />
      {/* 위로 쳐 올린 플리퍼 */}
      <Solid d="M6.5 38.5 a4.6 4.6 0 0 1 3.3 -7.9 L31 34.6 a2.6 2.6 0 0 1 -0.4 5.2 L9.6 41.2 a4.6 4.6 0 0 1 -3.1 -2.7 Z" tone="purple" />
      <Solid d={circle(17, 22, 6.5)} tone="silver" depth={2.5} />
      <path d="M8 26 l-3 3 M10.5 30.5 l-4 1.5" stroke="#bcc3d3" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  bomb: () => (
    <>
      <path d="M30 14 C31.5 8.5 36 7.5 38.5 9" fill="none" stroke={P.wood[1]} strokeWidth="2.6" strokeLinecap="round" />
      <Solid d={rrect(25.2, 10.6, 8.6, 7, 2)} tone="silver" depth={2} transform="rotate(38 29.5 14)" />
      <Solid d={circle(21, 29, 14)} tone="navy" depth={4} />
      <circle cx="15.5" cy="23" r="3" fill="#5a5390" />
      <path d={starPath(40, 8, 5.4, 0.42, 4)} fill={P.gold[0]} />
      <circle cx="40" cy="8" r="1.8" fill="#ff8a3d" />
    </>
  ),
  flag: () => (
    <>
      <ellipse cx="17" cy="42.5" rx="8.5" ry="2.8" fill="#d6dae5" />
      <rect x="14.6" y="5" width="4" height="38" rx="2" fill="#4b4570" />
      <Solid d="M18.6 6.5 C25 4.6 30 9.8 39.5 7.6 L35 16.4 L39.5 25 C30 27.2 25 22 18.6 24 Z" tone="red" depth={2.5} />
    </>
  ),
  shield: () => (
    <>
      <Solid d="M24 4.5 L39.5 10 C39.5 27 33.5 37.5 24 43.5 C14.5 37.5 8.5 27 8.5 10 Z" tone="purple" depth={4} />
      <path d="M16.8 22 L22 27.2 L31.5 16.8" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  shovel: () => (
    <g transform="rotate(40 24 24) translate(24 24) scale(0.92) translate(-24 -24)">
      <Solid d={rrect(16.5, 1.5, 15, 5.5, 2.75)} tone="wood" depth={2} />
      <rect x="21.8" y="5" width="4.4" height="23" rx="2.2" fill={P.wood[0]} />
      <Solid d="M14.5 25 H33.5 V33.5 C33.5 40 28.5 45 24 46.5 C19.5 45 14.5 40 14.5 33.5 Z" tone="silver" depth={3} />
    </g>
  ),
  tv: () => (
    <>
      <path d="M17 6.5 L23 12.5 L31 5" fill="none" stroke={P.navy[0]} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <Solid d={rrect(5, 12, 38, 29, 7)} tone="purple" depth={3.5} />
      <rect x="10" y="16" width="28" height="18.5" rx="4" fill="#efeaff" />
      <path d="M21 20.5 v9 l8 -4.5 Z" fill={P.pink[0]} />
    </>
  ),
  receipt: () => (
    <>
      <Solid d="M11 5 H37 V43 L33.2 40 L29.4 43 L25.6 40 L21.8 43 L18 40 L14.2 43 L11 40.5 Z" tone="paper" depth={2.5} />
      <path d="M16.5 13 H31.5 M16.5 20 H31.5 M16.5 27 H25" stroke="#bcc3d3" strokeWidth="2.8" strokeLinecap="round" />
      <Solid d={circle(31, 31, 4.2)} tone="gold" depth={1.5} />
    </>
  ),
  signal: () => (
    <>
      <path d="M12.5 17.5 a16 16 0 0 1 23 0" fill="none" stroke="#c9cede" strokeWidth="4" strokeLinecap="round" />
      <path d="M17.5 23 a9 9 0 0 1 13 0" fill="none" stroke="#c9cede" strokeWidth="4" strokeLinecap="round" />
      <Solid d={circle(24, 30, 3.6)} tone="silver" depth={1.5} />
      <Solid d={circle(35, 35, 7.5)} tone="red" depth={2} />
      <path d="M35 31 V35.4" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="35" cy="38.3" r="1.4" fill="#fff" />
    </>
  ),
  party: () => (
    <>
      <Solid d="M6.5 42 L15 18.5 L30 33.5 Z" tone="gold" depth={3} />
      <path d="M11.3 30 L22.6 36.6 M9 36.3 L16.3 40" stroke={P.pink[0]} strokeWidth="3" strokeLinecap="round" />
      <path d="M22 15 C21 9.5 25.5 7.5 24 3.5" fill="none" stroke={P.purple[0]} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M33 26 C38.5 25 40.5 29.5 44.5 28" fill="none" stroke={P.mint[0]} strokeWidth="2.6" strokeLinecap="round" />
      <rect x="30" y="8" width="5" height="5" rx="1" fill={P.pink[0]} transform="rotate(20 32.5 10.5)" />
      <rect x="38" y="16" width="4.5" height="4.5" rx="1" fill={P.gold[0]} transform="rotate(-15 40 18)" />
      <circle cx="29" cy="18.5" r="2.2" fill={P.mint[0]} />
      <circle cx="40.5" cy="6.5" r="1.8" fill={P.purple[0]} />
    </>
  ),
  unlock: () => (
    <>
      <path d="M14.5 21 V14 a8 8 0 0 1 15.4 -3" fill="none" stroke="#a9b1c4" strokeWidth="4" strokeLinecap="round" />
      <Solid d={rrect(9, 21, 30, 22, 6)} tone="gold" depth={3.5} />
      <circle cx="24" cy="29.6" r="3.2" fill={P.gold[1]} />
      <rect x="22.6" y="30" width="2.8" height="6" rx="1.4" fill={P.gold[1]} />
    </>
  ),
  boom: () => (
    <>
      <path d={starPath(24, 24, 21, 0.62, 9)} fill="#ff8a3d" transform="rotate(8 24 24)" />
      <path d={starPath(24, 24, 14, 0.6, 7)} fill={P.gold[0]} transform="rotate(-6 24 24)" />
      <circle cx="24" cy="24" r="5.5" fill="#fff6d6" />
    </>
  ),
  sparkle: () => (
    <>
      <path d={twinkle(20, 22, 15)} fill={P.gold[0]} />
      <path d={twinkle(37, 36, 7)} fill={P.pink[0]} />
      <path d={twinkle(37, 9, 4.5)} fill={P.purple[0]} />
    </>
  ),
  pine: () => (
    <>
      <rect x="21.5" y="34" width="5" height="10" rx="1.5" fill={P.wood[1]} />
      <Solid d="M24 15 L39.5 36.5 H8.5 Z" tone="green" depth={3.5} />
      <Solid d="M24 4 L35 20 H13 Z" tone="green" depth={3} />
    </>
  ),
  palm: () => (
    <>
      <Solid d="M3 44 C9 33 39 33 45 44 Z" tone="sand" depth={2.5} />
      <path d="M25.5 37 C26 28 25 20 21.5 13" fill="none" stroke={P.wood[0]} strokeWidth="4.4" strokeLinecap="round" />
      <path d="M21.5 13 C15 8 8 11 5.5 17 C11 14 16 14 21.5 13 Z" fill={P.green[1]} />
      <path d="M21.5 13 C27 6.5 36 7 40.5 13 C34 11.5 28 11.5 21.5 13 Z" fill={P.green[0]} />
      <path d="M21.5 13 C19 6 13.5 3.5 8.5 5 C14 6.5 18 9 21.5 13 Z" fill={P.green[0]} />
      <path d="M21.5 13 C28 13 33 17.5 34 23 C30 19 26 16.5 21.5 13 Z" fill={P.green[1]} />
      <circle cx="22.5" cy="15.5" r="2.4" fill={P.wood[1]} />
    </>
  ),
  temple: () => (
    <>
      <Solid d={rrect(5, 34, 38, 10, 2)} tone="gold" depth={3} />
      <Solid d={rrect(10, 24, 28, 11, 2)} tone="gold" depth={3} />
      <Solid d={rrect(15, 14, 18, 11, 2)} tone="gold" depth={3} />
      <Solid d={rrect(19.5, 6, 9, 9, 2)} tone="gold" depth={2.5} />
      <path d="M20.5 44 V37 a3.5 3.5 0 0 1 7 0 V44 Z" fill="#9a6200" />
    </>
  ),
  medal1: () => <Medal rank={1} />,
  medal2: () => <Medal rank={2} />,
  medal3: () => <Medal rank={3} />,
};

function Shape({ name }: { name: ArcadeIconName }) {
  return <>{SHAPES[name]()}</>;
}

export function ArcadeIcon({ name, size = 24, label, className }: { name: ArcadeIconName; size?: number; label?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className ? `arcade-icon ${className}` : 'arcade-icon'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: 'inline-block', verticalAlign: '-0.2em', flexShrink: 0 }}
    >
      <Shape name={name} />
    </svg>
  );
}

/** 게임별 아이콘 (지갑 칩·탭·시트) */
export function GameIcon({ id, size = 20 }: { id: string; size?: number }) {
  return <ArcadeIcon name={id === 'minesweeper' ? 'bomb' : 'pinball'} size={size} />;
}
