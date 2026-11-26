import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { test } from 'node:test';
import { audit, mutation } from '../../src/admin/index.ts';
import { adminActions } from '../../src/admin/schema.ts';
import { runCli, type Command } from '../../src/shared/cli/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { fakeIo } from '../helpers/cli.ts';
import { testDb } from '../helpers/db.ts';

const USER = '3f2a9c1e-7b4d-4e8a-9c1e-7b4d4e8a9c1e';

/** 테스트용 "바꾸는 명령": `thing set <n>`은 app.things에 한 줄을 넣는다 */
async function setup() {
  const { db, close } = await testDb();
  await db.execute(sql`CREATE TABLE app.things (n int NOT NULL, action_id bigint NOT NULL)`);
  const seenActionIds: number[] = [];
  const commands: Command[] = [
    {
      name: 'thing set',
      usage: 'thing set <n> --reason <까닭> [--yes]',
      run: mutation(db, 'ops-kim', {
        action: 'thing.set',
        describe: (args) => `물건을 ${args.positional[0]}(으)로 바꿔요`,
        target: (args) => ({ userId: typeof args.flags.user === 'string' ? args.flags.user : undefined, ref: `thing:${args.positional[0]}` }),
        apply: async (tx, args, adminActionId) => {
          seenActionIds.push(adminActionId);
          await tx.execute(sql`INSERT INTO app.things VALUES (${Number(args.positional[0])}, ${adminActionId})`);
          if (args.flags.fail === 'rule') throw new RuleError(409, 'nope', '할 수 없어요');
          if (args.flags.fail === 'crash') throw new Error('뜻밖의 오류');
          return { n: Number(args.positional[0]) };
        },
        report: (r) => `물건이 ${r.n}이 됐어요`,
      }),
    },
  ];
  return { db, close, commands, seenActionIds };
}

async function things(db: Db): Promise<number[]> {
  const out = (await db.execute(sql`SELECT n FROM app.things ORDER BY n`)) as { rows: Array<{ n: number }> };
  return out.rows.map((r) => r.n);
}

const actions = (db: Db) => db.select().from(adminActions).orderBy(adminActions.id);

test('--reason 없이 바꾸는 명령을 부르면 실패하고 아무것도 바뀌지 않는다', async () => {
  const { db, close, commands } = await setup();
  try {
    for (const argv of [
      ['thing', 'set', '5', '--yes'],
      ['thing', 'set', '5'],
      ['thing', 'set', '5', '--yes', '--reason'], // 값이 없다
      ['thing', 'set', '5', '--reason=', '--yes'],
      ['thing', 'set', '5', '--reason', '   ', '--yes'],
    ]) {
      const io = fakeIo();
      assert.equal(await runCli(argv, commands, io), 1, argv.join(' '));
      assert.match(io.text(), /--reason/);
      assert.deepEqual(io.questions, [], '까닭이 없으면 확인도 묻지 않는다');
    }
    assert.deepEqual(await things(db), []);
    assert.deepEqual(await actions(db), []);
  } finally {
    await close();
  }
});

test('요약을 보여 주고 확인을 묻는다. 아니오면 아무것도 바뀌지 않는다', async () => {
  const { db, close, commands } = await setup();
  try {
    const no = fakeIo(false);
    assert.equal(await runCli(['thing', 'set', '5', '--reason', '시험'], commands, no), 1);
    assert.equal(no.questions.length, 1);
    assert.ok(no.text().includes('물건을 5(으)로 바꿔요'), '요약이 보여야 한다');
    assert.ok(no.text().includes('시험'), '까닭이 보여야 한다');
    assert.deepEqual(await things(db), []);
    assert.deepEqual(await actions(db), []);

    const yes = fakeIo(true);
    assert.equal(await runCli(['thing', 'set', '5', '--reason', '시험'], commands, yes), 0);
    assert.equal(yes.questions.length, 1);
    // 요약은 확인을 묻기 전에 나온다
    assert.ok(yes.lines.findIndex((l) => l.includes('물건을 5(으)로 바꿔요')) < yes.lines.findIndex((l) => l.includes('물건이 5이 됐어요')));
    assert.deepEqual(await things(db), [5]);
    assert.equal((await actions(db)).length, 1);
  } finally {
    await close();
  }
});

