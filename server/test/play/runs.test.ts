import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount, type DeletionPolicy } from '../../src/account/index.ts';
import { revoke } from '../../src/entitlement/index.ts';
import { createGame, updateGame } from '../../src/game/index.ts';
import { boardStats, createBoard, leaderboard, listBoards, purgeUser, updateBoard } from '../../src/play/index.ts';
import { createProduct } from '../../src/product/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { applyCoins, getBalance, purgeUser as purgeWallet, verifyWallets } from '../../src/wallet/index.ts';
import { sql } from 'drizzle-orm';
import { loginGuest } from '../account/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { ledgerOf } from '../wallet/helpers.ts';
import { clearRun, counts, MS, NOW, own, playHandler, recordsOf, rule, runsOf, seedPlay, send } from './helpers.ts';

/** 지갑 상한 (스펙 5.2의 CHECK). wallet의 상수를 가져오지 않고 스펙의 숫자를 직접 적는다 */
const MAX_BALANCE = 9_000_000_000_000_000;

/** 판 사이 간격(3초)을 넘겨 가며 보내려고 쓰는 시계 */
function ticking(start: Date = NOW) {
  let at = start.getTime();
  return {
    /** 지금 */
    now: () => new Date(at),
    /** 5초 뒤 */
    next: () => new Date((at += 5000)),
    /** ms 뒤 */
    after: (ms: number) => new Date((at += ms)),
  };
}

async function setup(): Promise<{ db: Db; close(): Promise<void> }> {
  const kit = await testDb();
  await seedPlay(kit.db);
  return kit;
}

test('할 수 있는 게임의 판 결과는 판·기록·코인 기록을 한 번에 남기고 코인은 통일 지갑으로 간다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const t = ticking();
    const out = await send(db, me.userId, { boardId: 'pinball', score: 31000, coins: 45, gameVersion: 3 }, t.now());
    assert.deepEqual(out, { boardId: 'pinball', recordValue: 31000, isBest: true, firstClear: false, coins: 45, balance: 45, replayed: false });

    const ledger = await ledgerOf(db, me.userId);
    assert.deepEqual(
      ledger.map((l) => [l.delta, l.balanceAfter, l.reason, l.createdAt.toISOString()]),
      [[45, 45, 'run', NOW.toISOString()]],
    );
    const runs = await runsOf(db, me.userId);
    assert.equal(runs.length, 1);
    assert.deepEqual(
      { boardId: runs[0].boardId, value: runs[0].value, seconds: runs[0].seconds, won: runs[0].won, coins: runs[0].coins, ledgerId: runs[0].ledgerId, gameVersion: runs[0].gameVersion, key: runs[0].idempotencyKey, at: runs[0].createdAt.toISOString() },
      { boardId: 'pinball', value: 31000, seconds: null, won: null, coins: 45, ledgerId: ledger[0].id, gameVersion: 3, key: null, at: NOW.toISOString() },
      '판이 자기 코인 기록을 가리킨다 (runs.ledger_id)',
    );
    const records = await recordsOf(db, me.userId);
    assert.deepEqual(
      records.map((r) => [r.boardId, r.bestValue, r.bestAt?.toISOString(), r.bestSeconds, r.clearedAt, r.playCount]),
      [['pinball', 31000, NOW.toISOString(), null, null, 1]],
    );

    // 다른 게임에서 번 코인도 같은 지갑으로 간다 (표 D3: 게임별 코인이 없다)
    await own(db, me.userId, 'breakout');
    const second = await send(db, me.userId, { boardId: 'breakout', score: 12340, coins: 35 }, t.next());
    assert.deepEqual(second, { boardId: 'breakout', recordValue: 12340, isBest: true, firstClear: false, coins: 35, balance: 80, replayed: false });
    assert.equal(await getBalance(db, me.userId), 80);
    assert.deepEqual(await verifyWallets(db), [], '잔액과 코인 기록이 맞는다');

    // 코인이 0인 판은 코인 기록을 남기지 않는다 (판과 기록은 남는다)
    const third = await send(db, me.userId, { boardId: 'pinball', score: 100, coins: 0 }, t.next());
    assert.deepEqual(third, { boardId: 'pinball', recordValue: 100, isBest: false, firstClear: false, coins: 0, balance: 80, replayed: false });
    assert.deepEqual(await counts(db, me.userId), { runs: 3, records: 2, ledger: 2, balance: 80 });
    assert.equal((await runsOf(db, me.userId))[2].ledgerId, null);
  } finally {
    await close();
  }
});

test('사지 않은 게임의 판 결과는 403 game_locked', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const t = ticking();
    const easy = { boardId: 'minesweeper.easy', won: false, opened: 30, correctFlags: 3, wrongFlags: 1, coins: 10 };
    await assert.rejects(send(db, me.userId, easy, t.now()), rule(403, 'game_locked'));
    await assert.rejects(send(db, me.userId, { boardId: 'breakout', score: 100, coins: 0 }, t.now()), rule(403, 'game_locked'));
    assert.deepEqual(await counts(db, me.userId), { runs: 0, records: 0, ledger: 0, balance: null }, '거절된 판은 아무것도 남기지 않는다');

    // 가지면 된다 (v1처럼 점수로 열리지 않는다 — 표 D4: 핀볼 3만 점을 내도 지뢰찾기는 잠겨 있다)
    assert.equal((await send(db, me.userId, { boardId: 'pinball', score: 31000, coins: 0 }, t.next())).isBest, true);
    await assert.rejects(send(db, me.userId, easy, t.next()), rule(403, 'game_locked'));
    await own(db, me.userId, 'minesweeper');
    assert.equal((await send(db, me.userId, easy, t.next())).recordValue, 350);

    // 회수하면 다시 거절된다 (스펙 5.16)
    await db.transaction((tx) => revoke(tx, { userId: me.userId, productId: 'game.minesweeper', reason: 'admin' }));
    await assert.rejects(send(db, me.userId, easy, t.next()), rule(403, 'game_locked'));

    // live가 아닌 게임은 누구나 가진 상품이어도 못 한다
    await db.transaction((tx) => updateGame(tx, 'pinball', { status: 'retired' }));
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 100, coins: 0 }, t.next()), rule(403, 'game_locked'));
  } finally {
    await close();
  }
});

