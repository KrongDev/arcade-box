import { mixHex } from '../game/color';
import { CURRENCY } from '../game/currency';
import type { BallLook, Effect, MapLook, PinballTableLook, ShopItem, TileLook } from '../game/catalog';
import { iconGrid } from './arcadeIconData';
import { Raster } from './pixelRaster';

/**
 * 상점 아이템 미리보기 — 실제 게임 색으로 그린 20×25칸 픽셀 그림. 이펙트가 있으면 함께 보여 준다.
 * 게임 화면(핀볼 판·지뢰찾기 칸)과 같은 칸 그림체다. 아이템마다 한 번만 계산한다.
 */
const W = 20;
const H = 25;

const cache = new Map<string, [string, string][]>();

export function ItemPreview({ item }: { item: ShopItem }) {
  let paths = cache.get(item.id);
  if (!paths) {
    paths = draw(item).paths();
    cache.set(item.id, paths);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="item-preview" shapeRendering="crispEdges" aria-hidden="true">
      {paths.map(([color, d]) => (
        <path key={color} d={d} fill={color} />
      ))}
    </svg>
  );
}

function draw(item: ShopItem): Raster {
  switch (item.slot) {
    case 'table':
      return drawTable(item.look, item.effect, !!item.ability?.coinSpawn);
    case 'ball':
      return drawBall(item.look, item.effect);
    case 'tile':
      return drawTile(item.look, !!item.ability?.shield);
    case 'map':
      return drawMap(item.look, item.ability?.extraCoins?.[0] ?? 0, !!item.effect?.coinGlow);
  }
}

/** 핀볼 판: 벽 · 가운데 빛 · 범퍼 셋 · 동전 · 플리퍼 */
function drawTable(l: PinballTableLook, fx: Effect | undefined, extraCoin: boolean): Raster {
  const r = new Raster(W, H, l.page);
  r.rect(2, 2, 16, 21, l.table);
  r.disc(10, 10, 6.5, mixHex(l.table, l.tableGlow, 0.6));
  r.disc(10, 9.5, 4.5, l.tableGlow);
  if (fx?.table === 'stars') {
    for (const [x, y] of [
      [4, 5],
      [15, 4],
      [5, 15],
      [16, 13],
      [11, 17],
      [8, 3],
    ])
      r.put(x, y, '#ffffff');
    r.line(12, 6, 14, 5, '#d0d4ff');
  }
  // 벽(위 모서리는 비스듬히). 네온 판은 바깥에 빛 테가 한 칸 더 있다
  if (fx?.table === 'neon') {
    const halo = mixHex(l.wall, l.page, 0.55);
    r.rect(1, 3, 1, 21, halo);
    r.rect(18, 3, 1, 21, halo);
    r.rect(3, 1, 14, 1, halo);
  }
  r.rect(2, 4, 1, 19, l.wall);
  r.rect(17, 4, 1, 19, l.wall);
  r.rect(4, 2, 12, 1, l.wall);
  r.put(3, 3, l.wall);
  r.put(16, 3, l.wall);
  // 위쪽 레인 칸막이
  for (const x of [7, 10, 13]) r.rect(x, 4, 1, 3, l.wall);
  // 범퍼 셋(위에 하나, 아래 둘): 아래 진한 띠 + 고무 링 + 뚜껑 + 가운데 빛
  for (const [x, y] of [
    [10.5, 9.5],
    [6.5, 12.5],
    [14.5, 12.5],
  ]) {
    r.disc(x, y + 1, 2.4, mixHex(l.bumperRing, '#000000', 0.35));
    r.disc(x, y, 2.4, l.bumperRing);
    r.disc(x, y, 1.5, l.bumper);
    r.put(x - 0.5, y - 0.5, l.bumperFlash);
  }
  // 동전(판 위 동전이 더 자주 나오는 판이면 하나 더)
  const coin = (x: number, y: number) => {
    r.rect(x, y, 2, 2, l.coin);
    r.put(x + 1, y + 1, mixHex(l.coin, '#000000', 0.3));
  };
  coin(14, 6);
  if (extraCoin) coin(4, 7);
  // 슬링샷: 플리퍼 위 양쪽 비스듬한 고무
  const sling = mixHex(l.wall, l.table, 0.35);
  r.line(4, 14, 4, 16, sling);
  r.line(4, 14, 6, 17, sling);
  r.line(15, 14, 15, 16, sling);
  r.line(15, 14, 13, 17, sling);
  // 공
  r.rect(11, 16, 2, 2, '#c3cad8');
  r.put(11, 16, '#ffffff');
  // 플리퍼: 두 칸 두께로 비스듬히 아래를 향한다
  for (const [x0, x1] of [
    [4, 8],
    [15, 11],
  ]) {
    r.line(x0, 18, x1, 20, l.flipper);
    r.line(x0, 19, x1, 21, mixHex(l.flipper, l.plunger, 0.55));
  }
  return r;
}

