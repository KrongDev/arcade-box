import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Db } from '../src/shared/db/index.ts';
import { RuleError } from '../src/shared/errors.ts';
import { applyCoins, verifyWallets } from '../src/wallet/index.ts';
import { loginGuest } from '../test/account/helpers.ts';
import { runCoinStatus } from '../src/play/index.ts';
import { counts, NOW, recordsOf, seedPlay, send, sendFull } from '../test/play/helpers.ts';
import { pgTestDb, SKIP } from './helpers.ts';

function failure(reason: unknown): string {
  if (reason instanceof RuleError) return `${reason.status} ${reason.code}`;
  const cause = (reason as { cause?: { code?: unknown } } | null)?.cause;
  return `뜻밖의 오류: ${String(cause?.code ?? reason)}`;
}

type Sent = Awaited<ReturnType<typeof send>>;

/** 같은 순간에 보낸다 (pool의 연결이 저마다 트랜잭션을 연다) */
async function together(db: Db, userId: string, inputs: unknown[], now: Date): Promise<{ ok: Sent[]; failed: string[] }> {
  const settled = await Promise.allSettled(inputs.map((input) => send(db, userId, input, now)));
  return {
    ok: settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
    failed: settled.flatMap((r) => (r.status === 'rejected' ? [failure(r.reason)] : [])),
  };
}

test('같은 사용자가 판 결과 5개를 동시에 보내면 하나만 반영되고 나머지는 429 too_fast이다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedPlay(db);
    // 한 번으로는 우연히 지나갈 수 있어서 사용자를 바꿔 가며 여러 번 한다.
    // 짝수 번째는 지갑이 아직 없는 새 사용자, 홀수 번째는 코인을 받은 적 있는 사용자다
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOW);
      const start = round % 2 === 1 ? 1000 : 0;
      if (start > 0) await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: start, reason: 'grant', now: NOW }));
      const out = await together(
        db,
        me.userId,
        [1, 2, 3, 4, 5].map((n) => ({ boardId: 'pinball', score: 1000 * n, coins: 100 })),
        NOW,
      );
      assert.equal(out.ok.length, 1, `${round}번째: ${JSON.stringify(out.failed)}`);
      assert.deepEqual(out.failed, ['429 too_fast', '429 too_fast', '429 too_fast', '429 too_fast'], `${round}번째: 500이 아니라 너무 빠르다는 거절이다`);
      assert.equal(out.ok[0].balance, start + 100);
      assert.deepEqual(await counts(db, me.userId), { runs: 1, records: 1, ledger: start > 0 ? 2 : 1, balance: start + 100 }, `${round}번째: 코인은 한 번만 들어갔다`);
      const [record] = await recordsOf(db, me.userId);
      assert.equal(record.playCount, 1);
      assert.equal(record.bestValue, out.ok[0].recordValue, '반영된 그 판의 점수가 기록이다');
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('코인이 0인 판 5개를 동시에 보내도 하나만 반영된다 (지갑을 잡고 차례를 선다)', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedPlay(db);
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOW);
      const out = await together(
        db,
        me.userId,
        [1, 2, 3, 4, 5].map((n) => ({ boardId: n % 2 === 0 ? 'pinball' : 'pinball.sprint', score: 10 * n, won: true, seconds: 10 * n, coins: 0 })),
        NOW,
      );
      assert.equal(out.ok.length, 1, `${round}번째: ${JSON.stringify(out.failed)}`);
      assert.deepEqual(out.failed, ['429 too_fast', '429 too_fast', '429 too_fast', '429 too_fast'], `${round}번째`);
      assert.equal((await counts(db, me.userId)).runs, 1);
    }
  } finally {
    await close();
  }
});

