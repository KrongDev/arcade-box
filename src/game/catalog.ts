import type { GameId } from './registry';

/**
 * 아이템 카탈로그 — 모든 아이템은 고유 ID를 가진다. v1은 앱 번들에 들어 있고,
 * v2에서는 같은 형식을 서버에서 읽어 온다.
 * 유료 아이템은 콘솔에 등록하는 인앱결제 상품 ID(iapSku)와 1:1로 연결한다.
 *
 * 등급: 무료는 기본, 코인 아이템은 값에 따라 고급·희귀, 유료는 전설.
 * 능력은 코인 얻는 양에만 영향을 준다(점수·순위에는 영향 없음). 지뢰 보호는 판을 이어 가게 해 주지만
 * 그 판 점수가 깎인다(서버 server/src/domain.ts MS_SCORE.shieldPercent와 같다).
 * 능력 수치를 바꾸면 서버의 코인 상한(MAX_COIN_BONUS·MAP_EXTRA_COINS_MAX)도 같이 본다.
 */

export interface PinballTableLook {
  page: string;
  table: string;
  tableGlow: string;
  wall: string;
  bumper: string;
  bumperRing: string;
  bumperFlash: string;
  coin: string;
  coinRing: string;
  flipper: string;
  plunger: string;
}

export interface BallLook {
  ballLight: string;
  ballDark: string;
}

/** 지뢰찾기 발판 문양 — 칸 색과 닫힌 칸 무늬 */
export interface TileLook {
  closed: string;
  closedEdge: string;
  open: string;
  openEdge: string;
  coinInk: string;
  pattern: 'none' | 'dots' | 'check' | 'stars' | 'diamond' | 'leaf';
}

/** 지뢰찾기 맵 — 판 바탕과 그 위 글자색, 구석 장식 */
export interface MapLook {
  bg: string;
  ink: string;
  inkSub: string;
  /** 판 바탕 구석에 흐리게 놓는 이모지 */
  /** 판 구석에 크게 깔리는 그림(ArcadeIcon 이름) */
  motif: 'pine' | 'palm' | 'temple' | null;
}

export interface Ability {
  /** 핀볼 판: 판 위에 동전이 나오는 빈도 +비율 */
  coinSpawn?: number;
  /** 핀볼 공·지뢰찾기 발판: 동전 하나에서 받는 코인 +비율 */
  coinValue?: number;
  /** 지뢰찾기 발판: 지뢰를 밟아도 한 번 막아 준다 */
  shield?: number;
  /** 지뢰찾기 맵: 숨은 동전 수 +개 (초급·중급·고급) */
  extraCoins?: [number, number, number];
}

export interface Effect {
  /** 핀볼 공 꼬리 */
  trail?: 'sparkle' | 'fire' | 'lightning';
  /** 핀볼 공이 부딪힐 때 */
  hit?: 'fire' | 'boom';
  /** 핀볼 판 배경 */
  table?: 'neon' | 'stars';
  /** 지뢰찾기 칸이 열릴 때 */
  open?: 'sparkle' | 'gold';
  /** 지뢰찾기 동전이 빛남 */
  coinGlow?: boolean;
}

export type Price = { type: 'free' } | { type: 'coin'; amount: number } | { type: 'paid'; krw: number; iapSku: string | null };

interface ItemBase {
  id: string;
  game: GameId;
  name: string;
  price: Price;
  ability?: Ability;
  effect?: Effect;
}

export type ShopItem =
  | (ItemBase & { slot: 'table'; look: PinballTableLook })
  | (ItemBase & { slot: 'ball'; look: BallLook })
  | (ItemBase & { slot: 'tile'; look: TileLook })
  | (ItemBase & { slot: 'map'; look: MapLook });

export type Slot = ShopItem['slot'];

export const SLOT_NAMES: Record<Slot, string> = { table: '판', ball: '공', tile: '발판', map: '맵' };

const FREE: Price = { type: 'free' };
const coin = (amount: number): Price => ({ type: 'coin', amount });
/** iapSku는 콘솔에 인앱결제 상품을 등록한 뒤 채운다 */
const paid = (krw: number): Price => ({ type: 'paid', krw, iapSku: null });

