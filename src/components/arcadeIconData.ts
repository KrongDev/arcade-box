/**
 * 픽셀 아이콘 칸 지도와 색 — ArcadeIcon이 그리고, 다른 칸 그림(상점 미리보기)이 아이콘을 찍을 때도 쓴다.
 * 칸 지도의 글자 하나가 한 칸의 색이다('.'은 빈칸).
 */

export type ArcadeIconName =
  | 'gift'
  | 'bag'
  | 'trophy'
  | 'coin'
  | 'pinball'
  | 'bricks'
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
  | 'temple'
  | 'cabinet'
  | 'gear';

/** 칸 색 */
const PAL: Record<string, string> = {
  K: '#1c1d22',
  Y: '#ffd93d',
  y: '#fff3a8',
  A: '#c98a00', // 금색 어두운 테
  O: '#ff8a2a',
  R: '#ff4d5a',
  r: '#c42a36',
  P: '#ff6fae',
  p: '#ffb6d6',
  B: '#22b8f0',
  b: '#a6e6ff',
  C: '#0a6f99',
  G: '#3fbf5a',
  g: '#2a8f42',
  W: '#ffffff',
  S: '#d6dbe6',
  s: '#8f97ab',
  D: '#3a3a52',
  d: '#5b5b7a',
  N: '#a0603a',
  n: '#6e3d20',
  T: '#ffe2a8',
  t: '#e8b866',
  M: '#e5262e',
};

