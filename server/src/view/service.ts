import { getSettings, getUser, listProviders, type Provider, type Settings } from '../account/index.ts';
import { iconUrl } from '../asset/index.ts';
import { listEquipped, listOwned } from '../entitlement/index.ts';
import { listLiveGames, type LiveVersion } from '../game/index.ts';
import { boardStats, listAllBoards, runCoinStatus, type Board, type Ordering } from '../play/index.ts';
import { listCatalogProducts, type Currency, type ProductAccess, type ProductKind } from '../product/index.ts';
import { rewardStatus } from '../reward/index.ts';
import type { Db, Q } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { kstDate } from '../shared/time.ts';
import { getBalance } from '../wallet/index.ts';

export interface CatalogGame {
  id: string;
  name: string;
  description: string;
  iconUrl: string | null;
  sortOrder: number;
  /** 이 게임의 게임 상품. 팔리는(on_sale) 것만 보이고 아니면 null. 가격은 켜진 COIN 가격 */
  product: { id: string; access: ProductAccess; price: { currency: 'COIN'; amount: number } | null } | null;
  liveVersion: LiveVersion | null;
  boards: Array<{ id: string; label: string; ordering: Ordering }>;
}

export interface CatalogProduct {
  id: string;
  kind: ProductKind;
  name: string;
  description: string;
  iconUrl: string | null;
  gameId: string | null;
  slot: string | null;
  access: ProductAccess;
  prices: Array<{ currency: Currency; amount: number }>;
}

export interface Catalog {
  serverDate: string;
  games: CatalogGame[];
  products: CatalogProduct[];
}

/**
 * 게임 목록 (`GET /v2/catalog`, 스펙 5.8). live 게임과 on_sale 상품만 담는다.
 * 누구에게나 같은 답이라 캐시를 함께 쓴다: 사용자에 따라 달라지는 값을 넣지 않는다.
 * 게임에 딸린 상품(item·game)은 그 게임이 live일 때만 담는다 (아직 내보내지 않은 게임을 목록으로 알리지 않는다).
 */
export async function catalog(q: Q, now: Date): Promise<Catalog> {
  const liveGames = await listLiveGames(q);
  const live = new Set(liveGames.map((g) => g.id));
  const onSale = (await listCatalogProducts(q)).filter((p) => p.gameId === null || live.has(p.gameId));

  // 순위표는 한 쿼리로 읽어 게임별로 나눈다 (게임 수만큼 쿼리를 보내지 않게)
  const boardsByGame = new Map<string, Board[]>();
  for (const b of await listAllBoards(q)) boardsByGame.set(b.gameId, [...(boardsByGame.get(b.gameId) ?? []), b]);

  const games: CatalogGame[] = liveGames.map((g) => {
    const product = onSale.find((p) => p.kind === 'game' && p.gameId === g.id);
    const coin = product?.prices.find((p) => p.currency === 'COIN');
    const boards = boardsByGame.get(g.id) ?? [];
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      iconUrl: iconUrl(g.iconPath),
      sortOrder: g.sortOrder,
      product: product ? { id: product.id, access: product.access, price: coin ? { currency: 'COIN', amount: coin.amount } : null } : null,
      liveVersion: g.liveVersion,
      boards: boards.map((b) => ({ id: b.id, label: b.label, ordering: b.ordering })),
    };
  });

  const products: CatalogProduct[] = onSale.map((p) => ({
    id: p.id,
    kind: p.kind,
    name: p.name,
    description: p.description,
    iconUrl: iconUrl(p.iconPath),
    gameId: p.gameId,
    slot: p.slot,
    access: p.access,
    prices: p.prices.map((price) => ({ currency: price.currency, amount: price.amount })),
  }));

  return { serverDate: kstDate(now), games, products };
}

export interface Me {
  userId: string;
  providers: Provider[];
  balance: number;
  /** 사거나 지급받은(회수되지 않은) 상품. 누구나 가진(everyone·on_sale) 상품은 목록에서 안다 */
  owned: string[];
  equipped: Array<{ gameId: string; slot: string; productId: string }>;
  settings: Settings;
  rewards: { attendanceClaimedToday: boolean; adRewardsLeft: number };
  /** 오늘 판으로 번 코인과 하루 상한 (상한이 없으면 null) */
  runCoins: { earnedToday: number; limit: number | null };
  boards: Record<string, { best: number | null; bestSeconds: number | null; cleared: boolean }>;
  serverDate: string;
}

/**
 * 내 상태 한 번에 받기 (`GET /v2/me`, 표 K21). 내 것만 준다.
 * 한 시점의 모습이 되게 읽기 전용 트랜잭션(REPEATABLE READ) 하나에서 읽는다 (잔액과 가진 것이 서로 다른 순간의 값이 되지 않게).
 * 그사이 지워진 사용자면 `401 unauthorized`.
 */
export async function me(db: Db, userId: string, now: Date): Promise<Me> {
  return db.transaction(
    async (tx) => {
      if ((await getUser(tx, userId))?.status !== 'active') throw new RuleError(401, 'unauthorized', '로그인이 필요해요');
      return {
        userId,
        providers: await listProviders(tx, userId),
        balance: await getBalance(tx, userId),
        owned: await listOwned(tx, userId),
        equipped: await listEquipped(tx, userId),
        settings: await getSettings(tx, userId),
        rewards: await rewardStatus(tx, userId, now),
        runCoins: await runCoinStatus(tx, userId, now),
        boards: await boardStats(tx, userId),
        serverDate: kstDate(now),
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