export const CATALOG: ShopItem[] = [
  // ── 핀볼 — 판: 판 위 동전이 더 자주 나와요 ──
  {
    id: 'pinball.table.classic',
    game: 'pinball',
    slot: 'table',
    name: '기본 판',
    price: FREE,
    look: {
      page: '#12142a',
      table: '#1b1d38',
      tableGlow: '#262a52',
      wall: '#a594ff',
      bumper: '#ff5c86',
      bumperRing: '#ffc2d2',
      bumperFlash: '#fff4f7',
      coin: '#ffc53d',
      coinRing: '#fff0b3',
      flipper: '#f2f4f6',
      plunger: '#5d6194',
    },
  },
  {
    id: 'pinball.table.sunset',
    game: 'pinball',
    slot: 'table',
    name: '노을 판',
    price: coin(1000),
    ability: { coinSpawn: 0.05 },
    look: {
      page: '#24121b',
      table: '#3a1d2a',
      tableGlow: '#5a2a35',
      wall: '#ffb26b',
      bumper: '#ff6b4a',
      bumperRing: '#ffd3c2',
      bumperFlash: '#fff5ef',
      coin: '#ffd84d',
      coinRing: '#fff3b8',
      flipper: '#fff4e6',
      plunger: '#7a4a52',
    },
  },
  {
    id: 'pinball.table.forest',
    game: 'pinball',
    slot: 'table',
    name: '숲 판',
    price: coin(1500),
    ability: { coinSpawn: 0.1 },
    look: {
      page: '#0c1a13',
      table: '#163024',
      tableGlow: '#22462f',
      wall: '#8ee08a',
      bumper: '#f7c948',
      bumperRing: '#fff0b0',
      bumperFlash: '#fffbe6',
      coin: '#ffd43b',
      coinRing: '#fff3bf',
      flipper: '#eef7ee',
      plunger: '#3f6b4f',
    },
  },
  {
    id: 'pinball.table.candy',
    game: 'pinball',
    slot: 'table',
    name: '사탕 판',
    price: coin(3000),
    ability: { coinSpawn: 0.15 },
    look: {
      page: '#2a1030',
      table: '#3d1747',
      tableGlow: '#5e2470',
      wall: '#ff9ff3',
      bumper: '#48dbfb',
      bumperRing: '#c8f4ff',
      bumperFlash: '#f0fcff',
      coin: '#feca57',
      coinRing: '#fff1c9',
      flipper: '#fff0fb',
      plunger: '#7a3d86',
    },
  },
  {
    id: 'pinball.table.neon',
    game: 'pinball',
    slot: 'table',
    name: '네온 시티 판',
    price: paid(3000),
    ability: { coinSpawn: 0.2 },
    effect: { table: 'neon' },
    look: {
      page: '#0b0b12',
      table: '#15151f',
      tableGlow: '#24203a',
      wall: '#00e5c0',
      bumper: '#ff3df2',
      bumperRing: '#ffc2fb',
      bumperFlash: '#fff0fe',
      coin: '#faff5c',
      coinRing: '#fdffc2',
      flipper: '#e9f9ff',
      plunger: '#3a3a55',
    },
  },
  {
    id: 'pinball.table.galaxy',
    game: 'pinball',
    slot: 'table',
    name: '은하수 판',
    price: paid(5000),
    ability: { coinSpawn: 0.3 },
    effect: { table: 'stars' },
    look: {
      page: '#0a071c',
      table: '#140f33',
      tableGlow: '#2c1f63',
      wall: '#c3a6ff',
      bumper: '#7c4dff',
      bumperRing: '#e2d6ff',
      bumperFlash: '#ffffff',
      coin: '#ffe08a',
      coinRing: '#fff6d6',
      flipper: '#f5f0ff',
      plunger: '#4a3d80',
    },
  },

  // ── 핀볼 — 공: 동전을 주울 때 코인을 더 받아요 ──
  { id: 'pinball.ball.silver', game: 'pinball', slot: 'ball', name: '은색 공', price: FREE, look: { ballLight: '#ffffff', ballDark: '#9aa3b8' } },
  {
    id: 'pinball.ball.gold',
    game: 'pinball',
    slot: 'ball',
    name: '금색 공',
    price: coin(1000),
    ability: { coinValue: 0.05 },
    look: { ballLight: '#fff6cc', ballDark: '#d4a017' },
  },
  {
    id: 'pinball.ball.emerald',
    game: 'pinball',
    slot: 'ball',
    name: '에메랄드 공',
    price: coin(2500),
    ability: { coinValue: 0.1 },
    look: { ballLight: '#d3fbe8', ballDark: '#0f9d6b' },
  },
  {
    id: 'pinball.ball.ruby',
    game: 'pinball',
    slot: 'ball',
    name: '루비 공',
    price: paid(1000),
    ability: { coinValue: 0.15 },
    effect: { trail: 'sparkle' },
    look: { ballLight: '#ffd6dc', ballDark: '#c2185b' },
  },
  {
    id: 'pinball.ball.fire',
    game: 'pinball',
    slot: 'ball',
    name: '불꽃 공',
    price: paid(2500),
    ability: { coinValue: 0.2 },
    effect: { trail: 'fire', hit: 'fire' },
    look: { ballLight: '#fff3bf', ballDark: '#e8590c' },
  },
  {
    id: 'pinball.ball.thunder',
    game: 'pinball',
    slot: 'ball',
    name: '번개 공',
    price: paid(3900),
    ability: { coinValue: 0.3 },
    effect: { trail: 'lightning', hit: 'boom' },
    look: { ballLight: '#e7f5ff', ballDark: '#1c7ed6' },
  },

  // ── 지뢰찾기 — 발판 문양: 코인 더 받기·지뢰 보호 ──
  {
    id: 'minesweeper.tile.basic',
    game: 'minesweeper',
    slot: 'tile',
    name: '기본 발판',
    price: FREE,
    look: { closed: '#c7d1e2', closedEdge: '#b4bfd3', open: '#ffffff', openEdge: '#e3e8f0', coinInk: '#9a6700', pattern: 'none' },
  },
  {
    id: 'minesweeper.tile.mint',
    game: 'minesweeper',
    slot: 'tile',
    name: '민트 발판',
    price: coin(1000),
    ability: { coinValue: 0.1 },
    look: { closed: '#a8dcc6', closedEdge: '#86c7ab', open: '#ffffff', openEdge: '#d6ece2', coinInk: '#8a5a00', pattern: 'dots' },
  },
  {
    id: 'minesweeper.tile.peach',
    game: 'minesweeper',
    slot: 'tile',
    name: '복숭아 발판',
    price: coin(1500),
    ability: { coinValue: 0.2 },
    look: { closed: '#f5c2a8', closedEdge: '#e5a487', open: '#fffaf6', openEdge: '#f3e0d6', coinInk: '#8a5a00', pattern: 'leaf' },
  },
  {
    id: 'minesweeper.tile.check',
    game: 'minesweeper',
    slot: 'tile',
    name: '체크무늬 발판',
    price: coin(3000),
    ability: { shield: 1 },
    look: { closed: '#b9b4f5', closedEdge: '#9a93e6', open: '#ffffff', openEdge: '#e4e1fb', coinInk: '#8a5a00', pattern: 'check' },
  },
  {
    id: 'minesweeper.tile.night',
    game: 'minesweeper',
    slot: 'tile',
    name: '한밤 발판',
    price: paid(3000),
    ability: { coinValue: 0.2, shield: 1 },
    effect: { open: 'sparkle' },
    look: { closed: '#3a4157', closedEdge: '#262c3d', open: '#f6f7fb', openEdge: '#dfe3ec', coinInk: '#8a5a00', pattern: 'stars' },
  },
  {
    id: 'minesweeper.tile.gold',
    game: 'minesweeper',
    slot: 'tile',
    name: '황금 발판',
    price: paid(4900),
    ability: { coinValue: 0.4, shield: 1 },
    effect: { open: 'gold' },
    look: { closed: '#f2c94c', closedEdge: '#d4a017', open: '#fffbea', openEdge: '#f5e6b3', coinInk: '#7a4f00', pattern: 'diamond' },
  },

  // ── 지뢰찾기 — 맵: 숨은 동전 수가 달라요 ──
  {
    id: 'minesweeper.map.basic',
    game: 'minesweeper',
    slot: 'map',
    name: '기본 맵',
    price: FREE,
    look: { bg: '#eef1f6', ink: '#1f1a3d', inkSub: '#5d5878', motif: null },
  },
  {
    id: 'minesweeper.map.forest',
    game: 'minesweeper',
    slot: 'map',
    name: '숲속 맵',
    price: coin(2000),
    ability: { extraCoins: [1, 2, 3] },
    look: { bg: 'linear-gradient(180deg, #e6f6ea 0%, #d3eedc 100%)', ink: '#163024', inkSub: '#3d6650', motif: 'pine' },
  },
  {
    id: 'minesweeper.map.island',
    game: 'minesweeper',
    slot: 'map',
    name: '보물섬 맵',
    price: coin(4000),
    ability: { extraCoins: [2, 4, 6] },
    look: { bg: 'linear-gradient(180deg, #e3f6ff 0%, #fff3d6 100%)', ink: '#14304a', inkSub: '#4a6a85', motif: 'palm' },
  },
  {
    id: 'minesweeper.map.temple',
    game: 'minesweeper',
    slot: 'map',
    name: '황금 사원 맵',
    price: paid(3900),
    ability: { extraCoins: [4, 7, 10] },
    effect: { coinGlow: true },
    look: { bg: 'linear-gradient(180deg, #fff4d1 0%, #ffe08a 100%)', ink: '#3d2a00', inkSub: '#7a5a14', motif: 'temple' },
  },
];

