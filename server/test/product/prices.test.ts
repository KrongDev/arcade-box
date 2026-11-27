import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asc } from 'drizzle-orm';
import { activePrice, clearPrice, listCatalogProducts, setPrice, setSku, updateProduct } from '../../src/product/index.ts';
import { productPrices, storeSkus } from '../../src/product/schema.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { testDb } from '../helpers/db.ts';
import { add, games, rule } from './helpers.ts';

const price = (db: Db, id: string, currency: 'COIN' | 'KRW', amount: number) => db.transaction((tx) => setPrice(tx, id, currency, amount));
const prices = (db: Db) => db.select().from(productPrices).orderBy(asc(productPrices.id));

test('가격을 1000에서 1500으로 바꾸면 행이 둘이고 켜진 것은 1500 하나다', async () => {
  const { db, close } = await testDb();
  try {
    await games(db, ['pinball']);
    await add(db, { id: 'pinball.table.sunset', kind: 'item', name: '노을', access: 'purchase', gameId: 'pinball', slot: 'table' });
    await price(db, 'pinball.table.sunset', 'COIN', 1000);
    const first = await activePrice(db, 'pinball.table.sunset', 'COIN');
    assert.equal(first?.amount, 1000);
    await price(db, 'pinball.table.sunset', 'COIN', 1500);

    const rows = await prices(db);
    assert.deepEqual(rows.map((r) => [r.currency, r.amount, r.active]), [['COIN', 1000, false], ['COIN', 1500, true]], '옛 가격은 꺼진 채 내역으로 남는다');
    const now = await activePrice(db, 'pinball.table.sunset', 'COIN');
    assert.deepEqual(now, { id: rows[1].id, amount: 1500 });
    assert.notEqual(now?.id, first?.id, '주문이 가리킬 가격 행이 바뀐다');

    // 화폐마다 따로다
    await price(db, 'pinball.table.sunset', 'KRW', 2200);
    assert.equal((await activePrice(db, 'pinball.table.sunset', 'KRW'))?.amount, 2200);
    assert.equal((await activePrice(db, 'pinball.table.sunset', 'COIN'))?.amount, 1500);

    // 같은 값으로 다시 정하면 내역을 늘리지 않고 알려 준다. 0은 된다
    await assert.rejects(price(db, 'pinball.table.sunset', 'COIN', 1500), rule(409, 'same_price'));
    await price(db, 'pinball.table.sunset', 'COIN', 0);
    for (const bad of [-1, 1.5, Number.NaN, 9_000_000_000_000_001]) await assert.rejects(price(db, 'pinball.table.sunset', 'COIN', bad), rule(400, 'invalid_amount'), String(bad));
    await assert.rejects(price(db, 'pinball.table.sunset', 'USD' as never, 1), rule(400, 'invalid_currency'));
    await assert.rejects(price(db, 'none.here', 'COIN', 1), rule(404, 'not_found'));
    assert.equal((await prices(db)).filter((r) => r.active).length, 2);
  } finally {
    await close();
  }
});

test('가격을 지우면 activePrice가 null이다', async () => {
  const { db, close } = await testDb();
  try {
    await games(db, ['pinball']);
    await add(db, { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'purchase', gameId: 'pinball' });
    await price(db, 'game.pinball', 'COIN', 3000);
    await db.transaction((tx) => clearPrice(tx, 'game.pinball', 'COIN'));
    assert.equal(await activePrice(db, 'game.pinball', 'COIN'), null);
    assert.deepEqual((await prices(db)).map((r) => [r.amount, r.active]), [[3000, false]], '지운 가격도 내역으로 남는다');
    await assert.rejects(db.transaction((tx) => clearPrice(tx, 'game.pinball', 'COIN')), rule(409, 'no_price'));
    // 다시 정할 수 있다
    await price(db, 'game.pinball', 'COIN', 2500);
    assert.equal((await activePrice(db, 'game.pinball', 'COIN'))?.amount, 2500);
    assert.equal(await activePrice(db, 'none.here', 'COIN'), null);
  } finally {
    await close();
  }
});

