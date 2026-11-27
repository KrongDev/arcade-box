import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { devVerifier } from '../src/account/index.ts';
import { allCommands } from '../src/commands.ts';
import { seed } from '../src/seed.ts';
import { buildServer } from '../src/server.ts';
import { runCli } from '../src/shared/cli/index.ts';
import type { Db } from '../src/shared/db/index.ts';
import { applyCoins, verifyWallets } from '../src/wallet/index.ts';
import { loginGuest, testConfig } from '../test/account/helpers.ts';
import { fakeIo } from '../test/helpers/cli.ts';
import { call, type CallResult, type Handler } from '../test/helpers/http.ts';
import { ledgerOf } from '../test/wallet/helpers.ts';
import { pgTestDb, SKIP } from './helpers.ts';

/**
 * 도메인을 섞은 동시 요청 (Review Focus 1). 지갑·출석·구매를 따로 본 테스트는 도메인마다 있고(`wallet`·`reward`·`order`·`play`),
 * 여기서는 조립한 서버(`buildServer`)에 한 사용자의 판 결과와 구매를 한꺼번에 보낸다: 판 결과는 코인을 넣고 구매는 뺀다.
 * 둘이 같은 지갑을 같은 순간에 쓰고, 판은 하루 상한(1,500)에, 구매는 잔액에 걸린다.
 */

/** 2026-11-26 10:00 KST */
const START = Date.parse('2026-11-26T01:00:00Z');
const RUNS = 20;
const RUN_COINS = 400;
const DAILY_CAP = 1500;
const FUNDED = 1000;
/** 처음 자료(`seed-data.ts`)의 코인 아이템 다섯과 그 가격. 다 사려면 5,500코인이 든다 */
const SHOPPING: Array<[productId: string, price: number]> = [
  ['pinball.table.sunset', 1000],
  ['pinball.ball.gold', 1000],
  ['minesweeper.tile.mint', 1000],
  ['breakout.paddle.mint', 1000],
  ['pinball.table.forest', 1500],
];

const key = () => randomBytes(12).toString('base64url');
const codeOf = (res: CallResult) => (res.body as { error?: { code?: string } } | null)?.error?.code ?? null;

/**
 * 요청마다 4초씩 뒤의 시각을 주는 시계. 판 결과는 직전 판에서 3초가 지나야 받으므로, 같은 시각을 주면 20개 가운데 하나만 반영된다.
 * 시각을 벌려 여러 판이 반영되게 한다 (늦게 온 판이 먼저 처리되면 그 앞 시각의 판은 `429 too_fast`다 — 몇 개가 반영될지는 정해져 있지 않다).
 */
function steppingClock(): () => Date {
  let n = 0;
  return () => new Date(START + n++ * 4000);
}

async function world(): Promise<{ db: Db; handler: Handler; close(): Promise<void> }> {
  const { db, close } = await pgTestDb();
  await seed(db);
  const handler = buildServer({ db, config: testConfig, now: steppingClock(), verify: devVerifier() });
  return { db, handler, close };
}

async function count(db: Db, table: 'runs' | 'orders' | 'entitlements', userId: string): Promise<number> {
  const out = (await db.execute(sql`select count(*)::text as n from ${sql.raw(`app.${table}`)} where user_id = ${userId}`)) as unknown as { rows: Array<{ n: string }> };
  return Number(out.rows[0].n);
}

