import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount, type DeletionPolicy } from '../../src/account/index.ts';
import { claimAdReward, claimAttendance, purgeUser, rewardStatus } from '../../src/reward/index.ts';
import { applyCoins, getBalance, purgeUser as purgeWallet, verifyWallets } from '../../src/wallet/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { ledgerOf } from '../wallet/helpers.ts';
import { claimsOf, counts, NOON, rewardHandler, rule, setConfig } from './helpers.ts';

/** 지갑 상한 (스펙 5.2의 CHECK). wallet의 상수를 가져오지 않고 스펙의 숫자를 직접 적는다 */
const MAX_BALANCE = 9_000_000_000_000_000;

const at = (iso: string) => new Date(iso);
const codeOf = (body: unknown) => (body as { error?: { code?: string } } | null)?.error?.code;

test('출석은 하루에 한 번: 두 번째는 409 already_claimed', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOON);
    const other = await loginGuest(db, NOON);
    assert.deepEqual(await claimAttendance(db, me.userId, NOON), { coins: 50, balance: 50 });
    await assert.rejects(claimAttendance(db, me.userId, NOON), rule(409, 'already_claimed'));
    await assert.rejects(claimAttendance(db, me.userId, at('2026-11-26T14:00:00Z')), rule(409, 'already_claimed'), '같은 한국 날짜의 밤 11시');
    assert.deepEqual(await counts(db, me.userId), { claims: 1, ledger: 1, balance: 50 }, '거절된 출석은 코인도 기록도 남기지 않는다');

    // 사용자마다 따로 센다
    assert.deepEqual(await claimAttendance(db, other.userId, NOON), { coins: 50, balance: 50 });
    // 한국 시간 0시가 지나면 다시 받는다 (v1 테스트: 2026-11-17 15:30Z = 11-18 00:30 KST)
    assert.deepEqual(await claimAttendance(db, me.userId, at('2026-11-26T15:30:00Z')), { coins: 50, balance: 100 });
    await assert.rejects(claimAttendance(db, me.userId, at('2026-11-26T16:00:00Z')), rule(409, 'already_claimed'));
    assert.deepEqual(
      (await claimsOf(db, me.userId)).map((c) => [c.kind, c.claimDate, c.seq]),
      [
        ['attendance', '2026-11-26', 1],
        ['attendance', '2026-11-27', 1],
      ],
    );
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('한국 시간 23:59:59에 받고 00:00:00에 또 받을 수 있다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOON);
    // 14:59:59Z = 한국 23:59:59, 15:00:00Z = 한국 다음 날 00:00:00
    assert.deepEqual(await claimAttendance(db, me.userId, at('2026-11-26T14:59:59Z')), { coins: 50, balance: 50 });
    await assert.rejects(claimAttendance(db, me.userId, at('2026-11-26T14:59:59.999Z')), rule(409, 'already_claimed'), '같은 날의 마지막 순간');
    assert.deepEqual(await claimAttendance(db, me.userId, at('2026-11-26T15:00:00Z')), { coins: 50, balance: 100 });
    assert.deepEqual((await claimsOf(db, me.userId)).map((c) => c.claimDate), ['2026-11-26', '2026-11-27'], '서로 다른 날로 세어진다');

    // 광고 보상의 하루 한도도 같은 순간에 바뀐다
    for (let i = 0; i < 3; i++) await claimAdReward(db, me.userId, at('2026-11-27T14:59:59Z'));
    await assert.rejects(claimAdReward(db, me.userId, at('2026-11-27T14:59:59.999Z')), rule(429, 'daily_limit'));
    assert.equal((await claimAdReward(db, me.userId, at('2026-11-27T15:00:00Z'))).left, 2);
    // UTC 날짜가 아니라 한국 날짜다: UTC로는 같은 날(11-28)인 00:30Z와 15:30Z가 한국에서는 다른 날이다
    assert.deepEqual(await claimAttendance(db, me.userId, at('2026-11-28T00:30:00Z')), { coins: 50, balance: 350 });
    assert.deepEqual(await claimAttendance(db, me.userId, at('2026-11-28T15:30:00Z')), { coins: 50, balance: 400 });
  } finally {
    await close();
  }
});

