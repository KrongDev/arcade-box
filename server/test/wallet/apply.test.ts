import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { test } from 'node:test';
import { deleteAccount, getUser, type DeletionPolicy } from '../../src/account/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { applyCoins, getBalance, hasLedgerKey, purgeUser, verifyWallets, type LedgerReason } from '../../src/wallet/index.ts';
import { coinLedger, wallets } from '../../src/wallet/schema.ts';
import { loginGuest } from '../account/helpers.ts';
import { testDb } from '../helpers/db.ts';
import { dumpAppSchema } from '../helpers/scan.ts';
import { apply, ledgerOf, MAX_BALANCE, NOW, rule, totals, walletOf } from './helpers.ts';

test('처음 코인을 받으면 지갑이 생기고 기록의 balance_after가 잔액과 같다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    assert.equal(await walletOf(db, me.userId), null, '코인을 받기 전에는 지갑 행이 없다');
    assert.equal(await getBalance(db, me.userId), 0, '지갑이 없으면 0이다');

    const first = await apply(db, { userId: me.userId, delta: 120, reason: 'run' });
    assert.deepEqual({ balance: first.balance, replayed: first.replayed }, { balance: 120, replayed: false });
    const wallet = await walletOf(db, me.userId);
    assert.equal(wallet?.balance, 120);
    let rows = await ledgerOf(db, me.userId);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { id: rows[0].id, delta: rows[0].delta, balanceAfter: rows[0].balanceAfter, reason: rows[0].reason, adminActionId: rows[0].adminActionId, idempotencyKey: rows[0].idempotencyKey },
      { id: first.ledgerId, delta: 120, balanceAfter: 120, reason: 'run', adminActionId: null, idempotencyKey: null },
    );
    assert.equal(await getBalance(db, me.userId), 120);

    // 두 번째부터는 같은 지갑에 쌓인다
    const second = await apply(db, { userId: me.userId, delta: -20, reason: 'purchase' });
    assert.deepEqual({ balance: second.balance, replayed: second.replayed }, { balance: 100, replayed: false });
    rows = await ledgerOf(db, me.userId);
    assert.deepEqual(rows.map((r) => [r.id, r.delta, r.balanceAfter, r.reason]), [
      [first.ledgerId, 120, 120, 'run'],
      [second.ledgerId, -20, 100, 'purchase'],
    ]);
    assert.ok(second.ledgerId > first.ledgerId);
    assert.deepEqual(await totals(db, me.userId), { balance: 100, sum: 100, last: 100, count: 2 });
    assert.equal((await db.select().from(wallets)).length, 1, '지갑은 사용자마다 하나다');

    // bigint 열을 숫자로 읽는다 (bigint나 글자열이면 JSON으로 바꾸다 500이 나거나 "100" + 1 = "1001"이 된다)
    for (const value of [first.ledgerId, first.balance, wallet?.balance, rows[0].id, rows[0].delta, rows[0].balanceAfter, await getBalance(db, me.userId)]) {
      assert.equal(typeof value, 'number');
    }
  } finally {
    await close();
  }
});

test('코인을 주고받는 까닭 일곱 가지를 모두 적을 수 있다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const reasons: LedgerReason[] = ['run', 'attendance', 'ad_reward', 'purchase', 'refund', 'grant', 'adjust'];
    for (const reason of reasons) await apply(db, { userId: me.userId, delta: 10, reason });
    assert.deepEqual((await ledgerOf(db, me.userId)).map((r) => r.reason), reasons);
  } finally {
    await close();
  }
});

