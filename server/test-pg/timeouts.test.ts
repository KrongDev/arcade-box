import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devVerifier } from '../src/account/index.ts';
import { buildServer } from '../src/server.ts';
import type { DbTimeouts } from '../src/shared/config.ts';
import type { Db } from '../src/shared/db/index.ts';
import { applyCoins, getBalance, lockWallet, verifyWallets } from '../src/wallet/index.ts';
import { loginGuest, testConfig } from '../test/account/helpers.ts';
import { call } from '../test/helpers/http.ts';
import { ledgerOf } from '../test/wallet/helpers.ts';
import { pgTestDb, SKIP } from './helpers.ts';

/**
 * 연결 풀의 시간 제한 (지휘 중에 더한 것). 잠긴 행을 기다리는 요청, 트랜잭션을 연 채 멈춘 연결, 연결을 기다리는 요청이
 * 끝없이 매달리지 않고 정해진 시간 뒤에 오류로 끝나는지 본다. 시간 제한은 테스트가 빨리 끝나게 짧게 준다.
 */
const NOW = new Date('2026-11-26T03:00:00Z');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 넉넉한 값. 보려는 제한 하나만 짧게 바꿔 쓴다 */
const LONG: DbTimeouts = { connectMs: 20_000, statementMs: 20_000, idleInTxMs: 20_000 };

/** 실패한 까닭을 한 줄로: PostgreSQL 오류 코드(있으면)와 메시지 */
function why(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  return `${String(cause?.code ?? '')} ${String(cause?.message ?? (err as Error).message)}`.trim();
}

/** 이 사용자의 지갑을 잠근 채 `release()`를 부를 때까지 트랜잭션을 열어 둔다. `locked`는 잠금을 잡은 뒤에 풀린다 */
function holdWallet(db: Db, userId: string): { locked: Promise<void>; release(): void; done: Promise<void> } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let gotLock!: () => void;
  const locked = new Promise<void>((resolve) => (gotLock = resolve));
  const done = db.transaction(async (tx) => {
    await lockWallet(tx, userId, NOW);
    gotLock();
    await gate;
  });
  return { locked, release, done };
}

test('잠긴 지갑을 기다리는 요청은 정해진 시간 뒤에 오류로 끝난다 (끝없이 매달리지 않고, 아무것도 남기지 않는다)', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb({ ...LONG, statementMs: 400 });
  try {
    const me = await loginGuest(db, NOW);
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 100, reason: 'grant', now: NOW }));
    const handler = buildServer({ db, config: testConfig, now: () => NOW, verify: devVerifier() });

    const holder = holdWallet(db, me.userId);
    await holder.locked;
    try {
      // 함수로 부른 요청: 지갑 잠금을 기다리다 쿼리 시간 제한(57014 query_canceled)으로 끝난다
      const started = Date.now();
      await assert.rejects(
        db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 50, reason: 'grant', now: NOW })),
        (err: unknown) => /57014/.test(why(err)),
      );
      const waited = Date.now() - started;
      assert.ok(waited >= 300 && waited < 5000, `기다린 시간 ${waited}ms`);

      // HTTP 요청도 같다: 매달리지 않고 500 internal로 끝나고, 오류 내용(쿼리)은 내보내지 않는다
      const startedHttp = Date.now();
      const res = await call(handler, 'POST', '/v2/me/attendance', { token: me.token, body: {} });
      assert.equal(res.status, 500);
      assert.deepEqual(Object.keys((res.body as { error: object }).error).sort(), ['code', 'message']);
      assert.equal((res.body as { error: { code: string } }).error.code, 'internal');
      assert.ok(Date.now() - startedHttp < 5000);
    } finally {
      holder.release();
      await holder.done;
    }

    // 끝난 요청은 아무것도 남기지 않았다: 잔액과 기록이 그대로다
    assert.equal(await getBalance(db, me.userId), 100);
    assert.equal((await ledgerOf(db, me.userId)).length, 1);
    // 잠금이 풀린 뒤에는 같은 요청이 된다 (연결 풀이 멀쩡하다)
    const again = await call(handler, 'POST', '/v2/me/attendance', { token: me.token, body: {} });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(await getBalance(db, me.userId), 150);
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('트랜잭션을 연 채 쉬는 연결은 정해진 시간 뒤에 끊기고 잠금이 풀린다 (서버는 죽지 않는다)', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb({ ...LONG, idleInTxMs: 300 });
  try {
    const me = await loginGuest(db, NOW);
    // 지갑을 잠근 채 아무 쿼리도 보내지 않고 멈춘 요청 (코드가 트랜잭션 안에서 다른 일을 기다리는 경우)
    await assert.rejects(
      db.transaction(async (tx) => {
        await lockWallet(tx, me.userId, NOW);
        await sleep(900);
        await applyCoins(tx, { userId: me.userId, delta: 50, reason: 'grant', now: NOW });
      }),
    );
    // 끊긴 트랜잭션은 되돌아갔고 잠금도 풀렸다: 다음 요청이 바로 된다
    const started = Date.now();
    const out = await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 70, reason: 'grant', now: NOW }));
    assert.equal(out.balance, 70);
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('연결이 모두 쓰이고 있으면 기다리던 요청은 정해진 시간 뒤에 오류로 끝난다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb({ ...LONG, connectMs: 400 });
  try {
    // 풀의 연결 10개를 모두 잡는다 (사용자 열 명이 저마다 지갑을 잠근 채 멈춤)
    const holders = [];
    for (let i = 0; i < 10; i++) {
      const user = await loginGuest(db, NOW);
      holders.push(holdWallet(db, user.userId));
    }
    await Promise.all(holders.map((h) => h.locked));
    const other = await Promise.race([loginGuest(db, NOW).then(() => 'ok'), sleep(5000).then(() => 'hung')]).catch((err: unknown) => `failed: ${why(err)}`);
    try {
      assert.match(other, /^failed: .*timeout/i, '열한 번째 요청은 연결을 기다리다 오류로 끝난다');
    } finally {
      for (const h of holders) h.release();
      await Promise.all(holders.map((h) => h.done));
    }
    // 연결이 돌아온 뒤에는 된다
    await loginGuest(db, NOW);
  } finally {
    await close();
  }
});
