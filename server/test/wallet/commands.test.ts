import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { test } from 'node:test';
import { deleteAccount } from '../../src/account/index.ts';
import { adminActions } from '../../src/admin/schema.ts';
import { runCli } from '../../src/shared/cli/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { commands, getBalance, purgeUser } from '../../src/wallet/index.ts';
import { coinLedger } from '../../src/wallet/schema.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeIo } from '../helpers/cli.ts';
import { testDb } from '../helpers/db.ts';
import { dumpAppSchema } from '../helpers/scan.ts';
import { apply, ledgerOf, MAX_BALANCE, NOW, totals } from './helpers.ts';

const ACTOR = 'ops-kim';

/** 명령을 한 번 부른다. 종료 코드와 나온 글, 받은 질문을 준다 */
async function run(db: Db, argv: string[], answer = true) {
  const io = fakeIo(answer);
  const code = await runCli(argv, commands(db, ACTOR), io);
  return { code, text: io.text(), questions: io.questions };
}

const actions = (db: Db) => db.select().from(adminActions).orderBy(adminActions.id);

test('coins adjust는 admin_actions와 그 번호가 달린 코인 기록을 한 줄씩 남긴다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);

    const out = await run(db, ['coins', 'adjust', me.userId, '500', '--reason', '테스터 보상', '--yes']);
    assert.equal(out.code, 0, out.text);

    const acts = await actions(db);
    assert.equal(acts.length, 1);
    assert.deepEqual(
      { actor: acts[0].actor, action: acts[0].action, targetUserId: acts[0].targetUserId, reason: acts[0].reason, params: acts[0].params },
      { actor: ACTOR, action: 'coins.adjust', targetUserId: me.userId, reason: '테스터 보상', params: { positional: [me.userId, '500'], flags: {} } },
    );
    const rows = await ledgerOf(db, me.userId);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { delta: rows[0].delta, balanceAfter: rows[0].balanceAfter, reason: rows[0].reason, adminActionId: rows[0].adminActionId, idempotencyKey: rows[0].idempotencyKey },
      { delta: 500, balanceAfter: 500, reason: 'grant', adminActionId: acts[0].id, idempotencyKey: null },
    );
    assert.equal(await getBalance(db, me.userId), 500);
    assert.deepEqual(await totals(db, other.userId), { balance: null, sum: 0, last: null, count: 0 }, '다른 사용자는 그대로다');
    // 무엇을 할지 미리 보여 주고, 끝난 뒤 잔액과 운영 기록 번호를 알려 준다
    assert.match(out.text, /\[coins\.adjust\]/);
    assert.match(out.text, new RegExp(me.userId));
    assert.match(out.text, /0 → 500/);
    assert.match(out.text, new RegExp(`운영 기록 #${acts[0].id}`));

    // 한 번 더: 운영 기록도 코인 기록도 한 줄씩 늘고 서로 짝이 맞는다
    assert.equal((await run(db, ['coins', 'adjust', me.userId, '-120', '--reason', '잘못 준 것 회수', '--yes'])).code, 0);
    const acts2 = await actions(db);
    const rows2 = await ledgerOf(db, me.userId);
    assert.equal(acts2.length, 2);
    assert.equal(rows2.length, 2);
    assert.deepEqual(rows2.map((r) => r.adminActionId), acts2.map((a) => a.id));
    assert.deepEqual({ delta: rows2[1].delta, balanceAfter: rows2[1].balanceAfter, reason: rows2[1].reason }, { delta: -120, balanceAfter: 380, reason: 'adjust' });
    assert.equal(acts2[1].reason, '잘못 준 것 회수');
  } finally {
    await close();
  }
});

test('coins adjust: 양수는 grant, 음수는 adjust로 적는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const steps: Array<[string, number, string, number]> = [
      ['1000', 1000, 'grant', 1000],
      ['+50', 50, 'grant', 1050],
      ['-300', -300, 'adjust', 750],
      ['-750', -750, 'adjust', 0],
      ['007', 7, 'grant', 7],
    ];
    for (const [text, delta, reason, balance] of steps) {
      const out = await run(db, ['coins', 'adjust', me.userId, text, '--reason', '확인', '--yes']);
      assert.equal(out.code, 0, `${text}: ${out.text}`);
      const last = (await ledgerOf(db, me.userId)).at(-1)!;
      assert.deepEqual({ delta: last.delta, reason: last.reason, balanceAfter: last.balanceAfter }, { delta, reason, balanceAfter: balance }, text);
      assert.match(out.text, new RegExp(`${balance - delta} → ${balance}`), text);
    }
    assert.equal((await actions(db)).length, steps.length);
    // --reason을 앞에 적어도 음수 증감은 자리 인자로 읽힌다
    assert.equal((await run(db, ['coins', 'adjust', '--reason', '순서 바꿔 적기', '--yes', me.userId, '-7'])).code, 0);
    assert.equal(await getBalance(db, me.userId), 0);
  } finally {
    await close();
  }
});

