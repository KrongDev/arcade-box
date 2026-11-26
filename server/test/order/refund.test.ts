import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { equip, grant, listEquipped, listOwned, revoke } from '../../src/entitlement/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { applyCoins, getBalance, verifyWallets } from '../../src/wallet/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { rowsOf } from '../entitlement/helpers.ts';
import { testDb } from '../helpers/db.ts';
import { ledgerOf } from '../wallet/helpers.ts';
import { buy, CHEAP, counts, eventsOf, fund, insertMoneyOrder, NOW, ordersOf, refund, rule, seedShop } from './helpers.ts';

async function withShop(run: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await testDb();
  try {
    await seedShop(db);
    await run(db);
  } finally {
    await close();
  }
}

const LATER = new Date(NOW.getTime() + 60 * 60 * 1000);

test('환불하면: 코인이 돌아오고(reason refund), 보유가 회수되고, 주문이 refunded이고, 사건에 refunded·revoked가 더해진다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    await equip(db, me.userId, 'pinball.table.sunset');
    const adminActionId = await refund(db, orderId, LATER);

    // 코인이 돌아왔다
    const ledger = await ledgerOf(db, me.userId);
    assert.deepEqual(ledger.map((l) => [l.delta, l.balanceAfter, l.reason]), [[1000, 1000, 'grant'], [-300, 700, 'purchase'], [300, 1000, 'refund']]);
    assert.equal(await getBalance(db, me.userId), 1000);
    // 환불의 코인 기록이 왜 생겼는지는 주문 사건이 가리킨다 (코인 기록은 운영자 지급·조정일 때만 admin_action_id를 가진다)
    assert.equal(ledger[2].adminActionId, null);

    // 보유가 회수됐고 장착도 풀렸다
    const [owned] = await rowsOf(db, me.userId);
    assert.equal(owned.revokeReason, 'refund');
    assert.ok(owned.revokedAt instanceof Date);
    assert.deepEqual(await listOwned(db, me.userId), []);
    assert.deepEqual(await listEquipped(db, me.userId), []);

    // 주문이 refunded다. 구매 당시 값과 보유를 가리키는 값은 그대로 남는다
    const [order] = await ordersOf(db, me.userId);
    assert.deepEqual(
      [order.status, order.completedAt?.toISOString(), order.refundedAt?.toISOString(), order.entitlementId, order.productName, order.priceAmount],
      ['refunded', NOW.toISOString(), LATER.toISOString(), owned.id, '노을', 300],
    );

    // 사건: 앞의 셋은 그대로이고 refunded·revoked가 더해졌다
    const events = await eventsOf(db, orderId);
    assert.deepEqual(
      events.map((e) => [e.type, e.fromStatus, e.toStatus, e.actor, e.ledgerId, e.adminActionId]),
      [
        ['created', null, 'pending', 'user', null, null],
        ['completed', 'pending', 'completed', 'system', ledger[1].id, null],
        ['granted', null, null, 'system', null, null],
        ['refunded', 'completed', 'refunded', 'admin', ledger[2].id, adminActionId],
        ['revoked', null, null, 'admin', null, adminActionId],
      ],
    );
    assert.deepEqual(events[4].detail, { entitlementId: owned.id });
    assert.deepEqual(await verifyWallets(db), []);
  }));

test('두 번 환불하면 409 already_refunded', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    await refund(db, orderId);
    const before = await counts(db, me.userId);
    await assert.rejects(refund(db, orderId), rule(409, 'already_refunded'));
    // 코인은 한 번만 돌아왔고 사건도 늘지 않았다. 거절된 환불의 운영 기록도 남지 않는다
    assert.deepEqual(await counts(db, me.userId), before);
    assert.deepEqual(before, { orders: 1, events: 5, entitlements: 1, ledger: 3, balance: 1000 });
    const actions = (await db.execute(sql`select count(*)::int as n from app.admin_actions`)) as unknown as { rows: Array<{ n: number }> };
    assert.equal(actions.rows[0].n, 1);
  }));

test('없는 주문은 404 not_found, 현금 주문은 409 not_coin_order', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid', '', "1' or '1'='1", 'a\u0000b']) {
      await assert.rejects(refund(db, id), rule(404, 'not_found'), id);
    }
    const money = await insertMoneyOrder(db, me.userId, NOW);
    await assert.rejects(refund(db, money), rule(409, 'not_coin_order'));
    const [order] = await ordersOf(db, me.userId);
    assert.equal(order.status, 'completed');
    assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 2, entitlements: 0, ledger: 0, balance: null });
  }));

