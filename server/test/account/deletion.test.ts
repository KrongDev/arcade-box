import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { test } from 'node:test';
import { deleteAccount, findSession, findUserByIdentity, getUser, issueNonce, linkIdentity, listProviders, registerOrLoginGuest, updateSettings, type DeletionPolicy } from '../../src/account/index.ts';
import { sessions, userIdentities, users, userSettings } from '../../src/account/schema.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { dumpAppSchema, tablesContaining } from '../helpers/scan.ts';
import { accountHandler, googleKit, loginGuest, TTL_DAYS, type Guest } from './helpers.ts';

const START = '2026-11-26T03:00:00.000Z';
const kit = await googleKit();
const summarize = async () => ({ coins: 0, games: 0 });

/** 구글이 붙고, 설정을 바꿨고, 세션이 둘인 사용자 */
async function fullUser(db: Db, now: Date, sub: string): Promise<Guest> {
  const me = await loginGuest(db, now);
  await linkIdentity(db, me.session, { provider: 'google', idToken: await kit.sign({ sub, nonce: await issueNonce(db, me.userId, now) }) }, kit.verify, now, summarize);
  await updateSettings(db, me.userId, { sound: false });
  await loginGuest(db, now, me.secret);
  return me;
}

/** 불린 순서를 적는 가짜 방침 (진짜는 조립이 order·reward·play·entitlement·wallet의 purgeUser로 만든다) */
function recordingPolicy(keep: boolean) {
  const calls: string[] = [];
  const policy: DeletionPolicy = {
    mustKeepUserRow: async (_tx, userId) => {
      calls.push(`keep? ${userId}`);
      return keep;
    },
    purge: ['order', 'reward', 'play', 'entitlement', 'wallet'].map((name) => async (_tx, userId) => void calls.push(`${name} ${userId}`)),
  };
  return { calls, policy };
}

test('mustKeepUserRow가 거짓이면 사용자 행까지 사라지고 purge가 모두 불린다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const me = await fullUser(db, clock(), 'g-me');
    const other = await fullUser(db, clock(), 'g-other');
    const otherBefore = await dumpAppSchema(db);
    const { calls, policy } = recordingPolicy(false);

    await deleteAccount(db, me.userId, policy);

    assert.equal(await getUser(db, me.userId), null);
    assert.deepEqual(await tablesContaining(db, [me.userId]), [], '이 사용자를 가리키는 행이 어디에도 없다');
    assert.deepEqual(calls, [`keep? ${me.userId}`, `order ${me.userId}`, `reward ${me.userId}`, `play ${me.userId}`, `entitlement ${me.userId}`, `wallet ${me.userId}`]);
    assert.equal(await findSession(db, me.tokenHash, clock()), null);
    assert.equal(await findUserByIdentity(db, 'google', 'g-me'), null);

    // 다른 사용자는 그대로다
    for (const [table, text] of Object.entries(await dumpAppSchema(db))) {
      const kept = otherBefore[table].split('\n').filter((line) => line.includes(other.userId));
      assert.deepEqual(text.split('\n').filter(Boolean), kept, table);
    }
    assert.deepEqual(await findSession(db, other.tokenHash, clock()), other.session);

    // 지운 뒤 같은 기기 비밀값으로 들어오면 새 손님이다 (K20)
    const fresh = await registerOrLoginGuest(db, me.secret, clock(), TTL_DAYS);
    assert.equal(fresh.created, true);
    assert.notEqual(fresh.userId, me.userId);
    // 구글 계정도 다시 쓸 수 있다
    const again = await loginGuest(db, clock(), me.secret);
    const relink = await linkIdentity(db, again.session, { provider: 'google', idToken: await kit.sign({ sub: 'g-me', nonce: await issueNonce(db, again.userId, clock()) }) }, kit.verify, clock(), summarize);
    assert.equal(relink.linked, true);

    // 없는 사용자를 지우라고 해도 던지지 않는다 (같은 요청이 두 번 온 경우)
    await deleteAccount(db, me.userId, policy);
  } finally {
    await close();
  }
});

