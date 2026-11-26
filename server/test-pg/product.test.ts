import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGame } from '../src/game/index.ts';
import { createProduct, setSku } from '../src/product/index.ts';
import { storeSkus } from '../src/product/schema.ts';
import { RuleError } from '../src/shared/errors.ts';
import { pgTestDb, SKIP } from './helpers.ts';

test('두 상품에 같은 스토어 코드를 동시에 붙이면 하나만 되고 하나는 409 sku_taken이다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await db.transaction(async (tx) => {
      await createGame(tx, { id: 'pinball', name: '핀볼', description: '' });
      for (const id of ['pinball.table.a', 'pinball.table.b']) await createProduct(tx, { id, kind: 'item', name: id, access: 'purchase', gameId: 'pinball', slot: 'table' });
    });
    for (let round = 0; round < 10; round++) {
      const code = `table_code_${round}`;
      const settled = await Promise.allSettled(['pinball.table.a', 'pinball.table.b'].map((id) => db.transaction((tx) => setSku(tx, id, 'google_play', code))));
      const failed = settled.flatMap((r) => (r.status === 'rejected' ? [r.reason instanceof RuleError ? `${r.reason.status} ${r.reason.code}` : `뜻밖의 오류: ${String(r.reason)}`] : []));
      assert.deepEqual(failed, ['409 sku_taken'], `${round}번째`);
      assert.equal((await db.select().from(storeSkus)).filter((s) => s.sku === code).length, 1);
    }
  } finally {
    await close();
  }
});