test('앞 단계를 깨지 않았으면 403 stage_locked', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    await own(db, me.userId, 'minesweeper');
    const t = ticking();
    await assert.rejects(send(db, me.userId, clearRun('minesweeper.normal', MS.normal, 80), t.now()), rule(403, 'stage_locked'));
    await assert.rejects(send(db, me.userId, clearRun('minesweeper.hard', MS.hard), t.now()), rule(403, 'stage_locked'));

    // 초급을 못 깬 판은 중급을 열지 않는다
    await send(db, me.userId, { boardId: 'minesweeper.easy', won: false, opened: 30, correctFlags: 3, wrongFlags: 1, coins: 0 }, t.next());
    await assert.rejects(send(db, me.userId, clearRun('minesweeper.normal', MS.normal), t.next()), rule(403, 'stage_locked'));

    // 초급을 깨면 중급이, 중급을 깨면 고급이 열린다 (초급 → 중급 → 고급)
    const easy = await send(db, me.userId, clearRun('minesweeper.easy', MS.easy), t.next());
    assert.equal(easy.firstClear, true);
    await assert.rejects(send(db, me.userId, clearRun('minesweeper.hard', MS.hard), t.next()), rule(403, 'stage_locked'), '초급만 깨서는 고급이 열리지 않는다');
    const normal = await send(db, me.userId, clearRun('minesweeper.normal', MS.normal), t.next());
    assert.equal(normal.firstClear, true);
    const hard = await send(db, me.userId, clearRun('minesweeper.hard', MS.hard), t.next());
    assert.equal(hard.firstClear, true);

    // 다른 사용자가 깬 것으로는 열리지 않는다
    const other = await loginGuest(db, NOW);
    await own(db, other.userId, 'minesweeper');
    await assert.rejects(send(db, other.userId, clearRun('minesweeper.normal', MS.normal), t.next()), rule(403, 'stage_locked'));
  } finally {
    await close();
  }
});

test('직전 판에서 3초가 안 지났으면 429 too_fast', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await own(db, me.userId, 'breakout');
    const t = ticking();
    const run = { boardId: 'pinball', score: 100, coins: 5 };
    assert.equal((await send(db, me.userId, run, t.now())).coins, 5);
    await assert.rejects(send(db, me.userId, run, t.now()), rule(429, 'too_fast'), '같은 순간');
    await assert.rejects(send(db, me.userId, run, t.after(2999)), rule(429, 'too_fast'), '2.999초 뒤');
    // 간격은 사용자마다 센다: 순위표가 달라도 걸리고, 다른 사용자는 걸리지 않는다
    await assert.rejects(send(db, me.userId, { boardId: 'breakout', score: 100, coins: 5 }, t.now()), rule(429, 'too_fast'));
    assert.equal((await send(db, other.userId, run, t.now())).coins, 5);
    assert.deepEqual(await counts(db, me.userId), { runs: 1, records: 1, ledger: 1, balance: 5 }, '거절된 판은 코인도 판도 남기지 않는다');

    // 정확히 3초 뒤에는 된다
    assert.equal((await send(db, me.userId, run, t.after(1))).balance, 10);
    // 거절된 판은 "직전 판"이 아니다: 3초 안에 틀린 값을 보냈다가 3초가 지난 뒤 보내면 된다
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: -1, coins: 0 }, t.after(3000)), rule(400, 'invalid_score'));
    assert.equal((await send(db, me.userId, run, t.now())).balance, 15);
    // 시계가 뒤로 간 요청(먼저 받았는데 늦게 처리된 요청)도 간격 안으로 본다
    await assert.rejects(send(db, me.userId, run, t.after(-1000)), rule(429, 'too_fast'));
  } finally {
    await close();
  }
});

test('코인이 판당 상한을 넘거나 음수·소수·NaN이면 400 invalid_coins', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    await own(db, me.userId, 'minesweeper', 'breakout');
    const t = ticking();
    for (const coins of [401, 9999, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '10', null, undefined, true, [5], { n: 5 }, 2 ** 53]) {
      await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 100, coins }, t.next()), rule(400, 'invalid_coins'), String(coins));
    }
    assert.deepEqual(await counts(db, me.userId), { runs: 0, records: 0, ledger: 0, balance: null });

    // 상한까지는 된다. 상한은 순위표마다 다르다 (핀볼·벽돌깨기 400, 지뢰찾기 초급 69)
    assert.equal((await send(db, me.userId, { boardId: 'pinball', score: 30000, coins: 400 }, t.next())).balance, 400);
    await assert.rejects(send(db, me.userId, { boardId: 'breakout', score: 100, coins: 401 }, t.next()), rule(400, 'invalid_coins'));
    const ms = await send(db, me.userId, { boardId: 'minesweeper.easy', won: true, seconds: 40, opened: 70, correctFlags: 0, wrongFlags: 0, coins: 69 }, t.next());
    assert.equal(ms.balance, 469);
    await assert.rejects(
      send(db, me.userId, { boardId: 'minesweeper.easy', won: false, seconds: 40, opened: 10, correctFlags: 0, wrongFlags: 0, coins: 70 }, t.next()),
      rule(400, 'invalid_coins'),
    );
  } finally {
    await close();
  }
});

test('점수가 max_value를 넘으면 400', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    await own(db, me.userId, 'breakout');
    const t = ticking();
    for (const score of [5_000_001, -5, 1.5, Number.NaN, '100', null, undefined]) {
      await assert.rejects(send(db, me.userId, { boardId: 'pinball', score, coins: 0 }, t.next()), rule(400, 'invalid_score'), String(score));
      await assert.rejects(send(db, me.userId, { boardId: 'breakout', score, coins: 0 }, t.next()), rule(400, 'invalid_score'), String(score));
    }
    assert.equal((await send(db, me.userId, { boardId: 'breakout', score: 5_000_000, coins: 0 }, t.next())).recordValue, 5_000_000);
    // 시간 순위표는 시간이 범위 밖이면 400이다
    for (const seconds of [0.5, 86_401, Number.NaN, '40']) {
      await assert.rejects(send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds, coins: 0 }, t.next()), rule(400, 'invalid_seconds'), String(seconds));
    }
    // 지뢰찾기는 판이 말이 안 되면 400이다 (자세한 경우는 minesweeper.test.ts)
    await own(db, me.userId, 'minesweeper');
    await assert.rejects(send(db, me.userId, { boardId: 'minesweeper.easy', won: false, opened: 71, correctFlags: 0, wrongFlags: 0, coins: 0 }, t.next()), rule(400, 'invalid_board_stats'));
    await assert.rejects(send(db, me.userId, { boardId: 'minesweeper.easy', won: true, seconds: 0, opened: 70, correctFlags: 0, wrongFlags: 0, coins: 0 }, t.next()), rule(400, 'invalid_seconds'));
    // 게임 버전은 적지 않아도 되고, 적으면 1 이상의 정수여야 한다
    for (const gameVersion of [0, -1, 1.5, '3', 2 ** 31, Number.NaN, true]) {
      await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 1, coins: 0, gameVersion }, t.next()), rule(400, 'invalid_game_version'), String(gameVersion));
    }
    assert.deepEqual(await counts(db, me.userId), { runs: 1, records: 1, ledger: 0, balance: 0 });
  } finally {
    await close();
  }
});

