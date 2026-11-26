import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSession, registerOrLoginGuest } from '../../src/account/index.ts';
import { sessions, userIdentities } from '../../src/account/schema.ts';
import { sha256Hex } from '../../src/shared/crypto.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { accountHandler, DAY_MS, deviceSecret, TTL_DAYS } from './helpers.ts';

const START = '2026-11-26T03:00:00.000Z';

test('세션은 만료 1초 전에는 통하고, 만료 시각부터는 통하지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const handler = accountHandler(db, clock);
    const login = await registerOrLoginGuest(db, deviceSecret(), clock(), TTL_DAYS);
    const tokenHash = sha256Hex(login.token);
    const [identity] = await db.select().from(userIdentities);
    const ends = new Date(START).getTime() + TTL_DAYS * DAY_MS;
    assert.equal(login.expiresAt.getTime(), ends, '30일 뒤에 끝난다');

    // 방금 받은 세션
    assert.deepEqual(await findSession(db, tokenHash, clock()), { userId: login.userId, identityId: identity.id });

    // 만료 1초 전
    clock.set(new Date(ends - 1000).toISOString());
    assert.deepEqual(await findSession(db, tokenHash, clock()), { userId: login.userId, identityId: identity.id });
    assert.equal((await call(handler, 'PUT', '/v2/me/settings', { token: login.token, body: {} })).status, 200);

    // 만료 1밀리초 전
    clock.set(new Date(ends - 1).toISOString());
    assert.notEqual(await findSession(db, tokenHash, clock()), null);

    // 만료 시각
    clock.set(new Date(ends).toISOString());
    assert.equal(await findSession(db, tokenHash, clock()), null);
    const res = await call(handler, 'PUT', '/v2/me/settings', { token: login.token, body: {} });
    assert.equal(res.status, 401);
    assert.equal((res.body as { error: { code: string } }).error.code, 'unauthorized');

    // 그 뒤
    clock.advance(1000);
    assert.equal(await findSession(db, tokenHash, clock()), null);
  } finally {
    await close();
  }
});

test('없는 토큰과 다른 사람의 토큰 해시로는 세션을 찾지 못한다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const login = await registerOrLoginGuest(db, deviceSecret(), clock(), TTL_DAYS);
    assert.equal(await findSession(db, sha256Hex('없는-토큰-없는-토큰-없는-토큰'), clock()), null);
    // 토큰 원문을 해시 자리에 넣어도 찾지 못한다 (서버는 해시로만 찾는다)
    assert.equal(await findSession(db, login.token, clock()), null);
    const handler = accountHandler(db, clock);
    assert.equal((await call(handler, 'PUT', '/v2/me/settings', { token: 'x'.repeat(43), body: {} })).status, 401);
    assert.equal((await call(handler, 'PUT', '/v2/me/settings', { body: {} })).status, 401);
  } finally {
    await close();
  }
});

test('만료된 세션은 다음 로그인 때 지워진다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const secret = deviceSecret();
    const old = await registerOrLoginGuest(db, secret, clock(), TTL_DAYS);
    const otherUser = await registerOrLoginGuest(db, deviceSecret(), clock(), TTL_DAYS);

    // 15일 뒤에 받은 세션은 아직 남아 있어야 한다
    clock.advance(15 * DAY_MS);
    const middle = await registerOrLoginGuest(db, secret, clock(), TTL_DAYS);
    assert.equal((await db.select().from(sessions)).length, 3, '끝나지 않은 세션은 지우지 않는다');

    // 처음 세션이 끝나는 바로 그 시각에 다시 로그인
    clock.set(old.expiresAt.toISOString());
    const fresh = await registerOrLoginGuest(db, secret, clock(), TTL_DAYS);
    const left = (await db.select().from(sessions)).map((s) => s.tokenHash).sort();
    assert.deepEqual(left, [sha256Hex(middle.token), sha256Hex(fresh.token)].sort(), '끝난 세션은 누구의 것이든 지워진다');
    assert.ok(!left.includes(sha256Hex(old.token)));
    assert.ok(!left.includes(sha256Hex(otherUser.token)));
  } finally {
    await close();
  }
});
