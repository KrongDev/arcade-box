import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devVerifier, issueNonce, linkIdentity } from '../../src/account/index.ts';
import { adminActions } from '../../src/admin/schema.ts';
import { purchaseWithCoins } from '../../src/order/index.ts';
import { runCli } from '../../src/shared/cli/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { commands } from '../../src/view/index.ts';
import { applyCoins } from '../../src/wallet/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { gameKit } from '../game/helpers.ts';
import { fakeIo } from '../helpers/cli.ts';
import { NOW, seedView } from './helpers.ts';

async function run(db: Db, argv: string[]) {
  const io = fakeIo();
  const code = await runCli(argv, commands(db), io);
  return { code, text: io.text(), questions: io.questions };
}

const actionCount = async (db: Db) => (await db.select().from(adminActions)).length;

test('user show는 잔액·가진 것·최근 코인 기록과 주문을 보여 주고 admin_actions를 남기지 않는다', async () => {
  const kit = await gameKit();
  const { db } = kit;
  try {
    await seedView(kit);
    const me = await loginGuest(db, NOW);
    await db.transaction((tx) => applyCoins(tx, { userId: me.userId, delta: 2000, reason: 'grant', now: NOW }));
    const bought = await purchaseWithCoins(db, me.userId, { productId: 'pinball.table.sunset' }, NOW);

    const out = await run(db, ['user', 'show', me.userId]);
    assert.equal(out.code, 0, out.text);
    assert.match(out.text, new RegExp(me.userId));
    assert.match(out.text, /active/);
    assert.match(out.text, /수단: guest/);
    assert.match(out.text, /잔액: 1000/);
    assert.match(out.text, /가진 상품: pinball\.table\.sunset/);
    // 최근 코인 기록: 지급 +2000, 구매 −1000
    assert.match(out.text, /\+2000 grant/);
    assert.match(out.text, /-1000 purchase/);
    // 최근 주문
    assert.match(out.text, new RegExp(bought.orderId));
    assert.match(out.text, /pinball\.table\.sunset COIN 1000 completed/);

    // 읽기만 한다: 묻지 않고, 운영 기록도 남기지 않는다
    assert.deepEqual(out.questions, []);
    assert.equal(await actionCount(db), 0);
  } finally {
    await kit.close();
  }
});

test('user show는 없는 사용자와 사용자 ID 모양이 아닌 값을 DB 오류 없이 거절한다', async () => {
  const kit = await gameKit();
  try {
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid', "1' or '1'='1"]) {
      const out = await run(kit.db, ['user', 'show', id]);
      assert.equal(out.code, 1, id);
      assert.match(out.text, /없는 사용자예요/);
    }
    const none = await run(kit.db, ['user', 'show']);
    assert.equal(none.code, 1);
    assert.match(none.text, /user show <userId>/);
  } finally {
    await kit.close();
  }
});

test('user find는 연결된 구글 sub로 사용자 ID를 찾고, 없으면 없다고 말하며 1로 끝난다', async () => {
  const kit = await gameKit();
  const { db } = kit;
  try {
    const me = await loginGuest(db, NOW);
    const nonce = await issueNonce(db, me.userId, NOW);
    await linkIdentity(db, me.session, { provider: 'google', idToken: `dev:google-sub-1:${nonce}` }, devVerifier(), NOW, async () => ({ coins: 0, games: 0 }));

    const found = await run(db, ['user', 'find', '--provider', 'google', '--sub', 'google-sub-1']);
    assert.equal(found.code, 0, found.text);
    assert.match(found.text, new RegExp(me.userId));

    const missing = await run(db, ['user', 'find', '--provider', 'google', '--sub', 'google-sub-2']);
    assert.equal(missing.code, 1);
    assert.match(missing.text, /연결된 사용자가 없어요/);

    // 모양이 틀린 입력
    for (const argv of [
      ['user', 'find', '--sub', 'google-sub-1'],
      ['user', 'find', '--provider', 'guest', '--sub', 'x'],
      ['user', 'find', '--provider', 'google'],
    ]) {
      const bad = await run(db, argv);
      assert.equal(bad.code, 1, argv.join(' '));
    }
    assert.equal(await actionCount(db), 0);
  } finally {
    await kit.close();
  }
});