test('잔액보다 많이 쓰면 409 insufficient_coins이고 기록이 늘지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    await apply(db, { userId: me.userId, delta: 100, reason: 'run' });
    const before = await dumpAppSchema(db);

    await assert.rejects(apply(db, { userId: me.userId, delta: -101, reason: 'purchase' }), rule(409, 'insufficient_coins'));
    await assert.rejects(apply(db, { userId: me.userId, delta: -MAX_BALANCE, reason: 'adjust' }), rule(409, 'insufficient_coins'));
    assert.deepEqual(await dumpAppSchema(db), before, '거절된 뒤 아무것도 바뀌지 않았다');
    assert.deepEqual(await totals(db, me.userId), { balance: 100, sum: 100, last: 100, count: 1 });

    // 딱 잔액만큼은 쓸 수 있고, 0에서는 1코인도 못 쓴다
    assert.equal((await apply(db, { userId: me.userId, delta: -100, reason: 'purchase' })).balance, 0);
    await assert.rejects(apply(db, { userId: me.userId, delta: -1, reason: 'purchase' }), rule(409, 'insufficient_coins'));
    assert.deepEqual(await totals(db, me.userId), { balance: 0, sum: 0, last: 0, count: 2 });

    // 코인을 받은 적이 없는 사용자: 기록도 지갑도 생기지 않는다
    const fresh = await loginGuest(db, NOW);
    await assert.rejects(apply(db, { userId: fresh.userId, delta: -1, reason: 'purchase' }), rule(409, 'insufficient_coins'));
    assert.deepEqual(await totals(db, fresh.userId), { balance: null, sum: 0, last: null, count: 0 });
  } finally {
    await close();
  }
});

test('delta가 0, 소수, NaN이면 거절한다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    await apply(db, { userId: me.userId, delta: 100, reason: 'run' });
    const before = await dumpAppSchema(db);
    for (const bad of [0, -0, 1.5, -0.1, 99.999, NaN]) {
      await assert.rejects(apply(db, { userId: me.userId, delta: bad, reason: 'run' }), rule(400, 'invalid_delta'), String(bad));
    }
    assert.deepEqual(await dumpAppSchema(db), before);
  } finally {
    await close();
  }
});

test('delta가 무한대이거나, 2^53 이상이거나, 숫자가 아니면 거절한다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    await apply(db, { userId: me.userId, delta: 100, reason: 'run' });
    const before = await dumpAppSchema(db);
    const bad: unknown[] = [Infinity, -Infinity, 2 ** 53, -(2 ** 53), Number.MAX_VALUE, 1e300, '5', '', null, undefined, 10n, true, [5], { valueOf: () => 5 }];
    for (const value of bad) {
      await assert.rejects(apply(db, { userId: me.userId, delta: value as number, reason: 'run' }), rule(400, 'invalid_delta'), String(value));
    }
    assert.deepEqual(await dumpAppSchema(db), before);
  } finally {
    await close();
  }
});

test('같은 idempotency 키로 두 번 부르면 한 번만 반영되고 두 번째는 replayed가 true다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const earn = { userId: me.userId, delta: 50, reason: 'run', idempotencyKey: 'run-0001-abcdef' } as const;
    const first = await apply(db, earn);
    assert.deepEqual({ balance: first.balance, replayed: first.replayed }, { balance: 50, replayed: false });
    assert.equal((await ledgerOf(db, me.userId))[0].idempotencyKey, 'run-0001-abcdef');

    assert.deepEqual(await apply(db, earn), { ledgerId: first.ledgerId, balance: 50, replayed: true });
    assert.deepEqual(await totals(db, me.userId), { balance: 50, sum: 50, last: 50, count: 1 });

    // 그사이 잔액이 바뀌었어도 처음 결과를 그대로 준다 (스펙 5.5)
    await apply(db, { userId: me.userId, delta: 30, reason: 'attendance' });
    assert.deepEqual(await apply(db, earn), { ledgerId: first.ledgerId, balance: 50, replayed: true });
    assert.deepEqual(await totals(db, me.userId), { balance: 80, sum: 80, last: 80, count: 2 });

    // 다시 보낸 구매: 처음에 성공했으면, 지금은 잔액이 모자라도 insufficient_coins가 아니라 처음 결과다
    const spend = { userId: me.userId, delta: -80, reason: 'purchase', idempotencyKey: 'buy-0001-abcdef' } as const;
    const bought = await apply(db, spend);
    assert.deepEqual({ balance: bought.balance, replayed: bought.replayed }, { balance: 0, replayed: false });
    assert.deepEqual(await apply(db, spend), { ledgerId: bought.ledgerId, balance: 0, replayed: true });
    assert.deepEqual(await apply(db, spend), { ledgerId: bought.ledgerId, balance: 0, replayed: true });
    assert.deepEqual(await totals(db, me.userId), { balance: 0, sum: 0, last: 0, count: 3 });

    // 거절된 요청은 남지 않으니, 같은 키로 다시 보내면 새 요청으로 본다
    const tooMuch = { userId: me.userId, delta: -10, reason: 'purchase', idempotencyKey: 'buy-0002-abcdef' } as const;
    await assert.rejects(apply(db, tooMuch), rule(409, 'insufficient_coins'));
    await apply(db, { userId: me.userId, delta: 10, reason: 'ad_reward' });
    assert.deepEqual({ ...(await apply(db, tooMuch)), ledgerId: 0 }, { ledgerId: 0, balance: 0, replayed: false });
  } finally {
    await close();
  }
});