/** 공: 큰 공 하나 + 꼬리(불꽃·반짝이·번개) + 부딪힘 고리 */
function drawBall(l: BallLook, fx: Effect | undefined): Raster {
  const bg = '#101433';
  const r = new Raster(W, H, bg);
  for (let y = 2; y < H; y += 4) for (let x = y % 8 === 2 ? 2 : 4; x < W; x += 4) r.put(x, y, '#1d2350');
  const trail = fx?.trail;
  if (trail === 'fire') {
    for (let i = 0; i < 8; i++) {
      const x = 3 + i;
      const y = 5 + i;
      r.put(x, y, i < 3 ? '#f03e3e' : i < 6 ? '#ff922b' : '#ffe066');
      r.put(x + 1, y - 1, i < 4 ? '#ff922b' : '#ffe066');
      if (i % 2 === 0) r.put(x - 1, y + 1, '#f03e3e');
    }
  } else if (trail === 'sparkle') {
    for (const [x, y] of [
      [4, 4],
      [8, 7],
      [3, 10],
      [9, 2],
    ]) {
      r.put(x - 1, y, '#ff9fbf');
      r.put(x + 1, y, '#ff9fbf');
      r.put(x, y - 1, '#ff9fbf');
      r.put(x, y + 1, '#ff9fbf');
      r.put(x, y, '#ffe3ea');
    }
  } else if (trail === 'lightning') {
    const zig: [number, number][] = [
      [2, 2],
      [5, 5],
      [3, 7],
      [7, 10],
    ];
    for (let i = 0; i < zig.length - 1; i++) r.line(zig[i][0] + 1, zig[i][1] + 1, zig[i + 1][0] + 1, zig[i + 1][1] + 1, '#1c7ed6');
    for (let i = 0; i < zig.length - 1; i++) r.line(zig[i][0], zig[i][1], zig[i + 1][0], zig[i + 1][1], '#a5d8ff');
  } else {
    r.rect(5, 6, 2, 2, mixHex(bg, l.ballLight, 0.15));
    r.rect(7, 8, 2, 2, mixHex(bg, l.ballLight, 0.3));
  }
  if (fx?.hit === 'boom') r.ring(11.5, 14.5, 8, '#74c0fc');
  // 공 아래 그림자
  r.rect(8, 20, 8, 1, '#0a0c22');
  // 공: 진한 바탕 위에 면 색을 왼쪽 위로 비껴 덮고, 반짝임
  r.disc(11.5, 14.5, 5.2, l.ballDark);
  r.disc(10.9, 13.9, 4.4, mixHex(l.ballLight, l.ballDark, 0.3));
  r.rect(9, 11, 2, 2, l.ballLight);
  r.put(11, 11, l.ballLight);
  return r;
}

const DIGIT: Record<'1' | '2', string[]> = {
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '2': ['XX.', '..X', '.X.', 'X..', 'XXX'],
};

