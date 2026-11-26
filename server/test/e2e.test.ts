import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { devVerifier } from '../src/account/index.ts';
import { commands as gameCommands } from '../src/game/index.ts';
import { seed } from '../src/seed.ts';
import { buildServer } from '../src/server.ts';
import { runCli } from '../src/shared/cli/index.ts';
import type { Config } from '../src/shared/config.ts';
import type { Db } from '../src/shared/db/index.ts';
import { testConfig } from './account/helpers.ts';
import { keyPair, signManifest } from './game/helpers.ts';
import { fakeIo } from './helpers/cli.ts';
import { fakeClock } from './helpers/clock.ts';
import { testDb } from './helpers/db.ts';
import { call, type Handler } from './helpers/http.ts';
import { tablesContaining } from './helpers/scan.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const secret = () => randomBytes(32).toString('base64url');
const key = () => randomBytes(12).toString('base64url');
const errorCode = (body: unknown) => (body as { error: { code: string } }).error.code;

interface World {
  db: Db;
  handler: Handler;
  clock: ReturnType<typeof fakeClock>;
  bundle: Buffer;
  close(): Promise<void>;
}

/**
 * 처음 자료를 넣고, 운영자가 하듯 명령줄로 지뢰찾기 묶음 버전 1을 올려 내보낸 서버.
 * 묶음은 테스트 안에서 만든 Ed25519 키로 서명한다. 개발용 로그인(devAuth)이 켜져 있다.
 */
async function world(): Promise<World> {
  const { db, close } = await testDb();
  const root = await mkdtemp(join(tmpdir(), 'arcade-e2e-'));
  const keys = keyPair();
  const config: Config = { ...testConfig, dataDir: join(root, 'data'), bundlePublicKey: keys.publicKey, devAuth: true };
  await seed(db);

  const bundle = Buffer.from(`PK-e2e-minesweeper-1 ${'x'.repeat(200)}`);
  const file = join(root, 'minesweeper-1.zip');
  await writeFile(file, bundle);
  const signature = signManifest(keys.privateKey, { gameId: 'minesweeper', version: 1, sha256: createHash('sha256').update(bundle).digest('hex'), sizeBytes: bundle.length, minShellApi: 1 });
  const ops = gameCommands(db, 'ops', { dataDir: config.dataDir, publicKey: config.bundlePublicKey });
  for (const argv of [
    ['game', 'add-version', 'minesweeper', '1', '--file', file, '--signature', signature, '--min-shell-api', '1', '--reason', '첫 묶음', '--yes'],
    ['game', 'publish', 'minesweeper', '1', '--reason', '첫 묶음', '--yes'],
  ]) {
    const io = fakeIo();
    assert.equal(await runCli(argv, ops, io), 0, io.text());
  }

  // 2026-11-26 10:00 KST
  const clock = fakeClock('2026-11-26T01:00:00Z');
  return {
    db,
    handler: buildServer({ db, config, now: clock, verify: devVerifier() }),
    clock,
    bundle,
    async close() {
      await close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** 핀볼 판 하나 (핀볼은 누구나 가진 게임이다). 3초 간격을 지키려고 시계를 먼저 흘려보낸다 */
async function playPinball(w: World, token: string, coins: number) {
  w.clock.advance(5_000);
  const res = await call(w.handler, 'POST', '/v2/me/runs', { token, body: { boardId: 'pinball', coins, score: 10_000 + coins, idempotencyKey: key() } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { coins: number; coinsLeftToday: number | null; balance: number };
}

test('손님 등록 → 판 결과로 코인 벌기 → 출석 → 코인으로 게임 사기 → 묶음 받기 → 개발용 로그인으로 연결 → 다른 기기 비밀값으로 같은 계정에 들어가기 → 계정 삭제', async () => {
  const w = await world();
  try {
    // 1. 손님 등록
    const phoneSecret = secret();
    const guest = await call(w.handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: phoneSecret } });
    assert.equal(guest.status, 200);
    const phone = guest.body as { userId: string; token: string; created: boolean };
    assert.equal(phone.created, true);

    // 2. 판 결과로 코인 벌기: 첫날은 하루 상한 1500까지만 들어간다
    for (let i = 0; i < 3; i++) await playPinball(w, phone.token, 400);
    const capped = await playPinball(w, phone.token, 400);
    assert.deepEqual([capped.coins, capped.coinsLeftToday, capped.balance], [300, 0, 1500]);

    // 3. 출석
    const attendance = await call(w.handler, 'POST', '/v2/me/attendance', { token: phone.token, body: { idempotencyKey: key() } });
    assert.equal(attendance.status, 200);
    assert.deepEqual(attendance.body, { coins: 50, balance: 1550, replayed: false });

    // 다음 날 다시 번다
    w.clock.advance(DAY_MS);
    for (let i = 0; i < 4; i++) await playPinball(w, phone.token, 400);

    // 4. 코인으로 게임 사기. 사기 전에는 묶음을 받을 수 없다
    const locked = await call(w.handler, 'GET', '/v2/games/minesweeper/versions/1/bundle', { token: phone.token });
    assert.equal(locked.status, 403);
    assert.equal(errorCode(locked.body), 'game_locked');
    const catalog = (await call(w.handler, 'GET', '/v2/catalog')).body as { games: Array<{ id: string; product: { id: string; price: { amount: number } | null } }> };
    const minesweeper = catalog.games.find((g) => g.id === 'minesweeper');
    assert.deepEqual(minesweeper?.product.price, { currency: 'COIN', amount: 3000 });
    const purchase = await call(w.handler, 'POST', '/v2/shop/purchase', { token: phone.token, body: { productId: 'game.minesweeper', idempotencyKey: key() } });
    assert.equal(purchase.status, 200, JSON.stringify(purchase.body));
    const bought = purchase.body as { balance: number; game: { id: string; liveVersion: { version: number; sha256: string; sizeBytes: number } } };
    assert.equal(bought.balance, 3050 - 3000);
    assert.equal(bought.game.id, 'minesweeper');

    // 5. 묶음 받기: 구매 답의 버전으로 바로 받는다
    const dl = await call(w.handler, 'GET', `/v2/games/minesweeper/versions/${bought.game.liveVersion.version}/bundle`, { token: phone.token });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers['content-type'], 'application/zip');
    assert.ok(dl.raw.equals(w.bundle));
    assert.equal(createHash('sha256').update(dl.raw).digest('hex'), bought.game.liveVersion.sha256);
    assert.equal(dl.raw.length, bought.game.liveVersion.sizeBytes);

    // 6. 개발용 로그인으로 연결
    const link = async (token: string, path = '/v2/auth/link') => {
      const nonce = await call(w.handler, 'POST', '/v2/auth/nonce', { token });
      assert.equal(nonce.status, 200);
      return call(w.handler, 'POST', path, { token, body: { provider: 'google', idToken: `dev:e2e-sub:${(nonce.body as { nonce: string }).nonce}` } });
    };
    const linked = await link(phone.token);
    assert.equal(linked.status, 200);
    assert.deepEqual(linked.body, { linked: true, providers: ['guest', 'google'] });

    // 7. 다른 기기 비밀값으로 같은 계정에 들어가기: 새 손님 → 연결 충돌 → 그 계정으로
    const tabletSecret = secret();
    const tablet = (await call(w.handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: tabletSecret } })).body as { userId: string; token: string };
    assert.notEqual(tablet.userId, phone.userId);
    const conflict = await link(tablet.token);
    assert.equal(conflict.status, 409);
    assert.equal(errorCode(conflict.body), 'link_conflict');
    assert.deepEqual((conflict.body as { error: { account: unknown } }).error.account, { coins: 50, games: 1 });
    const resolved = await link(tablet.token, '/v2/auth/link/resolve');
    assert.equal(resolved.status, 200);
    const tabletLogin = resolved.body as { userId: string; token: string };
    assert.equal(tabletLogin.userId, phone.userId);
    const meOnTablet = (await call(w.handler, 'GET', '/v2/me', { token: tabletLogin.token })).body as { userId: string; balance: number; owned: string[]; providers: string[] };
    assert.deepEqual([meOnTablet.userId, meOnTablet.balance, meOnTablet.owned, meOnTablet.providers], [phone.userId, 50, ['game.minesweeper'], ['guest', 'google']]);
    // 세션이 끝나도 기기 비밀값만으로 같은 계정에 다시 들어간다
    const again = (await call(w.handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: tabletSecret } })).body as { userId: string; created: boolean };
    assert.deepEqual([again.userId, again.created], [phone.userId, false]);

    // 8. 계정 삭제 (현금 주문이 없으니 남는 것이 없다)
    const deleted = await call(w.handler, 'DELETE', '/v2/me', { token: tabletLogin.token });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { deleted: true });
    assert.deepEqual(await tablesContaining(w.db, [phone.userId, tablet.userId]), []);
    for (const token of [phone.token, tabletLogin.token]) assert.equal((await call(w.handler, 'GET', '/v2/me', { token })).status, 401);
  } finally {
    await w.close();
  }
});

