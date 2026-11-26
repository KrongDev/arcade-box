import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { deleteAccount, getUser, type DeletionPolicy } from '../../src/account/index.ts';
import { grant, purgeUser as purgeEntitlements } from '../../src/entitlement/index.ts';
import { hasMoneyOrders, listOrders, purgeExpired, purgeUser, retentionCutoff } from '../../src/order/index.ts';
import { orderEvents, orders } from '../../src/order/schema.ts';
import { purgeUser as purgePlay } from '../../src/play/index.ts';
import { purgeUser as purgeRewards } from '../../src/reward/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { applyCoins, purgeUser as purgeWallet, verifyWallets } from '../../src/wallet/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { testDb } from '../helpers/db.ts';
import { tablesContaining } from '../helpers/scan.ts';
import { buy, counts, DAY_MS, eventsOf, fund, insertMoneyOrder, NOW, ordersOf, refund, seedShop } from './helpers.ts';

async function withShop(run: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await testDb();
  try {
    await seedShop(db);
    await run(db);
  } finally {
    await close();
  }
}

/** 서버 조립(Task 13)이 계정 삭제에 넣는 것과 같은 방침: 현금 주문이 있으면 사용자 행을 남기고, order → reward → play → entitlement → wallet 순서로 지운다 */
const policy: DeletionPolicy = { mustKeepUserRow: hasMoneyOrders, purge: [purgeUser, purgeRewards, purgePlay, purgeEntitlements, purgeWallet] };

/** `now`에서 달력으로 `years`년 전 (UTC) */
function yearsBefore(now: Date, years: number): Date {
  const out = new Date(now);
  out.setUTCFullYear(out.getUTCFullYear() - years);
  return out;
}

const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

test('hasMoneyOrders는 코인 주문만 있으면 거짓, 현금 주문이 있으면 참이다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    assert.equal(await hasMoneyOrders(db, me.userId), false);
    await fund(db, me.userId, 1000);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    await refund(db, orderId);
    await buy(db, me.userId, 'pinball.ball.c0');
    assert.equal(await hasMoneyOrders(db, me.userId), false);

    await insertMoneyOrder(db, me.userId, NOW);
    assert.equal(await hasMoneyOrders(db, me.userId), true);
    // 남의 현금 주문은 세지 않는다. 애플 결제도 현금 주문이고, 환불된 현금 주문도 보관할 기록이다
    assert.equal(await hasMoneyOrders(db, other.userId), false);
    await insertMoneyOrder(db, other.userId, NOW, { paymentMethod: 'app_store', status: 'refunded', refundedAt: NOW });
    assert.equal(await hasMoneyOrders(db, other.userId), true);
    // 사용자 ID 모양이 아니면 쿼리 없이 거짓이다
    assert.equal(await hasMoneyOrders(db, 'not-a-user'), false);
  }));

test('purgeUser는 코인 주문과 그 사건만 지우고 현금 주문은 남긴다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    await fund(db, other.userId, 1000);
    const coin = (await buy(db, me.userId, 'pinball.table.sunset')).orderId;
    await refund(db, (await buy(db, me.userId, 'pinball.ball.c0')).orderId);
    const money = await insertMoneyOrder(db, me.userId, NOW);
    const theirs = (await buy(db, other.userId, 'pinball.table.sunset')).orderId;

    await db.transaction((tx) => purgeUser(tx, me.userId));

    const left = await ordersOf(db, me.userId);
    assert.deepEqual(left.map((o) => [o.id, o.paymentMethod]), [[money, 'google_play']]);
    assert.deepEqual((await eventsOf(db, money)).map((e) => e.type), ['created', 'completed']);
    assert.deepEqual(await eventsOf(db, coin), []);
    // 주문 사건 전체에서도 이 사용자의 코인 주문 것은 없다
    const all = await db.select({ orderId: orderEvents.orderId }).from(orderEvents);
    assert.deepEqual([...new Set(all.map((e) => e.orderId))].sort(), [money, theirs].sort());
    // 남의 주문은 그대로다
    assert.equal((await ordersOf(db, other.userId)).length, 1);
    assert.equal((await eventsOf(db, theirs)).length, 3);
  }));