test('광고 보상은 하루 3번, 네 번째는 429 daily_limit이고 다음 날 다시 3번이다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOON);
    assert.deepEqual(await claimAdReward(db, me.userId, NOON), { coins: 50, balance: 50, left: 2 });
    assert.deepEqual(await claimAdReward(db, me.userId, NOON), { coins: 50, balance: 100, left: 1 });
    assert.deepEqual(await claimAdReward(db, me.userId, at('2026-11-26T10:00:00Z')), { coins: 50, balance: 150, left: 0 });
    await assert.rejects(claimAdReward(db, me.userId, at('2026-11-26T11:00:00Z')), rule(429, 'daily_limit'));
    assert.deepEqual(await counts(db, me.userId), { claims: 3, ledger: 3, balance: 150 });
    assert.deepEqual(await rewardStatus(db, me.userId, at('2026-11-26T11:00:00Z')), { attendanceClaimedToday: false, adRewardsLeft: 0 });

    // 다음 날 다시 3번
    const next = at('2026-11-27T03:00:00Z');
    for (const left of [2, 1, 0]) assert.equal((await claimAdReward(db, me.userId, next)).left, left);
    await assert.rejects(claimAdReward(db, me.userId, next), rule(429, 'daily_limit'));
    assert.equal(await getBalance(db, me.userId), 300);
    assert.deepEqual(
      (await claimsOf(db, me.userId)).map((c) => [c.kind, c.claimDate, c.seq]),
      [
        ['ad_reward', '2026-11-26', 1],
        ['ad_reward', '2026-11-26', 2],
        ['ad_reward', '2026-11-26', 3],
        ['ad_reward', '2026-11-27', 1],
        ['ad_reward', '2026-11-27', 2],
        ['ad_reward', '2026-11-27', 3],
      ],
    );

    // 출석과 광고 보상은 따로 센다: 광고를 다 받은 날에도 출석은 받고, 출석이 광고 횟수를 쓰지 않는다
    assert.deepEqual(await claimAttendance(db, me.userId, next), { coins: 50, balance: 350 });
    const other = await loginGuest(db, NOON);
    await claimAttendance(db, other.userId, NOON);
    assert.equal((await claimAdReward(db, other.userId, NOON)).left, 2);
  } finally {
    await close();
  }
});

test('보상 코인은 설정값을 따른다: attendance_coins를 70으로 바꾸면 70을 받는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOON);
    await setConfig(db, 'attendance_coins', 70);
    assert.deepEqual(await claimAttendance(db, me.userId, NOON), { coins: 70, balance: 70 });
    await setConfig(db, 'ad_reward_coins', 15);
    assert.deepEqual(await claimAdReward(db, me.userId, NOON), { coins: 15, balance: 85, left: 2 });

    // 하루 횟수도 설정값이다: 5로 늘리면 5번까지, 그 뒤에 2로 줄이면 이미 받은 것이 더 많아 한도다 (남은 횟수가 음수가 되지 않는다)
    await setConfig(db, 'ad_rewards_per_day', 5);
    assert.equal((await rewardStatus(db, me.userId, NOON)).adRewardsLeft, 4);
    for (const left of [3, 2, 1]) assert.equal((await claimAdReward(db, me.userId, NOON)).left, left);
    await setConfig(db, 'ad_rewards_per_day', 2);
    await assert.rejects(claimAdReward(db, me.userId, NOON), rule(429, 'daily_limit'));
    assert.equal((await rewardStatus(db, me.userId, NOON)).adRewardsLeft, 0);
    // 0이면 아무도 받지 못한다
    await setConfig(db, 'ad_rewards_per_day', 0);
    const other = await loginGuest(db, NOON);
    await assert.rejects(claimAdReward(db, other.userId, NOON), rule(429, 'daily_limit'));
    assert.equal((await rewardStatus(db, other.userId, NOON)).adRewardsLeft, 0);
    assert.deepEqual((await ledgerOf(db, me.userId)).map((l) => l.delta), [70, 15, 15, 15, 15]);
  } finally {
    await close();
  }
});

test('받은 코인은 reason이 attendance·ad_reward인 코인 기록으로 남고 reward_claims가 그 기록을 가리킨다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOON);
    const later = at('2026-11-26T04:00:00Z');
    await claimAttendance(db, me.userId, NOON);
    await claimAdReward(db, me.userId, later);
    const ledger = await ledgerOf(db, me.userId);
    assert.deepEqual(
      ledger.map((l) => [l.delta, l.balanceAfter, l.reason, l.idempotencyKey, l.adminActionId, l.createdAt.toISOString()]),
      [
        [50, 50, 'attendance', null, null, NOON.toISOString()],
        [50, 100, 'ad_reward', null, null, later.toISOString()],
      ],
      '받는 곳은 통일 지갑 하나다 (표 D3: 게임을 고르지 않는다)',
    );
    const claims = await claimsOf(db, me.userId);
    assert.deepEqual(
      claims.map((c) => [c.kind, c.claimDate, c.seq, c.ledgerId, c.createdAt.toISOString()]),
      [
        ['attendance', '2026-11-26', 1, ledger[0].id, NOON.toISOString()],
        ['ad_reward', '2026-11-26', 1, ledger[1].id, later.toISOString()],
      ],
    );
  } finally {
    await close();
  }
});

