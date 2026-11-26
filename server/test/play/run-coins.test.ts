import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commands as adminCommands, setNumber } from '../../src/admin/index.ts';
import { runCoinStatus } from '../../src/play/index.ts';
import { claimAdReward, claimAttendance } from '../../src/reward/index.ts';
import { runCli } from '../../src/shared/cli/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { applyCoins, getBalance, verifyWallets } from '../../src/wallet/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { fakeIo } from '../helpers/cli.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { ledgerOf } from '../wallet/helpers.ts';
import { counts, NOW, own, playHandler, recordsOf, rule, runsOf, seedPlay, sendFull } from './helpers.ts';

/**
 * 하루에 판으로 벌 수 있는 코인의 상한 (스펙 5.9, 설정값 `run_coins_per_day`, 처음 값 1,500).
 * 상한에 걸려도 판은 거절하지 않는다: 점수와 기록은 그대로 반영하고 코인만 남은 만큼 넣는다.
 */
const setLimit = (db: Db, value: number) => db.transaction((tx) => setNumber(tx, 'run_coins_per_day', value));
const at = (iso: string) => new Date(iso);

async function setup(): Promise<{ db: Db; close(): Promise<void> }> {
  const kit = await testDb();
  await seedPlay(kit.db);
  return kit;
}

/** `start`부터 5초 간격으로 핀볼 판을 내서 코인을 번다. 마지막 판의 답을 준다 */
async function earn(db: Db, userId: string, coins: number[], start: Date) {
  let last = null;
  for (const [i, c] of coins.entries()) last = await sendFull(db, userId, { boardId: 'pinball', score: 100 + i, coins: c }, new Date(start.getTime() + i * 5000));
  return last!;
}

