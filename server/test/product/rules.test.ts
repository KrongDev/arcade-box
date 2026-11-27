import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { checkProductShape, gameProduct, getProduct, updateProduct, type Product } from '../../src/product/index.ts';
import { testDb } from '../helpers/db.ts';
import { add, games, pgError, rule } from './helpers.ts';

/** 규칙 함수에 넣는 온전한 상품. 경우마다 몇 칸만 바꿔 넣는다 */
const base: Product = {
  id: 'game.pinball',
  kind: 'game',
  name: '핀볼',
  description: '',
  iconPath: null,
  gameId: 'pinball',
  slot: null,
  access: 'everyone',
  status: 'on_sale',
  consumable: false,
  grantCoins: null,
  sortOrder: 0,
};
const item: Product = { ...base, id: 'pinball.table.neon', kind: 'item', slot: 'table', access: 'purchase' };
const pack: Product = { ...base, id: 'coins.1000', kind: 'coin_pack', gameId: null, consumable: true, grantCoins: 1000, access: 'purchase' };

const shapeError = (code: string) => (err: unknown) => rule(400, code)(err);

test('game 상품은 game_id가 꼭 있고 slot이 없어야 한다', async () => {
  checkProductShape(base);
  assert.throws(() => checkProductShape({ ...base, gameId: null }), shapeError('invalid_product_shape'));
  assert.throws(() => checkProductShape({ ...base, slot: 'table' }), shapeError('invalid_product_shape'));
  assert.throws(() => checkProductShape({ ...base, consumable: true }), shapeError('invalid_product_shape'));
  assert.throws(() => checkProductShape({ ...base, grantCoins: 10 }), shapeError('invalid_product_shape'));

  const { db, close } = await testDb();
  try {
    await games(db, ['pinball']);
    await assert.rejects(add(db, { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'everyone' }), rule(400, 'invalid_product_shape'), 'game_id 없음');
    await assert.rejects(add(db, { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'everyone', gameId: 'pinball', slot: 'x' }), rule(400, 'invalid_product_shape'));
    await assert.rejects(add(db, { id: 'game.nogame', kind: 'game', name: '없는 게임', access: 'everyone', gameId: 'nogame' }), rule(404, 'not_found'), '없는 게임');
    await add(db, { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'everyone', gameId: 'pinball' });
    assert.deepEqual(await getProduct(db, 'game.pinball'), { ...base, status: 'draft' });
    assert.deepEqual(await gameProduct(db, 'pinball'), { ...base, status: 'draft' });
    assert.equal(await gameProduct(db, 'breakout'), null);
    assert.equal(await getProduct(db, 'none.here'), null);
    assert.equal(await getProduct(db, '../x'), null);
  } finally {
    await close();
  }
});