const MAPS: Record<Exclude<ArcadeIconName, 'medal1' | 'medal2' | 'medal3'>, string[]> = {
  gift: [
    '................',
    '...YY......YY...',
    '..Y..Y....Y..Y..',
    '...YY.Y..Y.YY...',
    '.....YYYYYY.....',
    '.RRRRRRYYRRRRRR.',
    '.RRRRRRYYRRRRRR.',
    '.rrrrrrAArrrrrr.',
    '..RRRRRYYRRRRR..',
    '..RRRRRYYRRRRR..',
    '..RRRRRYYRRRRR..',
    '..RRRRRYYRRRRR..',
    '..RRRRRYYRRRRR..',
    '..rrrrrAArrrrr..',
    '................',
    '................',
  ],
  bag: [
    '................',
    '.....CCCCCC.....',
    '....C......C....',
    '....C......C....',
    '..BBBBBBBBBBBB..',
    '..BbbBBBBBBBBB..',
    '..BbBBBBBBBBBB..',
    '..BBBBBYYBBBBB..',
    '..BBBBYYYYBBBB..',
    '..BBBBBYYBBBBB..',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBBB..',
    '..BBBBBBBBBBBB..',
    '..CCCCCCCCCCCC..',
    '................',
    '................',
  ],
  trophy: [
    '................',
    '...YYYYYYYYYY...',
    '.OOYyYYYYYYYYOO.',
    '.O.YyYYYYYYYY.O.',
    '.O.YyYYYYYYYY.O.',
    '..OYYYYYYYYYYO..',
    '...YYYYYYYYYA...',
    '....YYYYYYYA....',
    '.....YYYYYA.....',
    '.......AA.......',
    '.......AA.......',
    '.....YYYYYY.....',
    '....BBBBBBBB....',
    '....CCCCCCCC....',
    '................',
    '................',
  ],
  // F·f·A는 코인 색(게임마다 다르다 — tint로 바꾼다)
  coin: [
    '................',
    '.....AAAAAA.....',
    '...AAFFFFFFAA...',
    '..AFFffffffFFA..',
    '..AFfFFFFFFFFA..',
    '.AFfFFFFFFFFFFA.',
    '.AFfFFFAFFFFFFA.',
    '.AFfFFFAFFFFFFA.',
    '.AFfFFFAFFFFFFA.',
    '.AFfFFFAFFFFFFA.',
    '.AFFFFFFFFFFFFA.',
    '..AFFFFFFFFFFA..',
    '..AAFFFFFFFFAA..',
    '...AAAFFFFAAA...',
    '.....AAAAAA.....',
    '................',
  ],
  pinball: [
    '................',
    '................',
    '......SSSS......',
    '....SSSSSSSS....',
    '...SWWSSSSSSS...',
    '...SWSSSSSSSs...',
    '..SSSSSSSSSSss..',
    '..SSSSSSSSSSss..',
    '..SSSSSSSSSSss..',
    '..SSSSSSSSSsss..',
    '...SSSSSSSsss...',
    '...ssSSSSssss...',
    '....ssssssss....',
    '......ssss......',
    '................',
    '................',
  ],
  bricks: [
    '................',
    '..........SS....',
    '.........SWSS...',
    '.........SSSs...',
    '..........ss....',
    '................',
    '.RRRRRR.RRRRRRR.',
    '.RRRRRR.RRRRRRR.',
    '.rrrrrr.rrrrrrr.',
    '................',
    '.BBB.BBBBBB.BBB.',
    '.BBB.BBBBBB.BBB.',
    '.CCC.CCCCCC.CCC.',
    '................',
    '....SSSSSSSS....',
    '....ssssssss....',
  ],
  bomb: [
    '...........YO...',
    '..........Y.....',
    '.........N......',
    '........N.......',
    '......SSS.......',
    '.....DDDDDD.....',
    '...DDDDDDDDDD...',
    '..DDWWDDDDDDDD..',
    '..DDWDDDDDDDDD..',
    '.DDDDDDDDDDDDDD.',
    '.DDDDDDDDDDDDDD.',
    '.DDDDDDDDDDDDDD.',
    '..DDDDDDDDDDDD..',
    '..dDDDDDDDDDDd..',
    '....dddddddd....',
    '................',
  ],
  flag: [
    '................',
    '...sRRR.........',
    '...sRRRRRR......',
    '...sRRRRRRRRR...',
    '...sRRRRRRRRRRR.',
    '...sRRRRRRRRrr..',
    '...sRRRRRRrr....',
    '...sRRRrr.......',
    '...s............',
    '...s............',
    '...s............',
    '...s............',
    '..sss...........',
    '.SSSSS..........',
    '................',
    '................',
  ],
  shield: [
    '................',
    '..BBBBBBBBBBBB..',
    '..BbbBBBBBBBBB..',
    '..BbBBBBBBBBWB..',
    '..BBBBBBBBBWWB..',
    '..BBBBBBBBWWBB..',
    '..BBWBBBBWWBBB..',
    '..BBWWBBWWBBBB..',
    '...BBWWWWBBBB...',
    '...BBBWWBBBBB...',
    '....BBBBBBBC....',
    '.....BBBBBC.....',
    '......BBCC......',
    '.......CC.......',
    '................',
    '................',
  ],
  shovel: [
    '................',
    '...........nnnn.',
    '...........nNNn.',
    '...........nNn..',
    '..........N.n...',
    '.........N......',
    '........N.......',
    '.......N........',
    '...SS.N.........',
    '..SSSSs.........',
    '.SSSSSSs........',
    '.SWSSSSs........',
    '.SSSSSs.........',
    '..SSss..........',
    '...s............',
    '................',
  ],
  tv: [
    '................',
    '....d......d....',
    '.....d....d.....',
    '......d..d......',
    '.BBBBBBBBBBBBBB.',
    '.BWWWWWWWWWWWBB.',
    '.BWWWRWWWWWWWBB.',
    '.BWWWRRWWWWWWBB.',
    '.BWWWRRRWWWWWBB.',
    '.BWWWRRWWWWWWBB.',
    '.BWWWRWWWWWWWBB.',
    '.BWWWWWWWWWWWBB.',
    '.BBBBBBBBBBBBBB.',
    '.CCCCCCCCCCCCCC.',
    '...CC......CC...',
    '................',
  ],
  receipt: [
    '................',
    '...SSSSSSSSSS...',
    '...SWWWWWWWWS...',
    '...SWssssssWS...',
    '...SWWWWWWWWS...',
    '...SWssssWWWS...',
    '...SWWWWWWWWS...',
    '...SWsssWWWWS...',
    '...SWWWWWWWWS...',
    '...SWWWWWYYWS...',
    '...SWWWWYYYYS...',
    '...SWWWWWYYWS...',
    '...SWWWWWWWWS...',
    '...SWSWWSWWSS...',
    '...S.S..S..S....',
    '................',
  ],
  signal: [
    '................',
    '.....ssssss.....',
    '...ss......ss...',
    '..s..........s..',
    '.....ssssss.....',
    '....s......s....',
    '.......ss.......',
    '......s..s......',
    '................',
    '.......ss..RRRR.',
    '.......ss.RRWWRR',
    '..........RRWWRR',
    '..........RRWWRR',
    '..........RRRRRR',
    '..........RRWWRR',
    '...........RRRR.',
  ],
  party: [
    '...........P....',
    '.....B..........',
    '.........Y...G..',
    '....P...........',
    '.......G....B...',
    '..........P.....',
    '...Y............',
    '..YYY.......Y...',
    '..YOYY..........',
    '.YYYOYY.........',
    '.YOYYYOY........',
    '.YYYOYYYY.......',
    'YYOYYYOYYY......',
    'YYYYOYYYYYY.....',
    'YOYYYYOYY.......',
    '.YYYYY..........',
  ],
  unlock: [
    '................',
    '.......ssss.....',
    '......s....s....',
    '......s....s....',
    '......s.........',
    '......s.........',
    '..YYYYYYYYYYYY..',
    '..YyyyyyyyyyyY..',
    '..YYYYYAAYYYYY..',
    '..YYYYAAAAYYYY..',
    '..YYYYYAAYYYYY..',
    '..YYYYYAAYYYYY..',
    '..YYYYYYYYYYYY..',
    '..AAAAAAAAAAAA..',
    '................',
    '................',
  ],
  boom: [
    '.......O........',
    '...O...OO...O...',
    '....OO.OYO.OO...',
    '....OYOOYYOYO...',
    '.OO.OYYYYYYO..O.',
    '..OOYYyyyyYYOO..',
    '...OYyyWWyyYO...',
    '.OOYYyWWWWyYYOO.',
    '...OYyyWWyyYO...',
    '..OOYYyyyyYYOO..',
    '.O..OYYYYYYO.OO.',
    '....OYOYYOYO....',
    '...OO.OYO.OO....',
    '...O...OO...O...',
    '.......O........',
    '................',
  ],
  sparkle: [
    '................',
    '......Y.........',
    '......Y.........',
    '.....YYY........',
    '.....YyY........',
    '.YYYYyWyYYYY.P..',
    '.....YyY....PpP.',
    '.....YYY.....P..',
    '......Y.........',
    '......Y.....B...',
    '...........BbB..',
    '............B...',
    '................',
    '................',
    '................',
    '................',
  ],
  pine: [
    '.......G........',
    '......GGG.......',
    '.....GGgGG......',
    '....GGGGGGG.....',
    '......GGG.......',
    '....GGGGgGG.....',
    '...GGGGGGGGG....',
    '..GGGgGGGGGGG...',
    '.....GGGGG......',
    '...GGGGGGgGGG...',
    '..GGGGGGGGGGGG..',
    '.GGgGGGGGGGGGGG.',
    '.......nn.......',
    '.......nn.......',
    '......nnnn......',
    '................',
  ],
  palm: [
    '....GGG...GGG...',
    '..GGGGGG.GGGGGG.',
    '.GG...GGGGG...GG',
    '.G...GGnGGG....G',
    '....G..n...G....',
    '.......n........',
    '.......n........',
    '......n.........',
    '......n.........',
    '......n.........',
    '.....n..........',
    '.....n..........',
    '..TTTTTTTTTTT...',
    '.TTTTTTTTTTTTTT.',
    'tttttttttttttttt',
    '................',
  ],
  temple: [
    '................',
    '......YYYY......',
    '......YyyY......',
    '......AAAA......',
    '....YYYYYYYY....',
    '....YyyyyyyY....',
    '....AAAAAAAA....',
    '..YYYYYYYYYYYY..',
    '..YyyyyyyyyyyY..',
    '..AAAAAAAAAAAA..',
    'YYYYYYnnnnYYYYYY',
    'YyyyyynnnnyyyyyY',
    'YYYYYYnnnnYYYYYY',
    'AAAAAAnnnnAAAAAA',
    '................',
    '................',
  ],
  cabinet: [
    '................',
    '..PPPPPPPPPPPP..',
    '..PyyyyyyyyyyP..',
    '..PPPPPPPPPPPP..',
    '..SSSSSSSSSSSS..',
    '..SKKKKKKKKKKS..',
    '..SKDDDDDDDDKS..',
    '..SKDBDDDDYDKS..',
    '..SKDDDDDDDDKS..',
    '..SKKKKKKKKKKS..',
    '..SSSSSSSSSSSS..',
    '..SMSSSSSSWWSS..',
    '..SMMSSSSWWWSS..',
    '..SSSSSSSSSSSS..',
    '..ssssssssssss..',
    '................',
  ],
  gear: [
    '................',
    '......ssss......',
    '..ss..ssss..ss..',
    '..ssssssssssss..',
    '...ssssssssss...',
    '..sssss..sssss..',
    'ssssss....ssssss',
    'sssss......sssss',
    'sssss......sssss',
    'ssssss....ssssss',
    '..sssss..sssss..',
    '...ssssssssss...',
    '..ssssssssssss..',
    '..ss..ssss..ss..',
    '......ssss......',
    '................',
  ],
};