/** 한 사용자의 판 결과 20개와 구매 5개를 같은 순간에 보내고, 답과 DB가 서로 맞는지 본다 */
async function mixedBurst(db: Db, handler: Handler, label: string): Promise<{ userId: string; accepted: number; bought: number }> {
  const me = await loginGuest(db, new Date(START));
  await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: FUNDED, reason: 'grant', now: new Date(START) }));

  const runs = Array.from({ length: RUNS }, (_, i) => call(handler, 'POST', '/v2/me/runs', { token: me.token, body: { boardId: 'pinball', score: 1000 + i, coins: RUN_COINS, idempotencyKey: key() } }));
  const buys = SHOPPING.map(([productId]) => call(handler, 'POST', '/v2/shop/purchase', { token: me.token, body: { productId, idempotencyKey: key() } }));
  // 섞어서 한꺼번에: 판 4개마다 구매 하나
  const order: Array<Promise<CallResult>> = [];
  for (let i = 0; i < RUNS; i++) {
    order.push(runs[i]);
    if (i % 4 === 3) order.push(buys[(i - 3) / 4]);
  }
  await Promise.all(order);
  const ran = await Promise.all(runs);
  const bought = await Promise.all(buys);

  // 500이 없다: 판은 반영(200)이거나 너무 빠르다는 거절, 구매는 성공이거나 코인이 모자라다는 거절이다
  for (const res of ran) assert.ok(res.status === 200 || (res.status === 429 && codeOf(res) === 'too_fast'), `${label} 판: ${res.status} ${JSON.stringify(res.body)}`);
  for (const res of bought) assert.ok(res.status === 200 || (res.status === 409 && codeOf(res) === 'insufficient_coins'), `${label} 구매: ${res.status} ${JSON.stringify(res.body)}`);

  const accepted = ran.filter((r) => r.status === 200).map((r) => r.body as { coins: number; balance: number });
  const paid = bought.flatMap((r, i) => (r.status === 200 ? [SHOPPING[i]] : []));
  assert.ok(accepted.length >= 1, `${label}: 반영된 판이 하나는 있다`);

  // 판으로 번 코인은 하루 상한까지만이고, 상한에 걸린 판은 코인 없이 반영된다
  const earned = accepted.reduce((sum, r) => sum + r.coins, 0);
  assert.equal(earned, Math.min(DAILY_CAP, accepted.length * RUN_COINS), `${label}: 판으로 번 코인`);
  const spent = paid.reduce((sum, [, price]) => sum + price, 0);
  const expected = FUNDED + earned - spent;
  assert.ok(expected >= 0, `${label}: 잔액이 0 아래로 내려가지 않는다`);

  // DB가 답과 맞다: 잔액, 판·주문·보유의 수, 코인 기록의 수(지급 1 + 코인이 들어간 판 + 구매)
  const me2 = await call(handler, 'GET', '/v2/me', { token: me.token });
  assert.equal(me2.status, 200);
  const state = me2.body as { balance: number; owned: string[]; runCoins: { earnedToday: number } };
  assert.equal(state.balance, expected, `${label}: 잔액`);
  assert.equal(state.runCoins.earnedToday, earned);
  assert.deepEqual([...state.owned].sort(), paid.map(([id]) => id).sort(), `${label}: 가진 것은 산 것 그대로다 (같은 상품이 두 번 팔리지 않았다)`);
  assert.equal(await count(db, 'runs', me.userId), accepted.length);
  assert.equal(await count(db, 'orders', me.userId), paid.length);
  assert.equal(await count(db, 'entitlements', me.userId), paid.length);

  // 코인 기록을 차례로 더하면 줄마다 그때의 잔액이고, 한 줄도 0 아래로 내려가지 않는다
  const ledger = await ledgerOf(db, me.userId);
  assert.equal(ledger.length, 1 + accepted.filter((r) => r.coins > 0).length + paid.length, `${label}: 코인 기록의 수`);
  let running = 0;
  for (const row of ledger) {
    running += row.delta;
    assert.equal(row.balanceAfter, running, `${label}: 기록 #${row.id}의 balance_after`);
    assert.ok(running >= 0);
  }
  assert.equal(running, expected);
  // 답에 적힌 잔액도 저마다 기록의 어느 한 줄과 같다 (없는 잔액을 답한 요청이 없다)
  const seen = new Set(ledger.map((row) => row.balanceAfter));
  for (const r of accepted.filter((a) => a.coins > 0)) assert.ok(seen.has(r.balance), `${label}: 판의 답 잔액 ${r.balance}`);
  for (const r of bought.filter((b) => b.status === 200)) assert.ok(seen.has((r.body as { balance: number }).balance), `${label}: 구매의 답 잔액`);

  return { userId: me.userId, accepted: accepted.length, bought: paid.length };
}

/** 운영자가 하는 그대로: 명령줄 `wallet verify`. 어긋난 지갑이 없으면 0으로 끝난다 */
async function walletVerify(db: Db): Promise<{ code: number; text: string }> {
  const io = fakeIo();
  const code = await runCli(['wallet', 'verify'], allCommands(db, 'ops', testConfig), io);
  return { code, text: io.text() };
}

test('판 결과 20개와 구매 5개를 섞어 동시에 보내도 wallet verify가 빈 목록이다', { skip: SKIP }, async () => {
  const { db, handler, close } = await world();
  try {
    // 한 번으로는 우연히 지나갈 수 있어서 사용자를 바꿔 가며 여러 번 한다
    let accepted = 0;
    let bought = 0;
    for (let round = 0; round < 6; round++) {
      const out = await mixedBurst(db, handler, `${round}번째`);
      accepted += out.accepted;
      bought += out.bought;
      assert.deepEqual(await verifyWallets(db, out.userId), [], `${round}번째: 잔액이 기록의 합과 같다`);
    }
    // 섞인 것이 맞는지: 여섯 번 가운데 판도 구매도 실제로 여러 번 반영됐다
    assert.ok(accepted > 6, `반영된 판 ${accepted}개`);
    assert.ok(bought >= 6, `성공한 구매 ${bought}개`);

    assert.deepEqual(await verifyWallets(db), []);
    const verify = await walletVerify(db);
    assert.equal(verify.code, 0, verify.text);
    assert.match(verify.text, /어긋난 지갑이 없어요/);
  } finally {
    await close();
  }
});

test('사용자 셋이 같은 순간에 저마다 판 결과 20개와 구매 5개를 보내도 서로의 지갑이 섞이지 않는다', { skip: SKIP }, async () => {
  const { db, handler, close } = await world();
  try {
    // 요청 75개가 연결 10개를 나눠 쓴다. 지갑마다 따로 줄을 서고, 한 사용자의 줄이 다른 사용자를 막지 않는다
    const outs = await Promise.all(['가', '나', '다'].map((name) => mixedBurst(db, handler, name)));
    assert.equal(new Set(outs.map((o) => o.userId)).size, 3);
    assert.deepEqual(await verifyWallets(db), []);
    const verify = await walletVerify(db);
    assert.equal(verify.code, 0, verify.text);
  } finally {
    await close();
  }
});
