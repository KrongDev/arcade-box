import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteAccount, getUser, type DeletionPolicy } from '../../src/account/index.ts';
import { adminActions } from '../../src/admin/schema.ts';
import { grant, listOwned, revoke } from '../../src/entitlement/index.ts';
import { commands, hasMoneyOrders, purgeUser } from '../../src/order/index.ts';
import { runCli } from '../../src/shared/cli/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { getBalance } from '../../src/wallet/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeIo } from '../helpers/cli.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { buy, CHEAP, counts, DAY_MS, eventsOf, fund, insertMoneyOrder, NOW, ordersOf, SECRET_TOKEN, seedShop } from './helpers.ts';

const ACTOR = 'ops-kim';
const clock = fakeClock('2031-11-26T03:00:00Z');

async function run(db: Db, argv: string[], answer = true) {
  const io = fakeIo(answer);
  const code = await runCli(argv, commands(db, ACTOR, clock), io);
  return { code, text: io.text(), questions: io.questions };
}

async function withShop(body: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await testDb();
  try {
    await seedShop(db);
    await body(db);
  } finally {
    await close();
  }
}

const actions = (db: Db) => db.select().from(adminActions).orderBy(adminActions.id);
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

test('order list와 order show는 읽기만 한다: 주문과 사건을 보여 주고 admin_actions를 남기지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    await fund(db, other.userId, 1000);
    const mine = (await buy(db, me.userId, 'pinball.table.sunset', undefined, at(1))).orderId;
    const money = await insertMoneyOrder(db, me.userId, at(2));
    const theirs = (await buy(db, other.userId, CHEAP[0], undefined, at(3))).orderId;

    // 모든 사용자의 최근 주문 (최신부터)
    const all = await run(db, ['order', 'list']);
    assert.equal(all.code, 0, all.text);
    const lines = all.text.split('\n').filter((line) => [theirs, money, mine].some((id) => line.includes(id)));
    assert.deepEqual(lines.map((line) => [theirs, money, mine].find((id) => line.includes(id))), [theirs, money, mine]);
    assert.match(all.text, /pinball\.table\.sunset/);
    assert.match(all.text, /COIN 300/);
    assert.match(all.text, /KRW 1200/);

    // 한 사용자의 주문만
    const one = await run(db, ['order', 'list', '--user', me.userId]);
    assert.equal(one.code, 0, one.text);
    assert.ok(one.text.includes(mine) && one.text.includes(money) && !one.text.includes(theirs));
    const limited = await run(db, ['order', 'list', '--limit', '1']);
    assert.ok(limited.text.includes(theirs) && !limited.text.includes(mine));
    assert.match((await run(db, ['order', 'list', '--user', '00000000-0000-4000-8000-000000000000'])).text, /주문이 없어요/);

    // 주문 하나와 그 사건
    const shown = await run(db, ['order', 'show', mine]);
    assert.equal(shown.code, 0, shown.text);
    assert.ok(shown.text.includes(mine) && shown.text.includes(me.userId));
    assert.match(shown.text, /노을/);
    assert.match(shown.text, /completed/);
    for (const type of ['created', 'completed', 'granted']) assert.match(shown.text, new RegExp(`\\b${type}\\b`));

    // 현금 주문: 스토어 상품 코드와 주문 번호는 보이고, 토큰과 영수증 원문은 보이지 않는다
    const paid = await run(db, ['order', 'show', money]);
    assert.equal(paid.code, 0, paid.text);
    assert.match(paid.text, /google_play/);
    assert.match(paid.text, /pinball_ball_gold/);
    for (const text of [all.text, one.text, shown.text, paid.text]) {
      assert.ok(!text.includes(SECRET_TOKEN) && !text.includes('receipt-signature-SECRET'));
    }

    // 틀린 인자
    for (const argv of [['order', 'show'], ['order', 'show', 'not-a-uuid'], ['order', 'show', mine, 'extra'], ['order', 'list', 'extra'], ['order', 'list', '--user', 'not-a-uuid'], ['order', 'list', '--limit', '0'], ['order', 'list', '--limit', 'abc']]) {
      assert.equal((await run(db, argv)).code, 1, argv.join(' '));
    }
    const missing = await run(db, ['order', 'show', '00000000-0000-4000-8000-000000000000']);
    assert.equal(missing.code, 1);
    assert.match(missing.text, /없는 주문/);

    assert.deepEqual(await actions(db), []);
  }));

