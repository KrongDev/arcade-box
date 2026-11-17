/**
 * 홈 오락기 화면에 띄우는 게임 그림 — 픽셀 아이콘과 같은 그림체(칸 하나 = 한 색).
 * 66×42칸을 계산해 같은 색 칸을 path 하나로 묶어 그린다. 처음 한 번만 계산한다.
 * 글자 대신 그림이라 aria-hidden이다(게임 이름은 화면 글자로 따로 읽힌다).
 */

const W = 66;
const H = 42;

type Raster = string[][];

function raster(bg: string): Raster {
  return Array.from({ length: H }, () => Array<string>(W).fill(bg));
}
function put(r: Raster, x: number, y: number, c: string) {
  if (x >= 0 && y >= 0 && x < W && y < H) r[y][x] = c;
}
function rect(r: Raster, x: number, y: number, w: number, h: number, c: string) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(r, i, j, c);
}
function disc(r: Raster, cx: number, cy: number, rad: number, c: string) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rad * rad) put(r, x, y, c);
}
function line(r: Raster, x0: number, y0: number, x1: number, y1: number, c: string, t = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) rect(r, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), t, t, c);
}
function toPaths(r: Raster): [string, string][] {
  const by = new Map<string, string>();
  r.forEach((row, y) => row.forEach((c, x) => by.set(c, (by.get(c) ?? '') + `M${x} ${y}h1v1h-1z`)));
  return [...by.entries()];
}

function pinballPaths() {
  const r = raster('#101433');
  // 바닥 점 무늬
  for (let x = 2; x < W; x += 8) for (let y = (x / 8) % 2 ? 3 : 7; y < H; y += 8) put(r, x, y, '#2a3170');
  // 레일
  const rail = '#4fc0f2';
  line(r, 6, 42, 6, 11, rail, 2);
  line(r, 6, 11, 12, 5, rail, 2);
  line(r, 12, 5, 53, 5, rail, 2);
  line(r, 53, 5, 59, 11, rail, 2);
  line(r, 59, 11, 59, 42, rail, 2);
  // 범퍼 셋: 빨간 그림자 + 분홍 뚜껑 + 고리
  for (const [x, y] of [
    [26, 14],
    [40, 14],
    [33, 22],
  ]) {
    disc(r, x + 1, y + 1.5, 4.8, '#8e1f22');
    disc(r, x, y, 4.8, '#ff5fa2');
    disc(r, x, y, 2.7, '#ffb6d6');
    disc(r, x, y, 1.2, '#ff5fa2');
  }
  // 날아가는 공과 속도선
  line(r, 13, 15, 15, 17, '#4a5590');
  line(r, 11, 18, 13, 20, '#343d78');
  disc(r, 18.5, 23.5, 2.7, '#0a0c22');
  disc(r, 18, 22, 2.7, '#d6dbe6');
  put(r, 17, 21, '#ffffff');
  // 동전
  disc(r, 50, 24, 2.4, '#c98a00');
  disc(r, 50, 23.4, 2.2, '#ffd93d');
  // 플리퍼 둘
  line(r, 17, 35, 27, 38, '#ffe14d', 2);
  line(r, 48, 35, 38, 38, '#ffe14d', 2);
  return toPaths(r);
}

// 위쪽에 판을 두고 아래는 게임 이름 자리로 비워 둔다(화면 아래에 이름이 겹친다)
const MS_ROWS = ['cc1oo1ccc', 'c2oooo1cf', 'f1o12occ1', 'c2oob1cc2'];
const NUM: Record<string, string[]> = {
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '2': ['XX.', '..X', '.X.', 'X..', 'XXX'],
};
function minesweeperPaths() {
  const r = raster('#0e2730');
  for (let x = 2; x < W; x += 8) for (let y = (x / 8) % 2 ? 3 : 7; y < H; y += 8) put(r, x, y, '#1b4450');
  const size = 5;
  const gap = 1;
  const left = Math.floor((W - (size * 9 + gap * 8)) / 2);
  const top = 5;
  MS_ROWS.forEach((row, ry) =>
    [...row].forEach((ch, cx) => {
      const x = left + cx * (size + gap);
      const y = top + ry * (size + gap);
      const closed = ch === 'c' || ch === 'f';
      if (closed) {
        rect(r, x, y, size, size, '#56627e');
        rect(r, x, y, size, size - 1, '#8794b0');
      } else {
        rect(r, x, y, size, size, '#e8f6f1');
      }
      const digit = NUM[ch];
      if (digit) {
        const color = ch === '1' ? '#3b5bdb' : '#2b8a3e';
        digit.forEach((d, dy) => [...d].forEach((v, dx) => v === 'X' && put(r, x + 1 + dx, y + dy, color)));
      }
      if (ch === 'f') {
        rect(r, x + 1, y + 1, 1, 3, '#1c1d22');
        rect(r, x + 2, y + 1, 2, 2, '#ff4d5a');
      }
      if (ch === 'b') {
        disc(r, x + 2.5, y + 2.8, 2, '#3a3a52');
        put(r, x + 2, y + 2, '#8f97ab');
        put(r, x + 4, y, '#ff8a2a');
      }
    }),
  );
  // 반짝이는 민트 동전 하나
  disc(r, left + 6 * (size + gap) + 2.5, top + 2 * (size + gap) + 2.5, 1.6, '#3ccfa4');
  return toPaths(r);
}

const cache: Record<string, [string, string][]> = {};
function paths(id: 'pinball' | 'minesweeper') {
  cache[id] ??= id === 'pinball' ? pinballPaths() : minesweeperPaths();
  return cache[id];
}

export function GameArt({ id }: { id: string }) {
  if (id !== 'pinball' && id !== 'minesweeper') return null;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height="100%"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {paths(id).map(([color, d]) => (
        <path key={color} d={d} fill={color} />
      ))}
    </svg>
  );
}