test('확인하는 순서는 v1과 같다: unknown_board → game_locked → stage_locked → too_fast → invalid_coins → 값', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const t = ticking();
    // 모든 것이 틀린 판: 없는 순위표가 먼저다
    for (const boardId of ['nope', '', 'PINBALL', '../pinball', 'a'.repeat(200), 'pin\u0000ball', 42, null, undefined, ['pinball'], { id: 'pinball' }]) {
      await assert.rejects(send(db, me.userId, { boardId, coins: -1, score: -1 }, t.now()), rule(400, 'unknown_board'), String(boardId));
    }
    // v1의 이름(board)으로 보내면 순위표를 적지 않은 것이다
    await assert.rejects(send(db, me.userId, { board: 'pinball', coins: 0, score: 1 }, t.now()), rule(400, 'unknown_board'));
    // 본문이 객체가 아니면 400이다
    for (const body of [null, [], 'pinball', 42]) await assert.rejects(send(db, me.userId, body, t.now()), rule(400, 'invalid_body'), String(body));

    // 가지지 않은 게임의 잠긴 단계에 틀린 코인: 잠긴 게임이 먼저다
    await assert.rejects(send(db, me.userId, { ...clearRun('minesweeper.normal', MS.normal), coins: -1 }, t.now()), rule(403, 'game_locked'));
    // 가진 게임의 잠긴 단계: 직전 판에서 3초가 안 지났고 코인이 틀렸어도 잠긴 단계가 먼저다
    await own(db, me.userId, 'minesweeper');
    await send(db, me.userId, { boardId: 'pinball', score: 1, coins: 0 }, t.now());
    await assert.rejects(send(db, me.userId, { ...clearRun('minesweeper.normal', MS.normal), coins: -1 }, t.now()), rule(403, 'stage_locked'));
    // 3초 안에 틀린 코인: 너무 빠른 것이 먼저다
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: -1, coins: -1 }, t.now()), rule(429, 'too_fast'));
    // 3초 뒤에 틀린 코인과 틀린 점수: 코인이 먼저다
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: -1, coins: -1 }, t.next()), rule(400, 'invalid_coins'));
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: -1, coins: 0 }, t.now()), rule(400, 'invalid_score'));
  } finally {
    await close();
  }
});

test('같은 idempotency 키로 다시 보내면 코인이 한 번만 들어가고 같은 답(replayed)을 받는다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    const t = ticking();
    const run = { boardId: 'pinball', score: 31000, coins: 45, gameVersion: 2, idempotencyKey: 'run-key-0001' };
    const first = await send(db, me.userId, run, t.now());
    assert.deepEqual(first, { boardId: 'pinball', recordValue: 31000, isBest: true, firstClear: false, coins: 45, balance: 45, replayed: false });

    // 통신이 끊겨 바로 다시 보낸 것: 3초가 안 지났어도 너무 빠르다고 하지 않고 처음 답을 준다
    const again = await send(db, me.userId, run, t.after(500));
    assert.deepEqual(again, { ...first, replayed: true });
    assert.deepEqual(await counts(db, me.userId), { runs: 1, records: 1, ledger: 1, balance: 45 }, '판도 코인 기록도 하나다');
    assert.equal((await recordsOf(db, me.userId))[0].playCount, 1, '판 수도 늘지 않는다');

    // 그 뒤에 더 좋은 기록을 내고 코인을 더 벌어도, 처음 판을 다시 보내면 처음 답 그대로다
    const better = await send(db, me.userId, { boardId: 'pinball', score: 50000, coins: 100, idempotencyKey: 'run-key-0002' }, t.next());
    assert.deepEqual(better, { boardId: 'pinball', recordValue: 50000, isBest: true, firstClear: false, coins: 100, balance: 145, replayed: false });
    assert.deepEqual(await send(db, me.userId, run, t.now()), { ...first, replayed: true }, '그때의 isBest와 잔액을 준다');
    // 다시 보낸 판은 "직전 판"을 바꾸지 않는다: 두 번째 판에서 5초 뒤의 새 판은 된다
    assert.equal((await send(db, me.userId, { boardId: 'pinball', score: 1, coins: 0, idempotencyKey: 'run-key-0003' }, t.next())).replayed, false);
    assert.deepEqual(await counts(db, me.userId), { runs: 3, records: 1, ledger: 2, balance: 145 });

    // 같은 키에 다른 내용이면 거절한다: 순위표, 점수, 코인, 게임 버전 어느 것이 달라도
    for (const changed of [{ boardId: 'pinball.sprint', won: true, seconds: 40 }, { score: 31001 }, { coins: 46 }, { coins: 0 }, { gameVersion: 3 }, { gameVersion: undefined }]) {
      await assert.rejects(send(db, me.userId, { ...run, ...changed }, t.next()), rule(409, 'idempotency_mismatch'), JSON.stringify(changed));
    }
    assert.deepEqual(await counts(db, me.userId), { runs: 3, records: 1, ledger: 2, balance: 145 });

    // 키는 사용자마다 따로다: 다른 사용자가 같은 키를 써도 그 사람의 새 판이다
    const theirs = await send(db, other.userId, run, t.now());
    assert.deepEqual(theirs, { boardId: 'pinball', recordValue: 31000, isBest: true, firstClear: false, coins: 45, balance: 45, replayed: false });

    // 키 모양이 틀리면 400이다
    for (const idempotencyKey of ['short', 'a'.repeat(65), 'has space!', 12345678, '', {}]) {
      await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 1, coins: 0, idempotencyKey }, t.next()), rule(400, 'invalid_idempotency_key'), String(idempotencyKey));
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('코인이 0인 판도 같은 idempotency 키로 다시 보내면 판이 하나만 남는다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    await own(db, me.userId, 'minesweeper');
    const t = ticking();
    const run = { ...clearRun('minesweeper.easy', MS.easy, 40), idempotencyKey: 'zero-coin-run-1' };
    const first = await send(db, me.userId, run, t.now());
    // 700 + 200 + 700 + 1400 = 3000
    assert.deepEqual(first, { boardId: 'minesweeper.easy', recordValue: 3000, isBest: true, firstClear: true, coins: 0, balance: 0, replayed: false });
    const again = await send(db, me.userId, run, t.after(100));
    assert.deepEqual(again, { ...first, replayed: true });
    assert.equal((await counts(db, me.userId)).runs, 1);
    assert.equal((await counts(db, me.userId)).ledger, 0, '코인 기록은 없다');
    assert.equal((await recordsOf(db, me.userId))[0].playCount, 1);

    // 그 뒤에 같은 단계를 더 빨리 깨도, 처음 판을 다시 보내면 그때의 답(첫 클리어, 최고 기록)이다
    const faster = await send(db, me.userId, { ...clearRun('minesweeper.easy', MS.easy, 30), idempotencyKey: 'zero-coin-run-2' }, t.next());
    assert.deepEqual(faster, { boardId: 'minesweeper.easy', recordValue: 3100, isBest: true, firstClear: false, coins: 0, balance: 0, replayed: false });
    assert.deepEqual(await send(db, me.userId, run, t.now()), { ...first, replayed: true });
    assert.deepEqual(await send(db, me.userId, { ...clearRun('minesweeper.easy', MS.easy, 30), idempotencyKey: 'zero-coin-run-2' }, t.now()), { ...faster, replayed: true });
    assert.equal((await counts(db, me.userId)).runs, 2);

    // 같은 키로 코인만 바꿔 보내면 거절한다 (0 → 10)
    await assert.rejects(send(db, me.userId, { ...run, coins: 10 }, t.next()), rule(409, 'idempotency_mismatch'));
    // 점수가 같아지는 다른 판(연 칸과 깃발이 다르지만 합이 같음)은 같은 내용으로 본다: 판에 남긴 값이 같다
    const lost = { boardId: 'minesweeper.easy', won: false, opened: 30, correctFlags: 3, wrongFlags: 1, coins: 0, idempotencyKey: 'zero-coin-run-3' };
    const a = await send(db, me.userId, lost, t.next());
    assert.equal(a.recordValue, 350);
    assert.deepEqual(await send(db, me.userId, { ...lost, opened: 31, correctFlags: 2, wrongFlags: 0 }, t.now()), { ...a, replayed: true });
    await assert.rejects(send(db, me.userId, { ...lost, opened: 32 }, t.now()), rule(409, 'idempotency_mismatch'));
  } finally {
    await close();
  }
});