test('상한이 1500이고 오늘 1400을 벌었으면 300코인 판은 100만 들어가고 판과 기록은 그대로 남는다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const before = await earn(db, me.userId, [400, 400, 400, 200], NOW);
    assert.deepEqual([before.coins, before.coinsLeftToday, before.balance], [200, 100, 1400]);
    assert.deepEqual(await runCoinStatus(db, me.userId, NOW), { earnedToday: 1400, limit: 1500 });

    const when = new Date(NOW.getTime() + 60_000);
    const out = await sendFull(db, me.userId, { boardId: 'pinball', score: 99_000, coins: 300 }, when);
    assert.deepEqual(out, { boardId: 'pinball', recordValue: 99_000, isBest: true, firstClear: false, coins: 100, coinsLeftToday: 0, balance: 1500, replayed: false }, '코인은 남은 100만 들어가고 점수는 최고 기록이 된다');

    const runs = await runsOf(db, me.userId);
    const ledger = await ledgerOf(db, me.userId);
    assert.equal(runs.length, 5, '판은 거절되지 않고 남는다');
    assert.deepEqual([runs[4].value, runs[4].coins, runs[4].ledgerId], [99_000, 100, ledger[4].id], 'runs.coins는 실제로 들어간 코인이다');
    assert.deepEqual([ledger[4].delta, ledger[4].balanceAfter, ledger[4].reason], [100, 1500, 'run']);
    const [record] = await recordsOf(db, me.userId);
    assert.deepEqual([record.bestValue, record.bestAt?.toISOString(), record.playCount], [99_000, when.toISOString(), 5]);
    assert.deepEqual(await runCoinStatus(db, me.userId, when), { earnedToday: 1500, limit: 1500 });
    assert.equal(await getBalance(db, me.userId), 1500);

    // 판당 상한은 앱이 보낸 값에 그대로 본다: 남은 것이 0이어도 401코인 판은 400 invalid_coins다
    await assert.rejects(sendFull(db, me.userId, { boardId: 'pinball', score: 1, coins: 401 }, new Date(when.getTime() + 5000)), rule(400, 'invalid_coins'));
    // 다른 사용자의 상한은 따로다
    const other = await loginGuest(db, NOW);
    assert.deepEqual(await runCoinStatus(db, other.userId, when), { earnedToday: 0, limit: 1500 });
    const theirs = await sendFull(db, other.userId, { boardId: 'pinball', score: 1, coins: 400 }, when);
    assert.deepEqual([theirs.coins, theirs.coinsLeftToday], [400, 1100]);
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('상한을 다 채운 뒤의 판은 코인 0으로 반영되고 코인 기록이 생기지 않는다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    await own(db, me.userId, 'minesweeper');
    const filled = await earn(db, me.userId, [400, 400, 400, 300], NOW);
    assert.deepEqual([filled.coins, filled.coinsLeftToday, filled.balance], [300, 0, 1500]);
    const before = await counts(db, me.userId);

    const when = new Date(NOW.getTime() + 60_000);
    const out = await sendFull(db, me.userId, { boardId: 'minesweeper.easy', won: true, seconds: 40, opened: 70, correctFlags: 10, wrongFlags: 0, coins: 69 }, when);
    assert.deepEqual(out, { boardId: 'minesweeper.easy', recordValue: 3000, isBest: true, firstClear: true, coins: 0, coinsLeftToday: 0, balance: 1500, replayed: false }, '기록과 첫 클리어는 그대로다');
    assert.deepEqual(await counts(db, me.userId), { runs: before.runs + 1, records: before.records + 1, ledger: before.ledger, balance: 1500 }, '코인 기록은 늘지 않는다');
    const last = (await runsOf(db, me.userId)).at(-1)!;
    assert.deepEqual([last.coins, last.ledgerId, last.won], [0, null, true]);

    // 그 뒤의 판도 계속 반영된다 (3초 간격은 그대로 본다)
    await assert.rejects(sendFull(db, me.userId, { boardId: 'pinball', score: 5, coins: 400 }, new Date(when.getTime() + 1000)), rule(429, 'too_fast'));
    const next = await sendFull(db, me.userId, { boardId: 'pinball', score: 500_000, coins: 400 }, new Date(when.getTime() + 5000));
    assert.deepEqual([next.recordValue, next.isBest, next.coins, next.coinsLeftToday, next.balance], [500_000, true, 0, 0, 1500]);

    // 운영자가 상한을 이미 번 것보다 낮추면 남은 것은 0이고(음수가 아니다), 올리면 그만큼 더 번다
    await setLimit(db, 1000);
    const lowered = await sendFull(db, me.userId, { boardId: 'pinball', score: 1, coins: 50 }, new Date(when.getTime() + 10_000));
    assert.deepEqual([lowered.coins, lowered.coinsLeftToday], [0, 0]);
    assert.deepEqual(await runCoinStatus(db, me.userId, when), { earnedToday: 1500, limit: 1000 });
    await setLimit(db, 1530);
    const raised = await sendFull(db, me.userId, { boardId: 'pinball', score: 1, coins: 50 }, new Date(when.getTime() + 15_000));
    assert.deepEqual([raised.coins, raised.coinsLeftToday, raised.balance], [30, 0, 1530]);
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('한국 시간 23:59:59에 상한을 채워도 00:00:00에는 다시 벌 수 있다', async () => {
  const { db, close } = await setup();
  try {
    await setLimit(db, 100);
    // 14:59:57Z = 한국 23:59:57, 15:00:00Z = 한국 다음 날 00:00:00 (판 사이는 3초여야 해서 두 사용자로 나눠 본다)
    const a = await loginGuest(db, NOW);
    const first = await sendFull(db, a.userId, { boardId: 'pinball', score: 1, coins: 100 }, at('2026-11-26T14:59:57Z'));
    assert.deepEqual([first.coins, first.coinsLeftToday], [100, 0]);
    const next = await sendFull(db, a.userId, { boardId: 'pinball', score: 2, coins: 100 }, at('2026-11-26T15:00:00Z'));
    assert.deepEqual([next.coins, next.coinsLeftToday, next.balance], [100, 0, 200], '00:00:00은 새 날이다');

    const b = await loginGuest(db, NOW);
    await sendFull(db, b.userId, { boardId: 'pinball', score: 1, coins: 60 }, at('2026-11-26T14:59:56Z'));
    const last = await sendFull(db, b.userId, { boardId: 'pinball', score: 2, coins: 100 }, at('2026-11-26T14:59:59Z'));
    assert.deepEqual([last.coins, last.coinsLeftToday], [40, 0], '23:59:59에 상한을 채운다');
    assert.deepEqual(await runCoinStatus(db, b.userId, at('2026-11-26T14:59:59.999Z')), { earnedToday: 100, limit: 100 });
    assert.deepEqual(await runCoinStatus(db, b.userId, at('2026-11-26T15:00:00Z')), { earnedToday: 0, limit: 100 });
    const morning = await sendFull(db, b.userId, { boardId: 'pinball', score: 3, coins: 70 }, at('2026-11-26T15:00:02Z'));
    assert.deepEqual([morning.coins, morning.coinsLeftToday, morning.balance], [70, 30, 170]);
    // UTC 날짜가 아니라 한국 날짜다: UTC로는 다음 날인 00:30Z도 한국에서는 같은 날이라 남은 30만 들어간다
    const sameKoreanDay = await sendFull(db, b.userId, { boardId: 'pinball', score: 4, coins: 70 }, at('2026-11-27T00:30:00Z'));
    assert.deepEqual([sameKoreanDay.coins, sameKoreanDay.coinsLeftToday], [30, 0]);
  } finally {
    await close();
  }
});

test('설정이 0이면 상한이 없다', async () => {
  const { db, close } = await setup();
  try {
    await setLimit(db, 0);
    const me = await loginGuest(db, NOW);
    const out = await earn(db, me.userId, [400, 400, 400, 400, 400], NOW);
    assert.deepEqual([out.coins, out.coinsLeftToday, out.balance], [400, null, 2000], '남은 코인은 null이다 (상한이 없다)');
    assert.deepEqual(await runCoinStatus(db, me.userId, NOW), { earnedToday: 2000, limit: null });
    // 상한을 다시 두면 그날 이미 번 것부터 센다
    await setLimit(db, 2100);
    const capped = await sendFull(db, me.userId, { boardId: 'pinball', score: 1, coins: 400 }, new Date(NOW.getTime() + 60_000));
    assert.deepEqual([capped.coins, capped.coinsLeftToday], [100, 0]);
    assert.deepEqual(await runCoinStatus(db, 'not-a-uuid', NOW), { earnedToday: 0, limit: 2100 }, '사용자 ID 모양이 아니어도 쿼리 오류가 나지 않는다');
  } finally {
    await close();
  }
});

test('출석·광고 보상과 운영자 지급은 상한에 들어가지 않는다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    await claimAttendance(db, me.userId, NOW);
    for (let i = 0; i < 3; i++) await claimAdReward(db, me.userId, NOW);
    await db.transaction(async (tx) => {
      await applyCoins(tx, { userId: me.userId, delta: 5000, reason: 'grant', now: NOW });
      await applyCoins(tx, { userId: me.userId, delta: -300, reason: 'purchase', now: NOW });
      await applyCoins(tx, { userId: me.userId, delta: 300, reason: 'refund', now: NOW });
    });
    assert.equal(await getBalance(db, me.userId), 5200);
    assert.deepEqual(await runCoinStatus(db, me.userId, NOW), { earnedToday: 0, limit: 1500 }, '판으로 번 것만 센다');

    const out = await earn(db, me.userId, [400, 400, 400, 400], NOW);
    assert.deepEqual([out.coins, out.coinsLeftToday, out.balance], [300, 0, 6700], '판으로는 1,500까지 다 번다');
    // 상한을 채운 뒤에도 보상은 받는다 (다음 날의 출석)
    assert.equal((await claimAttendance(db, me.userId, at('2026-11-27T03:00:00Z'))).balance, 6750);
    assert.deepEqual(await runCoinStatus(db, me.userId, new Date(NOW.getTime() + 60_000)), { earnedToday: 1500, limit: 1500 });
  } finally {
    await close();
  }
});

