import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminActions } from '../../src/admin/schema.ts';
import { commands, equip, listEquipped } from '../../src/entitlement/index.ts';
import { runCli } from '../../src/shared/cli/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeIo } from '../helpers/cli.ts';
import { testDb } from '../helpers/db.ts';
import { NOW, rowsOf, seedCatalog } from './helpers.ts';

const ACTOR = 'ops-kim';

async function run(db: Db, argv: string[], answer = true) {
  const io = fakeIo(answer);
  const code = await runCli(argv, commands(db, ACTOR), io);
  return { code, text: io.text(), questions: io.questions };
}

const actions = (db: Db) => db.select().from(adminActions).orderBy(adminActions.id);

test('grant 명령은 admin_actions와 그 번호가 달린 보유(source grant)를 남긴다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    const out = await run(db, ['grant', me.userId, 'pinball.table.neon', '--reason', '테스터 보상', '--yes']);
    assert.equal(out.code, 0, out.text);
    const acts = await actions(db);
    assert.equal(acts.length, 1);
    assert.deepEqual(
      { actor: acts[0].actor, action: acts[0].action, targetUserId: acts[0].targetUserId, targetRef: acts[0].targetRef, reason: acts[0].reason, params: acts[0].params },
      { actor: ACTOR, action: 'grant', targetUserId: me.userId, targetRef: 'pinball.table.neon', reason: '테스터 보상', params: { positional: [me.userId, 'pinball.table.neon'], flags: {} } },
    );
    const rows = await rowsOf(db, me.userId);
    assert.deepEqual(rows.map((r) => [r.productId, r.source, r.adminActionId, r.revokedAt]), [['pinball.table.neon', 'grant', acts[0].id, null]]);
    assert.match(out.text, new RegExp(`운영 기록 #${acts[0].id}`));

    // 이미 가졌으면 실패하고 운영 기록도 남지 않는다
    const again = await run(db, ['grant', me.userId, 'pinball.table.neon', '--reason', '또', '--yes']);
    assert.equal(again.code, 1);
    assert.match(again.text, /이미 가지고 있어요/);
    assert.equal((await actions(db)).length, 1);
  } finally {
    await close();
  }
});

test('revoke 명령은 보유를 회수하고 장착을 풀며 admin_actions에 남는다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    assert.equal((await run(db, ['grant', me.userId, 'pinball.table.neon', '--reason', '보상', '--yes'])).code, 0);
    await equip(db, me.userId, 'pinball.table.neon');
    const out = await run(db, ['revoke', me.userId, 'pinball.table.neon', '--reason', '잘못 줌', '--yes']);
    assert.equal(out.code, 0, out.text);
    const acts = await actions(db);
    assert.deepEqual(acts.map((a) => [a.action, a.targetUserId, a.targetRef]), [['grant', me.userId, 'pinball.table.neon'], ['revoke', me.userId, 'pinball.table.neon']]);
    const [row] = await rowsOf(db, me.userId);
    assert.equal(row.revokeReason, 'admin');
    assert.ok(row.revokedAt instanceof Date);
    assert.deepEqual(await listEquipped(db, me.userId), []);
  } finally {
    await close();
  }
});

test('grant·revoke는 인자가 틀리거나 없는 사용자면 묻기 전이나 쓰기 전에 거절한다', async () => {
  const { db, close } = await testDb();
  try {
    await seedCatalog(db);
    const me = await loginGuest(db, NOW);
    for (const argv of [
      ['grant', 'not-a-uuid', 'pinball.table.neon', '--reason', 'r'],
      ['grant', me.userId, 'Bad Id', '--reason', 'r'],
      ['grant', me.userId, '--reason', 'r'],
      ['revoke', me.userId, 'pinball.table.neon', 'extra', '--reason', 'r'],
    ]) {
      const out = await run(db, argv);
      assert.equal(out.code, 1, argv.join(' '));
      assert.deepEqual(out.questions, [], `${argv.join(' ')}: 묻지 않는다`);
    }
    const ghost = await run(db, ['grant', '00000000-0000-4000-8000-000000000000', 'pinball.table.neon', '--reason', 'r', '--yes']);
    assert.equal(ghost.code, 1);
    assert.match(ghost.text, /없는 사용자/);
    const coins = await run(db, ['grant', me.userId, 'coins.1000', '--reason', 'r', '--yes']);
    assert.equal(coins.code, 1);
    assert.equal((await actions(db)).length, 0);
    assert.deepEqual(await rowsOf(db, me.userId), []);
  } finally {
    await close();
  }
});