test('다시 보낸 판의 답은 그 판을 낼 때의 것이다: 시간 순위표, 코인 0인 판의 잔액, 순위표가 다른 같은 값', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    await own(db, me.userId, 'breakout');
    const t = ticking();

    // 시간 순위표(lower): 60초, 40초를 낸 뒤의 50초는 최고 기록이 아니다. 다시 보내도 아니다 (작을수록 좋다)
    await send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds: 60, coins: 0 }, t.now());
    await send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds: 40, coins: 0 }, t.next());
    const slow = { boardId: 'pinball.sprint', won: true, seconds: 50, coins: 0, idempotencyKey: 'sprint-run-50s' };
    const slowFirst = await send(db, me.userId, slow, t.next());
    assert.deepEqual(slowFirst, { boardId: 'pinball.sprint', recordValue: 50, isBest: false, firstClear: false, coins: 0, balance: 0, replayed: false });
    assert.deepEqual(await send(db, me.userId, slow, t.now()), { ...slowFirst, replayed: true });
    // 그때 최고였던 30초는 뒤에 20초를 내도 다시 보내면 최고 기록이었다고 답한다
    const fast = { boardId: 'pinball.sprint', won: true, seconds: 30, coins: 0, idempotencyKey: 'sprint-run-30s' };
    const fastFirst = await send(db, me.userId, fast, t.next());
    assert.equal(fastFirst.isBest, true);
    await send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds: 20, coins: 0 }, t.next());
    assert.deepEqual(await send(db, me.userId, fast, t.now()), { ...fastFirst, replayed: true });
    assert.deepEqual(await send(db, me.userId, slow, t.now()), { ...slowFirst, replayed: true });

    // 코인이 0이었던 판: 잔액이 있는 사용자는 그 잔액을 받는다 (0이 아니다)
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 30, reason: 'grant', now: NOW }));
    const zero = { boardId: 'pinball', score: 500, coins: 0, idempotencyKey: 'zero-coins-30' };
    const zeroFirst = await send(db, me.userId, zero, t.next());
    assert.deepEqual(zeroFirst, { boardId: 'pinball', recordValue: 500, isBest: true, firstClear: false, coins: 0, balance: 30, replayed: false });
    assert.deepEqual(await send(db, me.userId, zero, t.now()), { ...zeroFirst, replayed: true });
    // 코인이 0이었던 판은 가리키는 코인 기록이 없다: 그 뒤에 잔액이 변했으면 지금 잔액을 준다 (그 판은 잔액을 바꾸지 않았다)
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 12, reason: 'grant', now: NOW }));
    assert.deepEqual(await send(db, me.userId, zero, t.now()), { ...zeroFirst, balance: 42, replayed: true });

    // 같은 키로 순위표만 바꿔 보낸 것: 점수와 코인이 같아도 다른 내용이다
    const pinball = { boardId: 'pinball', score: 700, coins: 5, idempotencyKey: 'same-values-01' };
    const first = await send(db, me.userId, pinball, t.next());
    assert.deepEqual([first.boardId, first.recordValue, first.balance], ['pinball', 700, 47]);
    const before = await counts(db, me.userId);
    await assert.rejects(send(db, me.userId, { ...pinball, boardId: 'breakout' }, t.next()), rule(409, 'idempotency_mismatch'));
    assert.deepEqual(await counts(db, me.userId), before, '판도 코인도 늘지 않았다');
    assert.deepEqual(await boardStats(db, me.userId).then((b) => b.breakout), undefined, '벽돌깨기에 기록이 생기지 않았다');
  } finally {
    await close();
  }
});

