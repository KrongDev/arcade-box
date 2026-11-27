import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount, getUser, type DeletionPolicy } from '../src/account/index.ts';
import { equip, grant, listEquipped, listOwned, purgeUser as purgeEntitlements, revoke } from '../src/entitlement/index.ts';
import { hasMoneyOrders, purgeExpired, purgeUser } from '../src/order/index.ts';
import { RuleError } from '../src/shared/errors.ts';
import { applyCoins, getBalance, purgeUser as purgeWallet, verifyWallets } from '../src/wallet/index.ts';
import { loginGuest } from '../test/account/helpers.ts';
import { tablesContaining } from '../test/helpers/scan.ts';
import { buy, CHEAP, counts, eventsOf, fund, insertMoneyOrder, NOW, ordersOf, refund, seedShop } from '../test/order/helpers.ts';
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

test('잔액 1000에서 300짜리 구매 10개를 동시에 보내면 3개만 성공하고 잔액은 100, 기록의 합과 같다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    // 한 번으로는 우연히 지나갈 수 있어서 사용자를 바꿔 가며 여러 번 한다
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 1000);
      const out = await together(CHEAP.map((productId) => () => buy(db, me.userId, productId)));
      assert.equal(out.ok.length, 3, `${round}번째: ${JSON.stringify(out.failed)}`);
      assert.deepEqual(out.failed, Array.from({ length: 7 }, () => '409 insufficient_coins'), `${round}번째: 500이나 deadlock이 아니라 모자란다는 거절이다`);
      assert.deepEqual(out.ok.map((r) => r.balance).sort((a, b) => a - b), [100, 400, 700], `${round}번째: 답의 잔액이 겹치지 않는다`);
      assert.equal(await getBalance(db, me.userId), 100);
      // 주문 3, 사건 9, 보유 3, 코인 기록 4(지급 1 + 구매 3)
      assert.deepEqual(await counts(db, me.userId), { orders: 3, events: 9, entitlements: 3, ledger: 4, balance: 100 }, `${round}번째`);
      assert.deepEqual((await listOwned(db, me.userId)).sort(), out.ok.map((r) => r.productId).sort());
      assert.deepEqual(await verifyWallets(db, me.userId), [], `${round}번째: 잔액이 기록의 합과 같다`);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('같은 상품을 동시에 두 번 사면 하나는 409 already_owned이고 코인은 한 번만 나간다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    for (let round = 0; round < 10; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 1000);
      // 홀수 번째는 다섯 번을 한꺼번에, 저마다 다른 키로 보낸다 (연타)
      const n = round % 2 === 1 ? 5 : 2;
      const out = await together(Array.from({ length: n }, (_, i) => () => buy(db, me.userId, 'pinball.table.sunset', round % 2 === 1 ? `tap-${round}-${i}-key` : undefined)));
      assert.equal(out.ok.length, 1, `${round}번째: ${JSON.stringify(out.failed)}`);
      assert.deepEqual(out.failed, Array.from({ length: n - 1 }, () => '409 already_owned'), `${round}번째: 500이 아니라 이미 가졌다는 거절이다`);
      assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 3, entitlements: 1, ledger: 2, balance: 700 }, `${round}번째: 코인은 한 번만 나갔다`);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('같은 키의 구매를 동시에 5번 보내면 주문이 하나이고 모두 같은 답을 받는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 1000);
      const out = await together(times(5, () => buy(db, me.userId, 'pinball.table.sunset', `same-buy-key-${round}`)));
      assert.deepEqual(out.failed, [], `${round}번째: 다시 보낸 요청은 거절되지 않는다`);
      assert.equal(out.ok.filter((r) => !r.replayed).length, 1, `${round}번째: 처음 반영된 것은 하나다`);
      const [order] = await ordersOf(db, me.userId);
      for (const r of out.ok) assert.deepEqual({ ...r, replayed: false }, { orderId: order.id, productId: 'pinball.table.sunset', game: null, balance: 700, replayed: false }, `${round}번째`);
      assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 3, entitlements: 1, ledger: 2, balance: 700 });
    }
  } finally {
    await close();
  }
});

