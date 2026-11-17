import type { GameId } from './registry';

/**
 * 아이템 카탈로그 — 모든 아이템은 고유 ID를 가진다. v1은 앱 번들에 들어 있고,
 * v2에서는 같은 형식을 서버에서 읽어 온다.
 * 유료 아이템은 콘솔에 등록하는 인앱결제 상품 ID(iapSku)와 1:1로 연결한다.
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

export interface TileLook {
  bg: string;
  closed: string;
  closedEdge: string;
  open: string;
  openEdge: string;
  /** 판 바탕 위 글자색 (HUD) */
  ink: string;
  inkSub: string;
  coinInk: string;
}

export type Price = { type: 'free' } | { type: 'coin'; amount: number } | { type: 'paid'; krw: number; iapSku: string | null };

interface ItemBase {
  id: string;
  game: GameId;
  name: string;
  price: Price;
}

export type ShopItem =
  | (ItemBase & { slot: 'table'; look: PinballTableLook })
  | (ItemBase & { slot: 'ball'; look: BallLook })
  | (ItemBase & { slot: 'tile'; look: TileLook });

export type Slot = ShopItem['slot'];

export const SLOT_NAMES: Record<Slot, string> = { table: '판', ball: '공', tile: '타일' };

const FREE: Price = { type: 'free' };
const coin = (amount: number): Price => ({ type: 'coin', amount });
/** iapSku는 콘솔에 인앱결제 상품을 등록한 뒤 채운다 */
const paid = (krw: number): Price => ({ type: 'paid', krw, iapSku: null });

const LIGHT_INK = { ink: '#191f28', inkSub: '#4e5968', coinInk: '#9a6700' };

export const CATALOG: ShopItem[] = [
  // 핀볼 — 판
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
    id: 'pinball.table.neon',
    game: 'pinball',
    slot: 'table',
    name: '네온 시티 판',
    price: paid(3000),
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
  // 핀볼 — 공
  { id: 'pinball.ball.silver', game: 'pinball', slot: 'ball', name: '은색 공', price: FREE, look: { ballLight: '#ffffff', ballDark: '#9aa3b8' } },
  { id: 'pinball.ball.gold', game: 'pinball', slot: 'ball', name: '금색 공', price: coin(1000), look: { ballLight: '#fff6cc', ballDark: '#d4a017' } },
  { id: 'pinball.ball.ruby', game: 'pinball', slot: 'ball', name: '루비 공', price: paid(1000), look: { ballLight: '#ffd6dc', ballDark: '#c2185b' } },
  // 지뢰찾기 — 타일
  {
    id: 'minesweeper.tile.basic',
    game: 'minesweeper',
    slot: 'tile',
    name: '기본 타일',
    price: FREE,
    look: { bg: '#eef1f6', closed: '#c7d1e2', closedEdge: '#b4bfd3', open: '#ffffff', openEdge: '#e3e8f0', ...LIGHT_INK },
  },
  {
    id: 'minesweeper.tile.mint',
    game: 'minesweeper',
    slot: 'tile',
    name: '민트 타일',
    price: coin(1000),
    look: { bg: '#ecf7f3', closed: '#b2dcc9', closedEdge: '#94c8b1', open: '#ffffff', openEdge: '#d6ece2', ...LIGHT_INK },
  },
  {
    id: 'minesweeper.tile.peach',
    game: 'minesweeper',
    slot: 'tile',
    name: '복숭아 타일',
    price: coin(1500),
    look: { bg: '#fdf2ec', closed: '#f5c9b3', closedEdge: '#e8b096', open: '#ffffff', openEdge: '#f3e0d6', ...LIGHT_INK },
  },
  {
    id: 'minesweeper.tile.night',
    game: 'minesweeper',
    slot: 'tile',
    name: '한밤 타일',
    price: paid(3000),
    look: {
      bg: '#1c2030',
      closed: '#3a4157',
      closedEdge: '#2b3144',
      open: '#f1f3f7',
      openEdge: '#d9dee8',
      ink: '#f2f4f6',
      inkSub: '#b9bdd6',
      coinInk: '#ffc53d',
    },
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