test('idempotency 키는 사용자마다 따로다: 같은 키라도 사용자가 다르면 따로 반영된다', async () => {
  const { db, close } = await testDb();
  try {
    const a = await loginGuest(db, NOW);
    const b = await loginGuest(db, NOW);
    const key = 'shared-key-0001';
    const first = await apply(db, { userId: a.userId, delta: 50, reason: 'run', idempotencyKey: key });
    // 다른 사용자가 같은 키에 다른 내용을 보내도 409가 아니고, 남의 결과를 받지도 않는다
    const other = await apply(db, { userId: b.userId, delta: 70, reason: 'attendance', idempotencyKey: key });
    assert.deepEqual({ balance: other.balance, replayed: other.replayed }, { balance: 70, replayed: false });
    assert.notEqual(other.ledgerId, first.ledgerId);
    assert.deepEqual(await totals(db, a.userId), { balance: 50, sum: 50, last: 50, count: 1 });
    assert.deepEqual(await totals(db, b.userId), { balance: 70, sum: 70, last: 70, count: 1 });
    assert.deepEqual(await apply(db, { userId: b.userId, delta: 70, reason: 'attendance', idempotencyKey: key }), { ledgerId: other.ledgerId, balance: 70, replayed: true });
  } finally {
    await close();
  }
});

test('키가 없는 요청은 같은 내용이어도 매번 반영된다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    for (const idempotencyKey of [undefined, null, undefined, null]) {
      const result = await apply(db, { userId: me.userId, delta: 10, reason: 'run', idempotencyKey });
      assert.equal(result.replayed, false);
    }
    await apply(db, { userId: me.userId, delta: 10, reason: 'run' });
    assert.deepEqual(await totals(db, me.userId), { balance: 50, sum: 50, last: 50, count: 5 });
  } finally {
    await close();
  }
});

test('idempotency 키의 모양이 틀리면 400 invalid_idempotency_key이고 아무것도 남지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const before = await dumpAppSchema(db);
    const bad: unknown[] = ['short', 'a'.repeat(65), 'has space!', 'nul\u0000-aaaaaaaa', 'line\n-aaaaaaaa', 12345678, {}, true, ''];
    for (const key of bad) {
      await assert.rejects(apply(db, { userId: me.userId, delta: 10, reason: 'run', idempotencyKey: key as string }), rule(400, 'invalid_idempotency_key'), JSON.stringify(key));
    }
    assert.deepEqual(await dumpAppSchema(db), before);
    // 8자와 64자는 된다
    await apply(db, { userId: me.userId, delta: 10, reason: 'run', idempotencyKey: 'a'.repeat(8) });
    await apply(db, { userId: me.userId, delta: 10, reason: 'run', idempotencyKey: 'A-_9'.repeat(16) });
  } finally {
    await close();
  }
});

