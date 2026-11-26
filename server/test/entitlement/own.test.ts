import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount } from '../../src/account/index.ts';
import { canPlayGame, countOwnedGames, grant, listEquipped, listOwned, owns, purgeUser, revoke, equip } from '../../src/entitlement/index.ts';
import { entitlements, equippedItems } from '../../src/entitlement/schema.ts';
import { createGame, updateGame } from '../../src/game/index.ts';
import { getProduct, updateProduct } from '../../src/product/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { loginGuest, noPolicy } from '../account/helpers.ts';
import { testDb } from '../helpers/db.ts';
import { NOW, rowsOf, rule, seedCatalog } from './helpers.ts';

const give = (db: Db, userId: string, productId: string, source: 'coin_purchase' | 'store_purchase' | 'grant' = 'grant') => db.transaction((tx) => grant(tx, { userId, productId, source }));
const take = (db: Db, userId: string, productId: string, reason: 'refund' | 'admin' = 'admin') => db.transaction((tx) => revoke(tx, { userId, productId, reason }));
const product = async (db: Db, id: string) => (await getProduct(db, id))!;

test('everyone 상품은 보유 행 없이 누구나 가진 것이다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    assert.equal(await owns(db, me.userId, await product(db, 'game.pinball')), true);
    assert.equal(await owns(db, me.userId, await product(db, 'pinball.table.classic')), true);
    assert.equal(await owns(db, me.userId, await product(db, 'pinball.table.sunset')), false);
    assert.equal(await owns(db, me.userId, await product(db, 'game.minesweeper')), false);
    assert.deepEqual(await rowsOf(db, me.userId), []);
    assert.deepEqual(await listOwned(db, me.userId), [], '보유 행이 있는 것만 센다');
    assert.equal(await countOwnedGames(db, me.userId), 0);
    // 사용자 ID 모양이 아니어도 쿼리 오류(500)가 나지 않는다
    assert.equal(await owns(db, 'not-a-uuid', await product(db, 'pinball.table.sunset')), false);
  } finally {
    await close();
  }
});

test('지급하면 owns가 참이고, 두 번 지급하면 409 already_owned', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    const id = await give(db, me.userId, 'pinball.table.sunset', 'coin_purchase');
    assert.equal(typeof id, 'number');
    assert.equal(await owns(db, me.userId, await product(db, 'pinball.table.sunset')), true);
    assert.equal(await owns(db, other.userId, await product(db, 'pinball.table.sunset')), false, '다른 사용자는 아니다');
    await assert.rejects(give(db, me.userId, 'pinball.table.sunset'), rule(409, 'already_owned'));
    const rows = await rowsOf(db, me.userId);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { id: rows[0].id, productId: rows[0].productId, source: rows[0].source, revokedAt: rows[0].revokedAt, revokeReason: rows[0].revokeReason, adminActionId: rows[0].adminActionId },
      { id, productId: 'pinball.table.sunset', source: 'coin_purchase', revokedAt: null, revokeReason: null, adminActionId: null },
    );

    // hidden 상품(운영자 지급만 되는 유료 아이템)과 게임도 줄 수 있다
    await give(db, me.userId, 'pinball.table.neon');
    await give(db, me.userId, 'game.minesweeper', 'store_purchase');
    assert.deepEqual(await listOwned(db, me.userId), ['game.minesweeper', 'pinball.table.neon', 'pinball.table.sunset']);
    assert.equal(await countOwnedGames(db, me.userId), 1);

    await assert.rejects(give(db, me.userId, 'none.here'), rule(404, 'not_found'));
    await assert.rejects(give(db, me.userId, '../x'), rule(404, 'not_found'));
    await assert.rejects(db.transaction((tx) => grant(tx, { userId: me.userId, productId: 'pinball.ball.gold', source: 'gift' as never })), rule(400, 'invalid_source'));
  } finally {
    await close();
  }
});

test('회수하면 owns가 거짓이고 행은 revoked_at이 채워진 채 남는다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    await give(db, me.userId, 'game.minesweeper');
    await take(db, me.userId, 'game.minesweeper', 'refund');
    assert.equal(await owns(db, me.userId, await product(db, 'game.minesweeper')), false);
    const rows = await rowsOf(db, me.userId);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].revokedAt instanceof Date);
    assert.equal(rows[0].revokeReason, 'refund');
    assert.deepEqual(await listOwned(db, me.userId), []);
    assert.equal(await countOwnedGames(db, me.userId), 0);
    await assert.rejects(take(db, me.userId, 'game.minesweeper'), rule(409, 'not_owned'), '이미 회수했다');
    await assert.rejects(take(db, me.userId, 'pinball.ball.gold'), rule(409, 'not_owned'), '가진 적 없다');
    await assert.rejects(take(db, me.userId, 'none.here'), rule(404, 'not_found'));
    await assert.rejects(db.transaction((tx) => revoke(tx, { userId: me.userId, productId: 'game.minesweeper', reason: 'whim' as never })), rule(400, 'invalid_reason'));
  } finally {
    await close();
  }
});