test('참이면 사용자 행은 status deleted로 남고 로그인 수단·세션·설정은 사라진다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const me = await fullUser(db, clock(), 'g-me');
    const { calls, policy } = recordingPolicy(true);

    await deleteAccount(db, me.userId, policy);

    const [row] = await db.select().from(users);
    assert.equal(row.id, me.userId);
    assert.equal(row.status, 'deleted');
    assert.ok(row.deletedAt instanceof Date);
    assert.deepEqual(await getUser(db, me.userId), { id: me.userId, status: 'deleted', createdAt: START });
    assert.deepEqual(await db.select().from(userIdentities), []);
    assert.deepEqual(await db.select().from(sessions), []);
    assert.deepEqual(await db.select().from(userSettings), []);
    assert.deepEqual(await tablesContaining(db, [me.userId]), ['users'], '사용자 행 말고는 이 사용자를 가리키는 것이 없다');
    assert.deepEqual(await listProviders(db, me.userId), []);
    assert.equal(calls.length, 6, '다른 도메인의 데이터는 똑같이 지우라고 시킨다 (현금 주문을 남기는 것은 order의 purgeUser가 한다)');
    assert.equal(await findSession(db, me.tokenHash, clock()), null);

    // 같은 기기 비밀값은 새 손님이 된다. 지워진 사용자로 들어가지 않는다
    const fresh = await registerOrLoginGuest(db, me.secret, clock(), TTL_DAYS);
    assert.equal(fresh.created, true);
    assert.notEqual(fresh.userId, me.userId);
    assert.equal((await getUser(db, me.userId))?.status, 'deleted');
  } finally {
    await close();
  }
});

test('purge가 중간에 실패하면 아무것도 지워지지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const me = await fullUser(db, clock(), 'g-me');
    const before = await dumpAppSchema(db);
    const policy: DeletionPolicy = {
      mustKeepUserRow: async () => false,
      purge: [
        async (tx, userId) => {
          await tx.delete(userSettings).where(eq(userSettings.userId, userId));
        },
        async () => {
          throw new Error('지갑을 지우다 실패');
        },
      ],
    };
    await assert.rejects(deleteAccount(db, me.userId, policy), /지갑을 지우다 실패/);
    assert.deepEqual(await dumpAppSchema(db), before, '앞선 purge가 지운 것까지 되돌아간다 (한 트랜잭션)');
    assert.deepEqual(await findSession(db, me.tokenHash, clock()), me.session);
  } finally {
    await close();
  }
});

test('getUser는 없는 사용자와 사용자 번호 모양이 아닌 글에 null을 준다', async () => {
  const { db, close } = await testDb();
  try {
    assert.equal(await getUser(db, '11111111-1111-4111-8111-111111111111'), null);
    for (const bad of ['', 'abc', "'; drop table app.users; --", '11111111-1111-4111-8111-11111111111']) assert.equal(await getUser(db, bad), null, bad);
  } finally {
    await close();
  }
});

test('DELETE /v2/me: 200 { deleted: true } 뒤에 그 토큰은 401이고 같은 기기는 새 손님이다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const me = await fullUser(db, clock(), 'g-me');
    const { calls, policy } = recordingPolicy(false);
    const handler = accountHandler(db, clock, { verify: kit.verify, policy });

    const res = await call(handler, 'DELETE', '/v2/me', { token: me.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { deleted: true });
    assert.equal(calls.length, 6);
    assert.equal((await call(handler, 'DELETE', '/v2/me', { token: me.token })).status, 401);
    assert.deepEqual(await db.select().from(users), []);

    const again = await call(handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: me.secret } });
    assert.equal((again.body as { created: boolean }).created, true);
    assert.notEqual((again.body as { userId: string }).userId, me.userId);
  } finally {
    await close();
  }
});
