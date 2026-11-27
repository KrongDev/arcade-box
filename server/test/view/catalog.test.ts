import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rollback } from '../../src/game/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { gameKit } from '../game/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { call } from '../helpers/http.ts';
import { NOW, seedView, viewHandler } from './helpers.ts';

interface CatalogBody {
  serverDate: string;
  games: Array<{
    id: string;
    name: string;
    description: string;
    iconUrl: string | null;
    sortOrder: number;
    product: { id: string; access: string; price: { currency: string; amount: number } | null } | null;
    liveVersion: { version: number; sizeBytes: number; sha256: string; signature: string; minShellApi: number } | null;
    boards: Array<{ id: string; label: string; ordering: string }>;
  }>;
  products: Array<{ id: string; kind: string; name: string; description: string; iconUrl: string | null; gameId: string | null; slot: string | null; access: string; prices: Array<{ currency: string; amount: number }> }>;
}

test('목록은 live 게임과 on_sale 상품만 담고, 게임마다 상품·가격·지금 버전·순위표가 붙는다', async () => {
  const kit = await gameKit();
  try {
    await seedView(kit);
    const res = await call(viewHandler(kit.db, fakeClock(NOW.toISOString())), 'GET', '/v2/catalog');
    assert.equal(res.status, 200);
    const body = res.body as CatalogBody;
    assert.equal(body.serverDate, '2026-11-26');

    // breakout은 draft라 빠진다. 순서는 sort_order
    assert.deepEqual(
      body.games.map((g) => g.id),
      ['pinball', 'minesweeper'],
    );
    const [pinball, minesweeper] = body.games;
    assert.deepEqual(pinball, {
      id: 'pinball',
      name: '핀볼',
      description: '플리퍼로 공을 튕겨요',
      iconUrl: null,
      sortOrder: 1,
      product: { id: 'game.pinball', access: 'everyone', price: null },
      liveVersion: null,
      boards: [{ id: 'pinball', label: '핀볼', ordering: 'higher' }],
    });
    assert.deepEqual(minesweeper.product, { id: 'game.minesweeper', access: 'purchase', price: { currency: 'COIN', amount: 3000 } });
    assert.equal(minesweeper.liveVersion?.version, 2);
    assert.match(minesweeper.liveVersion?.sha256 ?? '', /^[0-9a-f]{64}$/);
    assert.ok((minesweeper.liveVersion?.signature ?? '').length > 0);
    assert.equal(minesweeper.liveVersion?.minShellApi, 1);
    assert.deepEqual(minesweeper.boards, [
      { id: 'minesweeper.easy', label: '초급', ordering: 'higher' },
      { id: 'minesweeper.normal', label: '중급', ordering: 'higher' },
    ]);

    // 숨김·초안 상품, 내보내지 않은 게임(breakout)의 상품은 빠진다
    assert.deepEqual(body.products.map((p) => p.id).sort(), ['game.minesweeper', 'game.pinball', 'pinball.table.classic', 'pinball.table.sunset']);
    const sunset = body.products.find((p) => p.id === 'pinball.table.sunset');
    assert.deepEqual(sunset, {
      id: 'pinball.table.sunset',
      kind: 'item',
      name: '노을 판',
      description: '',
      iconUrl: null,
      gameId: 'pinball',
      slot: 'table',
      access: 'purchase',
      prices: [{ currency: 'COIN', amount: 1000 }],
    });
  } finally {
    await kit.close();
  }
});

test('버전을 되돌리면 목록의 버전이 이전 것으로 바뀐다', async () => {
  const kit = await gameKit();
  try {
    await seedView(kit);
    const handler = viewHandler(kit.db, fakeClock(NOW.toISOString()));
    const before = (await call(handler, 'GET', '/v2/catalog')).body as CatalogBody;
    assert.equal(before.games.find((g) => g.id === 'minesweeper')?.liveVersion?.version, 2);

    await kit.db.transaction((tx) => rollback(tx, 'minesweeper'));
    const after = (await call(handler, 'GET', '/v2/catalog')).body as CatalogBody;
    const v = after.games.find((g) => g.id === 'minesweeper')?.liveVersion;
    assert.equal(v?.version, 1);
    assert.notEqual(v?.sha256, before.games.find((g) => g.id === 'minesweeper')?.liveVersion?.sha256);
  } finally {
    await kit.close();
  }
});

test('목록은 로그인 없이 받고 60초 캐시 헤더가 있다', async () => {
  const kit = await gameKit();
  try {
    await seedView(kit);
    const handler = viewHandler(kit.db, fakeClock(NOW.toISOString()));
    const anonymous = await call(handler, 'GET', '/v2/catalog');
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.headers['cache-control'], 'public, max-age=60');

    // 캐시를 함께 쓰므로 사용자마다 다른 값이 하나도 없다: 로그인해서 받아도 글자 하나 다르지 않다
    const me = await loginGuest(kit.db, NOW);
    const signedIn = await call(handler, 'GET', '/v2/catalog', { token: me.token });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.raw.toString('utf8'), anonymous.raw.toString('utf8'));
    assert.ok(!signedIn.raw.toString('utf8').includes(me.userId));
  } finally {
    await kit.close();
  }
});
