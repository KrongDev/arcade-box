import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminActions } from '../src/admin/schema.ts';
import { allCommands } from '../src/commands.ts';
import { runCli } from '../src/shared/cli/index.ts';
import { fakeIo } from './helpers/cli.ts';
import { testDb } from './helpers/db.ts';

/** 명령줄(`cli.ts`)이 등록하는 것과 같은 목록 */
async function registered() {
  const { db, close } = await testDb();
  return { db, close, commands: allCommands(db, 'ops', { dataDir: '/nonexistent', bundlePublicKey: null }) };
}

/** 쓰는 법 한 줄에 적힌 flag 이름들 (`--min-shell-api <n>` → `min-shell-api`) */
const flagsIn = (usage: string) => [...new Set([...usage.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]))].sort();

/**
 * 쓰는 법에는 없지만 받는 flag. 받아서 더 알맞은 말로 거절하려는 것뿐이다:
 * `board update --game`·`--ordering`은 "바꿀 수 없어요. 새 순위표를 만들어 주세요"라고 답한다.
 */
const EXTRA: Record<string, string[]> = { 'board update': ['game', 'ordering'] };

test('스펙 5.11의 명령이 모두 등록돼 있고 이름이 겹치지 않는다', async () => {
  const { close, commands } = await registered();
  try {
    const names = commands.map((c) => c.name);
    assert.equal(new Set(names).size, names.length, '이름이 겹친다');
    for (const name of [
      ...['product add', 'product update', 'product list', 'product show', 'price set', 'sku set'],
      ...['user find', 'user show'],
      ...['grant', 'revoke', 'coins adjust'],
      ...['game add', 'game update', 'game list', 'board add', 'board update', 'game add-version', 'game publish', 'game rollback'],
      ...['order list', 'order show', 'order refund', 'orders purge-expired'],
      ...['config get', 'config set', 'wallet verify'],
      'seed',
    ]) {
      assert.ok(names.includes(name), `${name} 명령이 없다`);
    }
  } finally {
    await close();
  }
});

test('모든 명령: 받는 flag의 목록이 쓰는 법에 적힌 flag와 같다', async () => {
  const { close, commands } = await registered();
  try {
    for (const c of commands) {
      const listed = [...c.flags].sort();
      assert.equal(new Set(listed).size, listed.length, `${c.name}: 목록에 같은 flag가 두 번 있다`);
      const extra = EXTRA[c.name] ?? [];
      assert.deepEqual(
        listed.filter((name) => !extra.includes(name)),
        flagsIn(c.usage),
        `${c.name}: 쓰는 법(${c.usage})과 받는 flag(${listed.join(', ')})가 다르다`,
      );
      for (const name of extra) assert.ok(listed.includes(name), `${c.name}: --${name}을 받지 않는다`);
    }
  } finally {
    await close();
  }
});

test('모든 명령: 모르는 flag가 오면 거절하고 아무것도 하지 않는다 (묻지도, 운영 기록을 남기지도 않는다)', async () => {
  const { db, close, commands } = await registered();
  try {
    for (const c of commands) {
      // 바꾸는 명령은 까닭과 --yes를 갖춰도, 오타 난 flag 하나 때문에 거절돼야 한다
      const rest = c.flags.includes('reason') ? ['--reason', '시험', '--yes'] : [];
      for (const bogus of [['--bogus'], ['--bogus', 'x'], ['--bogus=x']]) {
        const io = fakeIo();
        const argv = [...c.name.split(' '), ...rest, ...bogus];
        assert.equal(await runCli(argv, commands, io), 1, argv.join(' '));
        assert.match(io.text(), /모르는 flag예요: --bogus/, argv.join(' '));
        assert.ok(io.text().includes(c.usage), `${argv.join(' ')}: 쓰는 법이 없다`);
        assert.deepEqual(io.questions, [], argv.join(' '));
      }
    }
    assert.equal((await db.select().from(adminActions)).length, 0);
  } finally {
    await close();
  }
});

test('바꾸는 명령은 --reason과 --yes를 받고, 읽기만 하는 명령은 둘 다 받지 않는다', async () => {
  const { close, commands } = await registered();
  try {
    const readOnly = ['config get', 'wallet verify', 'game list', 'board list', 'product list', 'product show', 'order list', 'order show', 'user find', 'user show'];
    for (const c of commands) {
      const takes = (name: string) => c.flags.includes(name);
      if (readOnly.includes(c.name)) assert.ok(!takes('reason') && !takes('yes'), `${c.name}: 읽기만 하는 명령이 --reason·--yes를 받는다`);
      else assert.ok(takes('reason') && takes('yes'), `${c.name}: 바꾸는 명령이 --reason·--yes를 받지 않는다`);
    }
  } finally {
    await close();
  }
});
