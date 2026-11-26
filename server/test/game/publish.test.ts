import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { addVersion, createGame, getGame, listLiveGames, publish, rollback, updateGame } from '../../src/game/index.ts';
import { games, gameVersions } from '../../src/game/schema.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { gameKit, rule, sha256Hex, type GameKit } from './helpers.ts';

async function setup(k: GameKit, id: string, versions: number[]) {
  await k.db.transaction((tx) => createGame(tx, { id, name: `게임 ${id}`, description: '' }));
  for (const version of versions) {
    const b = await k.bundle(id, version);
    await k.db.transaction((tx) => addVersion(tx, { gameId: id, version, filePath: b.filePath, signature: b.signature, minShellApi: 1 }, k.env));
  }
}

const pub = (db: Db, gameId: string, version: number) => db.transaction((tx) => publish(tx, gameId, version));
const back = (db: Db, gameId: string, to?: number) => db.transaction((tx) => rollback(tx, gameId, to));

async function state(db: Db, gameId: string) {
  const [g] = await db.select().from(games).where(eq(games.id, gameId));
  const vs = await db.select().from(gameVersions).where(eq(gameVersions.gameId, gameId)).orderBy(gameVersions.version);
  const live = vs.find((v) => v.id === g.liveVersionId)?.version ?? null;
  return { status: g.status, live, versions: Object.fromEntries(vs.map((v) => [v.version, v.status])) };
}

test('publish하면 live_version_id가 그 버전이고 draft 게임이 live가 된다', async () => {
  const k = await gameKit();
  try {
    await setup(k, 'pinball', [1, 2]);
    assert.deepEqual(await state(k.db, 'pinball'), { status: 'draft', live: null, versions: { 1: 'uploaded', 2: 'uploaded' } });
    await pub(k.db, 'pinball', 1);
    assert.deepEqual(await state(k.db, 'pinball'), { status: 'live', live: 1, versions: { 1: 'live', 2: 'uploaded' } });
    const [v1] = await k.db.select().from(gameVersions).where(eq(gameVersions.version, 1));
    assert.ok(v1.publishedAt instanceof Date);

    await pub(k.db, 'pinball', 2);
    assert.deepEqual(await state(k.db, 'pinball'), { status: 'live', live: 2, versions: { 1: 'live', 2: 'live' } });

    // 없는 버전, 이미 지금 버전, 모양이 틀린 값
    await assert.rejects(pub(k.db, 'pinball', 3), rule(404, 'not_found'));
    await assert.rejects(pub(k.db, 'nogame', 1), rule(404, 'not_found'));
    await assert.rejects(pub(k.db, 'pinball', 2), rule(409, 'already_live'));
    await assert.rejects(pub(k.db, 'pinball', 1.5), rule(400, 'invalid_version'));
    assert.deepEqual(await state(k.db, 'pinball'), { status: 'live', live: 2, versions: { 1: 'live', 2: 'live' } });

    // retired 게임은 버전을 내보내도 retired 그대로다
    await setup(k, 'breakout', [1]);
    await k.db.transaction((tx) => updateGame(tx, 'breakout', { status: 'retired' }));
    await pub(k.db, 'breakout', 1);
    assert.deepEqual(await state(k.db, 'breakout'), { status: 'retired', live: 1, versions: { 1: 'live' } });
  } finally {
    await k.close();
  }
});

test('1, 2를 차례로 내보낸 뒤 rollback하면 포인터가 1이고 2는 withdrawn이다', async () => {
  const k = await gameKit();
  try {
    await setup(k, 'pinball', [1, 2, 3, 4]);
    await pub(k.db, 'pinball', 1);
    await pub(k.db, 'pinball', 2);
    assert.deepEqual(await back(k.db, 'pinball'), { from: 2, to: 1 });
    assert.deepEqual(await state(k.db, 'pinball'), { status: 'live', live: 1, versions: { 1: 'live', 2: 'withdrawn', 3: 'uploaded', 4: 'uploaded' } });
    // 목록도 이전 버전을 가리킨다
    const [listed] = await listLiveGames(k.db);
    assert.equal(listed.liveVersion?.version, 1);

    // withdrawn은 다시 내보낼 수 없고 되돌릴 곳도 아니다
    await assert.rejects(pub(k.db, 'pinball', 2), rule(409, 'version_withdrawn'));
    await pub(k.db, 'pinball', 3);
    await pub(k.db, 'pinball', 4);
    // 4 → (3, 2는 withdrawn이라 건너뛰고) 3 → 1
    assert.deepEqual(await back(k.db, 'pinball'), { from: 4, to: 3 });
    assert.deepEqual(await back(k.db, 'pinball'), { from: 3, to: 1 });
    assert.deepEqual(await state(k.db, 'pinball'), { status: 'live', live: 1, versions: { 1: 'live', 2: 'withdrawn', 3: 'withdrawn', 4: 'withdrawn' } });
  } finally {
    await k.close();
  }
});

