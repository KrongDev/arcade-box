import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { users } from '../../src/account/schema.ts';
import { createGame, updateGame } from '../../src/game/index.ts';
import { createBoard, leaderboard, nickname } from '../../src/play/index.ts';
import { boardRecords } from '../../src/play/schema.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { loginGuest } from '../account/helpers.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { clearRun, MS, NOW, own, playHandler, rule, seedPlay, send } from './helpers.ts';

interface Entry {
  rank: number;
  name: string;
  value: number;
  me: boolean;
}
interface Body {
  board: { id: string; label: string; ordering: string };
  top: Entry[];
  mine: { rank: number; value: number } | null;
}

async function setup(): Promise<{ db: Db; close(): Promise<void> }> {
  const kit = await testDb();
  await seedPlay(kit.db);
  return kit;
}

/** 시각을 정해 판 하나를 낸다 (사용자마다 첫 판이라 3초 간격에 걸리지 않는다) */
const at = (iso: string) => new Date(iso);

test('higher 순위표는 큰 값이 1등이고 같은 값은 먼저 낸 사람이 앞이다', async () => {
  const { db, close } = await setup();
  try {
    const [a, b, c, d, e] = await Promise.all([1, 2, 3, 4, 5].map(() => loginGuest(db, NOW)));
    // 낸 순서: a 500 → b 900 → c 500 → d 900 → e 100. 같은 값은 먼저 낸 사람이 앞이다
    await send(db, a.userId, { boardId: 'pinball', score: 500, coins: 0 }, at('2026-11-26T03:00:00Z'));
    await send(db, b.userId, { boardId: 'pinball', score: 900, coins: 0 }, at('2026-11-26T03:00:01Z'));
    await send(db, c.userId, { boardId: 'pinball', score: 500, coins: 0 }, at('2026-11-26T03:00:02Z'));
    await send(db, d.userId, { boardId: 'pinball', score: 900, coins: 0 }, at('2026-11-26T03:00:03Z'));
    await send(db, e.userId, { boardId: 'pinball', score: 100, coins: 0 }, at('2026-11-26T03:00:04Z'));

    const out = await leaderboard(db, 'pinball', 50, null);
    assert.deepEqual(out.board, { id: 'pinball', label: '핀볼', ordering: 'higher' });
    assert.deepEqual(
      out.top.map((r) => [r.name, r.value, r.rank]),
      [
        [nickname(b.userId), 900, 1],
        [nickname(d.userId), 900, 1],
        [nickname(a.userId), 500, 3],
        [nickname(c.userId), 500, 3],
        [nickname(e.userId), 100, 5],
      ],
      '같은 값은 같은 등수이고(v1의 RANK와 같다) 먼저 낸 사람이 앞에 온다',
    );
    assert.equal(out.mine, null);
    assert.ok(out.top.every((r) => r.me === false));

    // 나중에 같은 점수를 또 내도 낸 시각은 처음 그대로라 순서가 바뀌지 않는다
    await send(db, b.userId, { boardId: 'pinball', score: 900, coins: 0 }, at('2026-11-26T04:00:00Z'));
    assert.deepEqual((await leaderboard(db, 'pinball', 2, null)).top.map((r) => r.name), [nickname(b.userId), nickname(d.userId)]);
    // 더 높은 점수를 내면 올라간다
    await send(db, e.userId, { boardId: 'pinball', score: 901, coins: 0 }, at('2026-11-26T04:00:01Z'));
    assert.deepEqual((await leaderboard(db, 'pinball', 1, null)).top, [{ rank: 1, name: nickname(e.userId), value: 901, me: false }]);

    // 0점뿐인 사용자와 다른 순위표의 기록은 나오지 않는다
    const z = await loginGuest(db, NOW);
    await send(db, z.userId, { boardId: 'pinball', score: 0, coins: 0 }, at('2026-11-26T04:00:02Z'));
    await send(db, z.userId, { boardId: 'pinball.sprint', won: true, seconds: 10, coins: 0 }, at('2026-11-26T04:00:10Z'));
    assert.equal((await leaderboard(db, 'pinball', 50, z.userId)).top.length, 5);
    assert.equal((await leaderboard(db, 'pinball', 50, z.userId)).mine, null);
    assert.deepEqual((await leaderboard(db, 'breakout', 50, null)).top, []);
  } finally {
    await close();
  }
});

test('lower 순위표는 작은 값이 1등이고 같은 값은 먼저 낸 사람이 앞이다', async () => {
  const { db, close } = await setup();
  try {
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => loginGuest(db, NOW)));
    await send(db, a.userId, { boardId: 'pinball.sprint', won: true, seconds: 40, coins: 0 }, at('2026-11-26T03:00:00Z'));
    await send(db, b.userId, { boardId: 'pinball.sprint', won: true, seconds: 30.5, coins: 0 }, at('2026-11-26T03:00:01Z'));
    await send(db, c.userId, { boardId: 'pinball.sprint', won: true, seconds: 40, coins: 0 }, at('2026-11-26T03:00:02Z'));
    const out = await leaderboard(db, 'pinball.sprint', 50, c.userId);
    assert.equal(out.board.ordering, 'lower');
    assert.deepEqual(
      out.top.map((r) => [r.name, r.value, r.rank, r.me]),
      [
        [nickname(b.userId), 30.5, 1, false],
        [nickname(a.userId), 40, 2, false],
        [nickname(c.userId), 40, 2, true],
      ],
    );
    assert.deepEqual(out.mine, { rank: 2, value: 40 });
  } finally {
    await close();
  }
});

