import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listLedger } from '../../src/wallet/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { dumpAppSchema } from '../helpers/scan.ts';
import { apply, NOW, rule, walletHandler } from './helpers.ts';

interface Entry {
  id: number;
  delta: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
}
type Page = { entries: Entry[]; next: number | null };

const codeOf = (res: { status: number; body: unknown }) => `${res.status} ${(res.body as { error?: { code?: string } } | null)?.error?.code ?? 'ok'}`;

test('기록은 최신부터 나오고 next로 다음 쪽을 이어 받는다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    assert.deepEqual(await listLedger(db, me.userId, { limit: 50 }), { entries: [], next: null }, '기록이 없으면 빈 목록이다');

    // 남의 기록을 사이사이에 끼워서 내 기록의 번호가 이어지지 않게 한다
    const mine: Array<{ id: number; delta: number; balance: number }> = [];
    const deltas = [100, -30, 50, -20, 7];
    for (const [i, delta] of deltas.entries()) {
      const at = new Date(NOW.getTime() + i * 60_000);
      const result = await apply(db, { userId: me.userId, delta, reason: delta > 0 ? 'run' : 'purchase', now: at, idempotencyKey: `mine-${i}-key-0001` });
      mine.push({ id: result.ledgerId, delta, balance: result.balance });
      await apply(db, { userId: other.userId, delta: 1000 + i, reason: 'attendance' });
    }
    const newestFirst = [...mine].reverse();

    const first = await listLedger(db, me.userId, { limit: 2 });
    assert.deepEqual(first, {
      entries: [
        { id: newestFirst[0].id, delta: 7, balanceAfter: 107, reason: 'run', createdAt: '2026-11-26T03:04:00.000Z' },
        { id: newestFirst[1].id, delta: -20, balanceAfter: 100, reason: 'purchase', createdAt: '2026-11-26T03:03:00.000Z' },
      ],
      next: newestFirst[1].id,
    });
    const second = await listLedger(db, me.userId, { before: first.next!, limit: 2 });
    assert.deepEqual(second.entries.map((e) => [e.id, e.delta, e.balanceAfter]), [
      [newestFirst[2].id, 50, 120],
      [newestFirst[3].id, -30, 70],
    ]);
    assert.equal(second.next, newestFirst[3].id);
    const third = await listLedger(db, me.userId, { before: second.next!, limit: 2 });
    assert.deepEqual(third.entries.map((e) => [e.id, e.delta, e.balanceAfter]), [[newestFirst[4].id, 100, 100]]);
    assert.equal(third.next, null, '마지막 쪽에는 next가 없다');

    // 쪽 크기가 남은 기록 수와 딱 맞으면 next가 없다 (빈 쪽을 한 번 더 받게 하지 않는다)
    const all = await listLedger(db, me.userId, { limit: 5 });
    assert.deepEqual(all.entries.map((e) => e.id), newestFirst.map((m) => m.id));
    assert.equal(all.next, null);
    assert.equal((await listLedger(db, me.userId, { limit: 4 })).next, newestFirst[3].id);
    assert.deepEqual((await listLedger(db, me.userId, { before: newestFirst[2].id, limit: 2 })).next, null);
    // 가장 오래된 기록보다 앞은 없다
    assert.deepEqual(await listLedger(db, me.userId, { before: newestFirst[4].id, limit: 50 }), { entries: [], next: null });

    // 응답에는 정해진 다섯 가지만 나간다 (키와 운영 기록 번호는 내보내지 않는다)
    for (const entry of all.entries) assert.deepEqual(Object.keys(entry).sort(), ['balanceAfter', 'createdAt', 'delta', 'id', 'reason']);
  } finally {
    await close();
  }
});