test('계정을 지우면: 현금 주문이 없는 사용자는 전부 사라지고, 있는 사용자는 사용자 행(deleted)과 현금 주문·사건만 남는다', () =>
  withShop(async (db) => {
    const plain = await loginGuest(db, NOW);
    const payer = await loginGuest(db, NOW);
    const bystander = await loginGuest(db, NOW);
    for (const user of [plain, payer, bystander]) {
      await fund(db, user.userId, 1000);
      await buy(db, user.userId, 'pinball.table.sunset');
    }
    await refund(db, (await buy(db, payer.userId, 'pinball.ball.c0')).orderId);

    // 현금 주문 하나: 그 주문으로 생긴 보유와 코인 기록을 가리키고 있다 (3번 작업이 만들 모양).
    // 계정을 지우면 보유와 코인 기록이 사라지므로 남는 주문과 사건은 그것을 가리키지 않아야 한다
    const money = await insertMoneyOrder(db, payer.userId, NOW);
    const linked = await db.transaction(async (tx) => {
      const entitlementId = await grant(tx, { userId: payer.userId, productId: 'pinball.ball.gold', source: 'store_purchase' });
      const { ledgerId } = await applyCoins(tx, { userId: payer.userId, delta: 10, reason: 'grant', now: NOW });
      await tx.update(orders).set({ entitlementId }).where(eq(orders.id, money));
      await tx.insert(orderEvents).values({ orderId: money, type: 'granted', actor: 'system', ledgerId, detail: { entitlementId }, createdAt: NOW });
      return { entitlementId, ledgerId };
    });
    assert.ok(linked.entitlementId > 0 && linked.ledgerId > 0);

    await deleteAccount(db, plain.userId, policy, NOW);
    await deleteAccount(db, payer.userId, policy, NOW);

    // 현금 주문이 없던 사용자: 어느 테이블에도 흔적이 없다
    assert.deepEqual(await tablesContaining(db, [plain.userId]), []);
    assert.equal(await getUser(db, plain.userId), null);

    // 현금 주문이 있던 사용자: 사용자 행과 현금 주문만 남는다 (사건은 주문을 가리킨다)
    assert.deepEqual(await tablesContaining(db, [payer.userId]), ['orders', 'users']);
    assert.equal((await getUser(db, payer.userId))?.status, 'deleted');
    assert.deepEqual(await counts(db, payer.userId), { orders: 1, events: 3, entitlements: 0, ledger: 0, balance: null });
    const [kept] = await ordersOf(db, payer.userId);
    assert.deepEqual([kept.id, kept.status, kept.productName, kept.priceAmount, kept.priceCurrency, kept.entitlementId], [money, 'completed', '금 공', 1200, 'KRW', null]);
    assert.deepEqual((await eventsOf(db, money)).map((e) => [e.type, e.ledgerId]), [['created', null], ['completed', null], ['granted', null]]);
    assert.equal(await hasMoneyOrders(db, payer.userId), true);

    // 다른 사용자는 그대로다
    assert.deepEqual(await counts(db, bystander.userId), { orders: 1, events: 3, entitlements: 1, ledger: 2, balance: 700 });
    assert.deepEqual(await verifyWallets(db), []);
  }));