test('order refund는 코인을 돌려주고 보유를 회수하며, admin_actions와 그 번호가 달린 사건을 남긴다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');

    const out = await run(db, ['order', 'refund', orderId, '--reason', '잘못 샀다는 문의', '--yes']);
    assert.equal(out.code, 0, out.text);
    // 요약에 누구의 무엇을 얼마에 산 주문인지 보인다
    assert.ok(out.text.includes(orderId) && out.text.includes(me.userId));
    assert.match(out.text, /pinball\.table\.sunset/);
    assert.match(out.text, /300/);

    const acts = await actions(db);
    assert.equal(acts.length, 1);
    assert.deepEqual(
      { actor: acts[0].actor, action: acts[0].action, targetUserId: acts[0].targetUserId, targetRef: acts[0].targetRef, reason: acts[0].reason, params: acts[0].params },
      { actor: ACTOR, action: 'order.refund', targetUserId: me.userId, targetRef: orderId, reason: '잘못 샀다는 문의', params: { positional: [orderId], flags: {} } },
    );
    assert.match(out.text, new RegExp(`운영 기록 #${acts[0].id}`));
    assert.equal(await getBalance(db, me.userId), 1000);
    assert.deepEqual(await listOwned(db, me.userId), []);
    const [order] = await ordersOf(db, me.userId);
    assert.equal(order.status, 'refunded');
    // 환불한 시각은 명령에 넣어 준 시계의 지금이다
    assert.equal(order.refundedAt?.toISOString(), clock().toISOString());
    const events = await eventsOf(db, orderId);
    assert.deepEqual(events.slice(3).map((e) => [e.type, e.actor, e.adminActionId]), [['refunded', 'admin', acts[0].id], ['revoked', 'admin', acts[0].id]]);

    // 두 번째 환불은 묻기 전에 거절되고 운영 기록도 남지 않는다
    const again = await run(db, ['order', 'refund', orderId, '--reason', '또', '--yes']);
    assert.equal(again.code, 1);
    assert.match(again.text, /이미 환불/);
    assert.deepEqual(again.questions, []);
    assert.equal((await actions(db)).length, 1);
    assert.equal(await getBalance(db, me.userId), 1000);
  }));

test('order refund는 까닭이 없거나 인자가 틀리거나 환불할 수 없는 주문이면 묻기 전에 거절하고, 그만두면 아무것도 바꾸지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const { orderId } = await buy(db, me.userId, 'pinball.table.sunset');
    const money = await insertMoneyOrder(db, me.userId, NOW);
    const before = await counts(db, me.userId);

    const rejected: Array<[string[], RegExp]> = [
      [['order', 'refund', orderId], /--reason/],
      [['order', 'refund', orderId, '--reason', '  '], /--reason/],
      [['order', 'refund', '--reason', '까닭'], /order refund <주문ID>/],
      [['order', 'refund', orderId, 'extra', '--reason', '까닭'], /order refund <주문ID>/],
      [['order', 'refund', 'not-a-uuid', '--reason', '까닭'], /주문 ID 모양/],
      [['order', 'refund', '00000000-0000-4000-8000-000000000000', '--reason', '까닭'], /없는 주문/],
      [['order', 'refund', money, '--reason', '까닭'], /코인으로 산 주문만/],
    ];
    for (const [argv, message] of rejected) {
      const out = await run(db, argv);
      assert.equal(out.code, 1, argv.join(' '));
      assert.match(out.text, message, argv.join(' '));
      assert.deepEqual(out.questions, [], `${argv.join(' ')}: 확인을 묻기 전에 거절한다`);
    }

    // 확인에 "아니오"
    const no = await run(db, ['order', 'refund', orderId, '--reason', '까닭'], false);
    assert.equal(no.code, 1);
    assert.equal(no.questions.length, 1);
    assert.match(no.text, /아무것도 바뀌지 않았어요/);

    assert.deepEqual(await counts(db, me.userId), before);
    assert.deepEqual(await actions(db), []);
    assert.equal((await ordersOf(db, me.userId)).find((o) => o.id === orderId)?.status, 'completed');
  }));