test('listLedger는 limit이 1~100의 정수가 아니거나 before가 1 이상의 정수가 아니면 거절한다', async () => {
  const { db, close } = await testDb();
  try {
    const me = await loginGuest(db, NOW);
    await apply(db, { userId: me.userId, delta: 10, reason: 'run' });
    for (const limit of [0, 101, -1, 1.5, NaN, Infinity, '5' as unknown as number]) {
      await assert.rejects(listLedger(db, me.userId, { limit }), rule(400, 'invalid_limit'), String(limit));
    }
    for (const before of [0, -1, 1.5, NaN, Infinity, 2 ** 53, '5' as unknown as number]) {
      await assert.rejects(listLedger(db, me.userId, { before, limit: 10 }), rule(400, 'invalid_before'), String(before));
    }
    assert.equal((await listLedger(db, me.userId, { limit: 1 })).entries.length, 1);
    assert.equal((await listLedger(db, me.userId, { limit: 100 })).entries.length, 1);
    assert.equal((await listLedger(db, me.userId, { before: Number.MAX_SAFE_INTEGER, limit: 100 })).entries.length, 1);
  } finally {
    await close();
  }
});

test('GET /v2/me/ledger: 내 기록만 보이고, before를 남의 기록 번호로 줘도 남의 것은 보이지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const handler = walletHandler(db, fakeClock(NOW.toISOString()));
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    const idle = await loginGuest(db, NOW);
    const a1 = await apply(db, { userId: me.userId, delta: 100, reason: 'run', now: NOW });
    const b1 = await apply(db, { userId: other.userId, delta: 900, reason: 'grant', now: NOW });
    const a2 = await apply(db, { userId: me.userId, delta: -40, reason: 'purchase', now: NOW });
    const b2 = await apply(db, { userId: other.userId, delta: -1, reason: 'adjust', now: NOW });

    const mine = await call(handler, 'GET', '/v2/me/ledger', { token: me.token });
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body, {
      entries: [
        { id: a2.ledgerId, delta: -40, balanceAfter: 60, reason: 'purchase', createdAt: NOW.toISOString() },
        { id: a1.ledgerId, delta: 100, balanceAfter: 100, reason: 'run', createdAt: NOW.toISOString() },
      ],
      next: null,
    });
    // 숫자가 글자열("100")로 나가지 않는다
    assert.match(mine.raw.toString('utf8'), /"delta":-40,"balanceAfter":60/);
    assert.equal(mine.headers['cache-control'], 'no-store');

    const theirs = (await call(handler, 'GET', '/v2/me/ledger', { token: other.token })).body as Page;
    assert.deepEqual(theirs.entries.map((e) => e.id), [b2.ledgerId, b1.ledgerId]);

    // before에 남의 기록 번호를 넣어도 그 앞의 내 기록만 나온다
    for (const before of [b2.ledgerId, b1.ledgerId, a2.ledgerId, b2.ledgerId + 1000]) {
      const page = (await call(handler, 'GET', `/v2/me/ledger?before=${before}&limit=100`, { token: me.token })).body as Page;
      assert.deepEqual(page.entries.map((e) => e.id), [a2.ledgerId, a1.ledgerId].filter((id) => id < before), `before=${before}`);
    }
    // 사용자를 고르는 값은 받지 않는다: userId를 붙여도 세션의 사용자 것만 나온다
    const sneaky = (await call(handler, 'GET', `/v2/me/ledger?userId=${other.userId}&user_id=${other.userId}`, { token: me.token })).body as Page;
    assert.deepEqual(sneaky.entries.map((e) => e.id), [a2.ledgerId, a1.ledgerId]);

    assert.deepEqual((await call(handler, 'GET', '/v2/me/ledger', { token: idle.token })).body, { entries: [], next: null });
  } finally {
    await close();
  }
});

test('GET /v2/me/ledger: limit은 1~100(기본 50)이고 next로 끝까지 이어 받는다', async () => {
  const { db, close } = await testDb();
  try {
    const handler = walletHandler(db, fakeClock(NOW.toISOString()));
    const me = await loginGuest(db, NOW);
    const ids: number[] = [];
    for (let i = 0; i < 120; i++) ids.push((await apply(db, { userId: me.userId, delta: i + 1, reason: 'run' })).ledgerId);
    const newestFirst = [...ids].reverse();
    const get = async (query: string) => (await call(handler, 'GET', `/v2/me/ledger${query}`, { token: me.token })).body as Page;

    const byDefault = await get('');
    assert.equal(byDefault.entries.length, 50, '기본은 50개');
    assert.deepEqual(byDefault.entries.map((e) => e.id), newestFirst.slice(0, 50));
    assert.equal(byDefault.next, newestFirst[49]);
    assert.equal((await get('?limit=100')).entries.length, 100);
    assert.equal((await get('?limit=1')).entries.length, 1);

    // next를 따라가면 빠짐도 겹침도 없이 전부 받는다
    const seen: number[] = [];
    let cursor: number | null = null;
    let pages = 0;
    do {
      const page: Page = await get(cursor === null ? '?limit=33' : `?limit=33&before=${cursor}`);
      seen.push(...page.entries.map((e) => e.id));
      cursor = page.next;
      pages++;
    } while (cursor !== null && pages < 10);
    assert.deepEqual(seen, newestFirst);
    assert.equal(pages, 4);
  } finally {
    await close();
  }
});