test('purgeExpired는 5년이 지난 현금 주문만 지운다 (5년에서 하루 모자란 것은 남는다)', () =>
  withShop(async (db) => {
    const now = new Date('2031-11-26T03:00:00Z');
    const me = await loginGuest(db, NOW);
    const fiveYearsAgo = yearsBefore(now, 5);

    const expired = await insertMoneyOrder(db, me.userId, plus(fiveYearsAgo, -DAY_MS));
    const dayShort = await insertMoneyOrder(db, me.userId, plus(fiveYearsAgo, DAY_MS));
    const exact = await insertMoneyOrder(db, me.userId, fiveYearsAgo);
    const msShort = await insertMoneyOrder(db, me.userId, plus(fiveYearsAgo, 1));
    // 환불된 주문은 환불한 때부터 센다
    const refundedLate = await insertMoneyOrder(db, me.userId, yearsBefore(now, 6), { status: 'refunded', refundedAt: yearsBefore(now, 4) });
    const refundedLong = await insertMoneyOrder(db, me.userId, yearsBefore(now, 7), { paymentMethod: 'app_store', status: 'refunded', refundedAt: yearsBefore(now, 6) });
    // 끝내 결제되지 않은 주문은 만든 때부터 센다
    const pendingOld = await insertMoneyOrder(db, me.userId, yearsBefore(now, 6), { status: 'pending', completedAt: null });
    const failedNew = await insertMoneyOrder(db, me.userId, yearsBefore(now, 4), { status: 'failed', completedAt: null });
    // 보관 기간은 계정을 지운 뒤에 남겨 둔 기록의 것이다 (스펙 5.4). 계정을 지운다
    await deleteAccount(db, me.userId, policy, NOW);
    assert.equal((await getUser(db, me.userId))?.status, 'deleted');

    // 3년 전에 돌렸다면 아직 하나도 지워지지 않는다: 기준은 넣어 준 시각이다 (DB의 지금이 아니다)
    assert.equal(await purgeExpired(db, yearsBefore(now, 3)), 0);
    assert.equal((await ordersOf(db, me.userId)).length, 8);

    assert.equal(await purgeExpired(db, now), 4);
    const left = (await ordersOf(db, me.userId)).map((o) => o.id);
    assert.deepEqual([...left].sort(), [dayShort, msShort, refundedLate, failedNew].sort());
    for (const gone of [expired, exact, refundedLong, pendingOld]) assert.deepEqual(await eventsOf(db, gone), [], '지운 주문의 사건도 지운다');
    assert.equal((await eventsOf(db, dayShort)).length, 2);
    // 주문이 남아 있으니 사용자 행도 남는다
    assert.equal((await getUser(db, me.userId))?.status, 'deleted');

    // 다시 돌리면 지울 것이 없다. 하루가 더 지나면 하루 모자랐던 것이 지워진다
    assert.equal(await purgeExpired(db, now), 0);
    assert.equal(await purgeExpired(db, plus(now, DAY_MS)), 2);
    assert.deepEqual((await ordersOf(db, me.userId)).map((o) => o.id).sort(), [refundedLate, failedNew].sort());
  }));

test('살아 있는 사용자의 5년 지난 현금 주문은 지우지 않는다', () =>
  withShop(async (db) => {
    const now = new Date('2031-11-26T03:00:00Z');
    const old = yearsBefore(now, 6);
    const alive = await loginGuest(db, NOW);
    const gone = await loginGuest(db, NOW);
    // 두 사용자 모두 6년 전에 현금으로 샀다 (결제 완료 하나, 환불 하나). 살아 있는 사용자는 그때 코인으로도 샀다
    const kept = [await insertMoneyOrder(db, alive.userId, old), await insertMoneyOrder(db, alive.userId, old, { paymentMethod: 'app_store', status: 'refunded', refundedAt: old })];
    await db.transaction((tx) => applyCoins(tx, { userId: alive.userId, delta: 300, reason: 'grant', now: old }));
    const coin = (await buy(db, alive.userId, 'pinball.table.sunset', undefined, old)).orderId;
    await insertMoneyOrder(db, gone.userId, old);
    await insertMoneyOrder(db, gone.userId, old, { status: 'refunded', refundedAt: old });
    await deleteAccount(db, gone.userId, policy, NOW);

    // 계정을 지운 사용자의 것만 지워진다
    assert.equal(await purgeExpired(db, now), 2);
    assert.equal(await getUser(db, gone.userId), null);

    // 살아 있는 사용자: 주문도 사건도 행도 그대로다. 주문 내역에서 사라지지 않는다
    assert.equal((await getUser(db, alive.userId))?.status, 'active');
    assert.deepEqual((await ordersOf(db, alive.userId)).map((o) => o.id).sort(), [...kept, coin].sort());
    for (const id of kept) assert.equal((await eventsOf(db, id)).length, 2);
    assert.equal((await eventsOf(db, coin)).length, 3);
    assert.equal((await listOrders(db, alive.userId, { limit: 100 })).orders.length, 3);
    // 몇 번을 돌려도, 한참 뒤에 돌려도 같다
    assert.equal(await purgeExpired(db, yearsBefore(now, -20)), 0);
    assert.equal((await ordersOf(db, alive.userId)).length, 3);

    // 그 사용자가 계정을 지우면 그때부터 남겨 둔 기록이고, 5년이 이미 지났으니 다음 정리에서 지워진다 (코인 주문은 계정과 함께 지워진다)
    await deleteAccount(db, alive.userId, policy, now);
    assert.deepEqual((await ordersOf(db, alive.userId)).map((o) => o.id).sort(), [...kept].sort());
    assert.equal(await purgeExpired(db, now), 2);
    assert.deepEqual(await tablesContaining(db, [alive.userId]), []);
  }));

