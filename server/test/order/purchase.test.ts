import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { canPlayGame, grant, listEquipped, listOwned } from '../../src/entitlement/index.ts';
import { updateGame } from '../../src/game/index.ts';
import { getOrder, purchaseWithCoins } from '../../src/order/index.ts';
import { setPrice, updateProduct } from '../../src/product/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { applyCoins, getBalance, verifyWallets } from '../../src/wallet/index.ts';
import { ledgerOf } from '../wallet/helpers.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { rowsOf } from '../entitlement/helpers.ts';
import { buy, counts, eventsOf, fund, NOW, orderHandler, ordersOf, rule, seedShop } from './helpers.ts';

async function withShop(run: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await testDb();
  try {
    await seedShop(db);
    await run(db);
  } finally {
    await close();
  }
}

const CHEAP_ONE = 'pinball.ball.c0';

const codeOf = (body: unknown) => (body as { error?: { code?: string } }).error?.code;

test('코인으로 사면: 주문이 completed이고 구매 당시 이름·종류·가격이 들어 있고, 사건이 created·completed·granted 순서이고, 코인 기록이 −가격이고, 보유가 생기고, orders.entitlement_id가 그 보유다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const out = await buy(db, me.userId, 'pinball.table.sunset');
    assert.deepEqual({ ...out, orderId: '' }, { orderId: '', productId: 'pinball.table.sunset', balance: 700, replayed: false });

    const [order, ...more] = await ordersOf(db, me.userId);
    assert.equal(more.length, 0);
    assert.equal(order.id, out.orderId);
    assert.deepEqual(
      {
        userId: order.userId,
        productId: order.productId,
        paymentMethod: order.paymentMethod,
        status: order.status,
        productName: order.productName,
        productKind: order.productKind,
        priceAmount: order.priceAmount,
        priceCurrency: order.priceCurrency,
        createdAt: order.createdAt.toISOString(),
        completedAt: order.completedAt?.toISOString(),
        refundedAt: order.refundedAt,
      },
      {
        userId: me.userId,
        productId: 'pinball.table.sunset',
        paymentMethod: 'coin',
        status: 'completed',
        productName: '노을',
        productKind: 'item',
        priceAmount: 300,
        priceCurrency: 'COIN',
        createdAt: NOW.toISOString(),
        completedAt: NOW.toISOString(),
        refundedAt: null,
      },
    );
    // 스토어 값은 코인 주문에 없다
    assert.deepEqual([order.storeSku, order.storeOrderId, order.storePurchaseToken, order.storeEnvironment, order.rawReceipt], [null, null, null, null, null]);

    // 코인 기록: 지급 +1000 뒤에 구매 −300
    const ledger = await ledgerOf(db, me.userId);
    assert.deepEqual(ledger.map((l) => [l.delta, l.balanceAfter, l.reason]), [[1000, 1000, 'grant'], [-300, 700, 'purchase']]);
    assert.equal(ledger[1].createdAt.toISOString(), NOW.toISOString());

    // 보유와 orders.entitlement_id
    const owned = await rowsOf(db, me.userId);
    assert.deepEqual(owned.map((e) => [e.productId, e.source, e.revokedAt]), [['pinball.table.sunset', 'coin_purchase', null]]);
    assert.equal(order.entitlementId, owned[0].id);

    // 사건 셋: 순서, 상태, 가리키는 코인 기록
    const events = await eventsOf(db, order.id);
    assert.deepEqual(
      events.map((e) => [e.type, e.fromStatus, e.toStatus, e.actor, e.ledgerId, e.adminActionId]),
      [
        ['created', null, 'pending', 'user', null, null],
        ['completed', 'pending', 'completed', 'system', ledger[1].id, null],
        ['granted', null, null, 'system', null, null],
      ],
    );
    assert.deepEqual(events[2].detail, { entitlementId: owned[0].id });
    for (const e of events) assert.equal(e.createdAt.toISOString(), NOW.toISOString());
    assert.deepEqual(await verifyWallets(db), []);
  }));