test('같은 키인데 delta나 reason이 다르면 409 idempotency_mismatch', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const key = 'run-0001-abcdef';
    const first = await apply(db, { userId: me.userId, delta: 50, reason: 'run', idempotencyKey: key });
    const before = await dumpAppSchema(db);

    const different: Array<{ delta: number; reason: LedgerReason }> = [
      { delta: 60, reason: 'run' },
      { delta: 49, reason: 'run' },
      { delta: -50, reason: 'run' },
      { delta: 50, reason: 'attendance' },
      { delta: -50, reason: 'purchase' },
    ];
    for (const d of different) {
      await assert.rejects(apply(db, { userId: me.userId, ...d, idempotencyKey: key }), rule(409, 'idempotency_mismatch'), JSON.stringify(d));
    }
    assert.deepEqual(await dumpAppSchema(db), before, '거절된 뒤 아무것도 바뀌지 않았다');
    // 처음과 같은 내용은 여전히 처음 결과를 받는다
    assert.deepEqual(await apply(db, { userId: me.userId, delta: 50, reason: 'run', idempotencyKey: key }), { ledgerId: first.ledgerId, balance: 50, replayed: true });
  } finally {
    await close();
  }
});

test('applyCoins를 부른 트랜잭션이 뒤에서 실패하면 기록도 잔액도 남지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const fresh = await loginGuest(db, NOW); // 지갑이 아직 없는 사용자
    await apply(db, { userId: me.userId, delta: 100, reason: 'run' });
    const before = await dumpAppSchema(db);

    // 부른 쪽의 코드가 던진다 (판은 저장됐는데 그 뒤에서 오류)
    for (const userId of [me.userId, fresh.userId]) {
      await assert.rejects(
        db.transaction(async (tx) => {
          const result = await applyCoins(tx, { userId, delta: 40, reason: 'run', idempotencyKey: 'later-fails-0001' });
          assert.equal(result.replayed, false);
          assert.equal(await getBalance(tx, userId), result.balance, '같은 트랜잭션 안에서는 바뀐 잔액이 보인다');
          throw new Error('코인 반영 뒤의 오류');
        }),
        /코인 반영 뒤의 오류/,
      );
    }
    assert.deepEqual(await dumpAppSchema(db), before);

    // 부른 쪽의 다음 쿼리가 DB에서 실패한다
    await assert.rejects(
      db.transaction(async (tx) => {
        await applyCoins(tx, { userId: me.userId, delta: -30, reason: 'purchase' });
        await tx.execute(sql`insert into app.wallets (user_id, balance) values (${me.userId}, 1)`); // 유일 제약 위반
      }),
    );
    assert.deepEqual(await dumpAppSchema(db), before);
    assert.equal(await walletOf(db, fresh.userId), null, '지갑 행도 남지 않는다');

    // 남지 않았으니 같은 키로 다시 보내면 새 요청이다
    const again = await apply(db, { userId: me.userId, delta: 40, reason: 'run', idempotencyKey: 'later-fails-0001' });
    assert.deepEqual({ balance: again.balance, replayed: again.replayed }, { balance: 140, replayed: false });
  } finally {
    await close();
  }
});

