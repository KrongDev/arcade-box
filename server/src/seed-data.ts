/**
 * 처음 넣는 자료 (스펙 5.13, 표 K12). v1의 값을 그대로 옮겼다:
 * - 순위표와 판당 코인 상한: v1 `domain.ts`의 BOARDS (400·400·69·131·220, 지뢰찾기는 초급 → 중급 → 고급과 판 크기)
 * - 아이템: v1 `domain.ts`의 ITEMS. 이름은 앱의 `src/game/catalog.ts`, 유료 8개의 설명과 판매가(원)는 `docs/iap-products.md`
 *
 * 게임은 live로 넣지만 묶음 버전은 없다 (2번 작업에서 올린다). 게임 가격 3000코인은 임시값이고 출시 전에 운영자가 정한다.
 * 유료 아이템은 스토어 결제가 붙을 때까지 hidden이다 (운영자 지급은 된다).
 */
import type { NewBoard } from './play/index.ts';
import type { NewProduct } from './product/index.ts';

export interface SeedGame {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
}

/** 상품과 그 가격 (적지 않은 통화는 가격이 없다) */
export type SeedProduct = NewProduct & { prices: { COIN?: number; KRW?: number } };

/** 게임 이름과 설명은 앱의 `src/game/registry.ts`와 같다 */
const GAMES: SeedGame[] = [
  { id: 'pinball', name: '핀볼', description: '플리퍼로 공을 튕겨 점수를 모아요', sortOrder: 1 },
  { id: 'minesweeper', name: '지뢰찾기', description: '숫자를 보고 지뢰를 피해 칸을 열어요', sortOrder: 2 },
  { id: 'breakout', name: '벽돌깨기', description: '공을 튕겨 벽돌을 모두 깨요', sortOrder: 3 },
];

/** 점수 게임(핀볼·벽돌깨기)의 한 판 점수 상한 — v1 `MAX_SCORE`. 지뢰찾기는 다시 계산한 점수가 이 안이어야 한다 */
const MAX_SCORE = 5_000_000;

/** 앞 단계가 있는 순위표는 앞 단계보다 뒤에 둔다 (그 순서로 만든다) */
const BOARDS: NewBoard[] = [
  { id: 'pinball', gameId: 'pinball', label: '핀볼', ordering: 'higher', minValue: 0, maxValue: MAX_SCORE, maxCoinsPerRun: 400 },
  { id: 'breakout', gameId: 'breakout', label: '벽돌깨기', ordering: 'higher', minValue: 0, maxValue: MAX_SCORE, maxCoinsPerRun: 400 },
  // 지뢰찾기 판 크기: 초급 8×10·지뢰 10, 중급 12×18·36, 고급 16×26·80. par는 점수 계산의 기준 시간(초)
  {
    id: 'minesweeper.easy',
    gameId: 'minesweeper',
    label: '초급',
    ordering: 'higher',
    minValue: 0,
    maxValue: MAX_SCORE,
    maxCoinsPerRun: 69,
    validator: 'minesweeper',
    validatorParams: { safe: 70, mines: 10, par: 180 },
    sortOrder: 1,
  },
  {
    id: 'minesweeper.normal',
    gameId: 'minesweeper',
    label: '중급',
    ordering: 'higher',
    minValue: 0,
    maxValue: MAX_SCORE,
    maxCoinsPerRun: 131,
    requiresBoardId: 'minesweeper.easy',
    validator: 'minesweeper',
    validatorParams: { safe: 180, mines: 36, par: 480 },
    sortOrder: 2,
  },
  {
    id: 'minesweeper.hard',
    gameId: 'minesweeper',
    label: '고급',
    ordering: 'higher',
    minValue: 0,
    maxValue: MAX_SCORE,
    maxCoinsPerRun: 220,
    requiresBoardId: 'minesweeper.normal',
    validator: 'minesweeper',
    validatorParams: { safe: 336, mines: 80, par: 900 },
    sortOrder: 3,
  },
];

/** 게임 가격(임시). 출시 전에 운영자가 `price set`으로 정한다 */
const GAME_PRICE = 3000;

const GAME_PRODUCTS: SeedProduct[] = [
  { id: 'game.pinball', kind: 'game', name: '핀볼', gameId: 'pinball', access: 'everyone', status: 'on_sale', sortOrder: 1, prices: {} },
  { id: 'game.minesweeper', kind: 'game', name: '지뢰찾기', gameId: 'minesweeper', access: 'purchase', status: 'on_sale', sortOrder: 2, prices: { COIN: GAME_PRICE } },
  { id: 'game.breakout', kind: 'game', name: '벽돌깨기', gameId: 'breakout', access: 'purchase', status: 'on_sale', sortOrder: 3, prices: { COIN: GAME_PRICE } },
];