test('환불한 상품은 다시 살 수 있고, 새 주문과 새 보유가 생긴다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 300);
    const first = await buy(db, me.userId, 'pinball.table.sunset', 'first-buy-0001');
    await refund(db, first.orderId);
    const second = await buy(db, me.userId, 'pinball.table.sunset', 'second-buy-001', LATER);
    assert.notEqual(second.orderId, first.orderId);
    assert.equal(second.balance, 0);
    const rows = await ordersOf(db, me.userId);
    assert.deepEqual(rows.map((o) => o.status), ['refunded', 'completed']);
    assert.notEqual(rows[0].entitlementId, rows[1].entitlementId);
    assert.deepEqual(await listOwned(db, me.userId), ['pinball.table.sunset']);
    // 환불된 옛 주문을 다시 환불할 수 없고, 새 보유는 그대로다
    await assert.rejects(refund(db, first.orderId), rule(409, 'already_refunded'));
    assert.deepEqual(await listOwned(db, me.userId), ['pinball.table.sunset']);
  }));

test('운영자가 이미 회수한 보유의 주문을 환불하면: 코인은 돌아오고 주문은 refunded이고, 회수 사건 대신 note가 남는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 300);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    await db.transaction((tx) => revoke(tx, { userId: me.userId, productId: 'pinball.table.sunset', reason: 'admin' }));
    await refund(db, orderId);
    assert.equal(await getBalance(db, me.userId), 300);
    const [order] = await ordersOf(db, me.userId);
    assert.equal(order.status, 'refunded');
    const events = await eventsOf(db, orderId);
    assert.deepEqual(events.map((e) => e.type), ['created', 'completed', 'granted', 'refunded', 'note']);
    assert.deepEqual(events[4].detail, { entitlement: 'already_revoked', entitlementId: order.entitlementId });
    // 회수 까닭은 운영자가 회수한 그대로다 (환불이 덮어쓰지 않는다)
    const [owned] = await rowsOf(db, me.userId);
    assert.equal(owned.revokeReason, 'admin');
  }));

test('회수된 뒤 다시 받은 보유는 옛 주문의 환불이 건드리지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 300);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    // 운영자가 회수했다가 다시 줬다: 지금 켜진 보유는 이 주문이 만든 것이 아니다
    await db.transaction(async (tx) => {
      await revoke(tx, { userId: me.userId, productId: 'pinball.table.sunset', reason: 'admin' });
      await grant(tx, { userId: me.userId, productId: 'pinball.table.sunset', source: 'grant' });
    });
    await equip(db, me.userId, 'pinball.table.sunset');
    await refund(db, orderId);
    assert.equal(await getBalance(db, me.userId), 300);
    assert.deepEqual(await listOwned(db, me.userId), ['pinball.table.sunset']);
    assert.deepEqual((await listEquipped(db, me.userId)).map((e) => e.productId), ['pinball.table.sunset']);
    assert.deepEqual((await rowsOf(db, me.userId)).map((e) => [e.source, e.revokeReason]), [['coin_purchase', 'admin'], ['grant', null]]);
    assert.deepEqual((await eventsOf(db, orderId)).map((e) => e.type), ['created', 'completed', 'granted', 'refunded', 'note']);
  }));

test('지워진 사용자의 주문은 환불할 수 없다: 404 not_found이고 아무것도 바뀌지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    // 계정 삭제는 코인 주문을 함께 지운다. 삭제와 환불이 겹친 순간을 흉내 내려고 사용자 행만 deleted로 바꾼다
    await db.execute(sql`update app.users set status = 'deleted', deleted_at = now() where id = ${me.userId}`);
    const before = await counts(db, me.userId);
    await assert.rejects(refund(db, orderId), rule(404, 'not_found'));
    assert.deepEqual(await counts(db, me.userId), before);
    assert.equal((await ordersOf(db, me.userId))[0].status, 'completed');
    assert.equal((await rowsOf(db, me.userId))[0].revokedAt, null);
  }));

