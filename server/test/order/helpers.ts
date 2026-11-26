import { eq, sql } from 'drizzle-orm';
import { findSession } from '../../src/account/index.ts';
import { audit } from '../../src/admin/index.ts';
import { createGame, updateGame, type LiveVersion } from '../../src/game/index.ts';
import { games, gameVersions } from '../../src/game/schema.ts';
import { purchaseWithCoins, refundCoinOrder, routes } from '../../src/order/index.ts';
import { orderEvents, orders } from '../../src/order/schema.ts';
import { createProduct, setPrice, type NewProduct } from '../../src/product/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { createHandler } from '../../src/shared/http/index.ts';
import type { Clock } from '../../src/shared/time.ts';
import { applyCoins } from '../../src/wallet/index.ts';
import { testConfig } from '../account/helpers.ts';
import type { Handler } from '../helpers/http.ts';

/** 2026-11-26 12:00 KST */
export const NOW = new Date('2026-11-26T03:00:00Z');
export const DAY_MS = 24 * 60 * 60 * 1000;

/** `assert.rejects`에 넣는 확인: 이 상태와 코드의 `RuleError`인지 */
export const rule = (status: number, code: string) => (err: unknown) => err instanceof RuleError && err.status === status && err.code === code;

/** 300코인짜리 아이템 열 개 (동시에 여러 개를 사는 테스트용) */
export const CHEAP = Array.from({ length: 10 }, (_, i) => `pinball.ball.c${i}`);

const PRODUCTS: Array<NewProduct & { coin?: number; krw?: number }> = [
  { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'everyone', gameId: 'pinball', status: 'on_sale' },
  { id: 'game.minesweeper', kind: 'game', name: '지뢰찾기', access: 'purchase', gameId: 'minesweeper', status: 'on_sale', coin: 3000 },
  { id: 'pinball.table.sunset', kind: 'item', name: '노을', access: 'purchase', gameId: 'pinball', slot: 'table', status: 'on_sale', coin: 300 },
  // 팔 수 없는 것들: 숨김, 누구나 가진 것, COIN 가격이 없는 것, 코인 묶음, 초안, 판매 종료
  { id: 'pinball.table.neon', kind: 'item', name: '네온', access: 'purchase', gameId: 'pinball', slot: 'table', status: 'hidden', coin: 500 },
  { id: 'pinball.table.classic', kind: 'item', name: '클래식', access: 'everyone', gameId: 'pinball', slot: 'table', status: 'on_sale', coin: 100 },
  { id: 'pinball.ball.gold', kind: 'item', name: '금 공', access: 'purchase', gameId: 'pinball', slot: 'ball', status: 'on_sale', krw: 1200 },
  { id: 'coins.1000', kind: 'coin_pack', name: '코인 1000', access: 'purchase', grantCoins: 1000, status: 'on_sale', coin: 100, krw: 1200 },
  { id: 'pinball.table.draft', kind: 'item', name: '초안', access: 'purchase', gameId: 'pinball', slot: 'table', status: 'draft', coin: 100 },
  { id: 'pinball.table.retired', kind: 'item', name: '끝난 것', access: 'purchase', gameId: 'pinball', slot: 'table', status: 'retired', coin: 100 },
  // 할 수 없는 게임의 게임 상품: 상품은 on_sale이고 가격도 있지만 게임이 live가 아니다
  { id: 'game.breakout', kind: 'game', name: '벽돌깨기', access: 'purchase', gameId: 'breakout', status: 'on_sale', coin: 2000 },
  { id: 'game.tetra', kind: 'game', name: '테트라', access: 'purchase', gameId: 'tetra', status: 'on_sale', coin: 2000 },
  // 가격이 0인 것 (켜진 COIN 가격이 있으니 살 수 있다)
  { id: 'pinball.ball.free', kind: 'item', name: '공짜 공', access: 'purchase', gameId: 'pinball', slot: 'ball', status: 'on_sale', coin: 0 },
  ...CHEAP.map((id, i): NewProduct & { coin: number } => ({ id, kind: 'item', name: `공 ${i}`, access: 'purchase', gameId: 'pinball', slot: 'ball', status: 'on_sale', coin: 300 })),
];

/**
 * 게임 넷(pinball·minesweeper는 live, breakout은 draft, tetra는 retired)과 상품. 지뢰찾기 게임 상품은 3000코인, 노을은 300코인,
 * 300코인짜리 공 열 개, 그리고 팔 수 없는 상품들(위의 주석).
 */
export async function seedShop(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [id, status] of [['pinball', 'live'], ['minesweeper', 'live'], ['breakout', 'draft'], ['tetra', 'retired']] as const) {
      await createGame(tx, { id, name: id, description: '' });
      if (status !== 'draft') await updateGame(tx, id, { status });
    }
    for (const { coin, krw, ...product } of PRODUCTS) {
      await createProduct(tx, product);
      if (coin !== undefined) await setPrice(tx, product.id, 'COIN', coin);
      if (krw !== undefined) await setPrice(tx, product.id, 'KRW', krw);
    }
  });
}

/**
 * 이 게임의 버전 하나를 내보낸 것처럼 넣는다 (`game publish`가 남기는 모양: 버전 행 live, 게임의 지금 버전이 그 행).
 * 묶음 파일과 서명 확인은 game 노드의 일이라 여기서는 행만 넣는다. 앱에 내려갈 버전 정보를 준다.
 */