/** 메달: 리본 + 원판 + 3×5 숫자. 원판 색만 등수마다 다르다 */
const DIGITS: Record<1 | 2 | 3, string[]> = {
  1: ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  2: ['XX.', '..X', '.X.', 'X..', 'XXX'],
  3: ['XX.', '..X', '.X.', '..X', 'XX.'],
};
function medalMap(rank: 1 | 2 | 3): string[] {
  const g = Array.from({ length: 16 }, () => Array<string>(16).fill('.'));
  const ribbon = ['....BBB..PPP....', '....BBB..PPP....', '.....BBBPPP.....', '......BBPP......'];
  ribbon.forEach((row, y) => [...row].forEach((c, x) => (g[y][x] = c)));
  for (let y = 4; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 10);
      if (d > 5.7) continue;
      g[y][x] = d > 4.4 ? (x - 8 + (y - 10) >= 0 ? 'E' : 'e') : 'F';
    }
  DIGITS[rank].forEach((row, y) => [...row].forEach((c, x) => c === 'X' && (g[8 + y][7 + x - 1] = 'E')));
  return g.map((r) => r.join(''));
}
const MEDAL_TINT: Record<1 | 2 | 3, Record<string, string>> = {
  1: { F: '#ffd93d', e: '#fff3a8', E: '#a86f00' },
  2: { F: '#d6dbe6', e: '#f2f4f8', E: '#6b7387' },
  3: { F: '#eda673', e: '#f8cfae', E: '#8a4f22' },
};