test('rewardStatus는 오늘 받았는지와 남은 광고 횟수를 준다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOON);
    const other = await loginGuest(db, NOON);
    assert.deepEqual(await rewardStatus(db, me.userId, NOON), { attendanceClaimedToday: false, adRewardsLeft: 3 });
    await claimAttendance(db, me.userId, NOON);
    assert.deepEqual(await rewardStatus(db, me.userId, NOON), { attendanceClaimedToday: true, adRewardsLeft: 3 });
    await claimAdReward(db, me.userId, NOON);
    await claimAdReward(db, me.userId, NOON);
    assert.deepEqual(await rewardStatus(db, me.userId, NOON), { attendanceClaimedToday: true, adRewardsLeft: 1 });
    assert.deepEqual(await rewardStatus(db, other.userId, NOON), { attendanceClaimedToday: false, adRewardsLeft: 3 }, '다른 사용자는 그대로다');

    // 한국 날짜가 바뀌면 처음으로 돌아간다 (23:59:59까지는 오늘이다)
    assert.deepEqual(await rewardStatus(db, me.userId, at('2026-11-26T14:59:59Z')), { attendanceClaimedToday: true, adRewardsLeft: 1 });
    assert.deepEqual(await rewardStatus(db, me.userId, at('2026-11-26T15:00:00Z')), { attendanceClaimedToday: false, adRewardsLeft: 3 });
    // 읽기만 한다: 지갑도 보상도 생기지 않는다
    assert.deepEqual(await counts(db, other.userId), { claims: 0, ledger: 0, balance: null });
    // 사용자 ID 모양이 아니어도 쿼리 오류가 나지 않는다
    assert.deepEqual(await rewardStatus(db, 'not-a-uuid', NOON), { attendanceClaimedToday: false, adRewardsLeft: 3 });
  } finally {
    await close();
  }
});

test('보상 코인 설정이 0이면 코인 기록 없이 받은 것으로만 적는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOON);
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 30, reason: 'grant', now: NOON }));
    await setConfig(db, 'attendance_coins', 0);
    await setConfig(db, 'ad_reward_coins', 0);

    assert.deepEqual(await claimAttendance(db, me.userId, NOON), { coins: 0, balance: 30 });
    await assert.rejects(claimAttendance(db, me.userId, NOON), rule(409, 'already_claimed'), '코인이 0이어도 하루 한 번이다');
    assert.deepEqual(await claimAdReward(db, me.userId, NOON), { coins: 0, balance: 30, left: 2 });
    assert.deepEqual(await claimAdReward(db, me.userId, NOON), { coins: 0, balance: 30, left: 1 });
    assert.deepEqual(await claimAdReward(db, me.userId, NOON), { coins: 0, balance: 30, left: 0 });
    await assert.rejects(claimAdReward(db, me.userId, NOON), rule(429, 'daily_limit'));

    assert.deepEqual(await counts(db, me.userId), { claims: 4, ledger: 1, balance: 30 }, '코인 기록은 처음 받은 30뿐이다');
    assert.deepEqual((await claimsOf(db, me.userId)).map((c) => [c.kind, c.seq, c.ledgerId]), [['attendance', 1, null], ['ad_reward', 1, null], ['ad_reward', 2, null], ['ad_reward', 3, null]]);
    assert.deepEqual(await rewardStatus(db, me.userId, NOON), { attendanceClaimedToday: true, adRewardsLeft: 0 });
    assert.deepEqual(await verifyWallets(db), []);

    // 코인을 받은 적 없는 사용자: 잔액 0으로 답한다
    const fresh = await loginGuest(db, NOON);
    assert.deepEqual(await claimAttendance(db, fresh.userId, NOON), { coins: 0, balance: 0 });
    assert.deepEqual(await ledgerOf(db, fresh.userId), []);
  } finally {
    await close();
  }
});