test('코인이 모자라면 409 insufficient_coins이고 주문·사건·보유·기록이 하나도 생기지 않는다', () =>
  withShop(async (db) => {
    // 지갑이 아예 없는 사용자: 지갑 행도 남지 않는다
    const poor = await loginGuest(db, NOW);
    await assert.rejects(buy(db, poor.userId, 'pinball.table.sunset'), rule(409, 'insufficient_coins'));
    assert.deepEqual(await counts(db, poor.userId), { orders: 0, events: 0, entitlements: 0, ledger: 0, balance: null });

    // 1코인 모자란 사용자: 잔액과 기록이 그대로다
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 299);
    await assert.rejects(buy(db, me.userId, 'pinball.table.sunset', 'short-key-0001'), rule(409, 'insufficient_coins'));
    assert.deepEqual(await counts(db, me.userId), { orders: 0, events: 0, entitlements: 0, ledger: 1, balance: 299 });
    assert.deepEqual(await listOwned(db, me.userId), []);

    // 1코인을 더 받으면 같은 키로 살 수 있다 (실패한 요청은 키를 쓰지 않았다)
    await fund(db, me.userId, 1);
    assert.deepEqual({ ...(await buy(db, me.userId, 'pinball.table.sunset', 'short-key-0001')), orderId: '' }, { orderId: '', productId: 'pinball.table.sunset', balance: 0, replayed: false });
    assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 3, entitlements: 1, ledger: 3, balance: 0 });
    assert.deepEqual(await verifyWallets(db), []);
  }));

test('이미 가진 상품은 409 already_owned', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 5000);
    await buy(db, me.userId, 'pinball.table.sunset');
    await assert.rejects(buy(db, me.userId, 'pinball.table.sunset'), rule(409, 'already_owned'));
    await assert.rejects(buy(db, me.userId, 'pinball.table.sunset', 'other-key-0001'), rule(409, 'already_owned'));
    assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 3, entitlements: 1, ledger: 2, balance: 4700 });

    // 가진 것을 잔액보다 먼저 본다 (스펙 5.6의 순서, 표 K17): 코인이 모자라도 이미 가진 상품이면 already_owned다
    const poor = await loginGuest(db, NOW);
    await fund(db, poor.userId, 300);
    await buy(db, poor.userId, 'pinball.table.sunset');
    await assert.rejects(buy(db, poor.userId, 'pinball.table.sunset'), rule(409, 'already_owned'));

    // 운영자가 준 것도 가진 것이다: 코인이 나가지 않는다
    await db.transaction((tx) => grant(tx, { userId: me.userId, productId: 'game.minesweeper', source: 'grant' }));
    await assert.rejects(buy(db, me.userId, 'game.minesweeper'), rule(409, 'already_owned'));
    assert.equal(await getBalance(db, me.userId), 4700);
  }));

for (const [why, productId] of [
  ['hidden 상품', 'pinball.table.neon'],
  ['everyone 상품', 'pinball.table.classic'],
  ['COIN 가격이 없는 상품', 'pinball.ball.gold'],
  ['코인 묶음', 'coins.1000'],
  ['draft 상품', 'pinball.table.draft'],
  ['retired 상품', 'pinball.table.retired'],
  ['draft 게임의 게임 상품', 'game.breakout'],
  ['retired 게임의 게임 상품', 'game.tetra'],
] as const) {
  test(`${why}: 409 not_for_sale`, () =>
    withShop(async (db) => {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 5000);
      await assert.rejects(buy(db, me.userId, productId), rule(409, 'not_for_sale'));
      assert.deepEqual(await counts(db, me.userId), { orders: 0, events: 0, entitlements: 0, ledger: 1, balance: 5000 });
    }));
}

test('같은 idempotency 키로 다시 보내면 주문이 하나이고 같은 답(replayed)을 받는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const first = await buy(db, me.userId, 'pinball.table.sunset', 'buy-sunset-0001');
    assert.equal(first.replayed, false);
    // 그사이 잔액이 바뀌어도 처음 답 그대로다 (already_owned가 아니다)
    await fund(db, me.userId, 50);
    const again = await buy(db, me.userId, 'pinball.table.sunset', 'buy-sunset-0001', new Date(NOW.getTime() + 5000));
    assert.deepEqual(again, { ...first, replayed: true });
    assert.equal(again.balance, 700);
    assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 3, entitlements: 1, ledger: 3, balance: 750 });

    // 상품이 그사이 숨겨지고 가격이 바뀌어도 다시 보낸 요청은 처음 답이다
    await db.transaction(async (tx) => {
      await updateProduct(tx, 'pinball.table.sunset', { status: 'hidden' });
      await setPrice(tx, 'pinball.table.sunset', 'COIN', 9999);
    });
    assert.deepEqual(await buy(db, me.userId, 'pinball.table.sunset', 'buy-sunset-0001'), { ...first, replayed: true });

    // 같은 키로 다른 상품을 보내면 거절하고 아무것도 사지 않는다
    await assert.rejects(buy(db, me.userId, CHEAP_ONE, 'buy-sunset-0001'), rule(409, 'idempotency_mismatch'));
    assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 3, entitlements: 1, ledger: 3, balance: 750 });

    // 키는 사용자마다 따로다: 다른 사용자가 같은 키를 써도 자기 주문이 생긴다
    const other = await loginGuest(db, NOW);
    await fund(db, other.userId, 300);
    const theirs = await buy(db, other.userId, CHEAP_ONE, 'buy-sunset-0001');
    assert.equal(theirs.replayed, false);
    assert.notEqual(theirs.orderId, first.orderId);
    assert.deepEqual(await verifyWallets(db), []);
  }));