/** 지뢰찾기 발판: 3×3칸, 닫힌 칸은 볼록(밝은 왼쪽 위·어두운 오른쪽 아래) + 발판 무늬, 열린 칸에 숫자 */
function drawTile(l: TileLook, shield: boolean): Raster {
  const r = new Raster(W, H, '#e8e9ed');
  const opened = [0, 1, 0, 1, 1, 0, 0, 1, 0];
  const digits: Record<number, '1' | '2'> = { 1: '1', 3: '2' };
  const light = mixHex(l.closed, '#ffffff', 0.45);
  for (let i = 0; i < 9; i++) {
    const x = 1 + (i % 3) * 6;
    const y = 4 + Math.floor(i / 3) * 6;
    if (opened[i]) {
      r.rect(x, y, 6, 6, l.openEdge);
      r.rect(x, y, 5, 5, l.open);
      const d = digits[i];
      if (d) r.stamp(DIGIT[d], x + 1, y, () => (d === '1' ? '#3b5bdb' : '#2b8a3e'));
      continue;
    }
    r.rect(x, y, 6, 6, l.closedEdge);
    r.rect(x, y, 5, 5, light);
    r.rect(x + 1, y + 1, 4, 4, l.closed);
    pattern(r, l, x + 1, y + 1);
  }
  // 지뢰 보호 발판: 오른쪽 아래에 작은 방패
  if (shield) {
    r.rect(14, 19, 5, 4, '#3a56ff');
    r.rect(15, 23, 3, 1, '#3a56ff');
    r.put(16, 24, '#2338c4');
    r.put(15, 21, '#ffffff');
    r.put(16, 22, '#ffffff');
    r.put(17, 21, '#ffffff');
    r.put(18, 20, '#ffffff');
  }
  return r;
}

/** 닫힌 칸(4×4) 안 무늬 — 게임 칸의 CSS 무늬와 같은 모양 */
function pattern(r: Raster, l: TileLook, x: number, y: number): void {
  const ink = mixHex(l.closed, '#ffffff', 0.6);
  switch (l.pattern) {
    case 'dots':
      r.put(x + 1, y + 1, ink);
      r.put(x + 3, y + 3, ink);
      break;
    case 'check':
      r.rect(x, y, 2, 2, ink);
      r.rect(x + 2, y + 2, 2, 2, ink);
      break;
    case 'stars':
      r.put(x + 1, y + 1, '#ffe066');
      r.put(x + 3, y + 3, '#ffffff');
      break;
    case 'diamond':
      r.put(x + 2, y + 1, ink);
      r.put(x + 1, y + 2, ink);
      r.put(x + 3, y + 2, ink);
      r.put(x + 2, y + 3, ink);
      break;
    case 'leaf':
      r.rect(x + 1, y + 2, 2, 1, ink);
      break;
    default:
      break;
  }
}

/** 지뢰찾기 맵: 맵 바탕(위→아래 계단 색) · 열린 칸 3×2와 숨은 동전 · 아래쪽에 맵 그림 */
function drawMap(l: MapLook, extra: number, glow: boolean): Raster {
  const colors = l.bg.match(/#[0-9a-fA-F]{6}/g) ?? ['#eef1f6'];
  const top = colors[0];
  const bottom = colors[colors.length - 1];
  const r = new Raster(W, H, top);
  // 그라데이션 바탕을 다섯 칸짜리 띠로 끊어 칠한다
  for (let band = 0; band < 5; band++) r.rect(0, band * 5, W, 5, mixHex(top, bottom, band / 4));
  if (l.motif) {
    const { map, color } = iconGrid(l.motif);
    const fade = mixHex(top, bottom, 0.85);
    r.stamp(map, 2, 10, (ch) => {
      const c = color(ch);
      return c ? mixHex(c, fade, 0.3) : undefined;
    });
  }
  // 숨은 동전 수: 맵이 좋을수록 많다(기본 1 · 숲 3 · 섬 4 · 신전 6)
  const coins = extra > 0 ? Math.min(6, 2 + extra) : 1;
  const coin = CURRENCY.minesweeper;
  const order = [0, 4, 2, 3, 5, 1];
  for (let i = 0; i < 6; i++) {
    const x = 1 + (i % 3) * 6;
    const y = 2 + Math.floor(i / 3) * 6;
    r.rect(x, y, 6, 6, mixHex(top, '#000000', 0.12));
    r.rect(x, y, 5, 5, '#ffffff');
    if (order.indexOf(i) < coins) {
      if (glow) r.rect(x, y, 5, 5, mixHex('#ffffff', coin.face, 0.35));
      r.rect(x + 1, y + 1, 3, 3, coin.side);
      r.rect(x + 1, y + 1, 2, 2, coin.face);
      r.put(x + 1, y + 1, coin.light);
    }
  }
  return r;
}