test('회수한 뒤 다시 지급하면 새 행이 생긴다 (켜진 보유는 늘 하나)', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    const first = await give(db, me.userId, 'pinball.ball.gold');
    await take(db, me.userId, 'pinball.ball.gold');
    const second = await give(db, me.userId, 'pinball.ball.gold');
    assert.notEqual(second, first);
    const rows = await rowsOf(db, me.userId);
    assert.deepEqual(rows.map((r) => [r.id, r.revokedAt === null]), [[first, false], [second, true]]);
    assert.equal(await owns(db, me.userId, await product(db, 'pinball.ball.gold')), true);
    await assert.rejects(give(db, me.userId, 'pinball.ball.gold'), rule(409, 'already_owned'));
    // DB도 켜진 보유 둘을 막는다
    await assert.rejects(db.insert(entitlements).values({ userId: me.userId, productId: 'pinball.ball.gold', source: 'grant' }));
  } finally {
    await close();
  }
});

test('코인 묶음과 everyone 상품은 400 not_grantable', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    for (const id of ['coins.1000', 'game.pinball', 'pinball.table.classic']) await assert.rejects(give(db, me.userId, id), rule(400, 'not_grantable'), id);
    assert.deepEqual(await rowsOf(db, me.userId), []);
  } finally {
    await close();
  }
});

test('canPlayGame: 게임 상품이 everyone이면 참, purchase인데 안 샀으면 거짓, draft 게임이면 거짓', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    assert.equal(await canPlayGame(db, me.userId, 'pinball'), true);
    assert.equal(await canPlayGame(db, me.userId, 'minesweeper'), false);
    assert.equal(await canPlayGame(db, me.userId, 'breakout'), false, 'draft 게임 (상품은 everyone)');
    assert.equal(await canPlayGame(db, me.userId, 'nogame'), false);
    assert.equal(await canPlayGame(db, me.userId, '../x'), false);

    await give(db, me.userId, 'game.minesweeper', 'coin_purchase');
    assert.equal(await canPlayGame(db, me.userId, 'minesweeper'), true);
    await take(db, me.userId, 'game.minesweeper', 'refund');
    assert.equal(await canPlayGame(db, me.userId, 'minesweeper'), false, '회수하면 다시 못 한다');

    // retired 게임도 못 한다. 게임 상품이 없는 live 게임도 못 한다
    await db.transaction((tx) => updateGame(tx, 'pinball', { status: 'retired' }));
    assert.equal(await canPlayGame(db, me.userId, 'pinball'), false);
    await db.transaction(async (tx) => {
      await createGame(tx, { id: 'tetra', name: 'tetra', description: '' });
      await updateGame(tx, 'tetra', { status: 'live' });
    });
    assert.equal(await canPlayGame(db, me.userId, 'tetra'), false);
    // 게임 상품을 purchase로 바꾸면 보유가 있어야 한다
    await db.transaction((tx) => updateGame(tx, 'pinball', { status: 'live' }));
    await db.transaction((tx) => updateProduct(tx, 'game.pinball', { access: 'purchase' }));
    assert.equal(await canPlayGame(db, me.userId, 'pinball'), false);
  } finally {
    await close();
  }
});

test('지워진 사용자에게는 지급·회수·장착이 401이고 행이 붙지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    await deleteAccount(db, me.userId, { ...noPolicy, mustKeepUserRow: async () => true }, NOW);
    await assert.rejects(give(db, me.userId, 'pinball.ball.gold'), rule(401, 'unauthorized'));
    await assert.rejects(take(db, me.userId, 'pinball.ball.gold'), rule(401, 'unauthorized'));
    await assert.rejects(equip(db, me.userId, 'pinball.table.classic'), rule(401, 'unauthorized'));
    await assert.rejects(give(db, '00000000-0000-4000-8000-000000000000', 'pinball.ball.gold'), rule(401, 'unauthorized'), '없는 사용자');
    assert.deepEqual(await db.select().from(entitlements), []);
    assert.deepEqual(await db.select().from(equippedItems), []);
  } finally {
    await close();
  }
});

test('purgeUser는 이 사용자의 보유와 장착만 지운다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    for (const u of [me, other]) {
      await give(db, u.userId, 'pinball.table.sunset');
      await give(db, u.userId, 'pinball.ball.gold');
      await take(db, u.userId, 'pinball.ball.gold');
      await equip(db, u.userId, 'pinball.table.sunset');
    }
    await db.transaction((tx) => purgeUser(tx, me.userId));
    assert.deepEqual(await rowsOf(db, me.userId), []);
    assert.deepEqual(await listEquipped(db, me.userId), []);
    assert.equal((await rowsOf(db, other.userId)).length, 2);
    assert.deepEqual(await listEquipped(db, other.userId), [{ gameId: 'pinball', slot: 'table', productId: 'pinball.table.sunset' }]);
  } finally {
    await close();
  }
});