/** 씨앗이 같으면 늘 같은 수열을 주는 난수 (mulberry32). 실패했을 때 그대로 다시 돌릴 수 있다 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('씨앗을 준 난수로 사용자 3명에게 벌기·쓰기 500번을 섞어도, 사용자마다 잔액 = delta의 합 = 마지막 balance_after ≥ 0', async () => {
  const { db, close } = await testDb();
  try {
    const rand = seeded(20261126);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
    const users = [await loginGuest(db, NOW), await loginGuest(db, NOW), await loginGuest(db, NOW)].map((u) => u.userId);
    /** 우리가 따로 센 잔액. 서버의 답과 DB가 이것과 같아야 한다 */
    const model = new Map(users.map((userId) => [userId, 0]));
    /** 반영된 요청 가운데 키가 있던 것 (다시 보내기에 쓴다) */
    const keyed: Array<{ input: { userId: string; delta: number; reason: LedgerReason; idempotencyKey: string }; ledgerId: number; balance: number }> = [];
    const seen = { applied: 0, insufficient: 0, replayed: 0, mismatch: 0, rolledBack: 0 };
    const earnReasons: LedgerReason[] = ['run', 'attendance', 'ad_reward', 'refund', 'grant'];
    const spendReasons: LedgerReason[] = ['purchase', 'adjust'];

    for (let i = 0; i < 500; i++) {
      const roll = rand();
      if (roll < 0.1 && keyed.length > 0) {
        // 통신이 끊겨 같은 요청을 다시 보냄: 처음 결과 그대로, 한 번 더 반영되지 않는다
        const prev = pick(keyed);
        assert.deepEqual(await apply(db, prev.input), { ledgerId: prev.ledgerId, balance: prev.balance, replayed: true }, `${i}번째 (다시 보내기)`);
        seen.replayed++;
        continue;
      }
      if (roll < 0.15 && keyed.length > 0) {
        // 같은 키에 다른 내용
        const prev = pick(keyed);
        await assert.rejects(apply(db, { ...prev.input, delta: prev.input.delta * 2 }), rule(409, 'idempotency_mismatch'), `${i}번째 (다른 내용)`);
        seen.mismatch++;
        continue;
      }
      const userId = pick(users);
      const earning = rand() < 0.5;
      const amount = 1 + Math.floor(rand() * 400);
      const delta = earning ? amount : -amount;
      const reason = earning ? pick(earnReasons) : pick(spendReasons);
      const idempotencyKey = rand() < 0.4 ? `op-${String(i).padStart(4, '0')}-key` : null;
      const input = { userId, delta, reason, idempotencyKey };
      const balance = model.get(userId)!;

      if (roll > 0.92) {
        // 부른 쪽이 코인 반영 뒤에 실패: 아무것도 남지 않는다
        await assert.rejects(
          db.transaction(async (tx) => {
            await applyCoins(tx, input).catch((err: unknown) => {
              if (!(err instanceof RuleError)) throw err;
            });
            throw new Error('되돌리기');
          }),
          /되돌리기/,
        );
        seen.rolledBack++;
        continue;
      }
      if (balance + delta < 0) {
        await assert.rejects(apply(db, input), rule(409, 'insufficient_coins'), `${i}번째 (모자람)`);
        seen.insufficient++;
        continue;
      }
      const result = await apply(db, input);
      model.set(userId, balance + delta);
      assert.deepEqual({ balance: result.balance, replayed: result.replayed }, { balance: balance + delta, replayed: false }, `${i}번째`);
      if (idempotencyKey !== null) keyed.push({ input: { ...input, idempotencyKey }, ledgerId: result.ledgerId, balance: result.balance });
      seen.applied++;
    }

    // 다섯 가지가 모두 실제로 섞였다 (씨앗을 바꿔 한 가지가 0이 되면 이 테스트는 그 경우를 보지 않은 것이다)
    for (const [kind, count] of Object.entries(seen)) assert.ok(count >= 10, `${kind}가 ${count}번뿐이에요: ${JSON.stringify(seen)}`);
    assert.equal(Object.values(seen).reduce((a, b) => a + b, 0), 500);

    for (const userId of users) {
      const expected = model.get(userId)!;
      const t = await totals(db, userId);
      assert.ok(expected >= 0);
      assert.equal(t.balance, expected, '잔액');
      assert.equal(t.sum, expected, '기록의 합');
      assert.equal(t.last, expected, '마지막 balance_after');
      assert.equal(await getBalance(db, userId), expected);
      // 기록 한 줄 한 줄: balance_after는 그때까지의 합이고 0 아래로 내려간 적이 없다
      let running = 0;
      for (const row of await ledgerOf(db, userId)) {
        running += row.delta;
        assert.equal(row.balanceAfter, running);
        assert.ok(row.balanceAfter >= 0);
      }
    }
    assert.equal((await db.select().from(coinLedger)).length, seen.applied, '기록은 반영된 요청만큼만 있다');
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('잔액이 9,000,000,000,000,000을 넘게 되면 실패하고 아무것도 남지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const fresh = await loginGuest(db, NOW);
    assert.equal((await apply(db, { userId: me.userId, delta: MAX_BALANCE - 10, reason: 'grant' })).balance, 8_999_999_999_999_990);
    const before = await dumpAppSchema(db);

    // DB의 CHECK에 걸려 500이 나는 것이 아니라, 정해진 코드로 거절한다
    await assert.rejects(apply(db, { userId: me.userId, delta: 11, reason: 'run' }), rule(409, 'balance_limit'));
    await assert.rejects(apply(db, { userId: me.userId, delta: MAX_BALANCE, reason: 'grant' }), rule(409, 'balance_limit'));
    // 지갑이 없는 사용자에게 한 번에 상한을 넘겨 주기. 가장 큰 안전한 정수도 같은 답이다
    await assert.rejects(apply(db, { userId: fresh.userId, delta: MAX_BALANCE + 1, reason: 'grant' }), rule(409, 'balance_limit'));
    await assert.rejects(apply(db, { userId: fresh.userId, delta: Number.MAX_SAFE_INTEGER, reason: 'grant' }), rule(409, 'balance_limit'));
    await assert.rejects(apply(db, { userId: me.userId, delta: Number.MAX_SAFE_INTEGER, reason: 'grant' }), rule(409, 'balance_limit'));
    assert.deepEqual(await dumpAppSchema(db), before, '거절된 뒤 아무것도 바뀌지 않았다');

    // 부른 쪽의 트랜잭션도 함께 되돌아간다 (판은 저장됐는데 코인 반영에서 실패)
    await assert.rejects(
      db.transaction(async (tx) => {
        await applyCoins(tx, { userId: fresh.userId, delta: 5, reason: 'run' });
        await applyCoins(tx, { userId: me.userId, delta: 11, reason: 'run' });
      }),
      rule(409, 'balance_limit'),
    );
    assert.deepEqual(await dumpAppSchema(db), before);

    // 딱 상한까지는 되고, 1코인 단위가 정확하다 (상한이 2^53보다 작다)
    assert.equal((await apply(db, { userId: me.userId, delta: 10, reason: 'run' })).balance, 9_000_000_000_000_000);
    await assert.rejects(apply(db, { userId: me.userId, delta: 1, reason: 'run' }), rule(409, 'balance_limit'));
    assert.equal((await apply(db, { userId: me.userId, delta: -1, reason: 'adjust' })).balance, 8_999_999_999_999_999);
    assert.deepEqual(await totals(db, me.userId), { balance: 8_999_999_999_999_999, sum: 8_999_999_999_999_999, last: 8_999_999_999_999_999, count: 3 });
    assert.equal((await apply(db, { userId: me.userId, delta: -8_999_999_999_999_999, reason: 'adjust' })).balance, 0);
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('없는 사용자와 지워진 사용자에게는 401 unauthorized이고 지갑도 기록도 붙지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const gone = await loginGuest(db, NOW);
    const kept = await loginGuest(db, NOW);
    await apply(db, { userId: kept.userId, delta: 100, reason: 'run' });
    // 현금 주문이 있어 행이 deleted로 남는 삭제와, 행까지 지우는 삭제
    const keepRow: DeletionPolicy = { mustKeepUserRow: async () => true, purge: [purgeUser] };
    const dropRow: DeletionPolicy = { mustKeepUserRow: async () => false, purge: [purgeUser] };
    await deleteAccount(db, kept.userId, keepRow, NOW);
    await deleteAccount(db, gone.userId, dropRow, NOW);
    assert.equal((await getUser(db, kept.userId))?.status, 'deleted');
    const before = await dumpAppSchema(db);

    for (const userId of [kept.userId, gone.userId, randomUUID(), 'not-a-user-id', '']) {
      await assert.rejects(apply(db, { userId, delta: 10, reason: 'run' }), rule(401, 'unauthorized'), userId);
      await assert.rejects(apply(db, { userId, delta: -10, reason: 'purchase', idempotencyKey: 'ghost-key-0001' }), rule(401, 'unauthorized'), userId);
    }
    assert.deepEqual(await dumpAppSchema(db), before);
    assert.deepEqual(await db.select().from(wallets), []);
    assert.deepEqual(await db.select().from(coinLedger), []);
  } finally {
    await close();
  }
});