test('같은 키를 이미 다른 코인 기록(보상 등)에 썼으면 409 idempotency_mismatch이고 아무것도 사지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 1000, reason: 'attendance', idempotencyKey: 'shared-key-0001', now: NOW }));
    await assert.rejects(buy(db, me.userId, 'pinball.table.sunset', 'shared-key-0001'), rule(409, 'idempotency_mismatch'));
    assert.deepEqual(await counts(db, me.userId), { orders: 0, events: 0, entitlements: 0, ledger: 1, balance: 1000 });
  }));

test('키 모양이 틀리면 400 invalid_idempotency_key, 본문이나 productId가 틀리면 400, 없는 상품은 404 not_found', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    for (const key of ['short', 'has space 12345', 12345678, 'x'.repeat(65), 'null\u0000byte-key']) {
      await assert.rejects(purchaseWithCoins(db, me.userId, { productId: 'pinball.table.sunset', idempotencyKey: key }, NOW), rule(400, 'invalid_idempotency_key'), String(key));
    }
    for (const body of [null, undefined, 'pinball.table.sunset', [], 42]) await assert.rejects(purchaseWithCoins(db, me.userId, body, NOW), rule(400, 'invalid_body'), String(body));
    for (const productId of [undefined, null, 42, {}, ['pinball.table.sunset']]) {
      await assert.rejects(purchaseWithCoins(db, me.userId, { productId }, NOW), rule(400, 'invalid_product_id'), String(productId));
    }
    for (const productId of ['pinball.table.nothing', '', 'UPPER.case', '../etc/passwd', "x'; drop table app.orders; --", 'a\u0000b', 'x'.repeat(5000)]) {
      await assert.rejects(buy(db, me.userId, productId), rule(404, 'not_found'), productId.slice(0, 30));
    }
    assert.deepEqual(await counts(db, me.userId), { orders: 0, events: 0, entitlements: 0, ledger: 1, balance: 1000 });
  }));

test('산 뒤에 상품 이름과 가격을 바꿔도 주문의 이름과 가격은 그대로다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    const before = await getOrder(db, orderId);
    await db.transaction(async (tx) => {
      await updateProduct(tx, 'pinball.table.sunset', { name: '저녁노을 한정판', status: 'retired' });
      await setPrice(tx, 'pinball.table.sunset', 'COIN', 9000);
    });
    const [row] = await ordersOf(db, me.userId);
    assert.deepEqual([row.productName, row.productKind, row.priceAmount, row.priceCurrency, row.status], ['노을', 'item', 300, 'COIN', 'completed']);
    assert.deepEqual(await getOrder(db, orderId), before);
    assert.equal(before?.productName, '노을');
    assert.equal(before?.price.amount, 300);
    // 판매가 끝난 상품이어도 산 것은 그대로 가진 것이다
    assert.deepEqual(await listOwned(db, me.userId), ['pinball.table.sunset']);
  }));

test('가격은 서버가 읽는다: 앱이 보낸 가격과 그 밖의 값은 보지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const out = await purchaseWithCoins(db, me.userId, { productId: 'pinball.table.sunset', price: 1, amount: 0, priceAmount: 0, userId: 'someone-else', paymentMethod: 'google_play' }, NOW);
    assert.equal(out.balance, 700);
    const [row] = await ordersOf(db, me.userId);
    assert.deepEqual([row.priceAmount, row.paymentMethod, row.userId], [300, 'coin', me.userId]);

    // 가격을 바꾼 뒤의 구매는 새 가격이다
    await db.transaction((tx) => setPrice(tx, 'pinball.ball.c0', 'COIN', 450));
    assert.equal((await buy(db, me.userId, 'pinball.ball.c0')).balance, 250);
  }));