test('coins adjust: 잔액보다 많이 빼려 하면 거절하고 admin_actions도 코인 기록도 남지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const fresh = await loginGuest(db, NOW);
    await apply(db, { userId: me.userId, delta: 100, reason: 'run' });
    const before = await dumpAppSchema(db);

    const out = await run(db, ['coins', 'adjust', me.userId, '-101', '--reason', '너무 많이 빼기', '--yes']);
    assert.equal(out.code, 1);
    assert.match(out.text, /100/, '지금 잔액을 알려 준다');
    assert.doesNotMatch(out.text, /운영 기록 #/);
    // 지갑이 없는 사용자
    assert.equal((await run(db, ['coins', 'adjust', fresh.userId, '-1', '--reason', '없는 지갑', '--yes'])).code, 1);
    // 상한을 넘기는 지급
    const over = await run(db, ['coins', 'adjust', me.userId, String(MAX_BALANCE), '--reason', '상한 넘기기', '--yes']);
    assert.equal(over.code, 1);
    assert.doesNotMatch(over.text, /at .*\.ts/, '스택이 아니라 메시지로 거절한다');

    assert.deepEqual(await dumpAppSchema(db), before, '아무것도 바뀌지 않았다');
    assert.deepEqual(await actions(db), []);
    // 딱 잔액만큼은 뺄 수 있다
    assert.equal((await run(db, ['coins', 'adjust', me.userId, '-100', '--reason', '전부 회수', '--yes'])).code, 0);
    assert.equal(await getBalance(db, me.userId), 0);
  } finally {
    await close();
  }
});

test('coins adjust: 인자가 틀리면 확인을 묻기 전에 거절하고 아무것도 남기지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    await apply(db, { userId: me.userId, delta: 100, reason: 'run' });
    const before = await dumpAppSchema(db);
    const bad: string[][] = [
      [me.userId, '0'],
      [me.userId, '-0'],
      [me.userId, '+0'],
      [me.userId, '1.5'],
      [me.userId, '1e3'],
      [me.userId, '0x10'],
      [me.userId, 'abc'],
      [me.userId, ''],
      [me.userId, '1,000'],
      [me.userId, '--5'],
      [me.userId, '9000000000000001'], // 상한보다 큰 증감
      [me.userId, '99999999999999999999'],
      [me.userId], // 증감이 없다
      [], // 아무것도 없다
      [me.userId, '10', '20'], // 인자가 많다
      ['not-a-user-id', '10'],
      ['10', me.userId], // 순서가 바뀜
    ];
    for (const args of bad) {
      // --yes 없이 부른다: 틀린 인자라면 "실행할까요?"까지 가지 않아야 한다
      const out = await run(db, ['coins', 'adjust', ...args, '--reason', '틀린 인자']);
      assert.equal(out.code, 1, args.join(' '));
      assert.deepEqual(out.questions, [], `확인을 묻지 않는다: ${args.join(' ')}`);
      assert.doesNotMatch(out.text, /at .*\.ts/, `스택이 아니라 메시지: ${args.join(' ')}`);
    }
    // 까닭이 없으면 거절한다
    const noReason = await run(db, ['coins', 'adjust', me.userId, '10', '--yes']);
    assert.equal(noReason.code, 1);
    assert.match(noReason.text, /--reason/);
    assert.deepEqual(await dumpAppSchema(db), before);
  } finally {
    await close();
  }
});

