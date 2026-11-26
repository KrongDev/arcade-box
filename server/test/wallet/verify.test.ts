import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { test } from 'node:test';
import type { Db } from '../../src/shared/db/index.ts';
import { verifyWallets } from '../../src/wallet/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { testDb } from '../helpers/db.ts';
import { dumpAppSchema } from '../helpers/scan.ts';
import { apply, ledgerOf, NOW } from './helpers.ts';

/** 사용자 셋: 100 → 70 → 120, 500, 그리고 코인을 받은 적 없는 사용자 */
async function setup(db: Db) {
  const a = await loginGuest(db, NOW);
  const b = await loginGuest(db, NOW);
  const idle = await loginGuest(db, NOW);
  await apply(db, { userId: a.userId, delta: 100, reason: 'run' });
  await apply(db, { userId: a.userId, delta: -30, reason: 'purchase' });
  await apply(db, { userId: a.userId, delta: 50, reason: 'attendance' });
  await apply(db, { userId: b.userId, delta: 500, reason: 'grant' });
  return { a: a.userId, b: b.userId, idle: idle.userId };
}

test('wallet verify: 잔액을 SQL로 몰래 바꾸면 그 지갑을 찾아낸다. 멀쩡하면 빈 목록이다', async () => {
  const { db, close } = await testDb();
  try {
    const { a, b } = await setup(db);
    assert.deepEqual(await verifyWallets(db), [], '멀쩡하면 빈 목록이다');

    await db.execute(sql`update app.wallets set balance = 999 where user_id = ${a}`);
    assert.deepEqual(await verifyWallets(db), [{ userId: a, balance: 999, ledgerSum: 120, lastBalanceAfter: 120 }]);
    for (const row of await verifyWallets(db)) {
      assert.deepEqual([typeof row.balance, typeof row.ledgerSum, typeof row.lastBalanceAfter], ['number', 'number', 'number'], '숫자로 준다');
    }

    // 두 지갑이 어긋나면 둘 다 나온다 (사용자 ID 순서)
    await db.execute(sql`update app.wallets set balance = 0 where user_id = ${b}`);
    assert.deepEqual(
      await verifyWallets(db),
      [
        { userId: a, balance: 999, ledgerSum: 120, lastBalanceAfter: 120 },
        { userId: b, balance: 0, ledgerSum: 500, lastBalanceAfter: 500 },
      ].sort((x, y) => (x.userId < y.userId ? -1 : 1)),
    );

    // 되돌려 놓으면 다시 빈 목록이다
    await db.execute(sql`update app.wallets set balance = 120 where user_id = ${a}`);
    await db.execute(sql`update app.wallets set balance = 500 where user_id = ${b}`);
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('wallet verify: 기록을 몰래 고치거나 지우거나, 지갑 행만 지우거나 만들어도 찾아낸다', async () => {
  // 경우마다 새 DB에서 한 가지만 망가뜨린다
  const cases: Array<{ name: string; tamper(db: Db, ids: { a: string; b: string; idle: string }): Promise<unknown>; expected(ids: { a: string; b: string; idle: string }): unknown[] }> = [
    {
      name: '가운데 기록의 delta를 고침 (합이 달라진다)',
      tamper: async (db, { a }) => db.execute(sql`update app.coin_ledger set delta = -10 where id = ${(await ledgerOf(db, a))[1].id}`),
      expected: ({ a }) => [{ userId: a, balance: 120, ledgerSum: 140, lastBalanceAfter: 120 }],
    },
    {
      name: '마지막 기록의 balance_after를 고침 (합은 맞다)',
      tamper: async (db, { a }) => db.execute(sql`update app.coin_ledger set balance_after = 121 where id = ${(await ledgerOf(db, a))[2].id}`),
      expected: ({ a }) => [{ userId: a, balance: 120, ledgerSum: 120, lastBalanceAfter: 121 }],
    },
    {
      name: '마지막 기록을 지움',
      tamper: async (db, { a }) => db.execute(sql`delete from app.coin_ledger where id = ${(await ledgerOf(db, a))[2].id}`),
      expected: ({ a }) => [{ userId: a, balance: 120, ledgerSum: 70, lastBalanceAfter: 70 }],
    },
    {
      name: '기록을 모두 지움 (지갑만 남는다)',
      tamper: (db, { b }) => db.execute(sql`delete from app.coin_ledger where user_id = ${b}`),
      expected: ({ b }) => [{ userId: b, balance: 500, ledgerSum: 0, lastBalanceAfter: null }],
    },
    {
      name: '지갑 행을 지움 (기록만 남는다)',
      tamper: (db, { b }) => db.execute(sql`delete from app.wallets where user_id = ${b}`),
      expected: ({ b }) => [{ userId: b, balance: 0, ledgerSum: 500, lastBalanceAfter: 500 }],
    },
    {
      name: '기록 없이 지갑 행을 만듦',
      tamper: (db, { idle }) => db.execute(sql`insert into app.wallets (user_id, balance) values (${idle}, 7)`),
      expected: ({ idle }) => [{ userId: idle, balance: 7, ledgerSum: 0, lastBalanceAfter: null }],
    },
    {
      name: '기록 한 줄을 지갑을 거치지 않고 넣음',
      tamper: (db, { a }) => db.execute(sql`insert into app.coin_ledger (user_id, delta, balance_after, reason) values (${a}, 1000, 1120, 'grant')`),
      expected: ({ a }) => [{ userId: a, balance: 120, ledgerSum: 1120, lastBalanceAfter: 1120 }],
    },
  ];
  for (const c of cases) {
    const { db, close } = await testDb();
    try {
      const ids = await setup(db);
      await c.tamper(db, ids);
      assert.deepEqual(await verifyWallets(db), c.expected(ids), c.name);
    } finally {
      await close();
    }
  }
});

test('wallet verify: 잔액 0에 기록이 없는 지갑과, 지갑이 없는 사용자는 멀쩡한 것이다', async () => {
  const { db, close } = await testDb();
  try {
    const { a, idle } = await setup(db);
    // 모자라서 거절된 요청을 부른 쪽이 삼키고 커밋하면 잔액 0인 지갑 행만 남을 수 있다
    await db.execute(sql`insert into app.wallets (user_id, balance) values (${idle}, 0)`);
    // 다 써서 0이 된 지갑
    await apply(db, { userId: a, delta: -120, reason: 'purchase' });
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('wallet verify: userId를 주면 그 지갑만 보고, 아무것도 바꾸지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const { a, b, idle } = await setup(db);
    await db.execute(sql`update app.wallets set balance = 999 where user_id = ${a}`);
    await db.execute(sql`delete from app.wallets where user_id = ${b}`);
    const before = await dumpAppSchema(db);

    assert.deepEqual(await verifyWallets(db, a), [{ userId: a, balance: 999, ledgerSum: 120, lastBalanceAfter: 120 }]);
    assert.deepEqual(await verifyWallets(db, b), [{ userId: b, balance: 0, ledgerSum: 500, lastBalanceAfter: 500 }]);
    assert.deepEqual(await verifyWallets(db, idle), []);
    assert.equal((await verifyWallets(db)).length, 2);
    assert.deepEqual(await dumpAppSchema(db), before, '읽기만 한다: 어긋난 것을 고치지 않는다');
  } finally {
    await close();
  }
});