test('다시 보낸 판은 순위표의 지금 상한·범위로 다시 재지 않는다 (그사이 운영자가 순위표를 고쳐도 처음 답을 받는다)', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const t = ticking();
    const run = { boardId: 'pinball', score: 31000, coins: 300, idempotencyKey: 'before-update-1' };
    const first = await send(db, me.userId, run, t.now());
    assert.equal(first.balance, 300);
    const sprint = { boardId: 'pinball.sprint', won: true, seconds: 50, coins: 40, idempotencyKey: 'before-update-2' };
    const sprintFirst = await send(db, me.userId, sprint, t.next());

    // 판당 코인 상한과 값의 범위를 처음 판보다 좁게 고친다
    await db.transaction(async (tx) => {
      await updateBoard(tx, 'pinball', { maxCoinsPerRun: 100, maxValue: 1000 });
      await updateBoard(tx, 'pinball.sprint', { maxCoinsPerRun: 10, minValue: 100 });
    });
    assert.deepEqual(await send(db, me.userId, run, t.now()), { ...first, replayed: true });
    assert.deepEqual(await send(db, me.userId, sprint, t.now()), { ...sprintFirst, replayed: true });
    assert.deepEqual(await counts(db, me.userId), { runs: 2, records: 2, ledger: 2, balance: 340 });

    // 내용이 다르면 여전히 거절한다. 새 판은 고친 상한을 따른다
    await assert.rejects(send(db, me.userId, { ...run, coins: 301 }, t.now()), rule(409, 'idempotency_mismatch'));
    await assert.rejects(send(db, me.userId, { ...run, coins: '300' }, t.now()), rule(409, 'idempotency_mismatch'));
    await assert.rejects(send(db, me.userId, { ...run, score: 31001 }, t.now()), rule(409, 'idempotency_mismatch'));
    await assert.rejects(send(db, me.userId, { ...run, score: 1.5 }, t.now()), rule(400, 'invalid_score'), '모양이 틀린 값은 그대로 400이다');
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 500, coins: 300 }, t.next()), rule(400, 'invalid_coins'));
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 31000, coins: 0 }, t.next()), rule(400, 'invalid_score'));
  } finally {
    await close();
  }
});

test('같은 키가 이미 다른 코인 기록에 쓰였으면 판을 반영하지 않고, 판과 코인 기록이 어긋나 있으면 코인을 또 주지 않는다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const t = ticking();
    // 같은 키·같은 코인의 'run' 기록이 판 없이 먼저 있다 (판을 거치지 않은 쓰기): 코인이 들어가지 않으니 판도 남기지 않는다
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 45, reason: 'run', idempotencyKey: 'ledger-only-key', now: NOW }));
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 100, coins: 45, idempotencyKey: 'ledger-only-key' }, t.now()), rule(409, 'idempotency_mismatch'));
    // 같은 키를 다른 까닭(구매 등)이나 다른 코인으로 쓴 경우는 wallet이 거절한다
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: -10, reason: 'purchase', idempotencyKey: 'purchase-key-01', now: NOW }));
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 100, coins: 45, idempotencyKey: 'purchase-key-01' }, t.now()), rule(409, 'idempotency_mismatch'));
    assert.deepEqual(await counts(db, me.userId), { runs: 0, records: 0, ledger: 2, balance: 35 });

    // 판이 가리키는 코인 기록을 SQL로 다른 줄로 바꿔 놓는다: 다시 보낸 판은 실패하고(500) 코인이 또 들어가지 않는다
    const run = { boardId: 'pinball', score: 100, coins: 20, idempotencyKey: 'tampered-run-1' };
    assert.equal((await send(db, me.userId, run, t.now())).balance, 55);
    await db.execute(sql`update app.runs set ledger_id = (select min(id) from app.coin_ledger where user_id = ${me.userId}) where idempotency_key = 'tampered-run-1'`);
    await assert.rejects(send(db, me.userId, run, t.now()), /어긋났어요/);
    // 코인 기록의 키를 지워 놓으면 applyCoins가 새로 넣으려 한다: 그것도 되돌린다
    await db.execute(sql`update app.coin_ledger set idempotency_key = null where idempotency_key = 'tampered-run-1'`);
    await assert.rejects(send(db, me.userId, run, t.now()), /어긋났어요/);
    assert.deepEqual(await counts(db, me.userId), { runs: 1, records: 1, ledger: 3, balance: 55 });
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('코인 반영이 실패하면 판도 기록도 남지 않는다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const t = ticking();
    // 지갑을 상한에서 10 모자라게 만들어 둔다: 코인 11짜리 판은 지갑 상한에 걸려 실패한다
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: MAX_BALANCE - 10, reason: 'grant', now: NOW }));
    const before = await counts(db, me.userId);
    assert.deepEqual(before, { runs: 0, records: 0, ledger: 1, balance: MAX_BALANCE - 10 });

    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 31000, coins: 11, idempotencyKey: 'failing-run-01' }, t.now()), rule(409, 'balance_limit'));
    assert.deepEqual(await counts(db, me.userId), before, '판도 순위표 기록도 코인 기록도 늘지 않았다');
    assert.deepEqual(await boardStats(db, me.userId), {});

    // 실패한 판은 "직전 판"도 아니고 키도 쓰지 않았다: 바로 코인을 줄여 같은 키로 보내면 된다
    const ok = await send(db, me.userId, { boardId: 'pinball', score: 31000, coins: 10, idempotencyKey: 'failing-run-01' }, t.now());
    assert.deepEqual(ok, { boardId: 'pinball', recordValue: 31000, isBest: true, firstClear: false, coins: 10, balance: MAX_BALANCE, replayed: false });
    assert.deepEqual(await counts(db, me.userId), { runs: 1, records: 1, ledger: 2, balance: MAX_BALANCE });
    // 상한에 닿은 뒤: 코인이 0인 판은 되고 코인이 있는 판은 통째로 실패한다
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 99999, coins: 1 }, t.next()), rule(409, 'balance_limit'));
    assert.equal((await recordsOf(db, me.userId))[0].bestValue, 31000, '실패한 판의 점수가 최고 기록이 되지 않았다');
    assert.equal((await recordsOf(db, me.userId))[0].playCount, 1);
    assert.equal((await send(db, me.userId, { boardId: 'pinball', score: 99999, coins: 0 }, t.now())).isBest, true);
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('기록은 더 좋을 때만 바뀌고 play_count는 판마다 는다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const t = ticking();
    const record = async (boardId = 'pinball') => {
      const row = (await recordsOf(db, me.userId)).find((r) => r.boardId === boardId)!;
      return { best: row.bestValue, at: row.bestAt?.toISOString() ?? null, seconds: row.bestSeconds, cleared: row.clearedAt?.toISOString() ?? null, plays: row.playCount };
    };

    // 0점은 기록이 아니다 (표 K10): 판 수만 는다
    const zero = await send(db, me.userId, { boardId: 'pinball', score: 0, coins: 0 }, t.now());
    assert.deepEqual(zero, { boardId: 'pinball', recordValue: null, isBest: false, firstClear: false, coins: 0, balance: 0, replayed: false });
    assert.deepEqual(await record(), { best: null, at: null, seconds: null, cleared: null, plays: 1 });

    const firstAt = t.next();
    assert.equal((await send(db, me.userId, { boardId: 'pinball', score: 100, coins: 0 }, firstAt)).isBest, true);
    assert.deepEqual(await record(), { best: 100, at: firstAt.toISOString(), seconds: null, cleared: null, plays: 2 });

    // 더 낮거나 같은 점수는 기록을 바꾸지 않는다 (낸 시각도 그대로 — 같은 값이면 먼저 낸 사람이 앞이어야 해서)
    assert.equal((await send(db, me.userId, { boardId: 'pinball', score: 50, coins: 0 }, t.next())).isBest, false);
    assert.equal((await send(db, me.userId, { boardId: 'pinball', score: 100, coins: 0 }, t.next())).isBest, false);
    assert.deepEqual(await record(), { best: 100, at: firstAt.toISOString(), seconds: null, cleared: null, plays: 4 });

    const betterAt = t.next();
    const better = await send(db, me.userId, { boardId: 'pinball', score: 200, coins: 0 }, betterAt);
    assert.equal(better.isBest, true);
    assert.equal(better.recordValue, 200);
    assert.deepEqual(await record(), { best: 200, at: betterAt.toISOString(), seconds: null, cleared: null, plays: 5 });
    assert.equal((await runsOf(db, me.userId)).length, 5, '판은 기록이 아니어도 모두 남는다');

    // 시간 순위표(lower, 표 K11): 깬 판만 기록이고, 더 짧을 때만 바뀐다
    const lost = await send(db, me.userId, { boardId: 'pinball.sprint', won: false, seconds: 5, coins: 0 }, t.next());
    assert.deepEqual(lost, { boardId: 'pinball.sprint', recordValue: null, isBest: false, firstClear: false, coins: 0, balance: 0, replayed: false });
    assert.deepEqual(await record('pinball.sprint'), { best: null, at: null, seconds: null, cleared: null, plays: 1 });
    const wonAt = t.next();
    const won = await send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds: 50.04, coins: 0 }, wonAt);
    assert.deepEqual(won, { boardId: 'pinball.sprint', recordValue: 50, isBest: true, firstClear: true, coins: 0, balance: 0, replayed: false });
    assert.deepEqual(await record('pinball.sprint'), { best: 50, at: wonAt.toISOString(), seconds: 50, cleared: wonAt.toISOString(), plays: 2 });
    const slower = await send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds: 61.26, coins: 0 }, t.next());
    assert.deepEqual([slower.recordValue, slower.isBest, slower.firstClear], [61.3, false, false]);
    const fasterAt = t.next();
    const faster = await send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds: 49.9, coins: 0 }, fasterAt);
    assert.deepEqual([faster.recordValue, faster.isBest, faster.firstClear], [49.9, true, false]);
    assert.deepEqual(await record('pinball.sprint'), { best: 49.9, at: fasterAt.toISOString(), seconds: 49.9, cleared: wonAt.toISOString(), plays: 4 });
  } finally {
    await close();
  }
});

