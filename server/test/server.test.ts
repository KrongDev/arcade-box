import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { devVerifier } from '../src/account/index.ts';
import { storeIcon } from '../src/asset/index.ts';
import { grant } from '../src/entitlement/index.ts';
import { createGame, updateGame } from '../src/game/index.ts';
import { createProduct } from '../src/product/index.ts';
import { seed } from '../src/seed.ts';
import { buildServer, chooseVerifier } from '../src/server.ts';
import type { Config } from '../src/shared/config.ts';
import type { Db } from '../src/shared/db/index.ts';
import { applyCoins } from '../src/wallet/index.ts';
import { loginGuest, testConfig } from './account/helpers.ts';
import { fakeClock } from './helpers/clock.ts';
import { testDb } from './helpers/db.ts';
import { call } from './helpers/http.ts';
import { tablesContaining } from './helpers/scan.ts';
import { insertMoneyOrder } from './order/helpers.ts';

const NOW = '2026-11-26T03:00:00Z';

const server = (db: Db, config: Config = testConfig) => buildServer({ db, config, now: fakeClock(NOW), verify: devVerifier() });

test('모든 도메인의 경로가 붙는다: 로그인이 필요한 경로는 토큰 없이 401이고 없는 경로만 404다', async () => {
  const { db, close } = await testDb();
  try {
    const handler = server(db);
    const required: Array<[string, string]> = [
      ['GET', '/v2/me'],
      ['DELETE', '/v2/me'],
      ['PUT', '/v2/me/settings'],
      ['PUT', '/v2/me/equipped'],
      ['POST', '/v2/me/runs'],
      ['POST', '/v2/me/attendance'],
      ['POST', '/v2/me/ad-reward'],
      ['GET', '/v2/me/ledger'],
      ['GET', '/v2/me/orders'],
      ['POST', '/v2/shop/purchase'],
      ['GET', '/v2/games/pinball/versions/1/bundle'],
      ['POST', '/v2/auth/nonce'],
      ['POST', '/v2/auth/link'],
      ['POST', '/v2/auth/link/resolve'],
      ['POST', '/v2/auth/logout'],
    ];
    for (const [method, path] of required) {
      const res = await call(handler, method, path);
      assert.equal(res.status, 401, `${method} ${path}`);
    }
    assert.equal((await call(handler, 'GET', '/v2/catalog')).status, 200);
    const board = await call(handler, 'GET', '/v2/leaderboards/pinball');
    assert.equal((board.body as { error: { code: string } }).error.code, 'unknown_board');
    const guest = await call(handler, 'POST', '/v2/auth/guest', { body: {} });
    assert.equal((guest.body as { error: { code: string } }).error.code, 'invalid_device_secret');
    assert.equal((await call(handler, 'GET', '/v2/nothing')).status, 404);
  } finally {
    await close();
  }
});

