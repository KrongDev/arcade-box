import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs, runCli, type Args, type Command } from '../../src/shared/cli/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { fakeIo } from '../helpers/cli.ts';

/** 받은 인자를 적어 두기만 하는 명령들 */
function recording() {
  const calls: Array<{ name: string; args: Args }> = [];
  const make = (name: string, usage = name): Command => ({
    name,
    usage,
    run: async (args) => {
      calls.push({ name, args });
    },
  });
  const commands = [
    make('config get', 'config get [key]'),
    make('config set', 'config set <key> <value> --reason <까닭> [--yes]'),
    make('game add'),
    make('game add-version'),
    make('grant', 'grant <userId> <상품> --reason <까닭>'),
    make('order show'),
    make('orders purge-expired'),
  ];
  return { calls, commands };
}

test('parseArgs: --flag 값, 값 없는 flag, --flag=값, 자리 인자를 가른다', () => {
  assert.deepEqual(parseArgs([]), { positional: [], flags: {} });
  assert.deepEqual(parseArgs(['attendance_coins', '70', '--reason', '이벤트 준비', '--yes']), {
    positional: ['attendance_coins', '70'],
    flags: { reason: '이벤트 준비', yes: true },
  });
  // --yes는 값을 받지 않는다. 뒤에 온 것은 자리 인자다
  assert.deepEqual(parseArgs(['--yes', 'pinball', '--reason', 'x']), { positional: ['pinball'], flags: { yes: true, reason: 'x' } });
  // 다른 flag는 뒤에 값이 없거나 다른 flag가 오면 값 없는 flag다
  assert.deepEqual(parseArgs(['--all', '--user', 'u1', '--dry']), { positional: [], flags: { all: true, user: 'u1', dry: true } });
  assert.deepEqual(parseArgs(['--to=3', '--note=', '--k=a=b']), { positional: [], flags: { to: '3', note: '', k: 'a=b' } });
  // 음수는 flag가 아니다
  assert.deepEqual(parseArgs(['u1', '-300', '--delta', '-5']), { positional: ['u1', '-300'], flags: { delta: '-5' } });
  // 같은 flag를 두 번 쓰면 뒤의 것
  assert.deepEqual(parseArgs(['--to', '1', '--to', '2']).flags, { to: '2' });
});

test('모르는 명령이면 쓸 수 있는 명령 목록을 보여 주고 1로 끝난다', async () => {
  const { calls, commands } = recording();
  for (const argv of [['nope'], ['config'], ['config', 'nope', 'x'], [], ['--yes'], ['game']]) {
    const io = fakeIo();
    assert.equal(await runCli(argv, commands, io), 1, argv.join(' '));
    for (const c of commands) assert.ok(io.text().includes(c.usage), `${argv.join(' ')}: ${c.usage}가 목록에 없다`);
  }
  assert.deepEqual(calls, []);
});

test('명령 이름 뒤의 것을 인자로 넘기고 0으로 끝난다', async () => {
  const { calls, commands } = recording();
  assert.equal(await runCli(['config', 'set', 'attendance_coins', '70', '--reason', '이벤트', '--yes'], commands, fakeIo()), 0);
  assert.equal(await runCli(['grant', 'u1', 'game.minesweeper', '--reason', '보상'], commands, fakeIo()), 0);
  assert.equal(await runCli(['game', 'add-version', 'pinball', '3', '--file', 'a.zip'], commands, fakeIo()), 0);
  assert.equal(await runCli(['game', 'add', 'pinball'], commands, fakeIo()), 0);
  assert.equal(await runCli(['orders', 'purge-expired'], commands, fakeIo()), 0);
  assert.deepEqual(calls, [
    { name: 'config set', args: { positional: ['attendance_coins', '70'], flags: { reason: '이벤트', yes: true } } },
    { name: 'grant', args: { positional: ['u1', 'game.minesweeper'], flags: { reason: '보상' } } },
    { name: 'game add-version', args: { positional: ['pinball', '3'], flags: { file: 'a.zip' } } },
    { name: 'game add', args: { positional: ['pinball'], flags: {} } },
    { name: 'orders purge-expired', args: { positional: [], flags: {} } },
  ]);
});

test('RuleError는 메시지만 보여 주고 1로 끝난다', async () => {
  const io = fakeIo();
  const commands: Command[] = [
    {
      name: 'fail',
      usage: 'fail',
      run: async () => {
        throw new RuleError(409, 'already_owned', '이미 가지고 있어요');
      },
    },
  ];
  assert.equal(await runCli(['fail'], commands, io), 1);
  assert.deepEqual(io.lines, ['이미 가지고 있어요']);
});

test('그 밖의 오류는 스택까지 보여 주고 1로 끝난다', async () => {
  const io = fakeIo();
  const commands: Command[] = [
    {
      name: 'crash',
      usage: 'crash',
      run: async function crashingCommand() {
        throw new TypeError('뜻밖의 오류');
      },
    },
  ];
  assert.equal(await runCli(['crash'], commands, io), 1);
  assert.match(io.text(), /TypeError: 뜻밖의 오류/);
  assert.match(io.text(), /at .*crashingCommand/);
});
