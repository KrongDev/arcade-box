import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devVerifier } from '../src/account/index.ts';
import { grant } from '../src/entitlement/index.ts';
import { createGame, updateGame } from '../src/game/index.ts';
import { createProduct } from '../src/product/index.ts';
import { buildServer } from '../src/server.ts';
import type { Db } from '../src/shared/db/index.ts';
import { applyCoins } from '../src/wallet/index.ts';
import { loginGuest, testConfig } from './account/helpers.ts';
import { fakeClock } from './helpers/clock.ts';
import { testDb } from './helpers/db.ts';
import { call } from './helpers/http.ts';

const NOW = '2026-11-26T03:00:00Z';

const server = (db: Db) => buildServer({ db, config: testConfig, now: fakeClock(NOW), verify: devVerifier() });

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
    const icon = await call(handler, 'GET', `/v2/assets/${'a'.repeat(64)}.png`);
    assert.equal(icon.status, 404);
    assert.equal((await call(handler, 'GET', '/v2/nothing')).status, 404);
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