test('GET /v2/me/ledger: 말이 안 되는 limit과 before는 400이다', async () => {
  const { db, close } = await testDb();
  try {
    const handler = walletHandler(db, fakeClock(NOW.toISOString()));
    const me = await loginGuest(db, NOW);
    await apply(db, { userId: me.userId, delta: 10, reason: 'run' });
    const before = await dumpAppSchema(db);

    // 주소에 그대로 적을 수 없는 글자는 %로 적는다: %205는 " 5", %EF%BC%95는 전각 숫자 "５"
    const badLimits = ['0', '101', '-1', '1.5', 'abc', '', '1e2', '0x10', '%205', '5%20', '+5', '%EF%BC%95', '99999999999999999999', 'NaN', 'Infinity', '10;drop'];
    for (const value of badLimits) {
      assert.equal(codeOf(await call(handler, 'GET', `/v2/me/ledger?limit=${value}`, { token: me.token })), '400 invalid_limit', `limit=${value}`);
    }
    const badBefores = ['0', '-1', '1.5', 'abc', '', '1e2', '0x10', '%205', '+5', '9007199254740992', '99999999999999999999', 'null', 'undefined'];
    for (const value of badBefores) {
      assert.equal(codeOf(await call(handler, 'GET', `/v2/me/ledger?before=${value}`, { token: me.token })), '400 invalid_before', `before=${value}`);
    }
    // 같은 이름을 두 번 보내면 어느 것을 쓸지 정하지 않고 거절한다
    assert.equal(codeOf(await call(handler, 'GET', '/v2/me/ledger?limit=1&limit=100', { token: me.token })), '400 invalid_limit');
    assert.equal(codeOf(await call(handler, 'GET', '/v2/me/ledger?before=5&before=6', { token: me.token })), '400 invalid_before');
    // 하나가 맞아도 다른 하나가 틀리면 거절한다
    assert.equal(codeOf(await call(handler, 'GET', '/v2/me/ledger?limit=10&before=x', { token: me.token })), '400 invalid_before');
    assert.equal(codeOf(await call(handler, 'GET', '/v2/me/ledger?limit=x&before=10', { token: me.token })), '400 invalid_limit');

    // 되는 값
    for (const query of ['?limit=1', '?limit=100', '?limit=050', '?before=1', '?before=9007199254740991', '?limit=10&before=3', '?other=1']) {
      assert.equal(codeOf(await call(handler, 'GET', `/v2/me/ledger${query}`, { token: me.token })), '200 ok', query);
    }
    assert.deepEqual(await dumpAppSchema(db), before, '읽기만 한다');
  } finally {
    await close();
  }
});

test('GET /v2/me/ledger: 로그인하지 않았거나 토큰이 틀리면 401이고, 다른 메서드는 405다', async () => {
  const { db, close } = await testDb();
  try {
    const handler = walletHandler(db, fakeClock(NOW.toISOString()));
    const me = await loginGuest(db, NOW);
    await apply(db, { userId: me.userId, delta: 10, reason: 'run' });
    assert.equal(codeOf(await call(handler, 'GET', '/v2/me/ledger')), '401 unauthorized');
    assert.equal(codeOf(await call(handler, 'GET', '/v2/me/ledger', { token: 'x'.repeat(43) })), '401 unauthorized');
    // 틀린 쿼리보다 로그인 확인이 먼저다
    assert.equal(codeOf(await call(handler, 'GET', '/v2/me/ledger?limit=abc')), '401 unauthorized');
    for (const method of ['POST', 'PUT', 'DELETE']) {
      assert.equal(codeOf(await call(handler, method, '/v2/me/ledger', { token: me.token })), '405 method_not_allowed', method);
    }
  } finally {
    await close();
  }
});