test('게임 상품을 사면 그 게임을 할 수 있고, 아이템을 사도 장착하지는 않는다 (표 D7)', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 4000);
    assert.equal(await canPlayGame(db, me.userId, 'minesweeper'), false);
    await buy(db, me.userId, 'game.minesweeper');
    assert.equal(await canPlayGame(db, me.userId, 'minesweeper'), true);
    const [order] = await ordersOf(db, me.userId);
    assert.deepEqual([order.productName, order.productKind, order.priceAmount], ['지뢰찾기', 'game', 3000]);

    await buy(db, me.userId, 'pinball.table.sunset');
    assert.deepEqual(await listEquipped(db, me.userId), []);
    assert.deepEqual(await listOwned(db, me.userId), ['game.minesweeper', 'pinball.table.sunset']);
  }));

test('게임 상품은 그 게임이 live일 때만 팔린다: 내보내면 살 수 있고, 내린 뒤에는 새로 못 사지만 산 사람은 그대로 가진다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    const late = await loginGuest(db, NOW);
    await fund(db, me.userId, 5000);
    await fund(db, late.userId, 5000);
    // 아직 내보내지 않은(draft) 게임: 할 수 없는 게임에 코인을 받지 않는다
    await assert.rejects(buy(db, me.userId, 'game.breakout', 'breakout-key-01'), rule(409, 'not_for_sale'));
    assert.deepEqual(await counts(db, me.userId), { orders: 0, events: 0, entitlements: 0, ledger: 1, balance: 5000 });

    // 내보내면(live) 같은 키로 살 수 있다
    await db.transaction((tx) => updateGame(tx, 'breakout', { status: 'live' }));
    const out = await buy(db, me.userId, 'game.breakout', 'breakout-key-01');
    assert.deepEqual([out.balance, out.replayed], [3000, false]);
    assert.equal(await canPlayGame(db, me.userId, 'breakout'), true);

    // 내린(retired) 뒤: 새로 사지 못한다. 이미 산 사람의 보유와, 다시 보낸 요청의 답은 그대로다
    await db.transaction((tx) => updateGame(tx, 'breakout', { status: 'retired' }));
    await assert.rejects(buy(db, late.userId, 'game.breakout'), rule(409, 'not_for_sale'));
    assert.deepEqual(await counts(db, late.userId), { orders: 0, events: 0, entitlements: 0, ledger: 1, balance: 5000 });
    assert.deepEqual(await listOwned(db, me.userId), ['game.breakout']);
    assert.deepEqual(await buy(db, me.userId, 'game.breakout', 'breakout-key-01'), { ...out, replayed: true });

    // 게임이 live가 아니어도 그 게임의 아이템은 상품 상태만 본다 (게임 상품에만 거는 규칙이다)
    await db.transaction((tx) => updateGame(tx, 'pinball', { status: 'retired' }));
    assert.equal((await buy(db, late.userId, 'pinball.table.sunset')).balance, 4700);
  }));

test('가격이 0인 상품을 사면 코인 기록 없이 주문·사건·보유가 생긴다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    const out = await buy(db, me.userId, 'pinball.ball.free', 'free-ball-0001');
    assert.deepEqual({ ...out, orderId: '' }, { orderId: '', productId: 'pinball.ball.free', balance: 0, replayed: false });
    assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 3, entitlements: 1, ledger: 0, balance: 0 });
    const events = await eventsOf(db, out.orderId);
    assert.deepEqual(events.map((e) => [e.type, e.ledgerId]), [['created', null], ['completed', null], ['granted', null]]);
    // 다시 보내면 처음 답이다 (그 주문은 잔액을 바꾸지 않았다)
    assert.deepEqual(await buy(db, me.userId, 'pinball.ball.free', 'free-ball-0001'), { ...out, replayed: true });
    await assert.rejects(buy(db, me.userId, 'pinball.ball.free'), rule(409, 'already_owned'));
    assert.deepEqual(await verifyWallets(db), []);
  }));