test('이름은 "플레이어 "와 대문자 네 글자이고 사용자 ID가 드러나지 않는다', async () => {
  const { db, close } = await setup();
  try {
    const clock = fakeClock(NOW.toISOString());
    const handler = playHandler(db, clock);
    const me = await loginGuest(db, NOW);
    const other = await loginGuest(db, NOW);
    await send(db, me.userId, { boardId: 'pinball', score: 31000, coins: 0 }, NOW);
    await send(db, other.userId, { boardId: 'pinball', score: 100, coins: 0 }, NOW);

    // v1과 같은 식이다: SHA-256(사용자 ID)의 앞 4자를 대문자로 (`app.ts`의 playerLabel)
    const v1 = (userId: string) => `플레이어 ${createHash('sha256').update(userId).digest('hex').slice(0, 4).toUpperCase()}`;
    assert.equal(nickname(me.userId), v1(me.userId));
    assert.match(nickname(me.userId), /^플레이어 [0-9A-F]{4}$/);

    const r = await call(handler, 'GET', '/v2/leaderboards/pinball', { token: me.token });
    assert.equal(r.status, 200);
    const body = r.body as Body;
    assert.deepEqual(body.top, [
      { rank: 1, name: v1(me.userId), value: 31000, me: true },
      { rank: 2, name: v1(other.userId), value: 100, me: false },
    ]);
    const text = r.raw.toString('utf8');
    for (const secret of [me.userId, other.userId, me.token, me.tokenHash, me.secret]) assert.equal(text.includes(secret), false, '사용자 ID·토큰이 응답에 없다');
    assert.deepEqual(Object.keys(body.top[0]).sort(), ['me', 'name', 'rank', 'value']);
  } finally {
    await close();
  }
});

test('로그인했으면 내 순위가 함께 온다', async () => {
  const { db, close } = await setup();
  try {
    const clock = fakeClock(NOW.toISOString());
    const handler = playHandler(db, clock);
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => loginGuest(db, NOW)));
    await send(db, a.userId, { boardId: 'pinball', score: 300, coins: 0 }, NOW);
    await send(db, b.userId, { boardId: 'pinball', score: 200, coins: 0 }, NOW);
    await send(db, c.userId, { boardId: 'pinball', score: 100, coins: 0 }, NOW);

    // 위쪽 N명 밖이어도 내 순위는 온다
    const mine = (await call(handler, 'GET', '/v2/leaderboards/pinball?limit=1', { token: c.token })).body as Body;
    assert.deepEqual(mine.top, [{ rank: 1, name: nickname(a.userId), value: 300, me: false }]);
    assert.deepEqual(mine.mine, { rank: 3, value: 100 });
    const top = (await call(handler, 'GET', '/v2/leaderboards/pinball', { token: a.token })).body as Body;
    assert.deepEqual(top.top.map((r) => r.me), [true, false, false]);
    assert.deepEqual(top.mine, { rank: 1, value: 300 });

    // 로그인하지 않아도 보인다. 토큰이 틀려도 로그인하지 않은 것으로 보고 보여 준다 (표 K16)
    for (const token of [undefined, 'x'.repeat(43)]) {
      const r = await call(handler, 'GET', '/v2/leaderboards/pinball', { token });
      assert.equal(r.status, 200);
      const body = r.body as Body;
      assert.equal(body.mine, null);
      assert.deepEqual(body.top.map((e) => e.me), [false, false, false]);
      assert.equal(body.top.length, 3);
    }
    // 기록이 없는 사용자는 mine이 null이다
    const d = await loginGuest(db, NOW);
    assert.equal(((await call(handler, 'GET', '/v2/leaderboards/pinball', { token: d.token })).body as Body).mine, null);

    // 지뢰찾기: 더 빨리 깬 사람이 점수가 높아 1등이다 (app.test.ts의 경우)
    await own(db, a.userId, 'minesweeper');
    await own(db, b.userId, 'minesweeper');
    await send(db, a.userId, clearRun('minesweeper.easy', MS.easy, 40), new Date(NOW.getTime() + 5000));
    await send(db, b.userId, clearRun('minesweeper.easy', MS.easy, 30), new Date(NOW.getTime() + 5000));
    const ms = (await call(handler, 'GET', '/v2/leaderboards/minesweeper.easy', { token: a.token })).body as Body;
    assert.equal(ms.board.ordering, 'higher');
    assert.equal(ms.top[0].value, 3100);
    assert.deepEqual(ms.mine, { rank: 2, value: 3000 });
  } finally {
    await close();
  }
});