test('상한에 걸린 판을 같은 키로 다시 보내면 처음에 들어간 코인을 그대로 답한다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    await earn(db, me.userId, [400, 400, 400, 200], NOW);
    const when = new Date(NOW.getTime() + 60_000);
    const run = { boardId: 'pinball', score: 99_000, coins: 300, idempotencyKey: 'capped-run-0001' };
    const first = await sendFull(db, me.userId, run, when);
    assert.deepEqual(first, { boardId: 'pinball', recordValue: 99_000, isBest: true, firstClear: false, coins: 100, coinsLeftToday: 0, balance: 1500, replayed: false });
    assert.deepEqual(await sendFull(db, me.userId, run, new Date(when.getTime() + 500)), { ...first, replayed: true }, '300이 아니라 처음에 들어간 100이다');
    assert.deepEqual(await counts(db, me.userId), { runs: 5, records: 1, ledger: 5, balance: 1500 });

    // 상한을 다 채운 뒤 코인 0으로 반영된 판도 같다 (코인 기록이 없는 판)
    const zero = { boardId: 'pinball', score: 5, coins: 250, idempotencyKey: 'capped-run-0002' };
    const zeroFirst = await sendFull(db, me.userId, zero, new Date(when.getTime() + 5000));
    assert.deepEqual([zeroFirst.coins, zeroFirst.coinsLeftToday, zeroFirst.balance], [0, 0, 1500]);
    assert.deepEqual(await sendFull(db, me.userId, zero, new Date(when.getTime() + 5500)), { ...zeroFirst, replayed: true });
    // 다음 날에 늦게 다시 보내도 새로 벌지 않는다
    assert.deepEqual(await sendFull(db, me.userId, run, at('2026-11-27T03:00:00Z')), { ...first, replayed: true });
    assert.deepEqual(await sendFull(db, me.userId, zero, at('2026-11-27T03:00:00Z')), { ...zeroFirst, replayed: true });
    assert.equal((await counts(db, me.userId)).ledger, 5);

    // 상한에 걸려 깎인 판은 앱이 보낸 코인을 남기지 않았다: 들어간 것보다 적게 보낸 것만 다른 내용으로 가려낸다
    await assert.rejects(sendFull(db, me.userId, { ...run, coins: 99 }, when), rule(409, 'idempotency_mismatch'));
    await assert.rejects(sendFull(db, me.userId, { ...run, coins: -1 }, when), rule(409, 'idempotency_mismatch'));
    await assert.rejects(sendFull(db, me.userId, { ...run, coins: 1.5 }, when), rule(409, 'idempotency_mismatch'));
    await assert.rejects(sendFull(db, me.userId, { ...run, score: 98_000 }, when), rule(409, 'idempotency_mismatch'), '점수는 그대로 견준다');

    // 상한에 걸리지 않은 판은 보낸 코인이 그대로 들어간 것이라 코인이 다르면 거절한다 (더 많이 보내도)
    const other = await loginGuest(db, NOW);
    const free = { boardId: 'pinball', score: 10, coins: 100, idempotencyKey: 'free-run-00001' };
    const freeFirst = await sendFull(db, other.userId, free, NOW);
    assert.deepEqual([freeFirst.coins, freeFirst.coinsLeftToday], [100, 1400]);
    await sendFull(db, other.userId, { boardId: 'pinball', score: 11, coins: 50 }, new Date(NOW.getTime() + 5000));
    assert.deepEqual(await sendFull(db, other.userId, free, when), { ...freeFirst, replayed: true }, '남은 코인도 그 판을 낸 직후의 것이다');
    await assert.rejects(sendFull(db, other.userId, { ...free, coins: 101 }, when), rule(409, 'idempotency_mismatch'));
    await assert.rejects(sendFull(db, other.userId, { ...free, coins: 99 }, when), rule(409, 'idempotency_mismatch'));
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('상한은 config set으로 바꾸고 POST /v2/me/runs의 답에 남은 코인이 온다', async () => {
  const { db, close } = await setup();
  try {
    const clock = fakeClock(NOW.toISOString());
    const handler = playHandler(db, clock);
    const me = await loginGuest(db, NOW);
    const post = async (coins: number) => {
      const r = await call(handler, 'POST', '/v2/me/runs', { token: me.token, body: { boardId: 'pinball', score: 100, coins } });
      clock.advance(5000);
      return r.body as { coins: number; coinsLeftToday: number | null; balance: number };
    };
    assert.deepEqual(await post(400), { boardId: 'pinball', recordValue: 100, isBest: true, firstClear: false, coins: 400, coinsLeftToday: 1100, balance: 400, replayed: false });

    const io = fakeIo();
    assert.equal(await runCli(['config', 'set', 'run_coins_per_day', '500', '--reason', '하루 상한 조정', '--yes'], adminCommands(db, 'ops-kim'), io), 0, io.text());
    assert.match(io.text(), /1500 → 500/);
    const capped = await post(400);
    assert.deepEqual([capped.coins, capped.coinsLeftToday, capped.balance], [100, 0, 500]);
    assert.equal(await runCli(['config', 'set', 'run_coins_per_day', '0', '--reason', '상한 없앰', '--yes'], adminCommands(db, 'ops-kim'), fakeIo()), 0);
    const free = await post(400);
    assert.deepEqual([free.coins, free.coinsLeftToday, free.balance], [400, null, 900]);
  } finally {
    await close();
  }
});
