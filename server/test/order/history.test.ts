import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOrder, listOrders } from '../../src/order/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { buy, CHEAP, fund, insertMoneyOrder, NOW, orderHandler, refund, rule, SECRET_TOKEN, seedShop } from './helpers.ts';

async function withShop(run: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await testDb();
  try {
    await seedShop(db);
    await run(db);
  } finally {
    await close();
  }
}

const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const codeOf = (body: unknown) => (body as { error?: { code?: string } }).error?.code;

/** 나오면 안 되는 것: 스토어 토큰, 영수증 원문과 그 안의 값 */
function assertNoSecrets(text: string): void {
  for (const needle of [SECRET_TOKEN, 'receipt-signature-SECRET', 'purchaseToken', 'rawReceipt', 'raw_receipt', 'storePurchaseToken', 'store_purchase_token']) {
    assert.ok(!text.includes(needle), `${needle}이 나왔어요`);
  }
}

test('주문 내역은 내 주문만, 최신부터, 쪽 단위로 준다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await fund(db, me.userId, 5000);
    await fund(db, other.userId, 5000);
    const mine: string[] = [];
    for (let i = 0; i < 5; i++) mine.push((await buy(db, me.userId, CHEAP[i], undefined, at(i))).orderId);
    const theirs = (await buy(db, other.userId, CHEAP[0], undefined, at(2))).orderId;

    const first = await listOrders(db, me.userId, { limit: 2 });
    assert.deepEqual(first.orders.map((o) => o.id), [mine[4], mine[3]]);
    assert.equal(first.next, mine[3]);
    const second = await listOrders(db, me.userId, { before: first.next!, limit: 2 });
    assert.deepEqual(second.orders.map((o) => o.id), [mine[2], mine[1]]);
    const third = await listOrders(db, me.userId, { before: second.next!, limit: 2 });
    assert.deepEqual(third.orders.map((o) => o.id), [mine[0]]);
    assert.equal(third.next, null);
    // 딱 맞게 끝나는 쪽도 next가 null이다
    assert.equal((await listOrders(db, me.userId, { limit: 5 })).next, null);

    // 한 줄의 모양
    assert.deepEqual(first.orders[0], {
      id: mine[4],
      productId: CHEAP[4],
      productName: '공 4',
      productKind: 'item',
      paymentMethod: 'coin',
      status: 'completed',
      price: { currency: 'COIN', amount: 300 },
      createdAt: at(4).toISOString(),
      completedAt: at(4).toISOString(),
      refundedAt: null,
    });

    // 남의 주문은 before를 어떻게 주든 나오지 않는다
    assert.deepEqual(await listOrders(db, me.userId, { before: theirs, limit: 100 }), { orders: [], next: null });
    assert.deepEqual((await listOrders(db, other.userId, { limit: 100 })).orders.map((o) => o.id), [theirs]);
    assert.deepEqual(await listOrders(db, me.userId, { before: '00000000-0000-4000-8000-000000000000', limit: 100 }), { orders: [], next: null });

    // 쪽 크기와 before의 모양
    for (const limit of [0, 101, 1.5, Number.NaN, -1]) await assert.rejects(listOrders(db, me.userId, { limit }), rule(400, 'invalid_limit'), String(limit));
    for (const before of ['', 'not-a-uuid', "x' or '1'='1", 'a\u0000b']) await assert.rejects(listOrders(db, me.userId, { before, limit: 10 }), rule(400, 'invalid_before'), before);
    // 사용자 ID 모양이 아니면 쿼리 없이 빈 목록이다
    assert.deepEqual(await listOrders(db, 'not-a-user', { limit: 10 }), { orders: [], next: null });
  }));

test('환불된 주문은 내역에 refunded로 남고, 같은 시각의 주문도 쪽 사이에서 빠지거나 겹치지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 5000);
    // 같은 시각(NOW)에 주문 다섯
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await buy(db, me.userId, CHEAP[i])).orderId);
    await refund(db, ids[0], at(60));
    const seen: string[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const out = await listOrders(db, me.userId, before === undefined ? { limit: 2 } : { before, limit: 2 });
      seen.push(...out.orders.map((o) => o.id));
      if (out.next === null) break;
      before = out.next;
    }
    assert.deepEqual([...seen].sort(), [...ids].sort());
    assert.equal(seen.length, 5);
    const all = await listOrders(db, me.userId, { limit: 100 });
    const refunded = all.orders.find((o) => o.id === ids[0]);
    assert.deepEqual([refunded?.status, refunded?.refundedAt], ['refunded', at(60).toISOString()]);
  }));