test('구매와 운영자 지급이 같은 상품에서 겹치면 하나만 되고, 구매가 밀렸으면 코인이 나가지 않는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    for (let round = 0; round < 12; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 1000);
      const settled = await Promise.allSettled([
        buy(db, me.userId, 'pinball.table.sunset'),
        db.transaction((tx) => grant(tx, { userId: me.userId, productId: 'pinball.table.sunset', source: 'grant' })),
      ]);
      const failed = settled.flatMap((r) => (r.status === 'rejected' ? [failure(r.reason)] : []));
      assert.deepEqual(failed, ['409 already_owned'], `${round}번째: 하나만 되고 다른 하나는 이미 가졌다는 거절이다`);
      const bought = settled[0].status === 'fulfilled';
      assert.deepEqual(
        await counts(db, me.userId),
        bought ? { orders: 1, events: 3, entitlements: 1, ledger: 2, balance: 700 } : { orders: 0, events: 0, entitlements: 1, ledger: 1, balance: 1000 },
        `${round}번째 (${bought ? '구매가 먼저' : '지급이 먼저'})`,
      );
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('같은 주문의 환불을 동시에 세 번 보내면 한 번만 되고 코인도 한 번만 돌아온다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 1000);
      const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
      const out = await together(times(3, () => refund(db, orderId)));
      assert.equal(out.ok.length, 1, `${round}번째: ${JSON.stringify(out.failed)}`);
      assert.deepEqual(out.failed, ['409 already_refunded', '409 already_refunded'], `${round}번째`);
      assert.deepEqual(await counts(db, me.userId), { orders: 1, events: 5, entitlements: 1, ledger: 3, balance: 1000 }, `${round}번째`);
      assert.deepEqual((await eventsOf(db, orderId)).map((e) => e.type), ['created', 'completed', 'granted', 'refunded', 'revoked']);
      assert.deepEqual(await listOwned(db, me.userId), []);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('구매·환불·코인 벌기가 같은 순간에 겹쳐도 서로 물고 서지 않고 잔액이 기록의 합과 같다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    for (let round = 0; round < 8; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 600);
      const first = await buy(db, me.userId, CHEAP[0]);
      const second = await buy(db, me.userId, CHEAP[1]);
      // 잔액 0에서: 환불 둘(+300씩), 벌기 둘(+50씩), 구매 넷(−300씩)이 겹친다. 구매는 순서에 따라 0~2개가 된다
      const out = await together<unknown>([
        () => refund(db, first.orderId),
        () => buy(db, me.userId, CHEAP[2]),
        () => db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 50, reason: 'ad_reward', now: NOW })),
        () => buy(db, me.userId, CHEAP[3]),
        () => refund(db, second.orderId),
        () => buy(db, me.userId, CHEAP[4]),
        () => db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 50, reason: 'attendance', now: NOW })),
        () => buy(db, me.userId, CHEAP[5]),
      ]);
      for (const f of out.failed) assert.equal(f, '409 insufficient_coins', `${round}번째: 500이나 deadlock이 없다`);
      const bought = (await ordersOf(db, me.userId)).filter((o) => o.status === 'completed').length;
      assert.equal(bought, 4 - out.failed.length, `${round}번째`);
      assert.ok(bought <= 2, `${round}번째: 돌아온 코인(700)으로는 둘까지만 살 수 있다`);
      const balance = await getBalance(db, me.userId);
      assert.equal(balance, 700 - 300 * bought, `${round}번째`);
      assert.ok(balance >= 0);
      assert.deepEqual(await verifyWallets(db, me.userId), [], `${round}번째`);
    }
  } finally {
    await close();
  }
});

/** 서버 조립이 계정 삭제에 넣는 것과 같은 방침 (이 테스트가 만드는 것만: 주문 → 보유 → 지갑) */
const policy: DeletionPolicy = { mustKeepUserRow: hasMoneyOrders, purge: [purgeUser, purgeEntitlements, purgeWallet] };