test('item 상품은 game_id와 slot이 꼭 있어야 한다', async () => {
  checkProductShape(item);
  assert.throws(() => checkProductShape({ ...item, slot: null }), shapeError('invalid_product_shape'));
  assert.throws(() => checkProductShape({ ...item, gameId: null }), shapeError('invalid_product_shape'));
  assert.throws(() => checkProductShape({ ...item, consumable: true }), shapeError('invalid_product_shape'));
  assert.throws(() => checkProductShape({ ...item, slot: 'Table!' }), shapeError('invalid_slot'));
  assert.throws(() => checkProductShape({ ...item, id: 'Pinball.Table' }), shapeError('invalid_product_id'));
  assert.throws(() => checkProductShape({ ...item, id: 'x' }), shapeError('invalid_product_id'));
  assert.throws(() => checkProductShape({ ...item, kind: 'hat' as never }), shapeError('invalid_kind'));
  assert.throws(() => checkProductShape({ ...item, access: 'vip' as never }), shapeError('invalid_access'));
  assert.throws(() => checkProductShape({ ...item, status: 'sold' as never }), shapeError('invalid_status'));
  assert.throws(() => checkProductShape({ ...item, name: '' }), shapeError('invalid_name'));
  assert.throws(() => checkProductShape({ ...item, description: '탭\t' }), shapeError('invalid_description'));
  checkProductShape({ ...item, description: '첫 줄\n둘째 줄' });
  assert.throws(() => checkProductShape({ ...item, iconPath: '../a.png' }), shapeError('invalid_icon'));
  assert.throws(() => checkProductShape({ ...item, sortOrder: -1 }), shapeError('invalid_sort_order'));

  const { db, close } = await testDb();
  try {
    await games(db, ['pinball']);
    await assert.rejects(add(db, { id: 'pinball.table.neon', kind: 'item', name: '네온', access: 'purchase', gameId: 'pinball' }), rule(400, 'invalid_product_shape'));
    await add(db, { id: 'pinball.table.neon', kind: 'item', name: '네온', access: 'purchase', gameId: 'pinball', slot: 'table' });
    await add(db, { id: 'pinball.table.sunset', kind: 'item', name: '노을', access: 'purchase', gameId: 'pinball', slot: 'table' });
    assert.equal((await getProduct(db, 'pinball.table.sunset'))?.slot, 'table', '한 게임·자리에 아이템은 여럿이다');
    await assert.rejects(add(db, { id: 'pinball.table.neon', kind: 'item', name: '또', access: 'purchase', gameId: 'pinball', slot: 'table' }), rule(409, 'already_exists'));

    // kind와 id, 게임과 자리는 고칠 수 없다. 나머지는 고친 뒤에도 규칙을 지켜야 한다
    await db.transaction((tx) => updateProduct(tx, 'pinball.table.neon', { name: '네온 2', status: 'on_sale', sortOrder: 5, description: '반짝' }));
    const p = await getProduct(db, 'pinball.table.neon');
    assert.deepEqual({ name: p?.name, status: p?.status, sortOrder: p?.sortOrder, description: p?.description }, { name: '네온 2', status: 'on_sale', sortOrder: 5, description: '반짝' });
    for (const patch of [{ kind: 'game' }, { id: 'x.y' }, { gameId: 'other' }, { slot: 'ball' }, { consumable: true }]) {
      await assert.rejects(db.transaction((tx) => updateProduct(tx, 'pinball.table.neon', patch as never)), rule(400, 'not_updatable'), JSON.stringify(patch));
    }
    await assert.rejects(db.transaction((tx) => updateProduct(tx, 'pinball.table.neon', { grantCoins: 100 })), rule(400, 'invalid_product_shape'));
    await assert.rejects(db.transaction((tx) => updateProduct(tx, 'pinball.table.neon', {})), rule(400, 'nothing_to_update'));
    await assert.rejects(db.transaction((tx) => updateProduct(tx, 'none.here', { name: 'x' })), rule(404, 'not_found'));
  } finally {
    await close();
  }
});

test('coin_pack 상품은 consumable이 참이고 grant_coins가 0보다 커야 한다', async () => {
  checkProductShape(pack);
  for (const patch of [{ consumable: false }, { grantCoins: 0 }, { grantCoins: -5 }, { grantCoins: null }, { grantCoins: 1.5 }, { slot: 'x' }, { gameId: 'pinball' }]) {
    assert.throws(() => checkProductShape({ ...pack, ...patch }), shapeError('invalid_product_shape'), JSON.stringify(patch));
  }
  const { db, close } = await testDb();
  try {
    // consumable을 적지 않으면 coin_pack은 참이다
    await add(db, { id: 'coins.1000', kind: 'coin_pack', name: '코인 1000', access: 'purchase', grantCoins: 1000 });
    assert.deepEqual(await getProduct(db, 'coins.1000'), { ...pack, name: '코인 1000', status: 'draft' });
    await assert.rejects(add(db, { id: 'coins.0', kind: 'coin_pack', name: '코인 0', access: 'purchase', grantCoins: 0 }), rule(400, 'invalid_product_shape'));
    await db.transaction((tx) => updateProduct(tx, 'coins.1000', { grantCoins: 1200 }));
    assert.equal((await getProduct(db, 'coins.1000'))?.grantCoins, 1200);
  } finally {
    await close();
  }
});

test('한 게임에 game 상품을 둘 만들 수 없다', async () => {
  const { db, close } = await testDb();
  try {
    await games(db, ['pinball', 'breakout']);
    await add(db, { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'everyone', gameId: 'pinball' });
    await assert.rejects(add(db, { id: 'game.pinball2', kind: 'game', name: '핀볼 또', access: 'purchase', gameId: 'pinball' }), rule(409, 'game_product_exists'));
    await add(db, { id: 'game.breakout', kind: 'game', name: '벽돌', access: 'purchase', gameId: 'breakout' });
    // 아이템은 같은 게임에 여럿이어도 된다
    await add(db, { id: 'pinball.ball.gold', kind: 'item', name: '금 공', access: 'purchase', gameId: 'pinball', slot: 'ball' });
    assert.equal((await gameProduct(db, 'pinball'))?.id, 'game.pinball');
  } finally {
    await close();
  }
});

