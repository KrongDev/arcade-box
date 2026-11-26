import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equip, grant, listEquipped, owns, revoke } from '../src/entitlement/index.ts';
import { getProduct } from '../src/product/index.ts';
import type { Db } from '../src/shared/db/index.ts';
import { RuleError } from '../src/shared/errors.ts';
import { loginGuest } from '../test/account/helpers.ts';
import { NOW, rowsOf, seedCatalog } from '../test/entitlement/helpers.ts';
import { pgTestDb, SKIP } from './helpers.ts';

function failure(reason: unknown): string {
  if (reason instanceof RuleError) return `${reason.status} ${reason.code}`;
  const cause = (reason as { cause?: { code?: unknown } } | null)?.cause;
  return `뜻밖의 오류: ${String(cause?.code ?? reason)}`;
}

const give = (db: Db, userId: string, productId: string) => db.transaction((tx) => grant(tx, { userId, productId, source: 'grant' }));

test('같은 상품을 같은 사용자에게 동시에 두 번 지급하면 하나만 성공하고 하나는 409 already_owned이다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedCatalog(db);
    // 한 번으로는 우연히 지나갈 수 있어서 사용자를 바꿔 가며 여러 번 한다. 회수한 뒤 다시 주는 경우도 섞는다
    for (let round = 0; round < 10; round++) {
      const me = await loginGuest(db, NOW);
      if (round % 2 === 1) {
        await give(db, me.userId, 'pinball.table.sunset');
        await db.transaction((tx) => revoke(tx, { userId: me.userId, productId: 'pinball.table.sunset', reason: 'admin' }));
      }
      const settled = await Promise.allSettled([give(db, me.userId, 'pinball.table.sunset'), give(db, me.userId, 'pinball.table.sunset')]);
      const ok = settled.filter((r) => r.status === 'fulfilled');
      const failed = settled.flatMap((r) => (r.status === 'rejected' ? [failure(r.reason)] : []));
      assert.equal(ok.length, 1, `${round}번째: ${JSON.stringify(failed)}`);
      assert.deepEqual(failed, ['409 already_owned'], '500이 아니라 이미 가졌다는 거절이다');
      const active = (await rowsOf(db, me.userId)).filter((r) => r.revokedAt === null);
      assert.equal(active.length, 1, '켜진 보유는 하나다');
      assert.equal(await owns(db, me.userId, (await getProduct(db, 'pinball.table.sunset'))!), true);
    }
  } finally {
    await close();
  }
});

test('장착과 회수가 동시에 와도 회수된 아이템이 장착된 채 남지 않는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedCatalog(db);
    for (let round = 0; round < 10; round++) {
      const me = await loginGuest(db, NOW);
      await give(db, me.userId, 'pinball.table.sunset');
      const settled = await Promise.allSettled([
        equip(db, me.userId, 'pinball.table.sunset'),
        db.transaction((tx) => revoke(tx, { userId: me.userId, productId: 'pinball.table.sunset', reason: 'refund' })),
      ]);
      assert.equal(settled[1].status, 'fulfilled', `${round}번째: 회수는 늘 된다`);
      if (settled[0].status === 'rejected') assert.equal(failure(settled[0].reason), '403 not_owned', `${round}번째`);
      assert.deepEqual(await listEquipped(db, me.userId), [], `${round}번째: 장착이 남지 않는다`);
    }
  } finally {
    await close();
  }
});
