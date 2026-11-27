import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { revoke } from '../../src/entitlement/index.ts';
import { addVersion, getGame, publish, rollback, updateGame } from '../../src/game/index.ts';
import type { Config } from '../../src/shared/config.ts';
import { loginGuest, testConfig } from '../account/helpers.ts';
import { gameKit, sha256Hex, type GameKit } from '../game/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { call } from '../helpers/http.ts';
import { NOW, own, playHandler, seedPlay } from './helpers.ts';

const codeOf = (body: unknown) => (body as { error?: { code?: string } } | null)?.error?.code;

/** 게임 셋과 순위표, 그리고 묶음: 핀볼 1(live)·2(live, 지금 버전)·3(uploaded), 지뢰찾기 1(live) */
async function setup() {
  const k = await gameKit();
  await seedPlay(k.db);
  const bytes: Record<string, Buffer> = {};
  const add = async (gameId: string, version: number, live: boolean) => {
    const b = await k.bundle(gameId, version, { content: `PK-bundle ${gameId} v${version} ${'z'.repeat(50 * version)}` });
    await k.db.transaction((tx) => addVersion(tx, { gameId, version, filePath: b.filePath, signature: b.signature, minShellApi: 1 }, k.env));
    if (live) await k.db.transaction((tx) => publish(tx, gameId, version));
    bytes[`${gameId}@${version}`] = b.bytes;
  };
  await add('pinball', 1, true);
  await add('pinball', 2, true);
  await add('pinball', 3, false);
  await add('minesweeper', 1, true);
  const config: Config = { ...testConfig, dataDir: k.dataDir };
  const clock = fakeClock(NOW.toISOString());
  return { k, bytes, clock, handler: playHandler(k.db, clock, config) };
}

const bundleUrl = (gameId: string, version: string | number) => `/v2/games/${gameId}/versions/${version}/bundle`;

async function closing(k: GameKit, run: () => Promise<void>) {
  try {
    await run();
  } finally {
    await k.close();
  }
}

test('세션이 없으면 401, 사지 않은 게임이면 403 game_locked', async () => {
  const { k, handler, bytes } = await setup();
  await closing(k, async () => {
    const me = await loginGuest(k.db, NOW);
    const none = await call(handler, 'GET', bundleUrl('pinball', 2));
    assert.equal(none.status, 401);
    assert.equal(codeOf(none.body), 'unauthorized');
    assert.equal((await call(handler, 'GET', bundleUrl('pinball', 2), { token: 'x'.repeat(43) })).status, 401);
    assert.equal(none.raw.includes('PK-bundle'), false);

    const locked = await call(handler, 'GET', bundleUrl('minesweeper', 1), { token: me.token });
    assert.equal(locked.status, 403);
    assert.equal(codeOf(locked.body), 'game_locked');
    assert.equal(locked.raw.includes('PK-bundle'), false, '묶음의 내용이 나가지 않는다');
    // 사지 않은 게임은 없는 버전을 물어도 403이다 (어떤 버전이 있는지 알려 주지 않는다)
    assert.equal((await call(handler, 'GET', bundleUrl('minesweeper', 99), { token: me.token })).status, 403);

    // 사면(지급받으면) 받는다. 회수하면 다시 403이다 (스펙 5.16)
    await own(k.db, me.userId, 'minesweeper');
    const got = await call(handler, 'GET', bundleUrl('minesweeper', 1), { token: me.token });
    assert.equal(got.status, 200);
    assert.ok(got.raw.equals(bytes['minesweeper@1']));
    await k.db.transaction((tx) => revoke(tx, { userId: me.userId, productId: 'game.minesweeper', reason: 'refund' }));
    assert.equal((await call(handler, 'GET', bundleUrl('minesweeper', 1), { token: me.token })).status, 403);
  });
});

test('가진 게임의 live 버전을 받으면 내용의 SHA-256이 등록된 값과 같다', async () => {
  const { k, handler, bytes } = await setup();
  await closing(k, async () => {
    const me = await loginGuest(k.db, NOW);
    const live = (await getGame(k.db, 'pinball'))!.liveVersion!;
    assert.equal(live.version, 2);

    const got = await call(handler, 'GET', bundleUrl('pinball', 2), { token: me.token });
    assert.equal(got.status, 200);
    assert.equal(sha256Hex(got.raw), live.sha256, '목록(catalog)이 알려 주는 sha256과 같다');
    assert.equal(got.raw.length, live.sizeBytes);
    assert.ok(got.raw.equals(bytes['pinball@2']));
    assert.equal(got.headers['content-type'], 'application/zip');
    assert.equal(got.headers['content-length'], String(live.sizeBytes));
    assert.equal(got.headers['cache-control'], 'private, no-store', '로그인한 사람에게만 주는 파일이라 중간에서 캐시하지 않는다');
    assert.equal(got.headers['x-content-type-options'], 'nosniff');

    // 지금 버전이 아니어도 live인 버전은 받는다 (되돌린 뒤 앱이 낮은 버전을 받을 수 있게)
    const older = await call(handler, 'GET', bundleUrl('pinball', 1), { token: me.token });
    assert.equal(older.status, 200);
    assert.ok(older.raw.equals(bytes['pinball@1']));

    // HEAD는 본문 없이 같은 머리글이다
    const head = await call(handler, 'HEAD', bundleUrl('pinball', 2), { token: me.token });
    assert.equal(head.status, 200);
    assert.equal(head.raw.length, 0);
    assert.equal(head.headers['content-length'], String(live.sizeBytes));
    assert.equal((await call(handler, 'POST', bundleUrl('pinball', 2), { token: me.token })).status, 405);
  });
});