export async function publishVersion(db: Db, gameId: string, version: number): Promise<LiveVersion> {
  const info: LiveVersion = { version, sizeBytes: 12345, sha256: 'a'.repeat(64), signature: `sig-${gameId}-${version}`, minShellApi: 1 };
  const [row] = await db
    .insert(gameVersions)
    .values({ gameId, ...info, status: 'live', bundlePath: `bundles/${gameId}/${version}.zip`, publishedAt: NOW })
    .returning({ id: gameVersions.id });
  await db.update(games).set({ liveVersionId: row.id }).where(eq(games.id, gameId));
  return info;
}

/** 운영자 지급으로 코인을 넣는다 */
export async function fund(db: Db, userId: string, coins: number): Promise<void> {
  await db.transaction((tx) => applyCoins(tx, { userId, delta: coins, reason: 'grant', now: NOW }));
}

export const buy = (db: Db, userId: string, productId: string, idempotencyKey?: string, now: Date = NOW) =>
  purchaseWithCoins(db, userId, idempotencyKey === undefined ? { productId } : { productId, idempotencyKey }, now);

/** 운영자가 `order refund`로 하는 것과 같은 일: 운영 기록을 남기고 그 번호로 환불한다. 운영 기록의 번호를 준다 */
export async function refund(db: Db, orderId: string, now?: Date): Promise<number> {
  return db.transaction(async (tx) => {
    // 주문 ID는 운영 기록에 적지 않는다: 모양이 틀린 ID(NUL 포함)를 넘기는 테스트가 있다. 명령은 모양을 먼저 본 뒤에 적는다
    const id = await audit(tx, { actor: 'ops-kim', action: 'order.refund', params: {}, reason: '테스트 환불' });
    await refundCoinOrder(tx, orderId, id, now);
    return id;
  });
}

export function ordersOf(db: Db, userId: string) {
  return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(orders.createdAt, orders.id);
}

export function eventsOf(db: Db, orderId: string) {
  return db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId)).orderBy(orderEvents.id);
}

/** 주문·사건·보유·코인 기록의 수와 잔액을 SQL로 직접 센다 (order·entitlement·wallet의 함수를 거치지 않는다). 지갑이 없으면 `balance`는 null */
export async function counts(db: Db, userId: string): Promise<{ orders: number; events: number; entitlements: number; ledger: number; balance: number | null }> {
  const out = (await db.execute(sql`
    select
      (select count(*)::text from app.orders where user_id = ${userId}) as orders,
      (select count(*)::text from app.order_events where order_id in (select id from app.orders where user_id = ${userId})) as events,
      (select count(*)::text from app.entitlements where user_id = ${userId}) as entitlements,
      (select count(*)::text from app.coin_ledger where user_id = ${userId}) as ledger,
      (select balance::text from app.wallets where user_id = ${userId}) as balance
  `)) as unknown as { rows: Array<{ orders: string; events: string; entitlements: string; ledger: string; balance: string | null }> };
  const row = out.rows[0];
  return {
    orders: Number(row.orders),
    events: Number(row.events),
    entitlements: Number(row.entitlements),
    ledger: Number(row.ledger),
    balance: row.balance === null ? null : Number(row.balance),
  };
}

/** 테스트가 넣는 현금 주문에 들어가는 값. 응답·출력·로그 어디에도 나오면 안 되는 것들이다 */
export const SECRET_TOKEN = 'purchase-token-SECRET-abcdefghijklmnop';
export const SECRET_RECEIPT = { orderId: 'GPA.1234-5678', purchaseToken: SECRET_TOKEN, signature: 'receipt-signature-SECRET' };

/**
 * 현금 주문을 직접 넣는다 (이번 작업은 현금 주문을 만드는 길이 없다 — 보관 규칙만 확인한다).
 * 기본은 구글 플레이에서 `at`에 결제가 끝난(completed) 금 공 주문이고 사건 둘(created, completed)이 붙는다.
 */
export async function insertMoneyOrder(
  db: Db,
  userId: string,
  at: Date,
  over: Partial<typeof orders.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(orders)
    .values({
      userId,
      productId: 'pinball.ball.gold',
      paymentMethod: 'google_play',
      status: 'completed',
      productName: '금 공',
      productKind: 'item',
      priceAmount: 1200,
      priceCurrency: 'KRW',
      storeSku: 'pinball_ball_gold',
      storeOrderId: `GPA.${Math.random().toString(36).slice(2)}`,
      storePurchaseToken: SECRET_TOKEN,
      storeEnvironment: 'production',
      rawReceipt: SECRET_RECEIPT,
      createdAt: at,
      completedAt: at,
      ...over,
    })
    .returning({ id: orders.id });
  await db.insert(orderEvents).values([
    { orderId: row.id, type: 'created', toStatus: 'pending', actor: 'user', createdAt: at },
    { orderId: row.id, type: 'completed', fromStatus: 'pending', toStatus: 'completed', actor: 'store', createdAt: at },
  ]);
  return row.id;
}

/** order의 경로만 붙인 HTTP 처리기. 세션은 진짜 `findSession`으로 찾는다 */
export function orderHandler(db: Db, clock: Clock): Handler {
  return createHandler(routes({ db }), {
    allowedOrigins: testConfig.allowedOrigins,
    now: clock,
    findSession: (tokenHash, now) => findSession(db, tokenHash, now),
  });
}