test('코인 반영이 실패하면 받은 것으로 적지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOON);
    // 지갑을 상한에서 10 모자라게: 50코인 보상은 지갑 상한에 걸린다
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: MAX_BALANCE - 10, reason: 'grant', now: NOON }));
    await assert.rejects(claimAttendance(db, me.userId, NOON), rule(409, 'balance_limit'));
    await assert.rejects(claimAdReward(db, me.userId, NOON), rule(409, 'balance_limit'));
    assert.deepEqual(await counts(db, me.userId), { claims: 0, ledger: 1, balance: MAX_BALANCE - 10 });
    assert.deepEqual(await rewardStatus(db, me.userId, NOON), { attendanceClaimedToday: false, adRewardsLeft: 3 }, '오늘 몫은 그대로 남아 있다');

    // 받을 수 있게 되면 그날의 출석을 받는다
    await setConfig(db, 'attendance_coins', 10);
    assert.deepEqual(await claimAttendance(db, me.userId, NOON), { coins: 10, balance: MAX_BALANCE });
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('purgeUser는 그 사용자의 보상만 지우고, 지워진 사용자는 보상을 받지 못한다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOON);
    const other = await loginGuest(db, NOON);
    for (const who of [me, other]) {
      await claimAttendance(db, who.userId, NOON);
      await claimAdReward(db, who.userId, NOON);
    }
    // 보상이 코인 기록을 가리키므로(reward_claims.ledger_id) 지갑보다 먼저 지운다
    const policy: DeletionPolicy = { mustKeepUserRow: async () => false, purge: [purgeUser, purgeWallet] };
    await deleteAccount(db, me.userId, policy, NOON);
    assert.deepEqual(await counts(db, me.userId), { claims: 0, ledger: 0, balance: null });
    assert.deepEqual(await counts(db, other.userId), { claims: 2, ledger: 2, balance: 100 }, '다른 사용자의 것은 그대로다');

    await assert.rejects(claimAttendance(db, me.userId, NOON), rule(401, 'unauthorized'));
    await assert.rejects(claimAdReward(db, me.userId, NOON), rule(401, 'unauthorized'));
    await assert.rejects(claimAttendance(db, 'not-a-uuid', NOON), rule(401, 'unauthorized'));
    assert.deepEqual(await counts(db, me.userId), { claims: 0, ledger: 0, balance: null }, '지워진 사용자에 아무것도 붙지 않는다');
  } finally {
    await close();
  }
});

test('POST /v2/me/attendance와 /v2/me/ad-reward: 세션이 있어야 하고 요청을 받은 시각의 한국 날짜로 센다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock('2026-11-26T14:59:59Z');
    const handler = rewardHandler(db, clock);
    const me = await loginGuest(db, NOON);

    for (const path of ['/v2/me/attendance', '/v2/me/ad-reward']) {
      assert.equal((await call(handler, 'POST', path)).status, 401, path);
      assert.equal((await call(handler, 'POST', path, { token: 'x'.repeat(43) })).status, 401, path);
      assert.equal((await call(handler, 'GET', path, { token: me.token })).status, 405, path);
    }

    // v1은 받을 게임(gameId)을 골랐다. v2는 고르지 않는다: 본문이 없어도, 가지지 않은 게임을 적어도 통일 지갑으로 받는다 (표 D3)
    const first = await call(handler, 'POST', '/v2/me/attendance', { token: me.token, body: { gameId: 'minesweeper' } });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { coins: 50, balance: 50 });
    assert.equal(first.headers['cache-control'], 'no-store');
    const second = await call(handler, 'POST', '/v2/me/attendance', { token: me.token });
    assert.equal(second.status, 409);
    assert.equal(codeOf(second.body), 'already_claimed');
    assert.match((second.body as { error: { message: string } }).error.message, /요$/);

    const ads = [];
    for (let i = 0; i < 3; i++) ads.push((await call(handler, 'POST', '/v2/me/ad-reward', { token: me.token })).body);
    assert.deepEqual(ads, [
      { coins: 50, balance: 100, left: 2 },
      { coins: 50, balance: 150, left: 1 },
      { coins: 50, balance: 200, left: 0 },
    ]);
    const fourth = await call(handler, 'POST', '/v2/me/ad-reward', { token: me.token });
    assert.equal(fourth.status, 429);
    assert.equal(codeOf(fourth.body), 'daily_limit');
    // 깨진 본문을 보내도 본문을 읽지 않으니 결과는 같다
    assert.equal((await call(handler, 'POST', '/v2/me/ad-reward', { token: me.token, body: '{"gameId":' })).status, 429);

    // 1초 뒤는 한국의 다음 날이다
    clock.advance(1000);
    assert.deepEqual((await call(handler, 'POST', '/v2/me/attendance', { token: me.token })).body, { coins: 50, balance: 250 });
    assert.deepEqual((await call(handler, 'POST', '/v2/me/ad-reward', { token: me.token })).body, { coins: 50, balance: 300, left: 2 });
    assert.deepEqual(await counts(db, me.userId), { claims: 6, ledger: 6, balance: 300 });
  } finally {
    await close();
  }
});
