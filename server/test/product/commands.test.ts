import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { adminActions } from '../../src/admin/schema.ts';
import { activePrice, commands, getProduct } from '../../src/product/index.ts';
import { runCli } from '../../src/shared/cli/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { fakeIo } from '../helpers/cli.ts';
import { testDb } from '../helpers/db.ts';
import { games } from './helpers.ts';

const ACTOR = 'ops-kim';

async function kit() {
  const { db, close } = await testDb();
  const root = await mkdtemp(join(tmpdir(), 'arcade-product-'));
  await games(db, ['pinball']);
  return {
    db,
    root,
    async run(argv: string[], answer = true) {
      const io = fakeIo(answer);
      const code = await runCli(argv, commands(db, ACTOR, { dataDir: join(root, 'data') }), io);
      return { code, text: io.text(), questions: io.questions };
    },
    async close() {
      await close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

const actions = (db: Db) => db.select().from(adminActions).orderBy(adminActions.id);

test('product add, price set은 admin_actions에 남는다', async () => {
  const k = await kit();
  try {
    const added = await k.run(['product', 'add', 'pinball.table.neon', '--kind', 'item', '--game', 'pinball', '--slot', 'table', '--access', 'purchase', '--name', '네온 테이블', '--status', 'on_sale', '--reason', '새 테이블', '--yes']);
    assert.equal(added.code, 0, added.text);
    const priced = await k.run(['price', 'set', 'pinball.table.neon', 'COIN', '2500', '--reason', '첫 가격', '--yes']);
    assert.equal(priced.code, 0, priced.text);
    assert.equal((await activePrice(k.db, 'pinball.table.neon', 'COIN'))?.amount, 2500);
    assert.equal((await k.run(['sku', 'set', 'pinball.table.neon', 'google_play', 'table_neon', '--reason', '스토어 코드', '--yes'])).code, 0);
    assert.equal((await k.run(['price', 'clear', 'pinball.table.neon', 'COIN', '--reason', '판매 중지', '--yes'])).code, 0);
    assert.equal(await activePrice(k.db, 'pinball.table.neon', 'COIN'), null);

    const acts = await actions(k.db);
    assert.deepEqual(
      acts.map((a) => [a.actor, a.action, a.targetRef, a.reason]),
      [
        [ACTOR, 'product.add', 'pinball.table.neon', '새 테이블'],
        [ACTOR, 'price.set', 'pinball.table.neon', '첫 가격'],
        [ACTOR, 'sku.set', 'pinball.table.neon', '스토어 코드'],
        [ACTOR, 'price.clear', 'pinball.table.neon', '판매 중지'],
      ],
    );
    assert.deepEqual(acts[1].params, { positional: ['pinball.table.neon', 'COIN', '2500'], flags: {} });
    assert.match(priced.text, new RegExp(`운영 기록 #${acts[1].id}`));
    const p = await getProduct(k.db, 'pinball.table.neon');
    assert.deepEqual({ kind: p?.kind, gameId: p?.gameId, slot: p?.slot, access: p?.access, status: p?.status, name: p?.name }, { kind: 'item', gameId: 'pinball', slot: 'table', access: 'purchase', status: 'on_sale', name: '네온 테이블' });
  } finally {
    await k.close();
  }
});

test('product update --icon은 아이콘을 저장해 상품에 단다', async () => {
  const k = await kit();
  try {
    assert.equal((await k.run(['product', 'add', 'game.pinball', '--kind', 'game', '--game', 'pinball', '--access', 'everyone', '--name', '핀볼', '--reason', '추가', '--yes'])).code, 0);
    const icon = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(64, 2)]);
    const path = join(k.root, 'icon.webp');
    await writeFile(path, icon);
    const out = await k.run(['product', 'update', 'game.pinball', '--icon', path, '--status', 'on_sale', '--reason', '아이콘', '--yes']);
    assert.equal(out.code, 0, out.text);
    const p = await getProduct(k.db, 'game.pinball');
    const name = `${createHash('sha256').update(icon).digest('hex')}.webp`;
    assert.deepEqual({ iconPath: p?.iconPath, status: p?.status }, { iconPath: name, status: 'on_sale' });

    // 거절되는 명령은 assets/에 아무것도 남기지 않는다: 없는 상품, 고친 뒤 규칙에 안 맞는 상품
    assert.equal((await k.run(['product', 'add', 'pinball.table.neon', '--kind', 'item', '--game', 'pinball', '--slot', 'table', '--access', 'purchase', '--name', '네온', '--reason', '추가', '--yes'])).code, 0);
    await writeFile(path, Buffer.concat([icon, Buffer.from('다른 그림')]));
    for (const argv of [
      ['product', 'update', 'none.here', '--icon', path, '--reason', '아이콘', '--yes'],
      ['product', 'update', 'pinball.table.neon', '--grant-coins', '100', '--icon', path, '--reason', '아이콘', '--yes'],
    ]) {
      const out = await k.run(argv);
      assert.equal(out.code, 1, argv.join(' '));
    }
    assert.deepEqual(await readdir(join(k.root, 'data', 'assets')), [name], '앞서 단 아이콘 하나뿐이다');
    assert.equal((await getProduct(k.db, 'pinball.table.neon'))?.iconPath, null);
  } finally {
    await k.close();
  }
});

test('product 명령은 인자가 틀리면 묻기 전에 거절하고, list·show는 기록을 남기지 않는다', async () => {
  const k = await kit();
  try {
    const bad: string[][] = [
      ['product', 'add', 'pinball.x', '--kind', 'hat', '--game', 'pinball', '--access', 'purchase', '--name', 'x', '--reason', 'r'],
      ['product', 'add', 'pinball.x', '--kind', 'item', '--game', 'pinball', '--access', 'purchase', '--name', 'x', '--reason', 'r'],
      ['product', 'add', 'coins.x', '--kind', 'coin_pack', '--access', 'purchase', '--name', 'x', '--grant-coins', '1.5', '--reason', 'r'],
      ['product', 'update', 'pinball.x', '--reason', 'r'],
      ['price', 'set', 'pinball.x', 'USD', '100', '--reason', 'r'],
      ['price', 'set', 'pinball.x', 'COIN', '-100', '--reason', 'r'],
      ['price', 'set', 'pinball.x', 'COIN', '1e3', '--reason', 'r'],
      ['price', 'clear', 'pinball.x', '--reason', 'r'],
      ['sku', 'set', 'pinball.x', 'steam', 'abc', '--reason', 'r'],
    ];
    for (const argv of bad) {
      const out = await k.run(argv);
      assert.equal(out.code, 1, argv.join(' '));
      assert.deepEqual(out.questions, [], `${argv.join(' ')}: 묻지 않는다`);
    }
    assert.equal((await k.run(['product', 'add', 'coins.1000', '--kind', 'coin_pack', '--access', 'purchase', '--name', '코인 1000', '--grant-coins', '1000', '--reason', '추가', '--yes'])).code, 0);
    assert.equal((await k.run(['price', 'set', 'coins.1000', 'KRW', '1200', '--reason', '가격', '--yes'])).code, 0);
    const list = await k.run(['product', 'list']);
    assert.equal(list.code, 0);
    assert.match(list.text, /coins\.1000/);
    assert.match(list.text, /KRW 1200/);
    const show = await k.run(['product', 'show', 'coins.1000']);
    assert.equal(show.code, 0);
    assert.match(show.text, /grant_coins 1000/);
    assert.match(show.text, /KRW 1200/);
    assert.equal((await k.run(['product', 'show', 'none.here'])).code, 1);
    assert.equal((await actions(k.db)).length, 2);
  } finally {
    await k.close();
  }
});
