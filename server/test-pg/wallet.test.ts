import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount, type DeletionPolicy } from '../src/account/index.ts';
import { users } from '../src/account/schema.ts';
import type { Db } from '../src/shared/db/index.ts';
import { RuleError } from '../src/shared/errors.ts';
import { applyCoins, getBalance, purgeUser, verifyWallets } from '../src/wallet/index.ts';
import { coinLedger, wallets } from '../src/wallet/schema.ts';
import { loginGuest } from '../test/account/helpers.ts';
import { ledgerOf, totals, type ApplyInput } from '../test/wallet/helpers.ts';
import { pgTestDb, SKIP } from './helpers.ts';

const NOW = new Date('2026-11-26T03:00:00Z');

/** 요청 하나: 연결 하나를 잡아 트랜잭션 하나로 `applyCoins`를 부른다 */
const apply = (db: Db, input: ApplyInput) => db.transaction((tx) => applyCoins(tx, input));

/** 실패한 요청을 한 줄로: 규칙에 걸린 거절이면 `409 insufficient_coins`, 그 밖이면 PostgreSQL 오류 코드나 메시지 */
function failure(reason: unknown): string {
  if (reason instanceof RuleError) return `${reason.status} ${reason.code}`;
  const cause = (reason as { cause?: { code?: unknown } } | null)?.cause;
  return `뜻밖의 오류: ${String(cause?.code ?? reason)}`;
}

type Outcome = { ok: Awaited<ReturnType<typeof applyCoins>> } | { failed: string };

/** 같은 순간에 보낸다 (pool의 연결 10개가 저마다 트랜잭션을 연다). 순서는 보낸 순서 그대로다 */
async function together(db: Db, inputs: ApplyInput[]): Promise<Outcome[]> {
  const settled = await Promise.allSettled(inputs.map((input) => apply(db, input)));
  return settled.map((r) => (r.status === 'fulfilled' ? { ok: r.value } : { failed: failure(r.reason) }));
}

const oks = (outcomes: Outcome[]) => outcomes.flatMap((o) => ('ok' in o ? [o.ok] : []));
const fails = (outcomes: Outcome[]) => outcomes.flatMap((o) => ('failed' in o ? [o.failed] : []));