test('아이콘 경로가 붙는다: 올린 아이콘을 config.dataDir에서 내려 준다', async () => {
  const { db, close } = await testDb();
  const root = await mkdtemp(join(tmpdir(), 'arcade-server-'));
  try {
    const dataDir = join(root, 'data');
    const source = join(root, 'icon.png');
    // PNG 머리글자 8바이트 뒤에 아무 바이트
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);
    await writeFile(source, bytes);
    const name = await storeIcon(dataDir, source);
    const res = await call(server(db, { ...testConfig, dataDir }), 'GET', `/v2/assets/${name}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.ok(res.raw.equals(bytes));
  } finally {
    await close();
    await rm(root, { recursive: true, force: true });
  }
});

test('조립이 config.clientIpHeader를 넘긴다: 손님 등록의 IP 한도를 그 헤더의 IP로 센다', async () => {
  const { db, close } = await testDb();
  try {
    const handler = server(db, { ...testConfig, clientIpHeader: 'cf-connecting-ip' });
    // 앞단 프록시 뒤라 소켓 주소는 모두 같다
    const guest = (real: string) => call(handler, 'POST', '/v2/auth/guest', { ip: '172.18.0.3', headers: { 'cf-connecting-ip': real }, body: {} });
    for (let i = 0; i < 10; i++) assert.equal((await guest('203.0.113.1')).status, 400);
    assert.equal((await guest('203.0.113.1')).status, 429);
    // 다른 사용자(다른 IP)는 한도를 함께 쓰지 않는다
    assert.equal((await guest('203.0.113.2')).status, 400);
  } finally {
    await close();
  }
});

test('chooseVerifier: devAuth가 아니면 개발용 토큰으로는 연결되지 않고, devAuth면 연결된다', async () => {
  for (const devAuth of [false, true]) {
    const { db, close } = await testDb();
    try {
      const config: Config = { ...testConfig, devAuth, googleClientIds: ['arcade-test.apps.googleusercontent.com'] };
      const handler = buildServer({ db, config, now: fakeClock(NOW), verify: chooseVerifier(config) });
      const me = await loginGuest(db, new Date(NOW));
      const nonce = ((await call(handler, 'POST', '/v2/auth/nonce', { token: me.token })).body as { nonce: string }).nonce;
      const res = await call(handler, 'POST', '/v2/auth/link', { token: me.token, body: { provider: 'google', idToken: `dev:someone-else:${nonce}` } });
      if (devAuth) {
        assert.equal(res.status, 200);
      } else {
        assert.equal(res.status, 401);
        assert.equal((res.body as { error: { code: string } }).error.code, 'token_invalid');
      }
    } finally {
      await close();
    }
  }
});

test('현금 주문이 있는 계정을 DELETE /v2/me로 지우면 사용자 행과 주문만 남는다 (조립의 deletionPolicy, 표 K20)', async () => {
  const { db, close } = await testDb();
  try {
    await seed(db); // 주문의 상품(pinball.ball.gold)
    const handler = server(db);
    const me = await loginGuest(db, new Date(NOW));
    await insertMoneyOrder(db, me.userId, new Date(NOW));
    // 지울 것이 여러 도메인에 있게: 출석(보상·코인 기록·지갑)
    assert.equal((await call(handler, 'POST', '/v2/me/attendance', { token: me.token })).status, 200);

    const res = await call(handler, 'DELETE', '/v2/me', { token: me.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { deleted: true });
    assert.deepEqual((await tablesContaining(db, [me.userId])).sort(), ['orders', 'users']);
    assert.equal((await call(handler, 'GET', '/v2/me', { token: me.token })).status, 401);
  } finally {
    await close();
  }
});

test('연결 충돌의 요약은 wallet의 잔액과 entitlement의 가진 게임 수다 (조립이 넣어 준 summarize)', async () => {
  const { db, close } = await testDb();
  try {
    await db.transaction(async (tx) => {
      await createGame(tx, { id: 'minesweeper', name: '지뢰찾기', description: '' });
      await updateGame(tx, 'minesweeper', { status: 'live' });
      await createProduct(tx, { id: 'game.minesweeper', kind: 'game', name: '지뢰찾기', access: 'purchase', gameId: 'minesweeper', status: 'on_sale' });
    });
    const handler = server(db);
    const at = new Date(NOW);

    // 계정 쪽: 코인 500과 게임 하나를 가진 사용자가 구글 sub-a에 붙어 있다
    const account = await loginGuest(db, at);
    await db.transaction(async (tx) => {
      await applyCoins(tx, { userId: account.userId, delta: 500, reason: 'grant', now: at });
      await grant(tx, { userId: account.userId, productId: 'game.minesweeper', source: 'grant' });
    });
    const link = async (token: string) => {
      const nonce = ((await call(handler, 'POST', '/v2/auth/nonce', { token })).body as { nonce: string }).nonce;
      return call(handler, 'POST', '/v2/auth/link', { token, body: { provider: 'google', idToken: `dev:sub-a:${nonce}` } });
    };
    assert.equal((await link(account.token)).status, 200);

    // 기기 쪽: 새 손님이 같은 구글 계정을 연결하려 한다
    const device = await loginGuest(db, at);
    const res = await link(device.token);
    assert.equal(res.status, 409);
    const error = (res.body as { error: { code: string; account: unknown; device: unknown } }).error;
    assert.equal(error.code, 'link_conflict');
    assert.deepEqual(error.account, { coins: 500, games: 1 });
    assert.deepEqual(error.device, { coins: 0, games: 0 });
  } finally {
    await close();
  }
});