test('지뢰찾기: 서버가 다시 계산한 점수가 기록이고, 깬 시간과 깬 단계를 따로 남긴다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    await own(db, me.userId, 'minesweeper');
    const t = ticking();
    // 못 깬 판도 연 칸·깃발로 점수가 나고 기록이 된다 (시간 보너스는 없음): 300 + 60 - 10 = 350
    const lose = await send(db, me.userId, { boardId: 'minesweeper.easy', won: false, seconds: 12, opened: 30, correctFlags: 3, wrongFlags: 1, coins: 10, score: 999999 }, t.now());
    assert.deepEqual(lose, { boardId: 'minesweeper.easy', recordValue: 350, isBest: true, firstClear: false, coins: 10, balance: 10, replayed: false }, '앱이 보낸 score는 쓰지 않는다');
    assert.deepEqual(await boardStats(db, me.userId), { 'minesweeper.easy': { best: 350, bestSeconds: null, cleared: false } });

    // 초급 70칸 모두, 깃발 10개 맞음, 40초: 700 + 200 + 700 + (180-40)*10 = 3000
    const winAt = t.next();
    const win = await send(db, me.userId, { boardId: 'minesweeper.easy', won: true, seconds: 40.04, opened: 70, correctFlags: 10, wrongFlags: 0, coins: 25 }, winAt);
    assert.deepEqual(win, { boardId: 'minesweeper.easy', recordValue: 3000, isBest: true, firstClear: true, coins: 25, balance: 35, replayed: false });
    assert.deepEqual(await boardStats(db, me.userId), { 'minesweeper.easy': { best: 3000, bestSeconds: 40, cleared: true } });
    const run = (await runsOf(db, me.userId))[1];
    assert.deepEqual([run.value, run.seconds, run.won], [3000, 40, true], '판에는 반올림한 시간이 남는다');

    // 보호를 쓰고 더 빨리 깬 판: 점수는 70%라 최고 기록이 아니지만 최고 시간은 바뀐다 (v1과 같다)
    // 700 + 200 + 700 + (180-30)*10 = 3100 → 2170
    const shielded = await send(db, me.userId, { boardId: 'minesweeper.easy', won: true, seconds: 30, opened: 70, correctFlags: 10, wrongFlags: 0, shields: 1, coins: 0 }, t.next());
    assert.deepEqual([shielded.recordValue, shielded.isBest, shielded.firstClear], [2170, false, false]);
    assert.deepEqual(await boardStats(db, me.userId), { 'minesweeper.easy': { best: 3000, bestSeconds: 30, cleared: true } });
    const row = (await recordsOf(db, me.userId))[0];
    assert.equal(row.clearedAt?.toISOString(), winAt.toISOString(), '처음 깬 때가 남는다');
    assert.equal(row.playCount, 3);

    // 느리게 다시 깬 판은 아무 기록도 바꾸지 않는다
    const slow = await send(db, me.userId, clearRun('minesweeper.easy', MS.easy, 100), t.next());
    assert.deepEqual([slow.recordValue, slow.isBest, slow.firstClear], [2400, false, false]);
    assert.deepEqual(await boardStats(db, me.userId), { 'minesweeper.easy': { best: 3000, bestSeconds: 30, cleared: true } });
  } finally {
    await close();
  }
});

