import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount } from '../../src/account/index.ts';
import { applyCoins, getBalance, lockWallet, verifyWallets } from '../../src/wallet/index.ts';
import { loginGuest, noPolicy } from '../account/helpers.ts';
import { testDb } from '../helpers/db.ts';
import { ledgerOf, NOW, rule, walletOf } from './helpers.ts';

test('lockWallet은 지갑 행을 잠그고 지금 잔액을 준다. 코인은 바꾸지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    // 코인을 받은 적이 없으면 잔액 0인 지갑이 생긴다 (잠글 행이 있어야 해서). 코인 기록은 생기지 않는다
    assert.equal(await db.transaction((tx) => lockWallet(tx, me.userId, NOW)), 0);
    const wallet = await walletOf(db, me.userId);
    assert.deepEqual([wallet?.balance, wallet?.updatedAt.toISOString()], [0, NOW.toISOString()]);
    assert.deepEqual(await ledgerOf(db, me.userId), []);
    assert.deepEqual(await verifyWallets(db), [], '빈 지갑은 어긋난 지갑이 아니다');

    // 있는 지갑은 잔액도 시각도 그대로다
    const later = new Date(NOW.getTime() + 60_000);
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 120, reason: 'grant', now: later }));
    const much = new Date(NOW.getTime() + 120_000);
    const seen = await db.transaction(async (tx) => {
      const balance = await lockWallet(tx, me.userId, much);
      // 잠근 뒤 같은 트랜잭션에서 applyCoins를 불러도 된다 (같은 행을 다시 잠글 뿐이다)
      const paid = await applyCoins(tx, { userId: me.userId, delta: -20, reason: 'adjust', now: much });
      return { balance, after: paid.balance };
    });
    assert.deepEqual(seen, { balance: 120, after: 100 });
    assert.equal(await getBalance(db, me.userId), 100);

    // 부른 트랜잭션이 실패하면 만들던 빈 지갑도 남지 않는다
    const other = await loginGuest(db, NOW);
    await assert.rejects(
      db.transaction(async (tx) => {
        await lockWallet(tx, other.userId, NOW);
        throw new Error('뒤에서 실패');
      }),
      /뒤에서 실패/,
    );
    assert.equal(await walletOf(db, other.userId), null);
  } finally {
    await close();
  }
});

test('lockWallet: 없거나 지워진 사용자면 401 unauthorized이고 지갑이 붙지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    await deleteAccount(db, me.userId, noPolicy, NOW);
    await assert.rejects(db.transaction((tx) => lockWallet(tx, me.userId, NOW)), rule(401, 'unauthorized'));
    await assert.rejects(db.transaction((tx) => lockWallet(tx, 'not-a-uuid', NOW)), rule(401, 'unauthorized'));
    await assert.rejects(db.transaction((tx) => lockWallet(tx, '00000000-0000-4000-8000-000000000000', NOW)), rule(401, 'unauthorized'));
    assert.equal(await walletOf(db, me.userId), null);
  } finally {
    await close();
  }
});
