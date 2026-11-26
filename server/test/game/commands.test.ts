import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { adminActions } from '../../src/admin/schema.ts';
import { commands, getGame } from '../../src/game/index.ts';
import { gameVersions } from '../../src/game/schema.ts';
import { runCli } from '../../src/shared/cli/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { fakeIo } from '../helpers/cli.ts';
import { gameKit, sha256Hex, type GameKit } from './helpers.ts';

const ACTOR = 'ops-kim';

async function run(k: GameKit, argv: string[], answer = true) {
  const io = fakeIo(answer);
  const code = await runCli(argv, commands(k.db, ACTOR, k.env), io);
  return { code, text: io.text(), questions: io.questions };
}

const actions = (db: Db) => db.select().from(adminActions).orderBy(adminActions.id);

function png(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
}

test('game publish 명령은 admin_actions에 남는다', async () => {
  const k = await gameKit();
  try {
    assert.equal((await run(k, ['game', 'add', 'pinball', '--name', '핀볼', '--description', '공을 튕겨요', '--reason', '첫 게임', '--yes'])).code, 0);
    const b = await k.bundle('pinball', 1, { minShellApi: 2 });
    const added = await run(k, ['game', 'add-version', 'pinball', '1', '--file', b.filePath, '--signature', b.signature, '--min-shell-api', '2', '--reason', '첫 묶음', '--yes']);
    assert.equal(added.code, 0, added.text);
    assert.match(added.text, new RegExp(sha256Hex(b.bytes)));

    const out = await run(k, ['game', 'publish', 'pinball', '1', '--reason', '출시', '--yes']);
    assert.equal(out.code, 0, out.text);
    assert.equal((await getGame(k.db, 'pinball'))?.liveVersion?.version, 1);

    const acts = await actions(k.db);
    assert.deepEqual(
      acts.map((a) => [a.actor, a.action, a.targetRef, a.reason]),
      [
        [ACTOR, 'game.add', 'pinball', '첫 게임'],
        [ACTOR, 'game.add_version', 'pinball@1', '첫 묶음'],
        [ACTOR, 'game.publish', 'pinball@1', '출시'],
      ],
    );
    assert.deepEqual(acts[2].params, { positional: ['pinball', '1'], flags: {} });
    assert.match(out.text, new RegExp(`운영 기록 #${acts[2].id}`));

    // 되돌리기도 남는다
    const b2 = await k.bundle('pinball', 2);
    assert.equal((await run(k, ['game', 'add-version', 'pinball', '2', '--file', b2.filePath, '--signature', b2.signature, '--min-shell-api', '1', '--reason', '둘째', '--yes'])).code, 0);
    assert.equal((await run(k, ['game', 'publish', 'pinball', '2', '--reason', '업데이트', '--yes'])).code, 0);
    const rb = await run(k, ['game', 'rollback', 'pinball', '--reason', '튕김 버그', '--yes']);
    assert.equal(rb.code, 0, rb.text);
    assert.match(rb.text, /2 → 1/);
    assert.equal((await actions(k.db)).at(-1)?.action, 'game.rollback');
    assert.equal((await getGame(k.db, 'pinball'))?.liveVersion?.version, 1);
  } finally {
    await k.close();
  }
});

test('game update --icon은 아이콘을 저장하고 그 이름을 게임에 단다', async () => {
  const k = await gameKit();
  try {
    assert.equal((await run(k, ['game', 'add', 'pinball', '--name', '핀볼', '--reason', '추가', '--yes'])).code, 0);
    const icon = png();
    const path = join(k.src, 'icon.png');
    await writeFile(path, icon);
    const out = await run(k, ['game', 'update', 'pinball', '--icon', path, '--sort', '2', '--status', 'live', '--reason', '아이콘', '--yes']);
    assert.equal(out.code, 0, out.text);
    const name = `${sha256Hex(icon)}.png`;
    const g = await getGame(k.db, 'pinball');
    assert.deepEqual({ iconPath: g?.iconPath, sortOrder: g?.sortOrder, status: g?.status }, { iconPath: name, sortOrder: 2, status: 'live' });
    assert.deepEqual(await readFile(join(k.dataDir, 'assets', name)), icon);

    // 그림이 아닌 파일은 거절하고 게임은 그대로다
    await writeFile(path, 'not an image');
    const bad = await run(k, ['game', 'update', 'pinball', '--icon', path, '--reason', '틀린 아이콘', '--yes']);
    assert.equal(bad.code, 1);
    assert.equal((await getGame(k.db, 'pinball'))?.iconPath, name);
    assert.equal((await actions(k.db)).length, 2, '실패한 명령은 운영 기록을 남기지 않는다');
  } finally {
    await k.close();
  }
});

test('game 명령은 인자가 틀리면 확인을 묻기 전에 거절하고, game list는 기록을 남기지 않는다', async () => {
  const k = await gameKit();
  try {
    const bad: string[][] = [
      ['game', 'add', 'Pinball', '--name', 'x', '--reason', 'r'],
      ['game', 'add', 'pinball', '--reason', 'r'],
      ['game', 'add-version', 'pinball', '1.5', '--file', 'x', '--signature', 'x', '--min-shell-api', '1', '--reason', 'r'],
      ['game', 'add-version', 'pinball', '../1', '--file', 'x', '--signature', 'x', '--min-shell-api', '1', '--reason', 'r'],
      ['game', 'add-version', 'pinball', '1', '--signature', 'x', '--min-shell-api', '1', '--reason', 'r'],
      ['game', 'add-version', 'pinball', '1', '--file', 'x', '--signature', 'x', '--min-shell-api', 'abc', '--reason', 'r'],
      ['game', 'publish', 'pinball', 'abc', '--reason', 'r'],
      ['game', 'publish', 'pinball', '--reason', 'r'],
      ['game', 'rollback', 'pinball', '--to', '-1', '--reason', 'r'],
      ['game', 'update', 'pinball', '--status', 'gone', '--reason', 'r'],
      ['game', 'update', 'pinball', '--reason', 'r'],
    ];
    for (const argv of bad) {
      const out = await run(k, argv);
      assert.equal(out.code, 1, argv.join(' '));
      assert.deepEqual(out.questions, [], `${argv.join(' ')}: 묻지 않는다`);
    }
    assert.equal((await run(k, ['game', 'add', 'pinball', '--name', '핀볼', '--reason', '추가', '--yes'])).code, 0);
    const list = await run(k, ['game', 'list']);
    assert.equal(list.code, 0);
    assert.match(list.text, /pinball/);
    assert.match(list.text, /draft/);
    assert.equal((await actions(k.db)).length, 1);
    assert.equal((await k.db.select().from(gameVersions)).length, 0);
  } finally {
    await k.close();
  }
});