test('새 게임은 caps 순위표로 서버 코드 없이 추가되고, 모르는 검증기의 순위표가 있어도 서버가 죽지 않는다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const t = ticking();
    await db.transaction(async (tx) => {
      await createGame(tx, { id: 'tetris', name: '테트리스', description: '' });
      await updateGame(tx, 'tetris', { status: 'live' });
      await createProduct(tx, { id: 'game.tetris', kind: 'game', name: '테트리스', access: 'everyone', gameId: 'tetris', status: 'on_sale' });
      await createBoard(tx, { id: 'tetris', gameId: 'tetris', label: '테트리스', ordering: 'higher', minValue: 0, maxValue: 999_999, maxCoinsPerRun: 30 });
    });
    assert.equal((await send(db, me.userId, { boardId: 'tetris', score: 999_999, coins: 30 }, t.now())).balance, 30);
    await assert.rejects(send(db, me.userId, { boardId: 'tetris', score: 1_000_000, coins: 0 }, t.next()), rule(400, 'invalid_score'));
    await assert.rejects(send(db, me.userId, { boardId: 'tetris', score: 1, coins: 31 }, t.next()), rule(400, 'invalid_coins'));

    // 더 새로운 서버가 만든(이 서버는 모르는) 검증기의 순위표: 그 순위표만 받지 못하고 다른 것은 그대로 된다
    await db.execute(sql`update app.boards set validator = 'tetris-lines' where id = 'tetris'`);
    await assert.rejects(send(db, me.userId, { boardId: 'tetris', score: 10, coins: 0 }, t.next()), rule(503, 'board_unavailable'));
    assert.equal((await send(db, me.userId, { boardId: 'pinball', score: 10, coins: 1 }, t.next())).balance, 31);
    assert.deepEqual(
      (await listBoards(db, 'tetris')).map((b) => [b.id, b.validator]),
      [['tetris', 'tetris-lines']],
    );
    // 판 크기가 깨진 지뢰찾기 순위표도 마찬가지다
    await own(db, me.userId, 'minesweeper');
    await db.execute(sql`update app.boards set validator_params = '{"safe": "many"}'::jsonb where id = 'minesweeper.easy'`);
    await assert.rejects(send(db, me.userId, { boardId: 'minesweeper.easy', won: false, opened: 1, correctFlags: 0, wrongFlags: 0, coins: 0 }, t.next()), rule(503, 'board_unavailable'));
  } finally {
    await close();
  }
});

test('boardStats는 판을 낸 순위표의 최고 기록·최고 시간·깼는지를, listBoards는 게임의 순위표를 순서대로 준다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await own(db, me.userId, 'minesweeper');
    const t = ticking();
    assert.deepEqual(await boardStats(db, me.userId), {}, '판을 낸 적이 없으면 비어 있다');
    await send(db, me.userId, { boardId: 'pinball', score: 0, coins: 0 }, t.now());
    await send(db, me.userId, clearRun('minesweeper.easy', MS.easy, 40), t.next());
    await send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds: 12.3, coins: 0 }, t.next());
    await send(db, other.userId, { boardId: 'pinball', score: 777, coins: 0 }, t.next());
    assert.deepEqual(await boardStats(db, me.userId), {
      'minesweeper.easy': { best: 3000, bestSeconds: 40, cleared: true },
      pinball: { best: null, bestSeconds: null, cleared: false },
      'pinball.sprint': { best: 12.3, bestSeconds: 12.3, cleared: true },
    });
    assert.deepEqual(await boardStats(db, other.userId), { pinball: { best: 777, bestSeconds: null, cleared: false } });
    assert.deepEqual(await boardStats(db, 'not-a-uuid'), {}, '사용자 ID 모양이 아니어도 쿼리 오류가 나지 않는다');

    assert.deepEqual(
      (await listBoards(db, 'minesweeper')).map((b) => [b.id, b.label, b.ordering, b.maxCoinsPerRun, b.requiresBoardId]),
      [
        ['minesweeper.easy', '초급', 'higher', 69, null],
        ['minesweeper.normal', '중급', 'higher', 131, 'minesweeper.easy'],
        ['minesweeper.hard', '고급', 'higher', 220, 'minesweeper.normal'],
      ],
    );
    assert.deepEqual((await listBoards(db, 'pinball')).map((b) => b.id), ['pinball', 'pinball.sprint']);
    assert.deepEqual(await listBoards(db, 'nope'), []);
    assert.deepEqual(await listBoards(db, '../x'), []);
  } finally {
    await close();
  }
});

test('purgeUser는 그 사용자의 판과 기록만 지우고, 계정 삭제는 판 → 지갑 순서로 지운다', async () => {
  const { db, close } = await setup();
  try {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    const t = ticking();
    await send(db, me.userId, { boardId: 'pinball', score: 100, coins: 40 }, t.now());
    await send(db, me.userId, { boardId: 'pinball.sprint', won: true, seconds: 30, coins: 0 }, t.next());
    await send(db, other.userId, { boardId: 'pinball', score: 200, coins: 50 }, t.next());

    // 코인 기록을 가리키는 판을 먼저 지워야 지갑을 지울 수 있다 (runs.ledger_id → coin_ledger)
    const policy: DeletionPolicy = { mustKeepUserRow: async () => false, purge: [purgeUser, purgeWallet] };
    await deleteAccount(db, me.userId, policy, t.next());
    assert.deepEqual(await counts(db, me.userId), { runs: 0, records: 0, ledger: 0, balance: null });
    assert.deepEqual(await counts(db, other.userId), { runs: 1, records: 1, ledger: 1, balance: 50 }, '다른 사용자의 것은 그대로다');

    assert.deepEqual((await leaderboard(db, 'pinball', 50, null)).top.map((r) => r.value), [200], '지운 사용자의 기록이 순위표에서 빠진다');

    // 현금 주문 때문에 사용자 행이 deleted로 남는 삭제도 판과 기록을 지우고 순위표에서 빠진다
    const kept = await loginGuest(db, NOW);
    await send(db, kept.userId, { boardId: 'pinball', score: 900, coins: 10 }, t.next());
    assert.deepEqual((await leaderboard(db, 'pinball', 50, null)).top.map((r) => r.value), [900, 200]);
    await deleteAccount(db, kept.userId, { mustKeepUserRow: async () => true, purge: [purgeUser, purgeWallet] }, t.next());
    assert.deepEqual(await counts(db, kept.userId), { runs: 0, records: 0, ledger: 0, balance: null });
    assert.deepEqual((await leaderboard(db, 'pinball', 50, kept.userId)).top.map((r) => r.value), [200]);
    assert.equal((await leaderboard(db, 'pinball', 50, kept.userId)).mine, null);
    assert.deepEqual(await boardStats(db, kept.userId), {});
    await assert.rejects(send(db, kept.userId, { boardId: 'pinball', score: 100, coins: 40 }, t.next()), rule(401, 'unauthorized'), '행만 남은 사용자도 판을 낼 수 없다');

    // 지워진 사용자의 세션으로 온 판 결과는 401이고 아무것도 붙지 않는다
    await assert.rejects(send(db, me.userId, { boardId: 'pinball', score: 100, coins: 40 }, t.next()), rule(401, 'unauthorized'));
    assert.deepEqual(await counts(db, me.userId), { runs: 0, records: 0, ledger: 0, balance: null });
    // 사용자 ID 모양이 아니어도 500이 아니다
    await assert.rejects(send(db, 'not-a-uuid', { boardId: 'pinball', score: 100, coins: 0 }, t.now()), rule(401, 'unauthorized'));
  } finally {
    await close();
  }
});