test('구매와 계정 삭제가 겹쳐도 500이 없고, 지워진 사용자에 주문·보유·코인 기록이 남지 않는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    for (let round = 0; round < 12; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 1000);
      const settled = await Promise.allSettled([
        buy(db, me.userId, CHEAP[0]),
        deleteAccount(db, me.userId, policy, NOW),
        buy(db, me.userId, CHEAP[1]),
        buy(db, me.userId, CHEAP[2], `delete-race-${round}`),
      ]);
      assert.equal(settled[1].status, 'fulfilled', `${round}번째: 삭제는 늘 된다`);
      for (const r of settled) if (r.status === 'rejected') assert.equal(failure(r.reason), '401 unauthorized', `${round}번째: 삭제에 밀린 구매는 로그인이 필요하다는 거절이다`);
      assert.deepEqual(await tablesContaining(db, [me.userId]), [], `${round}번째: 어느 테이블에도 흔적이 없다`);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('환불과 계정 삭제가 겹쳐도 500이 없고, 환불이 되거나 404 not_found이며 사용자의 흔적이 남지 않는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    for (let round = 0; round < 20; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 1000);
      const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
      // 어느 쪽을 먼저 보내는지 번갈아 한다
      const requests = [() => refund(db, orderId), () => deleteAccount(db, me.userId, policy, NOW)];
      const settled = await Promise.allSettled((round % 2 === 1 ? requests : [...requests].reverse()).map((request) => request()));
      for (const r of settled) if (r.status === 'rejected') assert.equal(failure(r.reason), '404 not_found', `${round}번째: 삭제에 밀린 환불은 없는 주문이라는 거절이다`);
      assert.deepEqual(await tablesContaining(db, [me.userId]), [], `${round}번째: 어느 테이블에도 흔적이 없다`);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('환불·운영자 회수·장착이 겹쳐도 환불은 되고, 코인은 한 번만 돌아오고, 보유도 장착도 남지 않는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    for (let round = 0; round < 20; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 300);
      const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
      const settled = await Promise.allSettled([
        refund(db, orderId),
        equip(db, me.userId, 'pinball.table.sunset'),
        db.transaction((tx) => revoke(tx, { userId: me.userId, productId: 'pinball.table.sunset', reason: 'admin' })),
        equip(db, me.userId, 'pinball.table.sunset'),
      ]);
      const out = settled.map((r) => (r.status === 'fulfilled' ? 'ok' : failure(r.reason)));
      assert.equal(out[0], 'ok', `${round}번째: 환불은 늘 된다 (${out.join(' | ')})`);
      // 장착과 운영자 회수는 순서에 따라 밀릴 수 있다. 밀려도 규칙이 거절한 것이다
      for (const f of out.slice(1)) assert.ok(['ok', '403 not_owned', '409 not_owned'].includes(f), `${round}번째: ${out.join(' | ')}`);
      assert.equal(await getBalance(db, me.userId), 300, `${round}번째: 코인은 한 번만 돌아왔다`);
      assert.deepEqual(await listOwned(db, me.userId), [], `${round}번째`);
      assert.deepEqual(await listEquipped(db, me.userId), [], `${round}번째: 장착이 남지 않는다`);
      const types = (await eventsOf(db, orderId)).map((e) => e.type).join();
      // 환불이 회수했으면 revoked, 운영자가 먼저 회수했으면 note
      assert.ok(types === 'created,completed,granted,refunded,revoked' || types === 'created,completed,granted,refunded,note', `${round}번째: ${types}`);
    }
    assert.deepEqual(await verifyWallets(db), []);
  } finally {
    await close();
  }
});

test('환불과 같은 상품 다시 사기가 겹쳐도 완료된 주문 수가 켜진 보유 수와 같고 잔액이 맞는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    for (let round = 0; round < 20; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 300);
      const first = await buy(db, me.userId, 'pinball.table.sunset');
      const out = await together<unknown>([
        () => refund(db, first.orderId),
        () => buy(db, me.userId, 'pinball.table.sunset'),
        () => buy(db, me.userId, 'pinball.table.sunset', `rebuy-key-${round}`),
      ]);
      for (const f of out.failed) assert.ok(['409 already_owned', '409 insufficient_coins'].includes(f), `${round}번째: ${f}`);
      const owned = await listOwned(db, me.userId);
      const completed = (await ordersOf(db, me.userId)).filter((o) => o.status === 'completed').length;
      assert.equal(completed, owned.length, `${round}번째: 완료된 주문 수 = 켜진 보유 수`);
      // 코인은 300에서 시작했다: 지금 가졌으면 0, 아니면 300
      assert.equal(await getBalance(db, me.userId), owned.length === 1 ? 0 : 300, `${round}번째`);
      assert.deepEqual(await verifyWallets(db, me.userId), []);
    }
  } finally {
    await close();
  }
});

test('보관 기간 정리와 계정 삭제가 겹쳐도 둘 다 되고, 주문 없이 남은 사용자 행은 다음 정리 때 지워진다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    await seedShop(db);
    const now = new Date('2040-01-01T00:00:00Z');
    // 정리가 건드리면 안 되는 사람: 계정을 지우지 않은 사용자의 옛 현금 주문
    const alive = await loginGuest(db, NOW);
    const aliveOrder = await insertMoneyOrder(db, alive.userId, NOW);
    for (let round = 0; round < 16; round++) {
      const me = await loginGuest(db, NOW);
      await fund(db, me.userId, 1000);
      await buy(db, me.userId, 'pinball.table.sunset');
      await insertMoneyOrder(db, me.userId, NOW);
      const requests = [() => purgeExpired(db, now), () => deleteAccount(db, me.userId, policy, NOW)];
      const settled = await Promise.allSettled((round % 2 === 1 ? requests : [...requests].reverse()).map((request) => request()));
      assert.deepEqual(settled.map((r) => (r.status === 'fulfilled' ? 'ok' : failure(r.reason))), ['ok', 'ok'], `${round}번째`);
      // 삭제가 먼저 끝났으면 정리가 주문과 행을 지웠고, 아니면 deleted 행과 현금 주문이 남아 있다. 어느 쪽이든 한 번 더 돌리면 남는 것이 없다
      const user = await getUser(db, me.userId);
      assert.ok(user === null || user.status === 'deleted', `${round}번째: 계정은 지워졌다`);
      await purgeExpired(db, now);
      assert.deepEqual(await tablesContaining(db, [me.userId]), [], `${round}번째`);
    }
    assert.deepEqual((await ordersOf(db, alive.userId)).map((o) => o.id), [aliveOrder]);
    assert.equal((await getUser(db, alive.userId))?.status, 'active');
  } finally {
    await close();
  }
});