test('purgeUser는 그 사용자의 지갑과 기록만 지운다. 계정 삭제가 부르면 사용자 행까지 지워진다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    const never = await loginGuest(db, NOW); // 코인을 받은 적이 없다
    for (const delta of [100, -30, 5]) await apply(db, { userId: me.userId, delta, reason: delta > 0 ? 'run' : 'purchase', idempotencyKey: `me-${delta}-key-0001` });
    await apply(db, { userId: other.userId, delta: 70, reason: 'attendance', idempotencyKey: 'other-key-0001' });
    const otherBefore = { wallet: await walletOf(db, other.userId), ledger: await ledgerOf(db, other.userId) };

    await db.transaction((tx) => purgeUser(tx, never.userId)); // 지울 것이 없어도 된다
    await db.transaction((tx) => purgeUser(tx, me.userId));
    assert.deepEqual(await totals(db, me.userId), { balance: null, sum: 0, last: null, count: 0 });
    assert.equal(await getBalance(db, me.userId), 0);
    assert.deepEqual({ wallet: await walletOf(db, other.userId), ledger: await ledgerOf(db, other.userId) }, otherBefore, '다른 사용자의 것은 그대로다');

    // 지운 뒤 같은 키는 새 요청이다 (기록이 없으니 다시 보낸 것으로 보지 않는다)
    const again = await apply(db, { userId: me.userId, delta: 100, reason: 'run', idempotencyKey: 'me-100-key-0001' });
    assert.deepEqual({ balance: again.balance, replayed: again.replayed }, { balance: 100, replayed: false });

    // 계정 삭제: 지갑과 기록이 사용자 행을 붙잡지 않는다 (외래 키)
    await deleteAccount(db, me.userId, { mustKeepUserRow: async () => false, purge: [purgeUser] }, NOW);
    assert.equal(await getUser(db, me.userId), null);
    assert.deepEqual(await totals(db, me.userId), { balance: null, sum: 0, last: null, count: 0 });
    assert.deepEqual(await totals(db, other.userId), { balance: 70, sum: 70, last: 70, count: 1 });
  } finally {
    await close();
  }
});