test('코인을 돌려줄 수 없으면(지갑 상한) 환불 전체가 거절되고 주문과 보유가 그대로다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 300);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    await fund(db, me.userId, 9_000_000_000_000_000 - 100);
    const before = await counts(db, me.userId);
    await assert.rejects(refund(db, orderId), rule(409, 'balance_limit'));
    assert.deepEqual(await counts(db, me.userId), before);
    assert.equal((await ordersOf(db, me.userId))[0].status, 'completed');
    assert.deepEqual(await listOwned(db, me.userId), ['pinball.table.sunset']);
    assert.deepEqual((await eventsOf(db, orderId)).map((e) => e.type), ['created', 'completed', 'granted']);
    assert.deepEqual(await verifyWallets(db), []);
  }));

test('가격이 0이던 주문을 환불하면 코인 기록 없이 보유만 회수된다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    const { orderId } = await buy(db, me.userId, 'pinball.ball.free');
    await refund(db, orderId);
    assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 5, entitlements: 1, ledger: 0, balance: 0 });
    assert.deepEqual((await eventsOf(db, orderId)).map((e) => [e.type, e.ledgerId]).slice(3), [['refunded', null], ['revoked', null]]);
    assert.deepEqual(await listOwned(db, me.userId), []);
  }));

/** 씨앗이 같으면 늘 같은 순서를 내는 난수 (mulberry32) */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('임의의 순서로 벌기·사기·환불·지급·회수를 섞어도 잔액이 기록의 합과 같고 0 아래로 내려가지 않는다', () =>
  withShop(async (db) => {
    for (const seed of [1, 2, 3]) {
      const random = prng(seed);
      const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
      const me = await loginGuest(db, NOW);
      const goods = ['pinball.table.sunset', ...CHEAP.slice(0, 4)];
      let expected = 0;
      let step = 0;
      const allowed = new Set(['already_owned', 'insufficient_coins', 'already_refunded', 'not_owned']);
      for (; step < 60; step++) {
        const at = new Date(NOW.getTime() + step * 1000);
        const kind = pick(['earn', 'buy', 'buy', 'refund', 'grant', 'revoke'] as const);
        try {
          if (kind === 'earn') {
            const coins = 1 + Math.floor(random() * 400);
            await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: coins, reason: 'run', now: at }));
            expected += coins;
          } else if (kind === 'buy') {
            const out = await buy(db, me.userId, pick(goods), undefined, at);
            expected -= 300;
            assert.equal(out.balance, expected);
          } else if (kind === 'refund') {
            // 이미 환불한 주문도 고른다 (그때는 already_refunded로 거절되고 코인이 또 돌아오지 않는다)
            const all = await ordersOf(db, me.userId);
            if (all.length === 0) continue;
            await refund(db, pick(all).id, at);
            expected += 300;
          } else if (kind === 'grant') {
            await db.transaction((tx) => grant(tx, { userId: me.userId, productId: pick(goods), source: 'grant' }));
          } else {
            await db.transaction((tx) => revoke(tx, { userId: me.userId, productId: pick(goods), reason: 'admin' }));
          }
        } catch (err) {
          // 규칙이 거절한 것만 지나간다 (이미 가졌거나, 모자라거나, 이미 환불했거나, 가지지 않았거나). 거절은 아무것도 바꾸지 않는다
          if (!(err instanceof RuleError) || !allowed.has(err.code)) throw err;
        }
        const balance = await getBalance(db, me.userId);
        assert.equal(balance, expected, `씨앗 ${seed}, ${step}번째 ${kind}`);
        assert.ok(balance >= 0);
      }
      // 주문마다: 환불된 주문은 코인이 돌아왔고, 완료된 주문은 사건이 셋이다. 코인 기록은 구매와 환불이 짝을 이룬다
      const rows = await ordersOf(db, me.userId);
      const ledger = await ledgerOf(db, me.userId);
      assert.equal(ledger.filter((l) => l.reason === 'purchase').length, rows.length);
      assert.equal(ledger.filter((l) => l.reason === 'refund').length, rows.filter((o) => o.status === 'refunded').length);
      assert.ok(rows.length > 3, `씨앗 ${seed}: 주문이 충분히 생겼다 (${rows.length})`);
      assert.ok(rows.some((o) => o.status === 'refunded'), `씨앗 ${seed}: 환불된 주문이 있다`);
    }
    assert.deepEqual(await verifyWallets(db), []);
  }));