/** 아이콘 칸 지도와 색 — 다른 칸 그림(상점 미리보기)에 아이콘을 찍을 때 쓴다 */
export function iconGrid(name: Exclude<ArcadeIconName, 'medal1' | 'medal2' | 'medal3'>): { map: string[]; color: (ch: string) => string | undefined } {
  return { map: MAPS[name], color: (ch) => PAL[ch] };
}

/** 같은 색 칸을 path 하나로 묶는다 */
function toPaths(map: string[], tint: Record<string, string> | undefined) {
  const byColor = new Map<string, string>();
  map.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const color = tint?.[ch] ?? PAL[ch];
      if (!color) return;
      byColor.set(color, (byColor.get(color) ?? '') + `M${x} ${y}h1v1h-1z`);
    }),
  );
  return [...byColor.entries()];
}

const cache = new Map<string, [string, string][]>();
export function pathsFor(name: ArcadeIconName, tint?: Record<string, string>): [string, string][] {
  const key = tint ? `${name}|${JSON.stringify(tint)}` : name;
  const hit = cache.get(key);
  if (hit) return hit;
  let map: string[];
  let t = tint;
  if (name === 'medal1' || name === 'medal2' || name === 'medal3') {
    const rank = Number(name.slice(-1)) as 1 | 2 | 3;
    map = medalMap(rank);
    t = { ...MEDAL_TINT[rank], ...tint };
  } else {
    map = MAPS[name];
  }
  const paths = toPaths(map, t);
  cache.set(key, paths);
  return paths;
}

/** 코인 칸 색(F 면·f 밝은 테·A 어두운 테) — 게임별 코인 색은 game/currency.ts가 넘긴다 */
export type CoinTint = { face: string; light: string; side: string };

