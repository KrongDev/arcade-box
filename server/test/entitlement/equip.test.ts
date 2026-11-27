import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equip, grant, listEquipped, owns, revoke } from '../../src/entitlement/index.ts';
import { createProduct, getProduct, updateProduct } from '../../src/product/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { entitlementHandler, NOW, rule, seedCatalog } from './helpers.ts';

const give = (db: Db, userId: string, productId: string) => db.transaction((tx) => grant(tx, { userId, productId, source: 'grant' }));
const take = (db: Db, userId: string, productId: string) => db.transaction((tx) => revoke(tx, { userId, productId, reason: 'admin' }));

test('가진 아이템을 장착하면 같은 게임·같은 자리의 이전 것이 바뀐다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await give(db, me.userId, 'pinball.table.sunset');
    await give(db, me.userId, 'pinball.ball.gold');
    await give(db, me.userId, 'minesweeper.tile.mint');

    // everyone 아이템은 누구나 가진 것이라 장착된다
    await equip(db, me.userId, 'pinball.table.classic');
    assert.deepEqual(await listEquipped(db, me.userId), [{ gameId: 'pinball', slot: 'table', productId: 'pinball.table.classic' }]);
    await equip(db, me.userId, 'pinball.table.sunset');
    await equip(db, me.userId, 'pinball.ball.gold');
    await equip(db, me.userId, 'minesweeper.tile.mint');
    assert.deepEqual(await listEquipped(db, me.userId), [
      { gameId: 'minesweeper', slot: 'tile', productId: 'minesweeper.tile.mint' },
      { gameId: 'pinball', slot: 'ball', productId: 'pinball.ball.gold' },
      { gameId: 'pinball', slot: 'table', productId: 'pinball.table.sunset' },
    ]);
    // 같은 것을 다시 장착해도 그대로다
    await equip(db, me.userId, 'pinball.table.sunset');
    assert.equal((await listEquipped(db, me.userId)).length, 3);
    assert.deepEqual(await listEquipped(db, other.userId), [], '다른 사용자의 장착은 그대로다');
  } finally {
    await close();
  }
});

test('가지지 않은 아이템은 403 not_owned, 게임 상품은 400 not_item', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    // v1은 유료 아이템을 확인 없이 장착했다. v2는 종류와 상관없이 가진 것만 (K18)
    await assert.rejects(equip(db, me.userId, 'pinball.table.neon'), rule(403, 'not_owned'), '유료(hidden) 아이템');
    await assert.rejects(equip(db, me.userId, 'pinball.table.sunset'), rule(403, 'not_owned'), '코인 아이템');
    await assert.rejects(equip(db, me.userId, 'game.pinball'), rule(400, 'not_item'));
    await assert.rejects(equip(db, me.userId, 'coins.1000'), rule(400, 'not_item'));
    await assert.rejects(equip(db, me.userId, 'none.here'), rule(404, 'not_found'));
    await assert.rejects(equip(db, me.userId, '../x'), rule(404, 'not_found'));
    for (const bad of [undefined, null, 5, ['pinball.table.classic'], { id: 'x' }]) await assert.rejects(equip(db, me.userId, bad), rule(400, 'invalid_product_id'), JSON.stringify(bad));
    assert.deepEqual(await listEquipped(db, me.userId), []);
  } finally {
    await close();
  }
});

test('장착한 아이템을 회수하면 장착도 풀린다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    await give(db, me.userId, 'pinball.table.sunset');
    await give(db, me.userId, 'pinball.ball.gold');
    await equip(db, me.userId, 'pinball.table.sunset');
    await equip(db, me.userId, 'pinball.ball.gold');
    await take(db, me.userId, 'pinball.table.sunset');
    assert.deepEqual(await listEquipped(db, me.userId), [{ gameId: 'pinball', slot: 'ball', productId: 'pinball.ball.gold' }]);
    await assert.rejects(equip(db, me.userId, 'pinball.table.sunset'), rule(403, 'not_owned'));
    // 장착하지 않은 것을 회수해도 다른 장착은 그대로다
    await give(db, me.userId, 'minesweeper.tile.mint');
    await take(db, me.userId, 'minesweeper.tile.mint');
    assert.deepEqual(await listEquipped(db, me.userId), [{ gameId: 'pinball', slot: 'ball', productId: 'pinball.ball.gold' }]);
  } finally {
    await close();
  }
});

