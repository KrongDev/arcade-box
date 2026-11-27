import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminActions } from '../src/admin/schema.ts';
import { getGame, updateGame } from '../src/game/index.ts';
import { listBoards } from '../src/play/index.ts';
import { activePrice, getProduct, listCatalogProducts, setPrice, updateProduct } from '../src/product/index.ts';
import { products } from '../src/product/schema.ts';
import { seed, seedCommand } from '../src/seed.ts';
import { SEED } from '../src/seed-data.ts';
import { runCli } from '../src/shared/cli/index.ts';
import type { Db } from '../src/shared/db/index.ts';
import { fakeIo } from './helpers/cli.ts';
import { testDb } from './helpers/db.ts';

/** v1 `domain.ts`의 ITEMS: 무료는 free, 코인 아이템은 코인 가격, 유료 8개는 docs/iap-products.md의 판매가(원) */
const ITEMS: Array<[id: string, price: 'free' | { coin: number } | { krw: number }]> = [
  ['pinball.table.classic', 'free'],
  ['pinball.table.sunset', { coin: 1000 }],
  ['pinball.table.forest', { coin: 1500 }],
  ['pinball.table.candy', { coin: 3000 }],
  ['pinball.table.neon', { krw: 3300 }],
  ['pinball.table.galaxy', { krw: 5500 }],
  ['pinball.ball.silver', 'free'],
  ['pinball.ball.gold', { coin: 1000 }],
  ['pinball.ball.emerald', { coin: 2500 }],
  ['pinball.ball.ruby', { krw: 1100 }],
  ['pinball.ball.fire', { krw: 2200 }],
  ['pinball.ball.thunder', { krw: 4400 }],
  ['minesweeper.tile.basic', 'free'],
  ['minesweeper.tile.mint', { coin: 1000 }],
  ['minesweeper.tile.peach', { coin: 1500 }],
  ['minesweeper.tile.check', { coin: 3000 }],
  ['minesweeper.tile.night', { krw: 3300 }],
  ['minesweeper.tile.gold', { krw: 5500 }],
  ['minesweeper.map.basic', 'free'],
  ['minesweeper.map.forest', { coin: 2000 }],
  ['minesweeper.map.island', { coin: 4000 }],
  ['minesweeper.map.temple', { krw: 4400 }],
  ['breakout.paddle.basic', 'free'],
  ['breakout.paddle.mint', { coin: 1000 }],
  ['breakout.paddle.flame', { coin: 2500 }],
  ['breakout.bricks.basic', 'free'],
  ['breakout.bricks.pastel', { coin: 1500 }],
  ['breakout.bricks.gem', { coin: 3000 }],
];

async function prices(db: Db, id: string) {
  return { coin: (await activePrice(db, id, 'COIN'))?.amount ?? null, krw: (await activePrice(db, id, 'KRW'))?.amount ?? null };
}

test('seed를 두 번 돌려도 두 번째는 created가 0이다', async () => {
  const { db, close } = await testDb();
  try {
    const first = await seed(db);
    assert.deepEqual(first, { created: 3 + 5 + 31, skipped: 0 });
    const second = await seed(db);
    assert.deepEqual(second, { created: 0, skipped: 3 + 5 + 31 });
    assert.equal((await db.select().from(products)).length, 31);
  } finally {
    await close();
  }
});

test('seed는 이미 있는 것을 고치지 않는다: 운영자가 바꾼 이름·가격·상태가 그대로다', async () => {
  const { db, close } = await testDb();
  try {
    await seed(db);
    await db.transaction(async (tx) => {
      await updateProduct(tx, 'game.minesweeper', { name: '지뢰찾기 (새 이름)' });
      await setPrice(tx, 'game.minesweeper', 'COIN', 2500);
      await updateGame(tx, 'breakout', { status: 'retired' });
    });
    await seed(db);
    assert.equal((await getProduct(db, 'game.minesweeper'))?.name, '지뢰찾기 (새 이름)');
    assert.equal((await prices(db, 'game.minesweeper')).coin, 2500);
    assert.equal((await getGame(db, 'breakout'))?.status, 'retired');
  } finally {
    await close();
  }
});