test('구매가 중간에 실패하면(보유를 넣다 오류) 코인도 주문도 사건도 남지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    // 보유를 넣는 순간 실패하게 한다: 그때는 이미 코인이 빠지고 주문과 사건 둘이 들어간 뒤다
    await db.execute(sql`create function app.fail_entitlement() returns trigger language plpgsql as $$ begin raise exception 'test: entitlement insert fails'; end $$`);
    await db.execute(sql`create trigger fail_entitlement before insert on app.entitlements for each row execute function app.fail_entitlement()`);
    await assert.rejects(buy(db, me.userId, 'pinball.table.sunset', 'broken-key-0001'), (err: unknown) => !rule(409, 'insufficient_coins')(err) && err instanceof Error);
    assert.deepEqual(await counts(db, me.userId), { orders: 0, events: 0, entitlements: 0, ledger: 1, balance: 1000 });
    assert.deepEqual(await verifyWallets(db), []);

    // 고쳐진 뒤 같은 키로 다시 보내면 한 번 사진다
    await db.execute(sql`drop trigger fail_entitlement on app.entitlements`);
    assert.equal((await buy(db, me.userId, 'pinball.table.sunset', 'broken-key-0001')).replayed, false);
    assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 3, entitlements: 1, ledger: 2, balance: 700 });
  }));

test('지워진 사용자의 구매는 401 unauthorized이고 아무것도 남지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    await db.execute(sql`update app.users set status = 'deleted', deleted_at = now() where id = ${me.userId}`);
    await assert.rejects(buy(db, me.userId, 'pinball.table.sunset'), rule(401, 'unauthorized'));
    assert.deepEqual(await counts(db, me.userId), { orders: 0, events: 0, entitlements: 0, ledger: 1, balance: 1000 });
  }));

test('POST /v2/shop/purchase: 로그인해야 하고, 새 잔액과 산 상품을 답하고, 거절은 오류 모양으로 답한다', () =>
  withShop(async (db) => {
    const clock = fakeClock(NOW.toISOString());
    const handler = orderHandler(db, clock);
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 700);

    assert.equal((await call(handler, 'POST', '/v2/shop/purchase', { body: { productId: 'pinball.table.sunset' } })).status, 401);
    assert.equal((await call(handler, 'GET', '/v2/shop/purchase', { token: me.token })).status, 405);

    const ok = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId: 'pinball.table.sunset', idempotencyKey: 'http-buy-0001' } });
    assert.equal(ok.status, 200);
    const [order] = await ordersOf(db, me.userId);
    assert.deepEqual(ok.body, { orderId: order.id, productId: 'pinball.table.sunset', balance: 400, replayed: false });
    assert.equal(ok.headers['cache-control'], 'no-store');
    // 주문의 시각은 요청을 받은 시각이다
    assert.equal(order.createdAt.toISOString(), NOW.toISOString());

    const again = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId: 'pinball.table.sunset', idempotencyKey: 'http-buy-0001' } });
    assert.deepEqual(again.body, { orderId: order.id, productId: 'pinball.table.sunset', balance: 400, replayed: true });

    const owned = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId: 'pinball.table.sunset' } });
    assert.deepEqual([owned.status, codeOf(owned.body)], [409, 'already_owned']);
    const short = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId: 'game.minesweeper' } });
    assert.deepEqual([short.status, codeOf(short.body)], [409, 'insufficient_coins']);
    assert.equal(typeof (short.body as { error: { message: unknown } }).error.message, 'string');
    const hidden = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId: 'pinball.table.neon' } });
    assert.deepEqual([hidden.status, codeOf(hidden.body)], [409, 'not_for_sale']);
    const missing = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId: 'nothing.here' } });
    assert.deepEqual([missing.status, codeOf(missing.body)], [404, 'not_found']);
    const broken = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: '{"productId":' });
    assert.deepEqual([broken.status, codeOf(broken.body)], [400, 'invalid_json']);
    const empty = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token });
    assert.deepEqual([empty.status, codeOf(empty.body)], [400, 'invalid_product_id']);
    assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 3, entitlements: 1, ledger: 2, balance: 400 });
  }));

test('POST /v2/shop/purchase는 사용자당 분당 20번이다', () =>
  withShop(async (db) => {
    const clock = fakeClock(NOW.toISOString());
    const handler = orderHandler(db, clock);
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    for (let i = 0; i < 20; i++) {
      const res = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId: 'nothing.here' } });
      assert.equal(res.status, 404, `${i + 1}번째`);
    }
    const over = await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId: 'nothing.here' } });
    assert.deepEqual([over.status, codeOf(over.body)], [429, 'rate_limited']);
    // 다른 사용자는 따로 센다. 1분 뒤에는 다시 된다
    assert.equal((await call(handler, 'POST', '/v2/shop/purchase', { token: other.token, body: { productId: 'nothing.here' } })).status, 404);
    clock.advance(60_000);
    assert.equal((await call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId: 'nothing.here' } })).status, 404);
  }));
