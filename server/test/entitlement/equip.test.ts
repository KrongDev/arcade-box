import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equip, grant, listEquipped, revoke } from '../../src/entitlement/index.ts';
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