test('GET /v2/me/orders: 로그인해야 하고, 내 주문만 주고, 영수증 원문과 스토어 토큰은 나가지 않는다', () =>
  withShop(async (db) => {
    const clock = fakeClock(NOW.toISOString());
    const handler = orderHandler(db, clock);
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    await fund(db, other.userId, 1000);
    const coin = (await buy(db, me.userId, 'pinball.table.sunset', undefined, at(10))).orderId;
    const money = await insertMoneyOrder(db, me.userId, at(20));
    const theirs = (await buy(db, other.userId, 'pinball.table.sunset', undefined, at(30))).orderId;
    await insertMoneyOrder(db, other.userId, at(40));

    assert.equal((await call(handler, 'GET', '/v2/me/orders')).status, 401);

    const res = await call(handler, 'GET', '/v2/me/orders', { token: me.token });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    const body = res.body as { orders: Array<Record<string, unknown>>; next: string | null };
    assert.deepEqual(body.orders.map((o) => o.id), [money, coin]);
    assert.equal(body.next, null);
    assert.deepEqual(body.orders[0], {
      id: money,
      productId: 'pinball.ball.gold',
      productName: '금 공',
      productKind: 'item',
      paymentMethod: 'google_play',
      status: 'completed',
      price: { currency: 'KRW', amount: 1200 },
      createdAt: at(20).toISOString(),
      completedAt: at(20).toISOString(),
      refundedAt: null,
    });
    const text = res.raw.toString('utf8');
    assertNoSecrets(text);
    assert.ok(!text.includes(theirs) && !text.includes(other.userId));

    // 쪽 넘기기와 틀린 물음
    const page = await call(handler, 'GET', '/v2/me/orders?limit=1', { token: me.token });
    assert.deepEqual((page.body as typeof body).orders.map((o) => o.id), [money]);
    assert.equal((page.body as typeof body).next, money);
    const next = await call(handler, 'GET', `/v2/me/orders?limit=1&before=${money}`, { token: me.token });
    assert.deepEqual((next.body as typeof body).orders.map((o) => o.id), [coin]);
    const stolen = await call(handler, 'GET', `/v2/me/orders?before=${theirs}`, { token: me.token });
    assert.deepEqual(stolen.body, { orders: [], next: null });
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'limit=1e1', 'limit=5&limit=6']) {
      const bad = await call(handler, 'GET', `/v2/me/orders?${query}`, { token: me.token });
      assert.deepEqual([bad.status, codeOf(bad.body)], [400, 'invalid_limit'], query);
    }
    for (const query of ['before=abc', 'before=', `before=${money}&before=${coin}`, 'before=%00']) {
      const bad = await call(handler, 'GET', `/v2/me/orders?${query}`, { token: me.token });
      assert.deepEqual([bad.status, codeOf(bad.body)], [400, 'invalid_before'], query);
    }
  }));

test('getOrder는 주문과 사건을 순서대로 주고, 영수증 원문과 스토어 토큰은 주지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    const adminActionId = await refund(db, orderId, at(60));
    const order = await getOrder(db, orderId);
    assert.ok(order);
    assert.deepEqual(
      [order.id, order.userId, order.productId, order.productName, order.productKind, order.paymentMethod, order.status, order.price, order.refundedAt],
      [orderId, me.userId, 'pinball.table.sunset', '노을', 'item', 'coin', 'refunded', { currency: 'COIN', amount: 300 }, at(60).toISOString()],
    );
    assert.deepEqual(order.events.map((e) => [e.type, e.fromStatus, e.toStatus, e.actor]), [
      ['created', null, 'pending', 'user'],
      ['completed', 'pending', 'completed', 'system'],
      ['granted', null, null, 'system'],
      ['refunded', 'completed', 'refunded', 'admin'],
      ['revoked', null, null, 'admin'],
    ]);
    assert.equal(typeof order.events[1].ledgerId, 'number');
    assert.equal(order.events[3].adminActionId, adminActionId);
    assert.equal(order.events[0].createdAt, NOW.toISOString());

    const money = await getOrder(db, await insertMoneyOrder(db, me.userId, at(120)));
    assert.ok(money);
    assert.equal(money.paymentMethod, 'google_play');
    assert.equal(money.storeSku, 'pinball_ball_gold');
    assertNoSecrets(JSON.stringify(money));

    assert.equal(await getOrder(db, '00000000-0000-4000-8000-000000000000'), null);
    assert.equal(await getOrder(db, 'not-a-uuid'), null);
  }));