test('없는 순위표는 404 unknown_board', async () => {
  const { db, close } = await setup();
  try {
    const handler = playHandler(db, fakeClock(NOW.toISOString()));
    for (const id of ['nope', 'PINBALL', 'pinball%2F..', '..%2Fpinball', 'a'.repeat(100), 'pin%00ball', '%E0%A4%A']) {
      const r = await call(handler, 'GET', `/v2/leaderboards/${id}`);
      assert.ok(r.status === 404 || r.status === 400, `${id}: ${r.status}`);
      if (r.status === 404) assert.ok(['unknown_board', 'not_found'].includes((r.body as { error: { code: string } }).error.code), id);
    }
    const r = await call(handler, 'GET', '/v2/leaderboards/nope');
    assert.equal(r.status, 404);
    assert.equal((r.body as { error: { code: string } }).error.code, 'unknown_board');
    await assert.rejects(leaderboard(db, 'nope', 50, null), rule(404, 'unknown_board'));
    await assert.rejects(leaderboard(db, 'pin\u0000ball', 50, null), rule(404, 'unknown_board'));
    // 사용자 ID 모양이 아니면 로그인하지 않은 것처럼 보여 준다 (쿼리 오류가 나지 않는다)
    assert.equal((await leaderboard(db, 'pinball', 50, 'not-a-uuid')).mine, null);
  } finally {
    await close();
  }
});

test('아직 내보내지 않은(draft) 게임의 순위표는 없는 것으로 답한다', async () => {
  const { db, close } = await setup();
  try {
    const handler = playHandler(db, fakeClock(NOW.toISOString()));
    await db.transaction(async (tx) => {
      await createGame(tx, { id: 'secret', name: '출시 전 비밀 게임', description: '' });
      await createBoard(tx, { id: 'secret', gameId: 'secret', label: '출시 전 비밀 게임', ordering: 'higher', minValue: 0, maxValue: 100, maxCoinsPerRun: 1 });
    });
    const hidden = await call(handler, 'GET', '/v2/leaderboards/secret');
    assert.equal(hidden.status, 404);
    assert.equal((hidden.body as { error: { code: string } }).error.code, 'unknown_board');
    assert.equal(hidden.raw.toString('utf8').includes('비밀'), false, '순위표의 이름이 나가지 않는다');
    assert.deepEqual(hidden.body, (await call(handler, 'GET', '/v2/leaderboards/nope')).body, '없는 순위표와 같은 답이다');
    await assert.rejects(leaderboard(db, 'secret', 5, null), rule(404, 'unknown_board'));

    // 내보내면 보이고, 내린(retired) 게임의 순위표는 계속 보인다 (쌓인 기록을 볼 수 있게)
    await db.transaction((tx) => updateGame(tx, 'secret', { status: 'live' }));
    assert.equal((await leaderboard(db, 'secret', 5, null)).board.label, '출시 전 비밀 게임');
    await db.transaction((tx) => updateGame(tx, 'secret', { status: 'retired' }));
    assert.equal((await call(handler, 'GET', '/v2/leaderboards/secret')).status, 200);
  } finally {
    await close();
  }
});

test('limit은 1~100이고 기본은 50이다', async () => {
  const { db, close } = await setup();
  try {
    const handler = playHandler(db, fakeClock(NOW.toISOString()));
    // 사용자 120명과 그 기록을 직접 넣는다 (점수 1000, 999, …)
    const created = await db
      .insert(users)
      .values(Array.from({ length: 120 }, () => ({})))
      .returning({ id: users.id });
    await db.insert(boardRecords).values(created.map((u, i) => ({ boardId: 'pinball', userId: u.id, bestValue: 1000 - i, bestAt: NOW, playCount: 1 })));

    const top = async (query: string) => (await call(handler, 'GET', `/v2/leaderboards/pinball${query}`)).body as Body;
    assert.equal((await top('')).top.length, 50, '기본 50');
    assert.equal((await top('?limit=100')).top.length, 100, '상한 100');
    assert.equal((await top('?limit=1')).top.length, 1);
    const seven = await top('?limit=7');
    assert.deepEqual(seven.top.map((r) => [r.rank, r.value]), [[1, 1000], [2, 999], [3, 998], [4, 997], [5, 996], [6, 995], [7, 994]]);

    for (const bad of ['0', '101', '-1', '1.5', 'abc', '', '1e2', '0x10', '%205', '5&limit=6', '99999999999999999999']) {
      const r = await call(handler, 'GET', `/v2/leaderboards/pinball?limit=${bad}`);
      assert.equal(r.status, 400, bad);
      assert.equal((r.body as { error: { code: string } }).error.code, 'invalid_limit', bad);
    }
    for (const bad of [0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -1]) await assert.rejects(leaderboard(db, 'pinball', bad, null), rule(400, 'invalid_limit'), String(bad));

    // 내 순위는 100등 밖이어도 정확하다
    const last = created[119].id;
    assert.deepEqual((await leaderboard(db, 'pinball', 3, last)).mine, { rank: 120, value: 881 });
  } finally {
    await close();
  }
});
