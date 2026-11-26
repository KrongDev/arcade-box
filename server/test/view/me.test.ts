import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount, getUser, updateSettings } from '../../src/account/index.ts';
import { setNumber } from '../../src/admin/index.ts';
import { equip } from '../../src/entitlement/index.ts';
import { purchaseWithCoins } from '../../src/order/index.ts';
import { submitRun } from '../../src/play/index.ts';
import { claimAdReward, claimAttendance } from '../../src/reward/index.ts';
import { seed } from '../../src/seed.ts';
import { deletionPolicy } from '../../src/server.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { me as readMe } from '../../src/view/index.ts';
import { applyCoins } from '../../src/wallet/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { gameKit } from '../game/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { insertMoneyOrder } from '../order/helpers.ts';
import { NOW, seedView, viewHandler } from './helpers.ts';

test('새 손님의 /v2/me: 잔액 0, owned는 비고, providers는 ["guest"], 광고 3번 남음', async () => {
  const kit = await gameKit();
  try {
    await seedView(kit);
    const me = await loginGuest(kit.db, NOW);
    const res = await call(viewHandler(kit.db, fakeClock(NOW.toISOString())), 'GET', '/v2/me', { token: me.token });
    assert.equal(res.status, 200);
    // 사용자마다 다른 답이라 캐시하지 않는다
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.body, {
      userId: me.userId,
      providers: ['guest'],
      balance: 0,
      owned: [],
      equipped: [],
      settings: { sound: true, haptic: true },
      rewards: { attendanceClaimedToday: false, adRewardsLeft: 3 },
      runCoins: { earnedToday: 0, limit: 1500 },
      boards: {},
      serverDate: '2026-11-26',
    });
  } finally {
    await kit.close();
  }
});

test('판 결과·출석·구매·장착 뒤의 /v2/me가 그 결과를 모두 담는다', async () => {
  const kit = await gameKit();
  const { db } = kit;
  try {
    await seedView(kit);
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 2000, reason: 'grant', now: NOW }));
    await submitRun(db, me.userId, { boardId: 'pinball', coins: 100, score: 1234 }, NOW);
    await claimAttendance(db, me.userId, NOW);
    await claimAdReward(db, me.userId, NOW);
    await purchaseWithCoins(db, me.userId, { productId: 'pinball.table.sunset' }, NOW);
    await equip(db, me.userId, 'pinball.table.sunset');
    await updateSettings(db, me.userId, { sound: false }, NOW);

    const handler = viewHandler(db, fakeClock(NOW.toISOString()));
    const res = await call(handler, 'GET', '/v2/me', { token: me.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      userId: me.userId,
      providers: ['guest'],
      // 2000(지급) + 100(판) + 50(출석) + 50(광고) − 1000(노을 판)
      balance: 1200,
      owned: ['pinball.table.sunset'],
      equipped: [{ gameId: 'pinball', slot: 'table', productId: 'pinball.table.sunset' }],
      settings: { sound: false, haptic: true },
      rewards: { attendanceClaimedToday: true, adRewardsLeft: 2 },
      runCoins: { earnedToday: 100, limit: 1500 },
      boards: { pinball: { best: 1234, bestSeconds: null, cleared: false } },
      serverDate: '2026-11-26',
    });

    // 하루 상한이 없으면(설정 0) limit은 null이다
    await db.transaction((tx) => setNumber(tx, 'run_coins_per_day', 0));
    const unlimited = (await call(handler, 'GET', '/v2/me', { token: me.token })).body as { runCoins: unknown };
    assert.deepEqual(unlimited.runCoins, { earnedToday: 100, limit: null });

    // 내 것만 준다: 다른 사용자의 답에는 아무것도 묻어나지 않는다
    const theirs = (await call(handler, 'GET', '/v2/me', { token: other.token })).body as Record<string, unknown>;
    assert.equal(theirs.userId, other.userId);
    assert.equal(theirs.balance, 0);
    assert.deepEqual(theirs.owned, []);
    assert.deepEqual(theirs.equipped, []);
    assert.deepEqual(theirs.boards, {});
    assert.deepEqual(theirs.rewards, { attendanceClaimedToday: false, adRewardsLeft: 3 });
    assert.deepEqual(theirs.runCoins, { earnedToday: 0, limit: null });
  } finally {
    await kit.close();
  }
});

test('/v2/me는 로그인이 필요하다', async () => {
  const kit = await gameKit();
  try {
    const handler = viewHandler(kit.db, fakeClock(NOW.toISOString()));
    const res = await call(handler, 'GET', '/v2/me');
    assert.equal(res.status, 401);
    assert.deepEqual((res.body as { error: { code: string } }).error.code, 'unauthorized');
    const wrong = await call(handler, 'GET', '/v2/me', { token: 'a'.repeat(43) });
    assert.equal(wrong.status, 401);
  } finally {
    await kit.close();
  }
});

test('없는 사용자와 계정을 지워 deleted로만 남은 사용자에게는 401 unauthorized다 (세션 확인과 읽기 사이에 지워진 경우)', async () => {
  const { db, close } = await testDb();
  const unauthorized = (err: unknown) => err instanceof RuleError && err.status === 401 && err.code === 'unauthorized';
  try {
    await assert.rejects(readMe(db, '00000000-0000-4000-8000-000000000000', NOW), unauthorized);

    // 현금 주문이 있어 사용자 행이 deleted로 남는다 (주문의 상품은 처음 자료의 pinball.ball.gold)
    await seed(db);
    const gone = await loginGuest(db, NOW);
    await insertMoneyOrder(db, gone.userId, NOW);
    await deleteAccount(db, gone.userId, deletionPolicy, NOW);
    assert.equal((await getUser(db, gone.userId))?.status, 'deleted');
    await assert.rejects(readMe(db, gone.userId, NOW), unauthorized);
  } finally {
    await close();
  }
});