test('POST /v2/me/runs: 세션이 있어야 하고, 결과는 200 JSON, 말이 안 되는 입력은 4xx다', async () => {
  const { db, close } = await setup();
  try {
    const clock = fakeClock(NOW.toISOString());
    const handler = playHandler(db, clock);
    const me = await loginGuest(db, NOW);

    assert.equal((await call(handler, 'POST', '/v2/me/runs', { body: { boardId: 'pinball', score: 1, coins: 0 } })).status, 401);
    assert.equal((await call(handler, 'POST', '/v2/me/runs', { token: 'x'.repeat(43), body: { boardId: 'pinball', score: 1, coins: 0 } })).status, 401);
    assert.equal((await call(handler, 'GET', '/v2/me/runs', { token: me.token })).status, 405);

    const ok = await call(handler, 'POST', '/v2/me/runs', { token: me.token, body: { boardId: 'pinball', score: 31000, coins: 45, idempotencyKey: 'http-run-0001' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { boardId: 'pinball', recordValue: 31000, isBest: true, firstClear: false, coins: 45, coinsLeftToday: 1455, balance: 45, replayed: false });
    assert.equal(ok.headers['cache-control'], 'no-store');

    // 판의 시각은 요청을 받은 시각이다: 시계가 3초 흐르기 전에는 너무 빠르다
    const fast = await call(handler, 'POST', '/v2/me/runs', { token: me.token, body: { boardId: 'pinball', score: 1, coins: 0 } });
    assert.equal(fast.status, 429);
    assert.equal((fast.body as { error: { code: string; message: string } }).error.code, 'too_fast');
    assert.match((fast.body as { error: { message: string } }).error.message, /요$/, '메시지는 해요체다');
    clock.advance(3000);

    // JSON으로는 NaN과 무한대를 적을 수 없어서 글자나 null로 온다. 모두 4xx다 (Review Focus 4)
    const bad: Array<[unknown, number, string]> = [
      ['{"boardId":"pinball","score":1,"coins":NaN}', 400, 'invalid_json'],
      ['{"boardId":"pinball","score":1,"coins":1e999}', 400, 'invalid_coins'],
      [{ boardId: 'pinball', score: 1, coins: 'NaN' }, 400, 'invalid_coins'],
      [{ boardId: 'pinball', score: 1, coins: null }, 400, 'invalid_coins'],
      [{ boardId: 'pinball', score: 1, coins: -1 }, 400, 'invalid_coins'],
      [{ boardId: 'pinball', score: 1, coins: 0.5 }, 400, 'invalid_coins'],
      [{ boardId: 'pinball', score: '1', coins: 0 }, 400, 'invalid_score'],
      [{ boardId: 'nope', score: 1, coins: 0 }, 400, 'unknown_board'],
      [{ boardId: 'minesweeper.easy', won: false, opened: 1, correctFlags: 0, wrongFlags: 0, coins: 0 }, 403, 'game_locked'],
      [[1, 2, 3], 400, 'invalid_body'],
      ['"pinball"', 400, 'invalid_body'],
      ['{"boardId":', 400, 'invalid_json'],
      ['', 400, 'unknown_board'],
      ['x'.repeat(70_000), 413, 'body_too_large'],
    ];
    for (const [body, status, code] of bad) {
      const r = await call(handler, 'POST', '/v2/me/runs', { token: me.token, body, headers: { 'content-type': 'application/json' } });
      assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
      assert.equal((r.body as { error: { code: string } }).error.code, code, JSON.stringify(body).slice(0, 80));
    }
    assert.deepEqual(await counts(db, me.userId), { runs: 1, records: 1, ledger: 1, balance: 45 });

    // 같은 키로 다시 보내면 HTTP로도 처음 답에 replayed만 참이다
    const again = await call(handler, 'POST', '/v2/me/runs', { token: me.token, body: { boardId: 'pinball', score: 31000, coins: 45, idempotencyKey: 'http-run-0001' } });
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { ...(ok.body as object), replayed: true });
    const mismatch = await call(handler, 'POST', '/v2/me/runs', { token: me.token, body: { boardId: 'pinball', score: 31000, coins: 46, idempotencyKey: 'http-run-0001' } });
    assert.equal(mismatch.status, 409);
    assert.equal((mismatch.body as { error: { code: string } }).error.code, 'idempotency_mismatch');
  } finally {
    await close();
  }
});

test('코인이 0인 판도 다른 코인 기록에 쓴 키로는 받지 않는다: 409 idempotency_mismatch이고 판이 남지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    await seedPlay(db);
    const me = await loginGuest(db, NOW);
    // 출석에 쓴 키 (코인 기록에 그 키가 남는다)
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 50, reason: 'attendance', idempotencyKey: 'attend-key-0001', now: NOW }));
    const run = { boardId: 'pinball', score: 1000, coins: 0, idempotencyKey: 'attend-key-0001' };
    await assert.rejects(send(db, me.userId, run, NOW), rule(409, 'idempotency_mismatch'));
    assert.deepEqual(await counts(db, me.userId), { runs: 0, records: 0, ledger: 1, balance: 50 });
    // 새 키로는 받고, 그 키로 다시 보내면 처음 답이다
    const first = await send(db, me.userId, { ...run, idempotencyKey: 'run-zero-key-01' }, NOW);
    assert.deepEqual([first.coins, first.replayed], [0, false]);
    assert.deepEqual(await send(db, me.userId, { ...run, idempotencyKey: 'run-zero-key-01' }, NOW), { ...first, replayed: true });
    assert.deepEqual(await counts(db, me.userId), { runs: 1, records: 1, ledger: 1, balance: 50 });
  } finally {
    await close();
  }
});