type ItemPrice = { free: true } | { coin: number } | { krw: number; description: string };

const free = { free: true } as const;
const coin = (amount: number) => ({ coin: amount });
/** 유료 아이템: 판매가(부가세 포함, 원)와 스토어에 올릴 설명 (docs/iap-products.md) */
const paid = (krw: number, description: string) => ({ krw, description });

/** v1 ITEMS의 순서 그대로: [아이템 ID, 이름, 가격] */
const ITEMS: Array<[id: string, name: string, price: ItemPrice]> = [
  ['pinball.table.classic', '기본 판', free],
  ['pinball.table.sunset', '노을 판', coin(1000)],
  ['pinball.table.forest', '숲 판', coin(1500)],
  ['pinball.table.candy', '사탕 판', coin(3000)],
  ['pinball.table.neon', '네온 시티 판', paid(3300, '핀볼 판 꾸미기 · 판 위 동전 20% 더 자주 · 네온 빛 · 평생 소장')],
  ['pinball.table.galaxy', '은하수 판', paid(5500, '핀볼 판 꾸미기 · 판 위 동전 30% 더 자주 · 별똥별 · 평생 소장')],
  ['pinball.ball.silver', '은색 공', free],
  ['pinball.ball.gold', '금색 공', coin(1000)],
  ['pinball.ball.emerald', '에메랄드 공', coin(2500)],
  ['pinball.ball.ruby', '루비 공', paid(1100, '핀볼 공 꾸미기 · 동전 코인 +15% · 반짝이는 꼬리 · 평생 소장')],
  ['pinball.ball.fire', '불꽃 공', paid(2200, '핀볼 공 꾸미기 · 동전 코인 +20% · 불꽃 꼬리 · 평생 소장')],
  ['pinball.ball.thunder', '번개 공', paid(4400, '핀볼 공 꾸미기 · 동전 코인 +30% · 번개 꼬리 · 평생 소장')],
  ['minesweeper.tile.basic', '기본 발판', free],
  ['minesweeper.tile.mint', '민트 발판', coin(1000)],
  ['minesweeper.tile.peach', '복숭아 발판', coin(1500)],
  ['minesweeper.tile.check', '체크무늬 발판', coin(3000)],
  ['minesweeper.tile.night', '한밤 발판', paid(3300, '지뢰찾기 발판 · 동전 코인 +20% · 판마다 지뢰 1번 막기 · 평생 소장')],
  ['minesweeper.tile.gold', '황금 발판', paid(5500, '지뢰찾기 발판 · 동전 코인 +40% · 판마다 지뢰 1번 막기 · 평생 소장')],
  ['minesweeper.map.basic', '기본 맵', free],
  ['minesweeper.map.forest', '숲속 맵', coin(2000)],
  ['minesweeper.map.island', '보물섬 맵', coin(4000)],
  ['minesweeper.map.temple', '황금 사원 맵', paid(4400, '지뢰찾기 맵 · 숨은 동전 4·7·10개 더 · 금빛 동전 · 평생 소장')],
  ['breakout.paddle.basic', '기본 패들', free],
  ['breakout.paddle.mint', '민트 패들', coin(1000)],
  ['breakout.paddle.flame', '불꽃 패들', coin(2500)],
  ['breakout.bricks.basic', '기본 벽돌', free],
  ['breakout.bricks.pastel', '파스텔 벽돌', coin(1500)],
  ['breakout.bricks.gem', '보석 벽돌', coin(3000)],
];

/** 아이템 ID는 `<게임>.<자리>.<이름>`이다 */
function itemProduct([id, name, price]: (typeof ITEMS)[number], index: number): SeedProduct {
  const [gameId, slot] = id.split('.');
  const base = { id, kind: 'item' as const, name, gameId, slot, sortOrder: index + 1 };
  if ('free' in price) return { ...base, access: 'everyone', status: 'on_sale', prices: {} };
  if ('coin' in price) return { ...base, access: 'purchase', status: 'on_sale', prices: { COIN: price.coin } };
  return { ...base, description: price.description, access: 'purchase', status: 'hidden', prices: { KRW: price.krw } };
}

export const SEED: { games: SeedGame[]; boards: NewBoard[]; products: SeedProduct[] } = {
  games: GAMES,
  boards: BOARDS,
  products: [...GAME_PRODUCTS, ...ITEMS.map(itemProduct)],
};
