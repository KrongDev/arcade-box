import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commands, CONFIG_DEFAULTS, getNumber, setNumber, type ConfigKey } from '../../src/admin/index.ts';
import { adminActions } from '../../src/admin/schema.ts';
import { runCli } from '../../src/shared/cli/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { fakeIo } from '../helpers/cli.ts';
import { testDb } from '../helpers/db.ts';

test('config get은 처음에 50, 50, 3을 보여 준다', async () => {
  const { db, close } = await testDb();
  try {
    assert.deepEqual(CONFIG_DEFAULTS, { attendance_coins: 50, ad_reward_coins: 50, ad_rewards_per_day: 3 });
    const io = fakeIo();
    assert.equal(await runCli(['config', 'get'], commands(db, 'ops-kim'), io), 0);
    assert.deepEqual(io.lines, ['attendance_coins = 50', 'ad_reward_coins = 50', 'ad_rewards_per_day = 3']);

    const one = fakeIo();
    assert.equal(await runCli(['config', 'get', 'ad_rewards_per_day'], commands(db, 'ops-kim'), one), 0);
    assert.deepEqual(one.lines, ['ad_rewards_per_day = 3']);

    assert.equal(await getNumber(db, 'attendance_coins'), 50);
    assert.equal(await getNumber(db, 'ad_reward_coins'), 50);
    assert.equal(await getNumber(db, 'ad_rewards_per_day'), 3);
    // 읽기만 하는 명령은 까닭을 받지 않고 운영 기록도 남기지 않는다
    assert.deepEqual(io.questions, []);
    assert.deepEqual(await db.select().from(adminActions), []);
  } finally {
    await close();
  }
});

test('config set attendance_coins 70 뒤에 getNumber가 70을 준다', async () => {
  const { db, close } = await testDb();
  try {
    const cmds = commands(db, 'ops-kim');
    const io = fakeIo();
    assert.equal(await runCli(['config', 'set', 'attendance_coins', '70', '--reason', '이벤트', '--yes'], cmds, io), 0);
    assert.equal(await getNumber(db, 'attendance_coins'), 70);
    assert.equal(await getNumber(db, 'ad_reward_coins'), 50, '다른 설정은 그대로다');
    assert.ok(io.text().includes('50 → 70'), '바뀌기 전과 뒤를 보여 준다');

    // 다시 바꾸면 덮어쓴다
    assert.equal(await runCli(['config', 'set', 'attendance_coins', '0', '--reason', '이벤트 끝', '--yes'], cmds, fakeIo()), 0);
    assert.equal(await getNumber(db, 'attendance_coins'), 0);
    const shown = fakeIo();
    await runCli(['config', 'get'], cmds, shown);
    assert.deepEqual(shown.lines, ['attendance_coins = 0', 'ad_reward_coins = 50', 'ad_rewards_per_day = 3']);

    const rows = await db.select().from(adminActions).orderBy(adminActions.id);
    assert.deepEqual(
      rows.map((r) => [r.actor, r.action, r.targetRef, r.reason, r.params]),
      [
        ['ops-kim', 'config.set', 'attendance_coins', '이벤트', { positional: ['attendance_coins', '70'], flags: {} }],
        ['ops-kim', 'config.set', 'attendance_coins', '이벤트 끝', { positional: ['attendance_coins', '0'], flags: {} }],
      ],
    );
  } finally {
    await close();
  }
});

test('config set은 까닭이 없으면 실패하고, 확인에 아니오라고 하면 바뀌지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const cmds = commands(db, 'ops-kim');
    assert.equal(await runCli(['config', 'set', 'attendance_coins', '70', '--yes'], cmds, fakeIo()), 1);
    const no = fakeIo(false);
    assert.equal(await runCli(['config', 'set', 'attendance_coins', '70', '--reason', '이벤트'], cmds, no), 1);
    assert.equal(no.questions.length, 1);
    assert.equal(await getNumber(db, 'attendance_coins'), 50);
    assert.deepEqual(await db.select().from(adminActions), []);
  } finally {
    await close();
  }
});

test('모르는 설정 이름과 범위를 벗어난 값은 거절한다', async () => {
  const { db, close } = await testDb();
  try {
    const cmds = commands(db, 'ops-kim');
    for (const rest of [
      ['nope', '70'],
      ['attendance_coins', '-1'],
      ['attendance_coins', '100001'],
      ['attendance_coins', '1.5'],
      ['attendance_coins', 'abc'],
      ['attendance_coins', '1e3'],
      ['attendance_coins', ''],
      ['attendance_coins'],
      ['attendance_coins', '70', '80'],
      [],
    ]) {
      const io = fakeIo();
      assert.equal(await runCli(['config', 'set', ...rest, '--reason', '시험', '--yes'], cmds, io), 1, rest.join(' '));
      assert.equal(io.lines.length, 1, `스택 없이 메시지 한 줄: ${io.text()}`);
    }
    const unknown = fakeIo();
    assert.equal(await runCli(['config', 'get', 'nope'], cmds, unknown), 1);
    assert.ok(unknown.text().includes('attendance_coins'), '쓸 수 있는 이름을 알려 준다');
    assert.equal(await getNumber(db, 'attendance_coins'), 50);
    assert.deepEqual(await db.select().from(adminActions), []);

    // 명령줄을 거치지 않고 함수를 바로 불러도 막는다
    const bad = (key: string, value: number) => db.transaction((tx) => setNumber(tx, key as ConfigKey, value));
    await assert.rejects(bad('nope', 1), RuleError);
    await assert.rejects(bad('__proto__', 1), RuleError);
    for (const value of [-1, 100_001, 1.5, NaN, Infinity]) await assert.rejects(bad('attendance_coins', value), RuleError, String(value));
    await assert.rejects(getNumber(db, 'nope' as ConfigKey), RuleError);
    await bad('ad_rewards_per_day', 100_000);
    assert.equal(await getNumber(db, 'ad_rewards_per_day'), 100_000);
    await bad('ad_rewards_per_day', 0);
    assert.equal(await getNumber(db, 'ad_rewards_per_day'), 0);
  } finally {
    await close();
  }
});

test('설정을 바꾼 트랜잭션이 실패하면 값이 그대로다', async () => {
  const { db, close } = await testDb();
  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        await setNumber(tx, 'ad_reward_coins', 99);
        assert.equal(await getNumber(tx, 'ad_reward_coins'), 99, '같은 트랜잭션 안에서는 바뀐 값이 보인다');
        throw new Error('되돌려요');
      }),
      /되돌려요/,
    );
    assert.equal(await getNumber(db, 'ad_reward_coins'), 50);
  } finally {
    await close();
  }
});