test('withdrawn 버전과 없는 버전은 404', async () => {
  const { k, handler } = await setup();
  await closing(k, async () => {
    const me = await loginGuest(k.db, NOW);
    const get = (gameId: string, version: string | number) => call(handler, 'GET', bundleUrl(gameId, version), { token: me.token });

    // 올리기만 하고 내보내지 않은(uploaded) 버전과 없는 버전
    for (const version of [3, 4, 999, 2_147_483_647]) {
      const r = await get('pinball', version);
      assert.equal(r.status, 404, String(version));
      assert.equal(codeOf(r.body), 'not_found');
      assert.equal(r.raw.includes('PK-bundle'), false, String(version));
    }
    // 되돌리면 거둬들인(withdrawn) 버전은 더 내려 주지 않는다. 파일은 디스크에 그대로 있다
    await k.db.transaction((tx) => rollback(tx, 'pinball'));
    const withdrawn = await get('pinball', 2);
    assert.equal(withdrawn.status, 404);
    assert.equal(withdrawn.raw.includes('PK-bundle'), false);
    assert.equal((await get('pinball', 1)).status, 200);

    // 없는 게임, live가 아닌 게임
    assert.equal((await get('nogame', 1)).status, 404);
    await k.db.transaction((tx) => updateGame(tx, 'pinball', { status: 'retired' }));
    assert.equal((await get('pinball', 1)).status, 404);
    await k.db.transaction((tx) => updateGame(tx, 'pinball', { status: 'draft' }));
    assert.equal((await get('pinball', 1)).status, 404);
  });
});

for (const v of ['abc', '1.5', '-1', '../1']) {
  test(`버전 ${v}: 404이고 파일을 내주지 않는다`, async () => {
    const { k, handler } = await setup();
    await closing(k, async () => {
      const me = await loginGuest(k.db, NOW);
      // 경로가 풀리면 닿을 자리에 미끼 파일을 둔다: bundles/pinball/../1.zip = bundles/1.zip
      await mkdir(join(k.dataDir, 'bundles'), { recursive: true });
      for (const name of ['1.zip', 'abc.zip', '1.5.zip', '-1.zip']) await writeFile(join(k.dataDir, 'bundles', name), 'PK-bundle BAIT');
      for (const name of ['abc.zip', '1.5.zip', '-1.zip']) await writeFile(join(k.dataDir, 'bundles', 'pinball', name), 'PK-bundle BAIT');

      const r = await call(handler, 'GET', bundleUrl('pinball', encodeURIComponent(v)), { token: me.token });
      assert.equal(r.status, 404);
      assert.equal(codeOf(r.body), 'not_found');
      assert.equal(r.raw.includes('PK-bundle'), false, '파일 내용이 나가지 않는다');
    });
  });
}

test('버전·게임 자리에 온 그 밖의 이상한 값도 404이고 파일을 내주지 않는다', async () => {
  const { k, handler } = await setup();
  await closing(k, async () => {
    const me = await loginGuest(k.db, NOW);
    await writeFile(join(k.dataDir, 'bundles', '1.zip'), 'PK-bundle BAIT');
    const versions = ['0', '01', '1e0', '0x1', '+1', '1 ', ' 1', '2147483648', '99999999999999999999', '1/../2', '1%00', '１', ''];
    for (const version of versions) {
      const r = await call(handler, 'GET', bundleUrl('pinball', encodeURIComponent(version)), { token: me.token });
      assert.ok(r.status === 404 || r.status === 400, `버전 ${JSON.stringify(version)}: ${r.status}`);
      assert.equal(r.raw.includes('PK-bundle'), false, version);
    }
    for (const gameId of ['..', '../pinball', 'PINBALL', 'pinball/../minesweeper', 'a'.repeat(100), 'pin ball']) {
      const r = await call(handler, 'GET', bundleUrl(encodeURIComponent(gameId), 1), { token: me.token });
      assert.ok(r.status === 404 || r.status === 400, `게임 ${gameId}: ${r.status}`);
      assert.equal(r.raw.includes('PK-bundle'), false, gameId);
    }
  });
});

test('묶음 받기는 사용자당 분당 30번이다', async () => {
  const { k, handler, clock } = await setup();
  await closing(k, async () => {
    const me = await loginGuest(k.db, NOW);
    const other = await loginGuest(k.db, NOW);
    for (let i = 0; i < 30; i++) assert.equal((await call(handler, 'HEAD', bundleUrl('pinball', 2), { token: me.token })).status, 200, `${i + 1}번째`);
    const over = await call(handler, 'GET', bundleUrl('pinball', 2), { token: me.token });
    assert.equal(over.status, 429);
    assert.equal(codeOf(over.body), 'rate_limited');
    // 다른 사용자는 같은 IP여도 따로 센다. 1분 뒤에는 다시 된다
    assert.equal((await call(handler, 'HEAD', bundleUrl('pinball', 2), { token: other.token })).status, 200);
    clock.advance(60_000);
    assert.equal((await call(handler, 'HEAD', bundleUrl('pinball', 2), { token: me.token })).status, 200);
  });
});