test('기록의 시각: now를 주면 기록과 지갑이 그 시각이고, 주지 않으면 DB의 지금이다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const at = new Date('2026-11-26T14:59:59.123Z');
    await apply(db, { userId: me.userId, delta: 10, reason: 'run', now: at });
    assert.equal((await ledgerOf(db, me.userId))[0].createdAt.getTime(), at.getTime());
    assert.equal((await walletOf(db, me.userId))?.updatedAt.getTime(), at.getTime());

    const later = new Date('2026-11-27T00:00:00Z');
    await apply(db, { userId: me.userId, delta: -4, reason: 'purchase', now: later });
    assert.equal((await ledgerOf(db, me.userId))[1].createdAt.getTime(), later.getTime());
    assert.equal((await walletOf(db, me.userId))?.updatedAt.getTime(), later.getTime());

    const started = Date.now();
    await apply(db, { userId: me.userId, delta: 1, reason: 'run' });
    const stamped = (await ledgerOf(db, me.userId))[2].createdAt.getTime();
    assert.ok(Math.abs(stamped - started) < 60_000, 'now가 없으면 DB의 지금');
    assert.equal((await walletOf(db, me.userId))?.updatedAt.getTime(), stamped, '지갑과 기록의 시각이 같다');
  } finally {
    await close();
  }
});

