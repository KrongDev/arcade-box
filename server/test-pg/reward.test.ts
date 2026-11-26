import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimAdReward, claimAttendance, rewardStatus } from '../src/reward/index.ts';
import { rewardClaims } from '../src/reward/schema.ts';
import { RuleError } from '../src/shared/errors.ts';
import { getBalance, verifyWallets } from '../src/wallet/index.ts';
import { loginGuest } from '../test/account/helpers.ts';
import { seedPlay, send } from '../test/play/helpers.ts';
import { claimsOf, counts, NOON, setConfig } from '../test/reward/helpers.ts';
import { pgTestDb, SKIP } from './helpers.ts';

function failure(reason: unknown): string {
  if (reason instanceof RuleError) return `${reason.status} ${reason.code}`;
  const cause = (reason as { cause?: { code?: unknown } } | null)?.cause;
  return `뜻밖의 오류: ${String(cause?.code ?? reason)}`;
}

/** 같은 순간에 보낸다 (pool의 연결이 저마다 트랜잭션을 연다) */
async function together<T>(requests: Array<() => Promise<T>>): Promise<{ ok: T[]; failed: string[] }> {
  const settled = await Promise.allSettled(requests.map((request) => request()));
  return {
    ok: settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
    failed: settled.flatMap((r) => (r.status === 'rejected' ? [failure(r.reason)] : [])),
  };
}

const times = <T>(n: number, request: () => Promise<T>) => Array.from({ length: n }, () => request);

test('광고 보상을 동시에 10번 보내면 정확히 3번만 성공한다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    // 한 번으로는 우연히 지나갈 수 있어서 사용자를 바꿔 가며 여러 번 한다
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOON);
      const out = await together(times(10, () => claimAdReward(db, me.userId, NOON)));
      assert.equal(out.ok.length, 3, `${round}번째: ${JSON.stringify(out.failed)}`);
      assert.deepEqual(out.failed, Array.from({ length: 7 }, () => '429 daily_limit'), `${round}번째: 500이 아니라 한도라는 거절이다`);
      assert.deepEqual(out.ok.map((r) => r.left).sort(), [0, 1, 2], `${round}번째: 남은 횟수가 겹치지 않는다`);
      assert.deepEqual(out.ok.map((r) => r.balance).sort((a, b) => a - b), [50, 100, 150]);
      assert.deepEqual(await counts(db, me.userId), { claims: 3, ledger: 3, balance: 150 });
      assert.deepEqual((await claimsOf(db, me.userId)).map((c) => c.seq), [1, 2, 3]);
      assert.equal((await rewardStatus(db, me.userId, NOON)).adRewardsLeft, 0);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('같은 날 출석을 동시에 5번 보내면 하나만 성공한다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOON);
      const out = await together(times(5, () => claimAttendance(db, me.userId, NOON)));
      assert.equal(out.ok.length, 1, `${round}번째: ${JSON.stringify(out.failed)}`);
      assert.deepEqual(out.failed, ['409 already_claimed', '409 already_claimed', '409 already_claimed', '409 already_claimed'], `${round}번째: 500이 아니라 이미 받았다는 거절이다`);
      assert.deepEqual(out.ok[0], { coins: 50, balance: 50 });
      assert.deepEqual(await counts(db, me.userId), { claims: 1, ledger: 1, balance: 50 }, `${round}번째: 코인은 한 번만 들어갔다`);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('광고 보상이 두 번 남았을 때 동시에 온 두 요청은 둘 다 성공한다 (한도 오류를 받지 않는다)', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    for (let round = 0; round < 10; round++) {
      const me = await loginGuest(db, NOON);
      assert.equal((await claimAdReward(db, me.userId, NOON)).left, 2);
      const out = await together(times(2, () => claimAdReward(db, me.userId, NOON)));
      assert.deepEqual(out.failed, [], `${round}번째: 둘 다 받는다`);
      assert.deepEqual(out.ok.map((r) => r.left).sort(), [0, 1]);
      assert.equal(await getBalance(db, me.userId), 150);
    }
  } finally {
    await close();
  }
});

test('보상 코인 설정이 0이어도 동시에 온 출석은 하나만 받은 것으로 적힌다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await setConfig(db, 'attendance_coins', 0);
    await setConfig(db, 'ad_reward_coins', 0);
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOON);
      const out = await together([...times(5, () => claimAttendance(db, me.userId, NOON)), ...times(6, () => claimAdReward(db, me.userId, NOON))]);
      assert.equal(out.ok.length, 4, `${round}번째: 출석 하나와 광고 셋 (${JSON.stringify(out.failed)})`);
      assert.deepEqual(out.failed.sort(), ['409 already_claimed', '409 already_claimed', '409 already_claimed', '409 already_claimed', '429 daily_limit', '429 daily_limit', '429 daily_limit']);
      assert.deepEqual(await counts(db, me.userId), { claims: 4, ledger: 0, balance: 0 });
    }
  } finally {
    await close();
  }
});

test('판 결과와 출석·광고 보상이 같은 순간에 겹쳐도 모두 반영되고 잔액이 코인 기록과 맞는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedPlay(db);
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOON);
      const out = await together<unknown>([
        () => send(db, me.userId, { boardId: 'pinball', score: 1000, coins: 40 }, NOON),
        () => claimAttendance(db, me.userId, NOON),
        () => claimAdReward(db, me.userId, NOON),
        () => claimAdReward(db, me.userId, NOON),
        () => claimAdReward(db, me.userId, NOON),
      ]);
      assert.deepEqual(out.failed, [], `${round}번째`);
      // 40 + 50 + 50×3
      assert.equal(await getBalance(db, me.userId), 240, `${round}번째`);
      assert.deepEqual(await counts(db, me.userId), { claims: 4, ledger: 5, balance: 240 });
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('차례를 서지 않은 쓰기와 겹쳐 유일 제약에 걸리면 500이 아니라 한도 오류이고 코인도 되돌아간다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    for (const kind of ['attendance', 'ad_reward'] as const) {
      const me = await loginGuest(db, NOON);
      const request = () => (kind === 'attendance' ? claimAttendance(db, me.userId, NOON) : claimAdReward(db, me.userId, NOON));
      let pending: Promise<unknown> = Promise.resolve();
      // 지갑을 잡지 않는 쓰기(이 서버에는 없는 길)가 오늘의 첫 줄을 넣고 아직 끝내지 않은 사이에 보상 요청이 온다:
      // 요청은 그 줄을 보지 못해 같은 seq를 넣으려다 유일 제약에서 기다리고, 앞의 쓰기가 끝나면 넣지 못한다
      await db.transaction(async (tx) => {
        await tx.insert(rewardClaims).values({ userId: me.userId, kind, claimDate: '2026-11-26', seq: 1, ledgerId: null, createdAt: NOON });
        pending = request();
        pending.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const [settled] = await Promise.allSettled([pending]);
      assert.equal(settled.status, 'rejected', kind);
      assert.equal(failure((settled as PromiseRejectedResult).reason), kind === 'attendance' ? '409 already_claimed' : '429 daily_limit', kind);
      assert.deepEqual(await counts(db, me.userId), { claims: 1, ledger: 0, balance: null }, `${kind}: 코인이 들어가지 않았다`);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});