test('purgeExpired는 주문이 하나도 남지 않은 deleted 사용자 행도 지운다', () =>
  withShop(async (db) => {
    const now = new Date('2031-11-26T03:00:00Z');
    const old = plus(yearsBefore(now, 5), -DAY_MS);
    const recent = yearsBefore(now, 2);

    const gone = await loginGuest(db, NOW);
    await insertMoneyOrder(db, gone.userId, old);
    await insertMoneyOrder(db, gone.userId, old, { paymentMethod: 'app_store' });
    const half = await loginGuest(db, NOW);
    await insertMoneyOrder(db, half.userId, old);
    const halfKept = await insertMoneyOrder(db, half.userId, recent);
    const alive = await loginGuest(db, NOW);
    await insertMoneyOrder(db, alive.userId, old);
    for (const user of [gone, half]) await deleteAccount(db, user.userId, policy, NOW);
    assert.equal((await getUser(db, gone.userId))?.status, 'deleted');
    // 주문 없이 deleted로 남은 행 (계정 삭제와 이 정리가 겹친 순간에 생길 수 있다): 다음에 돌릴 때 함께 치워진다
    const orphan = await loginGuest(db, NOW);
    await deleteAccount(db, orphan.userId, { mustKeepUserRow: async () => true, purge: [] }, NOW);
    assert.equal((await getUser(db, orphan.userId))?.status, 'deleted');

    assert.equal(await purgeExpired(db, now), 3);
    // 주문이 다 지워진 deleted 사용자: 행까지 사라져 어느 테이블에도 흔적이 없다
    assert.equal(await getUser(db, gone.userId), null);
    assert.deepEqual(await tablesContaining(db, [gone.userId]), []);
    assert.equal(await getUser(db, orphan.userId), null);
    // 아직 보관할 주문이 남은 deleted 사용자: 행이 남는다
    assert.equal((await getUser(db, half.userId))?.status, 'deleted');
    assert.deepEqual((await ordersOf(db, half.userId)).map((o) => o.id), [halfKept]);
    // 살아 있는 사용자: 주문도 행도 그대로다
    assert.equal((await getUser(db, alive.userId))?.status, 'active');
    assert.equal((await ordersOf(db, alive.userId)).length, 1);

    // 남은 주문의 보관 기간이 끝나면 그 사용자 행도 지워진다
    assert.equal(await purgeExpired(db, plus(yearsBefore(now, -3), DAY_MS)), 1);
    assert.equal(await getUser(db, half.userId), null);
    const users = (await db.execute(sql`select count(*)::int as n from app.users where status = 'deleted'`)) as unknown as { rows: Array<{ n: number }> };
    assert.equal(users.rows[0].n, 0);
  }));

test('보관 기간의 기준 시각은 달력으로 5년 전이고, 2월 29일에는 5년 전의 2월 28일이다', () => {
  assert.equal(retentionCutoff(new Date('2031-11-26T03:00:00Z')).toISOString(), '2026-11-26T03:00:00.000Z');
  assert.equal(retentionCutoff(new Date('2030-01-01T00:00:00Z')).toISOString(), '2025-01-01T00:00:00.000Z');
  // 2028-02-29의 5년 전에는 2월 29일이 없다. 3월 1일로 넘기면 5년이 안 된 주문이 지워지므로 2월 28일로 당긴다
  assert.equal(retentionCutoff(new Date('2028-02-29T12:00:00Z')).toISOString(), '2023-02-28T12:00:00.000Z');
  assert.equal(retentionCutoff(new Date('2029-02-28T12:00:00Z')).toISOString(), '2024-02-28T12:00:00.000Z');
});