test('--yes면 묻지 않는다', async () => {
  const { db, close, commands } = await setup();
  try {
    const io = fakeIo(false); // 물으면 아니오라고 답할 테니, 바뀌었다면 묻지 않은 것이다
    assert.equal(await runCli(['thing', 'set', '7', '--reason', '시험', '--yes'], commands, io), 0);
    assert.deepEqual(io.questions, []);
    assert.ok(io.text().includes('물건을 7(으)로 바꿔요'), '묻지 않아도 요약은 보여 준다');
    assert.ok(io.text().includes('물건이 7이 됐어요'));
    assert.deepEqual(await things(db), [7]);
  } finally {
    await close();
  }
});

test('바꾸는 명령 하나에 admin_actions가 한 줄 생기고 actor·action·params·reason이 들어 있다', async () => {
  const { db, close, commands, seenActionIds } = await setup();
  try {
    const io = fakeIo();
    assert.equal(await runCli(['thing', 'set', '5', '--user', USER, '--note', '메모', '--reason', '문의 #12 보상', '--yes'], commands, io), 0);
    assert.equal(await runCli(['thing', 'set', '6', '--reason', '두 번째', '--yes'], commands, fakeIo()), 0);

    const rows = await actions(db);
    assert.equal(rows.length, 2, '명령 하나에 한 줄');
    const [first, second] = rows;
    assert.equal(first.actor, 'ops-kim');
    assert.equal(first.action, 'thing.set');
    assert.equal(first.reason, '문의 #12 보상');
    assert.equal(first.targetUserId, USER);
    assert.equal(first.targetRef, 'thing:5');
    // params는 받은 인자 그대로다. 까닭(따로 열이 있다)과 --yes는 뺀다
    assert.deepEqual(first.params, { positional: ['5'], flags: { user: USER, note: '메모' } });
    assert.ok(first.createdAt instanceof Date);
    assert.equal(second.targetUserId, null);
    assert.deepEqual(second.params, { positional: ['6'], flags: {} });

    // apply는 자기 운영 기록의 번호를 받는다 (코인 기록·보유가 그 번호를 가리킨다)
    assert.deepEqual(seenActionIds, [first.id, second.id]);
    assert.ok(io.text().includes(`#${first.id}`), '끝나면 운영 기록 번호를 보여 준다');
  } finally {
    await close();
  }
});

test('apply가 던지면 admin_actions도 남지 않는다 (같은 트랜잭션)', async () => {
  const { db, close, commands } = await setup();
  try {
    const rule = fakeIo();
    assert.equal(await runCli(['thing', 'set', '5', '--fail', 'rule', '--reason', '시험', '--yes'], commands, rule), 1);
    assert.ok(rule.text().includes('할 수 없어요'));
    assert.ok(!rule.text().includes('됐어요'));

    const crash = fakeIo();
    assert.equal(await runCli(['thing', 'set', '6', '--fail', 'crash', '--reason', '시험', '--yes'], commands, crash), 1);
    assert.match(crash.text(), /Error: 뜻밖의 오류/);

    assert.deepEqual(await things(db), []);
    assert.deepEqual(await actions(db), []);
  } finally {
    await close();
  }
});

test('대상 사용자가 사용자 ID 모양이 아니면 거절하고 아무것도 남지 않는다', async () => {
  const { db, close, commands } = await setup();
  try {
    const io = fakeIo();
    assert.equal(await runCli(['thing', 'set', '5', '--user', 'kim', '--reason', '시험', '--yes'], commands, io), 1);
    assert.match(io.text(), /사용자 ID/);
    assert.deepEqual(await things(db), []);
    assert.deepEqual(await actions(db), []);
  } finally {
    await close();
  }
});

test('audit은 넣은 줄의 번호를 돌려주고, 까닭이 비면 거절한다', async () => {
  const { db, close } = await setup();
  try {
    const ids = await db.transaction(async (tx) => [
      await audit(tx, { actor: 'ops-kim', action: 'grant', targetUserId: USER, targetRef: 'game.minesweeper', params: { a: [1, '둘'] }, reason: '보상' }),
      await audit(tx, { actor: 'ops-lee', action: 'seed', params: null, reason: '처음 자료' }),
    ]);
    const rows = await actions(db);
    assert.deepEqual(rows.map((r) => r.id), ids);
    assert.ok(ids[1] > ids[0]);
    assert.deepEqual(rows[0].params, { a: [1, '둘'] });
    assert.equal(rows[1].targetUserId, null);
    assert.equal(rows[1].targetRef, null);

    await assert.rejects(db.transaction((tx) => audit(tx, { actor: 'ops-kim', action: 'grant', params: {}, reason: ' ' })), /reason_required/);
    await assert.rejects(db.transaction((tx) => audit(tx, { actor: '', action: 'grant', params: {}, reason: '보상' })), RuleError);
    assert.equal((await actions(db)).length, 2);
  } finally {
    await close();
  }
});