test('coins adjust: 확인에 아니오라고 하면 아무것도 바뀌지 않고, 예라고 하면 반영된다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const before = await dumpAppSchema(db);
    const no = await run(db, ['coins', 'adjust', me.userId, '300', '--reason', '보상'], false);
    assert.equal(no.code, 1);
    assert.equal(no.questions.length, 1);
    assert.match(no.text, /300/, '묻기 전에 무엇을 할지 보여 준다');
    assert.match(no.text, new RegExp(me.userId));
    assert.deepEqual(await dumpAppSchema(db), before);

    const yes = await run(db, ['coins', 'adjust', me.userId, '300', '--reason', '보상'], true);
    assert.equal(yes.code, 0, yes.text);
    assert.equal(yes.questions.length, 1);
    assert.equal(await getBalance(db, me.userId), 300);
  } finally {
    await close();
  }
});

test('coins adjust: 없는 사용자와 지워진 사용자에게는 거절하고 아무것도 남기지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const kept = await loginGuest(db, NOW);
    await deleteAccount(db, kept.userId, { mustKeepUserRow: async () => true, purge: [purgeUser] }, NOW);
    const before = await dumpAppSchema(db);
    for (const userId of [randomUUID(), kept.userId]) {
      const out = await run(db, ['coins', 'adjust', userId, '100', '--reason', '없는 사용자', '--yes']);
      assert.equal(out.code, 1, userId);
      assert.match(out.text, /없는 사용자|지워진 사용자/, out.text);
      assert.doesNotMatch(out.text, /로그인/, '운영자에게 로그인하라고 하지 않는다');
    }
    assert.deepEqual(await dumpAppSchema(db), before);
    assert.deepEqual(await actions(db), []);
    assert.deepEqual(await db.select().from(coinLedger), []);
  } finally {
    await close();
  }
});

test('wallet verify 명령: 멀쩡하면 0으로 끝나고, 어긋난 지갑이 있으면 한 줄씩 보여 주고 1로 끝난다', async () => {
  const { db, close } = await testDb();
  try {
    const a = await loginGuest(db, NOW);
    const b = await loginGuest(db, NOW);
    await apply(db, { userId: a.userId, delta: 100, reason: 'run' });
    await apply(db, { userId: b.userId, delta: 500, reason: 'grant' });

    const clean = await run(db, ['wallet', 'verify']);
    assert.equal(clean.code, 0, clean.text);
    assert.match(clean.text, /어긋난 지갑이 없어요/);
    assert.deepEqual(clean.questions, [], '읽기만 하니 확인도 까닭도 묻지 않는다');

    await db.execute(sql`update app.wallets set balance = 999 where user_id = ${a.userId}`);
    const before = await dumpAppSchema(db);
    const broken = await run(db, ['wallet', 'verify']);
    assert.equal(broken.code, 1, '점검에 걸리면 0이 아닌 값으로 끝난다');
    const line = broken.text.split('\n').find((l) => l.includes(a.userId));
    assert.ok(line, broken.text);
    assert.match(line, /999/);
    assert.match(line, /100/);
    assert.doesNotMatch(broken.text, new RegExp(b.userId), '멀쩡한 지갑은 보여 주지 않는다');
    assert.doesNotMatch(broken.text, /at .*\.ts/);

    // 사용자 하나만 보기
    assert.equal((await run(db, ['wallet', 'verify', b.userId])).code, 0);
    assert.equal((await run(db, ['wallet', 'verify', a.userId])).code, 1);
    // 사용자 ID 모양이 아니거나 없는 사용자면 알려 준다 (DB 오류의 스택이 아니라)
    for (const bad of ['not-a-user-id', randomUUID()]) {
      const out = await run(db, ['wallet', 'verify', bad]);
      assert.equal(out.code, 1, bad);
      assert.match(out.text, /없는 사용자/);
      assert.doesNotMatch(out.text, /at .*\.ts/);
    }
    assert.equal((await run(db, ['wallet', 'verify', a.userId, b.userId])).code, 1, '인자는 하나까지만');

    assert.deepEqual(await dumpAppSchema(db), before, '읽기만 한다: 운영 기록도 남기지 않고 어긋난 것을 고치지도 않는다');
    assert.deepEqual(await actions(db), []);
  } finally {
    await close();
  }
});

test('쓰는 법: 모르는 명령이면 coins adjust와 wallet verify가 목록에 보인다', async () => {
  const { db, close } = await testDb();
  try {
    const out = await run(db, ['coins']);
    assert.equal(out.code, 1);
    assert.match(out.text, /coins adjust <userId> <증감> --reason/);
    assert.match(out.text, /wallet verify \[userId\]/);
  } finally {
    await close();
  }
});