test('계정을 지운 뒤 그 세션과 기기 비밀값으로는 예전 데이터에 닿지 않는다', async () => {
  const w = await world();
  try {
    const deviceSecret = secret();
    const before = (await call(w.handler, 'POST', '/v2/auth/guest', { body: { deviceSecret } })).body as { userId: string; token: string };
    await playPinball(w, before.token, 400);
    assert.equal((await call(w.handler, 'POST', '/v2/me/attendance', { token: before.token })).status, 200);
    const board = (await call(w.handler, 'GET', '/v2/leaderboards/pinball')).body as { top: unknown[] };
    assert.equal(board.top.length, 1);

    assert.equal((await call(w.handler, 'DELETE', '/v2/me', { token: before.token })).status, 200);

    // 옛 세션은 어디에도 통하지 않는다
    for (const [method, path] of [
      ['GET', '/v2/me'],
      ['GET', '/v2/me/ledger'],
      ['GET', '/v2/me/orders'],
      ['POST', '/v2/me/attendance'],
    ]) {
      const res = await call(w.handler, method, path, { token: before.token });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
    // 같은 기기 비밀값은 새 손님이다
    const after = (await call(w.handler, 'POST', '/v2/auth/guest', { body: { deviceSecret } })).body as { userId: string; token: string; created: boolean };
    assert.equal(after.created, true);
    assert.notEqual(after.userId, before.userId);
    const me = (await call(w.handler, 'GET', '/v2/me', { token: after.token })).body as { balance: number; boards: object; rewards: { attendanceClaimedToday: boolean } };
    assert.deepEqual([me.balance, me.boards, me.rewards.attendanceClaimedToday], [0, {}, false]);
    assert.deepEqual((await call(w.handler, 'GET', '/v2/me/ledger', { token: after.token })).body, { entries: [], next: null });
    // 순위표에서도 사라졌다
    assert.equal(((await call(w.handler, 'GET', '/v2/leaderboards/pinball')).body as { top: unknown[] }).top.length, 0);
    assert.deepEqual(await tablesContaining(w.db, [before.userId]), []);
  } finally {
    await w.close();
  }
});

test('GET /healthz는 200 { ok: true }', async () => {
  const { db, close } = await testDb();
  try {
    const handler = buildServer({ db, config: testConfig, now: () => new Date(), verify: devVerifier() });
    const res = await call(handler, 'GET', '/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  } finally {
    await close();
  }
});