test('order refund의 요약은 실제로 할 일을 말한다: 이미 회수된 보유는 회수한다고 하지 않고, 가격이 0이던 주문은 코인을 돌려준다고 하지 않는다', () =>
  withShop(async (db) => {
    const me = await loginGuest(db, NOW);
    await fund(db, me.userId, 1000);
    const normal = (await buy(db, me.userId, 'pinball.table.sunset')).orderId;
    const revoked = (await buy(db, me.userId, CHEAP[0])).orderId;
    const regranted = (await buy(db, me.userId, CHEAP[1])).orderId;
    const free = (await buy(db, me.userId, 'pinball.ball.free')).orderId;
    await db.transaction(async (tx) => {
      await revoke(tx, { userId: me.userId, productId: CHEAP[0], reason: 'admin' });
      // 회수한 뒤 다시 준 것: 지금 켜진 보유는 그 주문이 만든 것이 아니다
      await revoke(tx, { userId: me.userId, productId: CHEAP[1], reason: 'admin' });
      await grant(tx, { userId: me.userId, productId: CHEAP[1], source: 'grant' });
    });
    // 요약만 본다 (확인에 "아니오")
    const summary = async (orderId: string) => (await run(db, ['order', 'refund', orderId, '--reason', '까닭'], false)).text.split('\n')[0];

    const a = await summary(normal);
    assert.match(a, /300코인을 돌려주고/);
    assert.match(a, /회수해요/);
    assert.match(a, /장착/);

    for (const orderId of [revoked, regranted]) {
      const b = await summary(orderId);
      assert.match(b, /300코인/);
      assert.match(b, /이미 회수/);
      assert.match(b, /코인만 돌려줘요/);
      assert.doesNotMatch(b, /장착/);
    }

    const c = await summary(free);
    assert.doesNotMatch(c, /0코인을 돌려/);
    assert.match(c, /돌려줄 코인은 없/);
    assert.match(c, /회수해요/);

    // 요약대로 된다: 다시 받은 보유는 그대로이고, 끝난 뒤의 말도 실제와 같다
    const done = await run(db, ['order', 'refund', regranted, '--reason', '까닭', '--yes']);
    assert.equal(done.code, 0, done.text);
    assert.match(done.text, /300코인을 돌려줬어요/);
    assert.ok((await listOwned(db, me.userId)).includes(CHEAP[1]));
    const freed = await run(db, ['order', 'refund', free, '--reason', '까닭', '--yes']);
    assert.equal(freed.code, 0, freed.text);
    assert.doesNotMatch(freed.text, /0코인/);
  }));

test('orders purge-expired는 계정을 지운 사용자의 5년 지난 현금 주문과 주문이 남지 않은 deleted 사용자 행을 지우고 admin_actions에 남긴다', () =>
  withShop(async (db) => {
    const policy: DeletionPolicy = { mustKeepUserRow: hasMoneyOrders, purge: [purgeUser] };
    const now = clock();
    const fiveYearsAgo = new Date(now);
    fiveYearsAgo.setUTCFullYear(now.getUTCFullYear() - 5);
    const old = new Date(fiveYearsAgo.getTime() - DAY_MS);
    const short = new Date(fiveYearsAgo.getTime() + DAY_MS);

    const gone = await loginGuest(db, NOW);
    await insertMoneyOrder(db, gone.userId, old);
    const stay = await loginGuest(db, NOW);
    await insertMoneyOrder(db, stay.userId, old);
    const kept = await insertMoneyOrder(db, stay.userId, short);
    await deleteAccount(db, gone.userId, policy, NOW);
    await deleteAccount(db, stay.userId, policy, NOW);
    // 계정을 지우지 않은 사용자의 옛 현금 주문: 이 명령이 지우지 않는다
    const alive = await loginGuest(db, NOW);
    const aliveOrder = await insertMoneyOrder(db, alive.userId, old);

    // 까닭이 없으면 거절, 자리 인자는 받지 않는다
    assert.equal((await run(db, ['orders', 'purge-expired'])).code, 1);
    assert.equal((await run(db, ['orders', 'purge-expired', 'all', '--reason', '까닭', '--yes'])).code, 1);
    assert.equal((await run(db, ['orders', 'purge-expired', '--reason', '까닭'], false)).code, 1);
    assert.equal((await ordersOf(db, gone.userId)).length, 1);
    assert.deepEqual(await actions(db), []);

    const out = await run(db, ['orders', 'purge-expired', '--reason', '보관 기간 정리', '--yes']);
    assert.equal(out.code, 0, out.text);
    // 묻기 전에 몇 개를 지울지와 기준 시각을 보여 준다
    assert.match(out.text, /2개/);
    assert.match(out.text, /2026-11-26/);
    assert.match(out.text, /계정을 지운 사용자/);
    assert.match(out.text, /주문 2개/);
    assert.match(out.text, /사용자 행 1개/);

    assert.equal(await getUser(db, gone.userId), null);
    assert.equal((await getUser(db, stay.userId))?.status, 'deleted');
    assert.deepEqual((await ordersOf(db, stay.userId)).map((o) => o.id), [kept]);
    const acts = await actions(db);
    assert.deepEqual(acts.map((a) => [a.actor, a.action, a.reason]), [[ACTOR, 'orders.purge-expired', '보관 기간 정리']]);
    // 운영 기록에 무엇을 기준으로 지웠는지가 남는다 (되돌릴 수 없는 삭제라 나중에 답할 수 있게): 기준 시각과 그때 센 주문 수
    assert.equal(acts[0].targetRef, 'until=2026-11-26T03:00:00.000Z orders=2');
    assert.deepEqual((await ordersOf(db, alive.userId)).map((o) => o.id), [aliveOrder]);
    assert.equal((await getUser(db, alive.userId))?.status, 'active');

    // 지울 것이 없어도 돌릴 수 있다
    const again = await run(db, ['orders', 'purge-expired', '--reason', '다시', '--yes']);
    assert.equal(again.code, 0, again.text);
    assert.match(again.text, /주문 0개/);
  }));