test('같은 스토어의 같은 코드를 두 상품에 붙일 수 없다', async () => {
  const { db, close } = await testDb();
  try {
    await games(db, ['pinball']);
    await add(db, { id: 'pinball.table.neon', kind: 'item', name: '네온', access: 'purchase', gameId: 'pinball', slot: 'table' });
    await add(db, { id: 'pinball.table.galaxy', kind: 'item', name: '은하', access: 'purchase', gameId: 'pinball', slot: 'table' });
    const sku = (id: string, store: 'google_play' | 'app_store', code: string) => db.transaction((tx) => setSku(tx, id, store, code));
    await sku('pinball.table.neon', 'google_play', 'table_neon');
    await assert.rejects(sku('pinball.table.galaxy', 'google_play', 'table_neon'), rule(409, 'sku_taken'));
    // 다른 스토어에서는 같은 코드여도 된다
    await sku('pinball.table.galaxy', 'app_store', 'table_neon');
    // 한 상품의 한 스토어 코드는 하나: 다시 정하면 바뀐다
    await sku('pinball.table.neon', 'google_play', 'table_neon_v2');
    await sku('pinball.table.galaxy', 'google_play', 'table_neon');
    const rows = await db.select().from(storeSkus).orderBy(asc(storeSkus.productId), asc(storeSkus.store));
    assert.deepEqual(rows.map((r) => [r.productId, r.store, r.sku]), [
      ['pinball.table.galaxy', 'app_store', 'table_neon'],
      ['pinball.table.galaxy', 'google_play', 'table_neon'],
      ['pinball.table.neon', 'google_play', 'table_neon_v2'],
    ]);
    await assert.rejects(sku('pinball.table.neon', 'steam' as never, 'x'), rule(400, 'invalid_store'));
    for (const bad of ['', 'has space', 'a/b', 'x'.repeat(101), '줄\n바꿈']) await assert.rejects(sku('pinball.table.neon', 'google_play', bad), rule(400, 'invalid_sku'), JSON.stringify(bad));
    await assert.rejects(sku('none.here', 'google_play', 'abc'), rule(404, 'not_found'));
  } finally {
    await close();
  }
});

test('listCatalogProducts는 draft·hidden·retired를 뺀다', async () => {
  const { db, close } = await testDb();
  try {
    await games(db, ['pinball']);
    const statuses = ['draft', 'on_sale', 'hidden', 'retired'] as const;
    for (const [i, status] of statuses.entries()) {
      await add(db, { id: `pinball.ball.${status.replace('_', '-')}`, kind: 'item', name: status, access: 'purchase', gameId: 'pinball', slot: 'ball', status, sortOrder: 10 - i });
    }
    await add(db, { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'everyone', gameId: 'pinball', status: 'on_sale', sortOrder: 0 });
    await price(db, 'pinball.ball.on-sale', 'KRW', 1100);
    await price(db, 'pinball.ball.on-sale', 'COIN', 500);
    await price(db, 'pinball.ball.on-sale', 'COIN', 700);
    await price(db, 'pinball.ball.hidden', 'COIN', 900);

    const listed = await listCatalogProducts(db);
    assert.deepEqual(
      listed.map((p) => [p.id, p.status, p.prices]),
      [
        ['game.pinball', 'on_sale', []],
        ['pinball.ball.on-sale', 'on_sale', [{ currency: 'COIN', amount: 700 }, { currency: 'KRW', amount: 1100 }]],
      ],
      '켜진 가격만, 순서(sort_order)대로',
    );
    assert.equal(listed[1].kind, 'item');
    assert.equal(listed[1].slot, 'ball');

    await db.transaction((tx) => updateProduct(tx, 'pinball.ball.on-sale', { status: 'hidden' }));
    assert.deepEqual((await listCatalogProducts(db)).map((p) => p.id), ['game.pinball']);
  } finally {
    await close();
  }
});
