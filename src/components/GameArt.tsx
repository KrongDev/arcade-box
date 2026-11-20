/**
 * 홈 오락기 화면에 띄우는 게임 그림 — 픽셀 아이콘과 같은 그림체(칸 하나 = 한 색).
 * 66×42칸을 계산해 같은 색 칸을 path 하나로 묶어 그린다. 처음 한 번만 계산한다.
 * 글자 대신 그림이라 aria-hidden이다(게임 이름은 화면 글자로 따로 읽힌다).
 */

import { mixHex } from '../game/color';
import type { GameId } from '../game/registry';
import { Raster } from './pixelRaster';

const W = 66;
const H = 42;

function raster(bg: string): Raster {
  return new Raster(W, H, bg);
}

function pinballPaths() {
  const r = raster('#101433');
  // 바닥 점 무늬
  for (let x = 2; x < W; x += 8) for (let y = (x / 8) % 2 ? 3 : 7; y < H; y += 8) r.put(x, y, '#2a3170');
  // 레일
  const rail = '#4fc0f2';
  r.line(6, 42, 6, 11, rail, 2);
  r.line(6, 11, 12, 5, rail, 2);
  r.line(12, 5, 53, 5, rail, 2);
  r.line(53, 5, 59, 11, rail, 2);
  r.line(59, 11, 59, 42, rail, 2);
  // 범퍼 셋: 빨간 그림자 + 분홍 뚜껑 + 고리
  for (const [x, y] of [
    [26, 14],
    [40, 14],
    [33, 22],
  ]) {
    r.disc(x + 1, y + 1.5, 4.8, '#8e1f22');
    r.disc(x, y, 4.8, '#ff5fa2');
    r.disc(x, y, 2.7, '#ffb6d6');
    r.disc(x, y, 1.2, '#ff5fa2');
  }
  // 날아가는 공과 속도선
  r.line(13, 15, 15, 17, '#4a5590');
  r.line(11, 18, 13, 20, '#343d78');
  r.disc(18.5, 23.5, 2.7, '#0a0c22');
  r.disc(18, 22, 2.7, '#d6dbe6');
  r.put(17, 21, '#ffffff');
  // 동전
  r.disc(50, 24, 2.4, '#c98a00');
  r.disc(50, 23.4, 2.2, '#ffd93d');
  // 플리퍼 둘
  r.line(17, 35, 27, 38, '#ffe14d', 2);
  r.line(48, 35, 38, 38, '#ffe14d', 2);
  return r.paths();
}

// 위쪽에 판을 두고 아래는 게임 이름 자리로 비워 둔다(화면 아래에 이름이 겹친다)
const MS_ROWS = ['cc1oo1ccc', 'c2oooo1cf', 'f1o12occ1', 'c2oob1cc2'];
const NUM: Record<string, string[]> = {
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '2': ['XX.', '..X', '.X.', 'X..', 'XXX'],
};
function minesweeperPaths() {
  const r = raster('#0e2730');
  for (let x = 2; x < W; x += 8) for (let y = (x / 8) % 2 ? 3 : 7; y < H; y += 8) r.put(x, y, '#1b4450');
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
        r.rect(x, y, size, size, '#56627e');
        r.rect(x, y, size, size - 1, '#8794b0');
      } else {
        r.rect(x, y, size, size, '#e8f6f1');
      }
      const digit = NUM[ch];
      if (digit) {
        const color = ch === '1' ? '#3b5bdb' : '#2b8a3e';
        digit.forEach((d, dy) => [...d].forEach((v, dx) => v === 'X' && r.put(x + 1 + dx, y + dy, color)));
      }
      if (ch === 'f') {
        r.rect(x + 1, y + 1, 1, 3, '#1c1d22');
        r.rect(x + 2, y + 1, 2, 2, '#ff4d5a');
      }
      if (ch === 'b') {
        r.disc(x + 2.5, y + 2.8, 2, '#3a3a52');
        r.put(x + 2, y + 2, '#8f97ab');
        r.put(x + 4, y, '#ff8a2a');
      }
    }),
  );
  // 반짝이는 민트 동전 하나
  r.disc(left + 6 * (size + gap) + 2.5, top + 2 * (size + gap) + 2.5, 1.6, '#3ccfa4');
  return r.paths();
}

// 벽돌 네 줄(몇 칸은 깨졌다) · 날아가는 공 · 떨어지는 동전 · 패들. 아래 왼쪽은 게임 이름 자리로 비워 둔다
function breakoutPaths() {
  const r = raster('#14122a');
  for (let x = 2; x < W; x += 8) for (let y = (x / 8) % 2 ? 3 : 7; y < H; y += 8) r.put(x, y, '#2b2850');
  const frame = '#a594ff';
  r.rect(2, 2, W - 4, 1, frame);
  r.rect(2, 2, 1, H - 2, frame);
  r.rect(W - 3, 2, 1, H - 2, frame);
  const rows = ['#ff5c86', '#ff9f43', '#ffd93d', '#3ccf7a'];
  const broken = new Set(['2,1', '3,2', '4,2', '3,3', '5,3', '6,3']);
  rows.forEach((c, row) => {
    for (let col = 0; col < 8; col++) {
      if (broken.has(`${col},${row}`)) continue;
      const x = 5 + col * 7;
      const y = 5 + row * 4;
      r.rect(x, y, 6, 3, c);
      r.rect(x, y, 6, 1, mixHex(c, '#ffffff', 0.45));
      r.rect(x, y + 2, 6, 1, mixHex(c, '#000000', 0.35));
    }
  });
  // 날아가는 공과 지나온 길
  r.put(29, 29, '#3a3f70');
  r.put(31, 27, '#4a4f80');
  r.put(33, 25, '#5d6194');
  r.disc(35.5, 22.5, 1.9, '#9aa3b8');
  r.disc(35, 22, 1.4, '#ffffff');
  // 떨어지는 동전
  r.disc(49, 26.5, 1.7, '#c4502a');
  r.disc(49, 26, 1.5, '#ff8a5c');
  // 패들
  r.rect(41, 34, 14, 1, '#ffffff');
  r.rect(40, 35, 16, 1, '#e9ecf2');
  r.rect(41, 36, 14, 1, '#8f97ab');
  return r.paths();
}

const PAINTERS: Record<GameId, () => [string, string][]> = {
  pinball: pinballPaths,
  minesweeper: minesweeperPaths,
  breakout: breakoutPaths,
};

const cache: Partial<Record<GameId, [string, string][]>> = {};
function pathsOf(id: GameId) {
  cache[id] ??= PAINTERS[id]();
  return cache[id];
}

export function GameArt({ id }: { id: GameId }) {
  const paths = pathsOf(id);
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
      {paths.map(([color, d]) => (
        <path key={color} d={d} fill={color} />
      ))}
    </svg>
  );
}