test('coin_ledger의 외래 키는 users와 admin_actions뿐이고, wallets의 외래 키는 users뿐이다', async () => {
  const { db, close } = await testDb();
  try {
    // 주문·판·보상 쪽이 기록을 가리킨다. 기록이 그쪽을 가리키면 외래 키가 아래 도메인에서 위 도메인으로 향하게 된다 (스펙 5.2, 5.14)
    const out = (await db.execute(sql`
      select c.conrelid::regclass::text as tbl, c.confrelid::regclass::text as ref
      from pg_constraint c
      where c.contype = 'f' and c.conrelid in ('app.coin_ledger'::regclass, 'app.wallets'::regclass)
      order by 1, 2
    `)) as unknown as { rows: Array<{ tbl: string; ref: string }> };
    assert.deepEqual(
      out.rows.map((r) => `${r.tbl} → ${r.ref}`),
      ['app.coin_ledger → app.admin_actions', 'app.coin_ledger → app.users', 'app.wallets → app.users'],
    );
  } finally {
    await close();
  }
});

test('DB 제약: 잔액은 0~9,000,000,000,000,000, delta는 0이 아니고, balance_after는 0 이상이고, (사용자, 키)는 하나뿐이다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await apply(db, { userId: me.userId, delta: 100, reason: 'run', idempotencyKey: 'taken-key-0001' });
    const before = await dumpAppSchema(db);
    const u = me.userId;
    // applyCoins를 거치지 않고 쓰는 코드가 생겨도 DB가 막는다
    const violations = [
      sql`update app.wallets set balance = -1 where user_id = ${u}`,
      sql`update app.wallets set balance = 9000000000000001 where user_id = ${u}`,
      sql`insert into app.wallets (user_id, balance) values (${other.userId}, -5)`,
      sql`insert into app.coin_ledger (user_id, delta, balance_after, reason) values (${u}, 0, 100, 'run')`,
      sql`insert into app.coin_ledger (user_id, delta, balance_after, reason) values (${u}, -101, -1, 'purchase')`,
      sql`insert into app.coin_ledger (user_id, delta, balance_after, reason) values (${u}, 5, 105, 'gift')`,
      sql`insert into app.coin_ledger (user_id, delta, balance_after, reason, idempotency_key) values (${u}, 5, 105, 'run', 'taken-key-0001')`,
      sql`insert into app.coin_ledger (user_id, delta, balance_after, reason) values (${randomUUID()}, 5, 5, 'run')`,
      sql`insert into app.coin_ledger (user_id, delta, balance_after, reason, admin_action_id) values (${u}, 5, 105, 'grant', 999999)`,
    ];
    for (const statement of violations) await assert.rejects(db.execute(statement));
    assert.deepEqual(await dumpAppSchema(db), before);
    // 상한 딱 그 값과, 키가 없는 기록 여러 줄은 된다
    await db.execute(sql`update app.wallets set balance = 9000000000000000 where user_id = ${u}`);
    await db.execute(sql`insert into app.coin_ledger (user_id, delta, balance_after, reason) values (${u}, 1, 1, 'run'), (${u}, 1, 2, 'run')`);
  } finally {
    await close();
  }
});

test('hasLedgerKey는 이 사용자가 이 키로 남긴 코인 기록이 있는지 알려 준다 (키는 사용자마다 따로)', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    assert.equal(await hasLedgerKey(db, me.userId, 'used-key-0001'), false);
    await apply(db, { userId: me.userId, delta: 50, reason: 'attendance', idempotencyKey: 'used-key-0001' });
    await apply(db, { userId: me.userId, delta: 10, reason: 'run' });
    assert.equal(await hasLedgerKey(db, me.userId, 'used-key-0001'), true);
    assert.equal(await hasLedgerKey(db, me.userId, 'used-key-0002'), false);
    assert.equal(await hasLedgerKey(db, other.userId, 'used-key-0001'), false, '남이 쓴 키는 내 키가 아니다');
    // 사용자 ID 모양이 아니면 쿼리 없이 거짓이다
    assert.equal(await hasLedgerKey(db, 'not-a-uuid', 'used-key-0001'), false);
  } finally {
    await close();
  }
});