test('잔액 1000에서 −300을 동시에 10번 보내면 3번만 성공하고 잔액은 100, 기록의 합과 같다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    // 한 번으로는 우연히 지나갈 수 있어서 사용자를 바꿔 가며 여러 번 한다
    for (let round = 0; round < 5; round++) {
      const me = await loginGuest(db, NOW);
      await apply(db, { userId: me.userId, delta: 1000, reason: 'grant' });

      const outcomes = await together(db, Array.from({ length: 10 }, () => ({ userId: me.userId, delta: -300, reason: 'purchase' as const })));
      assert.equal(oks(outcomes).length, 3, `${round}번째: ${JSON.stringify(outcomes)}`);
      assert.deepEqual(fails(outcomes), Array.from({ length: 7 }, () => '409 insufficient_coins'), '나머지 일곱은 모자라서 거절된다 (500 없음)');
      // 성공한 셋이 받은 잔액은 700, 400, 100이고 서로 다른 기록이다
      assert.deepEqual(oks(outcomes).map((r) => r.balance).sort((a, b) => a - b), [100, 400, 700]);
      assert.equal(new Set(oks(outcomes).map((r) => r.ledgerId)).size, 3);
      assert.ok(oks(outcomes).every((r) => !r.replayed));

      assert.deepEqual(await totals(db, me.userId), { balance: 100, sum: 100, last: 100, count: 4 });
      assert.equal(await getBalance(db, me.userId), 100);
      // 기록을 차례로 더하면 한 줄도 0 아래로 내려가지 않는다
      let running = 0;
      for (const row of await ledgerOf(db, me.userId)) {
        running += row.delta;
        assert.equal(row.balanceAfter, running);
        assert.ok(running >= 0);
      }
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('지갑이 없는 사용자에게 동시에 10번 주면 지갑은 하나이고 잔액은 그 합이다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    for (let round = 0; round < 5; round++) {
      const me = await loginGuest(db, NOW);
      // 첫 코인이 동시에 온다: 지갑 행을 만드는 일이 겹친다
      const outcomes = await together(db, Array.from({ length: 10 }, (_, i) => ({ userId: me.userId, delta: 10 + i, reason: 'run' as const })));
      assert.deepEqual(fails(outcomes), [], `${round}번째: 열 번 모두 반영된다 (유일 제약 위반 없음)`);
      assert.equal((await db.select().from(wallets)).filter((w) => w.userId === me.userId).length, 1);
      assert.deepEqual(await totals(db, me.userId), { balance: 145, sum: 145, last: 145, count: 10 });
      assert.equal(Math.max(...oks(outcomes).map((r) => r.balance)), 145);
      assert.equal(new Set(oks(outcomes).map((r) => r.balance)).size, 10, '받은 잔액이 모두 다르다 (같은 잔액을 읽고 덮어쓴 요청이 없다)');
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('벌기와 쓰기를 섞어 동시에 40번 보내도 잔액은 0 아래로 내려가지 않고 기록의 합과 같다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    const a = await loginGuest(db, NOW);
    const b = await loginGuest(db, NOW);
    await apply(db, { userId: a.userId, delta: 500, reason: 'grant' });
    // 두 사용자의 요청이 뒤섞여 온다. 한 사용자의 잠금이 다른 사용자를 막거나 어긋나게 하지 않는다
    const inputs: ApplyInput[] = Array.from({ length: 40 }, (_, i) => ({
      userId: i % 2 === 0 ? a.userId : b.userId,
      delta: i % 3 === 0 ? 70 : -90,
      reason: i % 3 === 0 ? ('run' as const) : ('purchase' as const),
    }));
    const outcomes = await together(db, inputs);
    assert.deepEqual([...new Set(fails(outcomes))].filter((f) => f !== '409 insufficient_coins'), [], '거절은 모자람뿐이다');
    for (const userId of [a.userId, b.userId]) {
      const applied = outcomes.flatMap((o, i) => ('ok' in o && inputs[i].userId === userId ? [inputs[i].delta] : []));
      const expected = (userId === a.userId ? 500 : 0) + applied.reduce((sum, d) => sum + d, 0);
      assert.ok(expected >= 0);
      const t = await totals(db, userId);
      assert.deepEqual({ balance: t.balance, sum: t.sum, last: t.last }, { balance: expected, sum: expected, last: expected });
      let running = 0;
      for (const row of await ledgerOf(db, userId)) {
        running += row.delta;
        assert.equal(row.balanceAfter, running);
        assert.ok(running >= 0);
      }
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('같은 idempotency 키를 동시에 두 번 보내면 한 번만 반영되고 하나는 replayed다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    for (let round = 0; round < 10; round++) {
      const me = await loginGuest(db, NOW);
      // 짝수 번째는 지갑이 아직 없는 사용자다 (첫 요청이 두 번 온 경우: 지갑 만들기와 기록 넣기가 함께 겹친다)
      const start = round % 2 === 0 ? 0 : 1000;
      if (start > 0) await apply(db, { userId: me.userId, delta: start, reason: 'grant' });
      const delta = round % 4 < 2 ? 50 : start > 0 ? -300 : 20;
      const input: ApplyInput = { userId: me.userId, delta, reason: delta > 0 ? 'run' : 'purchase', idempotencyKey: `same-key-${round}-0001` };

      const outcomes = await together(db, [input, input]);
      assert.deepEqual(fails(outcomes), [], `${round}번째: 둘 다 답을 받는다 (유일 제약 위반이 500으로 나가지 않는다)`);
      const [x, y] = oks(outcomes);
      assert.deepEqual([x.replayed, y.replayed].sort(), [false, true], '하나만 반영하고 하나는 다시 보낸 것으로 본다');
      assert.equal(x.ledgerId, y.ledgerId, '둘이 같은 기록을 가리킨다');
      assert.equal(x.balance, start + delta);
      assert.equal(y.balance, start + delta, '처음과 같은 답을 받는다');

      const rows = (await ledgerOf(db, me.userId)).filter((r) => r.idempotencyKey === input.idempotencyKey);
      assert.equal(rows.length, 1);
      assert.deepEqual(await totals(db, me.userId), { balance: start + delta, sum: start + delta, last: start + delta, count: start > 0 ? 2 : 1 });
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('같은 키를 동시에 10번 보내도 한 번만 반영된다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    for (let round = 0; round < 3; round++) {
      const me = await loginGuest(db, NOW);
      await apply(db, { userId: me.userId, delta: 1000, reason: 'grant' });
      const input: ApplyInput = { userId: me.userId, delta: -300, reason: 'purchase', idempotencyKey: `burst-key-${round}-0001` };
      // 연타한 구매: 키가 없으면 3번 빠져나가지만 같은 키라 한 번만 빠진다
      const outcomes = await together(db, Array.from({ length: 10 }, () => input));
      assert.deepEqual(fails(outcomes), [], `${round}번째`);
      assert.equal(oks(outcomes).filter((r) => !r.replayed).length, 1);
      assert.equal(oks(outcomes).filter((r) => r.replayed).length, 9);
      assert.deepEqual([...new Set(oks(outcomes).map((r) => `${r.ledgerId}:${r.balance}`))].length, 1, '열 번 모두 같은 답이다');
      assert.deepEqual(await totals(db, me.userId), { balance: 700, sum: 700, last: 700, count: 2 });
    }
  } finally {
    await close();
  }
});

test('같은 키에 다른 내용을 동시에 보내면 하나만 반영되고 다른 하나는 409 idempotency_mismatch다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    for (let round = 0; round < 10; round++) {
      const me = await loginGuest(db, NOW);
      if (round % 2 === 1) await apply(db, { userId: me.userId, delta: 1000, reason: 'grant' });
      const start = round % 2 === 1 ? 1000 : 0;
      const idempotencyKey = `clash-key-${round}-0001`;
      const inputs: ApplyInput[] = [
        { userId: me.userId, delta: 50, reason: 'run', idempotencyKey },
        round % 4 < 2 ? { userId: me.userId, delta: 60, reason: 'run', idempotencyKey } : { userId: me.userId, delta: 50, reason: 'attendance', idempotencyKey },
      ];
      const outcomes = await together(db, inputs);
      assert.equal(oks(outcomes).length, 1, `${round}번째: ${JSON.stringify(outcomes)}`);
      assert.deepEqual(fails(outcomes), ['409 idempotency_mismatch']);
      // 반영된 쪽의 내용이 그대로 기록에 있다
      const winner = inputs[outcomes.findIndex((o) => 'ok' in o)];
      const rows = (await ledgerOf(db, me.userId)).filter((r) => r.idempotencyKey === idempotencyKey);
      assert.deepEqual(rows.map((r) => [r.delta, r.reason]), [[winner.delta, winner.reason]]);
      const balance = start + winner.delta;
      assert.deepEqual(await totals(db, me.userId), { balance, sum: balance, last: balance, count: start > 0 ? 2 : 1 });
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const keepRow of [true, false]) {
  const kind = keepRow ? '행을 남기는(현금 주문이 있는)' : '행까지 지우는';
  test(`${kind} 계정 삭제가 도는 동안 온 코인 요청은 401이고, 지워진 사용자에 지갑도 기록도 붙지 않는다 (500 없음)`, { skip: SKIP }, async () => {
    const { db, close } = await pgTestDb();
    try {
      // 다른 도메인의 데이터를 지우느라 0.2초가 걸리는 삭제. 그동안 사용자 행이 잠겨 있다
      const policy: DeletionPolicy = { mustKeepUserRow: async () => keepRow, purge: [() => sleep(200), purgeUser] };
      const gone: string[] = [];
      for (let round = 0; round < 3; round++) {
        const me = await loginGuest(db, NOW);
        if (round > 0) await apply(db, { userId: me.userId, delta: 500, reason: 'grant', idempotencyKey: `before-delete-${round}` });
        gone.push(me.userId);

        const deleting = deleteAccount(db, me.userId, policy, NOW);
        await sleep(50); // 삭제가 사용자 행을 잠근 뒤에 보낸다
        const outcomes = await together(db, [
          { userId: me.userId, delta: 50, reason: 'run' },
          { userId: me.userId, delta: -10, reason: 'purchase' },
          { userId: me.userId, delta: 500, reason: 'grant', idempotencyKey: `before-delete-${round}` }, // 지우기 전의 키를 다시 보냄
        ]);
        await deleting;
        assert.deepEqual(outcomes, [{ failed: '401 unauthorized' }, { failed: '401 unauthorized' }, { failed: '401 unauthorized' }], `${round}번째`);
      }

      // 거꾸로: 코인 요청이 먼저 사용자를 잡으면 삭제가 그 끝을 기다렸다가 지갑과 기록까지 지운다
      const racer = await loginGuest(db, NOW);
      gone.push(racer.userId);
      const [slow] = await Promise.allSettled([
        db.transaction(async (tx) => {
          const result = await applyCoins(tx, { userId: racer.userId, delta: 70, reason: 'run' });
          await sleep(200);
          return result;
        }),
        sleep(50).then(() => deleteAccount(db, racer.userId, policy, NOW)),
      ]);
      assert.equal(slow.status, 'fulfilled', '먼저 시작한 코인 요청은 끝까지 간다');

      const userRows = await db.select().from(users);
      for (const userId of gone) assert.equal(userRows.find((u) => u.id === userId)?.status, keepRow ? 'deleted' : undefined, '사용자 행');
      assert.deepEqual((await db.select().from(wallets)).filter((w) => gone.includes(w.userId)), [], '지워진 사용자의 지갑이 없다');
      assert.deepEqual((await db.select().from(coinLedger)).filter((l) => gone.includes(l.userId)), [], '지워진 사용자의 기록이 없다');
    } finally {
      await close();
    }
  });
}