test('규칙 함수를 건너뛰고 SQL로 넣어도 DB의 CHECK가 막는다', async () => {
  const { db, close } = await testDb();
  try {
    await games(db, ['pinball']);
    const insert = (id: string, kind: string, gameId: string | null, slot: string | null, consumable: boolean, grantCoins: number | null, access = 'purchase', status = 'draft') =>
      db.execute(sql`insert into app.products (id, kind, name, game_id, slot, access, status, consumable, grant_coins)
                     values (${id}, ${kind}, ${'x'}, ${gameId}, ${slot}, ${access}, ${status}, ${consumable}, ${grantCoins})`);
    const cases: Array<[string, () => Promise<unknown>, string]> = [
      ['game에 game_id 없음', () => insert('game.a', 'game', null, null, false, null), 'products_kind_check'],
      ['game에 slot 있음', () => insert('game.b', 'game', 'pinball', 'table', false, null), 'products_kind_check'],
      ['item에 slot 없음', () => insert('item.a', 'item', 'pinball', null, false, null), 'products_kind_check'],
      ['item에 game_id 없음', () => insert('item.b', 'item', null, 'table', false, null), 'products_kind_check'],
      ['consumable인 item', () => insert('item.c', 'item', 'pinball', 'table', true, null), 'products_kind_check'],
      ['consumable이 아닌 coin_pack', () => insert('pack.a', 'coin_pack', null, null, false, 100), 'products_kind_check'],
      ['grant_coins가 0인 coin_pack', () => insert('pack.b', 'coin_pack', null, null, true, 0), 'products_kind_check'],
      ['grant_coins가 없는 coin_pack', () => insert('pack.c', 'coin_pack', null, null, true, null), 'products_kind_check'],
      ['모르는 kind', () => insert('hat.a', 'hat', 'pinball', 'table', false, null), 'products_kind_check'],
      ['모르는 access', () => insert('item.d', 'item', 'pinball', 'table', false, null, 'vip'), 'products_access_check'],
      ['모르는 status', () => insert('item.e', 'item', 'pinball', 'table', false, null, 'purchase', 'sold'), 'products_status_check'],
      ['id 모양', () => insert('Bad Id', 'item', 'pinball', 'table', false, null), 'products_id_check'],
    ];
    for (const [why, run, constraint] of cases) {
      await assert.rejects(run(), (err) => {
        assert.deepEqual(pgError(err), { code: '23514', constraint }, why);
        return true;
      }, why);
    }
    // 한 게임에 game 상품 둘: 유일 색인이 막는다
    await insert('game.one', 'game', 'pinball', null, false, null);
    await assert.rejects(insert('game.two', 'game', 'pinball', null, false, null), (err) => {
      assert.deepEqual(pgError(err), { code: '23505', constraint: 'products_one_game_product' });
      return true;
    });
    // 가격: 음수는 CHECK, 켜진 가격 둘은 유일 색인이 막는다
    await assert.rejects(db.execute(sql`insert into app.product_prices (product_id, currency, amount, active) values ('game.one', 'COIN', -1, true)`), (err) => pgError(err).constraint === 'product_prices_amount_check');
    await assert.rejects(db.execute(sql`insert into app.product_prices (product_id, currency, amount, active) values ('game.one', 'EUR', 1, true)`), (err) => pgError(err).constraint === 'product_prices_currency_check');
    await db.execute(sql`insert into app.product_prices (product_id, currency, amount, active) values ('game.one', 'COIN', 100, true)`);
    await assert.rejects(db.execute(sql`insert into app.product_prices (product_id, currency, amount, active) values ('game.one', 'COIN', 200, true)`), (err) => pgError(err).constraint === 'product_prices_one_active');
    await db.execute(sql`insert into app.product_prices (product_id, currency, amount, active) values ('game.one', 'COIN', 200, false)`);
  } finally {
    await close();
  }
});