test('rollback --to: 내보낸 적 있는 live 버전으로만 간다', async () => {
  const k = await gameKit();
  try {
    await setup(k, 'pinball', [1, 2, 3, 4]);
    for (const v of [1, 2, 3]) await pub(k.db, 'pinball', v);
    await assert.rejects(back(k.db, 'pinball', 4), rule(409, 'version_not_live'), '올리기만 한 버전');
    await assert.rejects(back(k.db, 'pinball', 3), rule(409, 'nothing_to_rollback'), '지금 버전');
    await assert.rejects(back(k.db, 'pinball', 9), rule(404, 'not_found'));
    await assert.rejects(back(k.db, 'pinball', -1), rule(400, 'invalid_version'));
    assert.deepEqual(await back(k.db, 'pinball', 1), { from: 3, to: 1 });
    assert.deepEqual(await state(k.db, 'pinball'), { status: 'live', live: 1, versions: { 1: 'live', 2: 'live', 3: 'withdrawn', 4: 'uploaded' } });
  } finally {
    await k.close();
  }
});

test('버전이 하나뿐일 때 rollback은 409 nothing_to_rollback', async () => {
  const k = await gameKit();
  try {
    await setup(k, 'pinball', [1]);
    await assert.rejects(back(k.db, 'pinball'), rule(409, 'nothing_to_rollback'), '내보낸 버전이 없다');
    await pub(k.db, 'pinball', 1);
    await assert.rejects(back(k.db, 'pinball'), rule(409, 'nothing_to_rollback'));
    assert.deepEqual(await state(k.db, 'pinball'), { status: 'live', live: 1, versions: { 1: 'live' } }, '아무것도 바뀌지 않는다');
    await assert.rejects(back(k.db, 'nogame'), rule(404, 'not_found'));
  } finally {
    await k.close();
  }
});

test('listLiveGames는 draft·retired 게임을 빼고, 버전을 내보내지 않은 live 게임은 liveVersion이 null이다', async () => {
  const k = await gameKit();
  try {
    await setup(k, 'pinball', [1]);
    await setup(k, 'minesweeper', []);
    await setup(k, 'breakout', [1]);
    await setup(k, 'tetra', [1]);
    await pub(k.db, 'pinball', 1);
    await pub(k.db, 'tetra', 1);
    await k.db.transaction(async (tx) => {
      await updateGame(tx, 'minesweeper', { status: 'live', sortOrder: 2 });
      await updateGame(tx, 'pinball', { sortOrder: 1, iconPath: `${'b'.repeat(64)}.png` });
      await updateGame(tx, 'tetra', { status: 'retired' });
    });
    const b = await k.bundle('pinball', 1);
    const listed = await listLiveGames(k.db);
    assert.deepEqual(listed, [
      {
        id: 'pinball',
        name: '게임 pinball',
        description: '',
        iconPath: `${'b'.repeat(64)}.png`,
        status: 'live',
        sortOrder: 1,
        liveVersion: { version: 1, sizeBytes: b.bytes.length, sha256: sha256Hex(b.bytes), signature: b.signature, minShellApi: 1 },
      },
      { id: 'minesweeper', name: '게임 minesweeper', description: '', iconPath: null, status: 'live', sortOrder: 2, liveVersion: null },
    ]);
    // getGame은 상태와 상관없이 준다
    assert.equal((await getGame(k.db, 'breakout'))?.status, 'draft');
    assert.equal((await getGame(k.db, 'tetra'))?.liveVersion?.version, 1);
    assert.equal(await getGame(k.db, 'nogame'), null);
    assert.equal(await getGame(k.db, '../x'), null);
  } finally {
    await k.close();
  }
});

test('createGame·updateGame은 모양이 틀린 값을 거절하고, 설명은 줄바꿈(\\n)만 받는다', async () => {
  const k = await gameKit();
  try {
    const create = (input: Parameters<typeof createGame>[1]) => k.db.transaction((tx) => createGame(tx, input));
    const update = (id: string, patch: Parameters<typeof updateGame>[2]) => k.db.transaction((tx) => updateGame(tx, id, patch));
    await create({ id: 'pinball', name: '핀볼', description: '첫 줄\n둘째 줄', sortOrder: 3 });
    assert.equal((await getGame(k.db, 'pinball'))?.description, '첫 줄\n둘째 줄');
    await assert.rejects(create({ id: 'pinball', name: '또', description: '' }), rule(409, 'already_exists'));
    for (const id of ['p', 'Pinball', '1game', 'pin_ball', 'a'.repeat(33), '../x', 'pin ball']) {
      await assert.rejects(create({ id, name: 'x', description: '' }), rule(400, 'invalid_game_id'), id);
    }
    for (const name of ['', '줄\n바꿈', 'tab\t', 'x'.repeat(61)]) await assert.rejects(create({ id: 'other', name, description: '' }), rule(400, 'invalid_name'), JSON.stringify(name));
    for (const description of ['탭\t', 'CR\r\n', 'NUL\u0000', 'x'.repeat(1001)]) {
      await assert.rejects(create({ id: 'other', name: 'x', description }), rule(400, 'invalid_description'), JSON.stringify(description));
    }
    await assert.rejects(update('pinball', { status: 'gone' as never }), rule(400, 'invalid_status'));
    await assert.rejects(update('pinball', { iconPath: '../x.png' }), rule(400, 'invalid_icon'));
    await assert.rejects(update('pinball', { sortOrder: 1.5 }), rule(400, 'invalid_sort_order'));
    await assert.rejects(update('nogame', { name: 'x' }), rule(404, 'not_found'));
    await assert.rejects(update('pinball', {}), rule(400, 'nothing_to_update'));
    assert.deepEqual(await getGame(k.db, 'pinball'), { id: 'pinball', name: '핀볼', description: '첫 줄\n둘째 줄', iconPath: null, status: 'draft', sortOrder: 3, liveVersion: null });
  } finally {
    await k.close();
  }
});