test('PUT /v2/me/equipped: 로그인한 사용자의 장착을 바꾸고 바뀐 장착 목록을 준다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const clock = fakeClock('2026-11-26T03:00:00Z');
    const h = entitlementHandler(db, clock);
    const me = await loginGuest(db, NOW);
    await give(db, me.userId, 'pinball.table.sunset');

    const ok = await call(h, 'PUT', '/v2/me/equipped', { token: me.token, body: { productId: 'pinball.table.sunset' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { equipped: [{ gameId: 'pinball', slot: 'table', productId: 'pinball.table.sunset' }] });

    const notOwned = await call(h, 'PUT', '/v2/me/equipped', { token: me.token, body: { productId: 'pinball.ball.gold' } });
    assert.equal(notOwned.status, 403);
    assert.equal((notOwned.body as { error: { code: string } }).error.code, 'not_owned');
    assert.equal((await call(h, 'PUT', '/v2/me/equipped', { token: me.token, body: {} })).status, 400);
    assert.equal((await call(h, 'PUT', '/v2/me/equipped', { token: me.token, body: 'not json' })).status, 400);
    assert.equal((await call(h, 'PUT', '/v2/me/equipped', { body: { productId: 'pinball.table.classic' } })).status, 401);
    assert.equal((await call(h, 'GET', '/v2/me/equipped', { token: me.token })).status, 405);
  } finally {
    await close();
  }
});

test('everyone이던 아이템을 purchase로 바꾸면 장착 목록에서 빠지고, 지급하면 다시 보인다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    await equip(db, me.userId, 'pinball.table.classic');
    await db.transaction((tx) => updateProduct(tx, 'pinball.table.classic', { access: 'purchase' }));
    assert.deepEqual(await listEquipped(db, me.userId), [], '가지지 않은 것은 장착된 것으로 내려 주지 않는다');
    await assert.rejects(equip(db, me.userId, 'pinball.table.classic'), rule(403, 'not_owned'));
    await give(db, me.userId, 'pinball.table.classic');
    assert.deepEqual(await listEquipped(db, me.userId), [{ gameId: 'pinball', slot: 'table', productId: 'pinball.table.classic' }]);
  } finally {
    await close();
  }
});

test('draft인 everyone 아이템은 장착되지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    await db.transaction((tx) => createProduct(tx, { id: 'pinball.ball.silver', kind: 'item', name: '은 공', access: 'everyone', gameId: 'pinball', slot: 'ball' }));
    const me = await loginGuest(db, NOW);
    assert.equal(await owns(db, me.userId, (await getProduct(db, 'pinball.ball.silver'))!), false);
    await assert.rejects(equip(db, me.userId, 'pinball.ball.silver'), rule(403, 'not_owned'));
    for (const status of ['hidden', 'retired'] as const) {
      await db.transaction((tx) => updateProduct(tx, 'pinball.ball.silver', { status }));
      await assert.rejects(equip(db, me.userId, 'pinball.ball.silver'), rule(403, 'not_owned'), status);
    }
    await db.transaction((tx) => updateProduct(tx, 'pinball.ball.silver', { status: 'on_sale' }));
    await equip(db, me.userId, 'pinball.ball.silver');
    assert.deepEqual(await listEquipped(db, me.userId), [{ gameId: 'pinball', slot: 'ball', productId: 'pinball.ball.silver' }]);
  } finally {
    await close();
  }
});

test('on_sale이던 everyone 아이템을 retired로 바꾸면 장착 목록에서 빠진다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    await equip(db, me.userId, 'pinball.table.classic');
    await db.transaction((tx) => updateProduct(tx, 'pinball.table.classic', { status: 'retired' }));
    assert.deepEqual(await listEquipped(db, me.userId), []);
    assert.equal(await owns(db, me.userId, (await getProduct(db, 'pinball.table.classic'))!), false);
  } finally {
    await close();
  }
});

test('retired로 바뀐 상품도 지급받은 사람은 계속 가진다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await give(db, me.userId, 'pinball.table.sunset');
    await equip(db, me.userId, 'pinball.table.sunset');
    await db.transaction((tx) => updateProduct(tx, 'pinball.table.sunset', { status: 'retired' }));
    const p = (await getProduct(db, 'pinball.table.sunset'))!;
    assert.equal(await owns(db, me.userId, p), true);
    assert.equal(await owns(db, other.userId, p), false);
    assert.deepEqual(await listEquipped(db, me.userId), [{ gameId: 'pinball', slot: 'table', productId: 'pinball.table.sunset' }]);
    // hidden 상품(neon)도 운영자는 줄 수 있고, 받은 사람은 장착한다
    await give(db, me.userId, 'pinball.table.neon');
    await equip(db, me.userId, 'pinball.table.neon');
    assert.equal((await listEquipped(db, me.userId))[0].productId, 'pinball.table.neon');
    // retired 상품도 운영자 지급은 된다 (not_grantable은 consumable·everyone일 때만)
    await give(db, other.userId, 'pinball.table.sunset');
    assert.equal(await owns(db, other.userId, p), true);
  } finally {
    await close();
  }
});