test('seed 뒤: 게임 3, 순위표 5, 유료 아이템 8개는 hidden이고 KRW 가격이 있다', async () => {
  const { db, close } = await testDb();
  try {
    await seed(db);

    // 게임 셋은 live이고 묶음 버전은 아직 없다 (2번 작업에서 올린다)
    for (const id of ['pinball', 'minesweeper', 'breakout']) {
      const game = await getGame(db, id);
      assert.equal(game?.status, 'live', id);
      assert.equal(game?.liveVersion, null, id);
    }

    // 순위표 다섯: v1의 판당 코인 상한 400·400·69·131·220, 지뢰찾기 단계 순서와 판 크기 (표 K12)
    const boards = [...(await listBoards(db, 'pinball')), ...(await listBoards(db, 'breakout')), ...(await listBoards(db, 'minesweeper'))];
    assert.deepEqual(
      boards.map((b) => [b.id, b.ordering, b.minValue, b.maxValue, b.maxCoinsPerRun, b.requiresBoardId, b.validator, b.validatorParams]),
      [
        ['pinball', 'higher', 0, 5_000_000, 400, null, 'caps', null],
        ['breakout', 'higher', 0, 5_000_000, 400, null, 'caps', null],
        ['minesweeper.easy', 'higher', 0, 5_000_000, 69, null, 'minesweeper', { safe: 70, mines: 10, par: 180 }],
        ['minesweeper.normal', 'higher', 0, 5_000_000, 131, 'minesweeper.easy', 'minesweeper', { safe: 180, mines: 36, par: 480 }],
        ['minesweeper.hard', 'higher', 0, 5_000_000, 220, 'minesweeper.normal', 'minesweeper', { safe: 336, mines: 80, par: 900 }],
      ],
    );

    // 게임 상품: 핀볼은 누구나, 나머지 둘은 임시 가격 3000코인
    const gameProduct = async (id: string) => {
      const p = await getProduct(db, id);
      return [p?.kind, p?.gameId, p?.access, p?.status, await prices(db, id)];
    };
    assert.deepEqual(await gameProduct('game.pinball'), ['game', 'pinball', 'everyone', 'on_sale', { coin: null, krw: null }]);
    assert.deepEqual(await gameProduct('game.minesweeper'), ['game', 'minesweeper', 'purchase', 'on_sale', { coin: 3000, krw: null }]);
    assert.deepEqual(await gameProduct('game.breakout'), ['game', 'breakout', 'purchase', 'on_sale', { coin: 3000, krw: null }]);

    // 아이템: 무료는 everyone·on_sale, 코인 아이템은 purchase·on_sale, 유료 8개는 purchase·hidden에 KRW 가격
    let paid = 0;
    for (const [id, price] of ITEMS) {
      const p = await getProduct(db, id);
      assert.ok(p, id);
      const [gameId, slot] = id.split('.');
      assert.deepEqual([p.kind, p.gameId, p.slot, p.consumable], ['item', gameId, slot, false], id);
      const got = await prices(db, id);
      if (price === 'free') {
        assert.deepEqual([p.access, p.status, got], ['everyone', 'on_sale', { coin: null, krw: null }], id);
      } else if ('coin' in price) {
        assert.deepEqual([p.access, p.status, got], ['purchase', 'on_sale', { coin: price.coin, krw: null }], id);
      } else {
        paid++;
        assert.deepEqual([p.access, p.status, got], ['purchase', 'hidden', { coin: null, krw: price.krw }], id);
      }
    }
    assert.equal(paid, 8);

    // 목록의 순서: 게임 상품 셋이 먼저, 그 뒤에 아이템이 v1 ITEMS 순서로 (유료 8개는 hidden이라 빠진다)
    const onSale = (await listCatalogProducts(db)).map((p) => p.id);
    assert.deepEqual(onSale, [
      'game.pinball',
      'game.minesweeper',
      'game.breakout',
      ...ITEMS.filter(([, price]) => price === 'free' || 'coin' in price).map(([id]) => id),
    ]);
    assert.equal(SEED.products.filter((p) => p.kind === 'item').length, ITEMS.length);
  } finally {
    await close();
  }
});

test('seed 명령은 --reason을 받고 운영 기록을 하나 남긴다', async () => {
  const { db, close } = await testDb();
  try {
    const io = fakeIo();
    assert.equal(await runCli(['seed', '--yes'], [seedCommand(db, 'ops')], io), 1);
    assert.equal((await db.select().from(adminActions)).length, 0);

    const ok = fakeIo();
    assert.equal(await runCli(['seed', '--reason', '처음 자료', '--yes'], [seedCommand(db, 'ops')], ok), 0, ok.text());
    assert.match(ok.text(), /만들었어요 39/);
    const acts = await db.select().from(adminActions);
    assert.deepEqual(
      acts.map((a) => [a.actor, a.action, a.reason]),
      [['ops', 'seed', '처음 자료']],
    );
  } finally {
    await close();
  }
});