export function getItem(id: string): ShopItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export function slotKey(game: GameId, slot: Slot): string {
  return `${game}.${slot}`;
}

export function defaultItem(game: GameId, slot: Slot): ShopItem {
  const item = CATALOG.find((i) => i.game === game && i.slot === slot && i.price.type === 'free');
  if (!item) throw new Error(`no default item for ${game}.${slot}`);
  return item;
}

export function slotsOf(game: GameId): Slot[] {
  return Array.from(new Set(CATALOG.filter((i) => i.game === game).map((i) => i.slot)));
}

export type Tier = 'basic' | 'rare' | 'epic' | 'legend';

export const TIER_NAMES: Record<Tier, string> = { basic: '기본', rare: '고급', epic: '희귀', legend: '전설' };

/** 등급: 무료 기본, 코인 2,000 미만 고급, 그 이상 희귀, 유료 전설 */
export function tierOf(item: ShopItem): Tier {
  if (item.price.type === 'free') return 'basic';
  if (item.price.type === 'paid') return 'legend';
  return item.price.amount < 2000 ? 'rare' : 'epic';
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 능력 설명 한 줄씩 — 상점 카드와 장착 안내에 쓴다 */
export function abilityLines(item: ShopItem): string[] {
  const a = item.ability;
  if (!a) return [];
  const out: string[] = [];
  if (a.coinSpawn) out.push(`판 위 동전 ${pct(a.coinSpawn)} 더 자주`);
  if (a.coinValue) out.push(`동전 코인 +${pct(a.coinValue)}`);
  if (a.shield) out.push(`지뢰 보호 ${a.shield}번`);
  if (a.extraCoins) out.push(`숨은 동전 +${a.extraCoins.join('·')}개`);
  return out;
}

/** 이펙트 설명 — 유료 아이템 카드에 쓴다 */
export function effectLine(item: ShopItem): string | null {
  const e = item.effect;
  if (!e) return null;
  if (e.trail === 'fire') return '불꽃 꼬리 · 부딪히면 불꽃';
  if (e.trail === 'lightning') return '번개 꼬리 · 부딪히면 쾅';
  if (e.trail === 'sparkle') return '반짝이는 꼬리';
  if (e.table === 'neon') return '네온이 맥박처럼 빛나요';
  if (e.table === 'stars') return '별이 반짝이고 별똥별이 지나가요';
  if (e.open === 'sparkle') return '열 때 반짝임';
  if (e.open === 'gold') return '열 때 금가루';
  if (e.coinGlow) return '동전이 금빛으로 빛나요';
  return null;
}