test('같은 키의 판 결과를 동시에 5번 보내면 판과 코인은 한 번이고 모두 같은 답을 받는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedPlay(db);
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOW);
      const coins = round % 2 === 0 ? 100 : 0;
      const run = { boardId: 'pinball', score: 31000, coins, idempotencyKey: `same-key-${round}` };
      const out = await together(db, me.userId, [run, run, run, run, run], NOW);
      assert.deepEqual(out.failed, [], `${round}번째: 다시 보낸 요청은 거절되지 않는다`);
      assert.equal(out.ok.filter((r) => !r.replayed).length, 1, `${round}번째: 처음 반영된 것은 하나다`);
      const { replayed: _first, ...answer } = out.ok.find((r) => !r.replayed)!;
      for (const r of out.ok) {
        const { replayed: _each, ...rest } = r;
        assert.deepEqual(rest, answer, `${round}번째: 모두 같은 답이다`);
      }
      assert.deepEqual(answer, { boardId: 'pinball', recordValue: 31000, isBest: true, firstClear: false, coins, balance: coins });
      assert.deepEqual(await counts(db, me.userId), { runs: 1, records: 1, ledger: coins > 0 ? 1 : 0, balance: coins }, `${round}번째`);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('서로 다른 사용자의 판 결과는 서로를 기다리게 하지 않고 모두 반영된다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedPlay(db);
    const people = await Promise.all(Array.from({ length: 8 }, () => loginGuest(db, NOW)));
    const settled = await Promise.allSettled(people.map((p, i) => send(db, p.userId, { boardId: 'pinball', score: 100 + i, coins: 10 }, NOW)));
    assert.deepEqual(settled.flatMap((r) => (r.status === 'rejected' ? [failure(r.reason)] : [])), []);
    for (const p of people) assert.deepEqual(await counts(db, p.userId), { runs: 1, records: 1, ledger: 1, balance: 10 });
  } finally {
    await close();
  }
});

test('하루 상한: 진짜 PostgreSQL에서도 그날(한국 날짜) 판으로 번 합까지만 코인이 들어가고, 깎인 판을 동시에 다시 보내도 한 번이다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedPlay(db);
    const me = await loginGuest(db, NOW);
    // 한국 23:59:40부터 5초 간격으로 400코인 판 넷: 1,500까지만 들어간다
    const start = new Date('2026-11-26T14:59:40Z');
    const got = [];
    for (let i = 0; i < 4; i++) got.push(await sendFull(db, me.userId, { boardId: 'pinball', score: 100 + i, coins: 400 }, new Date(start.getTime() + i * 5000)));
    assert.deepEqual(got.map((r) => [r.coins, r.coinsLeftToday, r.balance]), [[400, 1100, 400], [400, 700, 800], [400, 300, 1200], [300, 0, 1500]]);
    assert.deepEqual(await runCoinStatus(db, me.userId, new Date('2026-11-26T14:59:59Z')), { earnedToday: 1500, limit: 1500 });
    assert.deepEqual(await runCoinStatus(db, me.userId, new Date('2026-11-26T15:00:00Z')), { earnedToday: 0, limit: 1500 }, '한국 날짜가 바뀌면 다시 0이다');

    // 다음 날 첫 판: 같은 키로 5번을 동시에 보내도 판과 코인은 한 번이다
    const run = { boardId: 'pinball', score: 9000, coins: 400, idempotencyKey: 'next-day-run-01' };
    const settled = await Promise.allSettled([1, 2, 3, 4, 5].map(() => sendFull(db, me.userId, run, new Date('2026-11-26T15:00:03Z'))));
    assert.deepEqual(settled.flatMap((r) => (r.status === 'rejected' ? [failure(r.reason)] : [])), []);
    const answers = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    assert.equal(answers.filter((r) => !r.replayed).length, 1);
    for (const r of answers) assert.deepEqual([r.coins, r.coinsLeftToday, r.balance], [400, 1100, 1900]);
    assert.deepEqual(await counts(db, me.userId), { runs: 5, records: 1, ledger: 5, balance: 1900 });
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});
