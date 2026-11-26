import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSession, issueNonce, linkIdentity, listProviders, logout, registerOrLoginGuest, resolveLink } from '../../src/account/index.ts';
import { sessions, userIdentities, users } from '../../src/account/schema.ts';
import { sha256Hex } from '../../src/shared/crypto.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { dumpAppSchema } from '../helpers/scan.ts';
import { accountHandler, googleKit, loginGuest, noPolicy, TTL_DAYS, type Guest } from './helpers.ts';

const START = '2026-11-26T03:00:00.000Z';
const kit = await googleKit();
const summarize = async () => ({ coins: 0, games: 0 });

async function token(db: Db, now: Date, sub: string) {
  return { provider: 'google', idToken: await kit.sign({ sub, nonce: await issueNonce(db, now) }) };
}

/** 구글 계정 하나에 기기 두 대가 붙은 상태: `first`가 계정을 만들었고 `second`가 나중에 들어왔다 */
async function accountWithTwoDevices(db: Db, now: Date): Promise<{ first: Guest; second: Guest }> {
  const first = await loginGuest(db, now);
  await linkIdentity(db, first.session, await token(db, now, 'g-1'), kit.verify, now, summarize);
  const guest = await loginGuest(db, now);
  await resolveLink(db, guest.session, await token(db, now, 'g-1'), kit.verify, now, TTL_DAYS, noPolicy);
  // 두 번째 기기가 그 계정으로 다시 들어온다
  const second = await loginGuest(db, now, guest.secret);
  assert.equal(second.userId, first.userId);
  return { first, second };
}

test('로그아웃하면 세션이 끝나고 이 기기의 수단이 계정에서 떨어진다. 같은 기기 비밀값은 새 손님이 된다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { first, second } = await accountWithTwoDevices(db, clock());
    // 같은 기기가 받아 둔 다른 세션도 있다
    const secondAgain = await loginGuest(db, clock(), second.secret);

    await logout(db, second.session, second.tokenHash);

    assert.equal(await findSession(db, second.tokenHash, clock()), null, '세션이 끝났다');
    assert.equal(await findSession(db, secondAgain.tokenHash, clock()), null, '이 기기가 받아 둔 다른 세션도 끝났다');
    const identityRows = await db.select().from(userIdentities);
    assert.ok(!identityRows.some((i) => i.id === second.session.identityId), '이 기기의 수단이 지워졌다');
    assert.ok(!identityRows.some((i) => i.subject === sha256Hex(second.secret)));
    assert.deepEqual(await listProviders(db, first.userId), ['guest', 'google']);

    // 같은 기기 비밀값으로는 그 계정에 못 들어간다: 새 손님이 된다
    const fresh = await registerOrLoginGuest(db, second.secret, clock(), TTL_DAYS);
    assert.equal(fresh.created, true);
    assert.notEqual(fresh.userId, first.userId);
    assert.deepEqual(await listProviders(db, fresh.userId), ['guest']);
    assert.equal((await db.select().from(users)).length, 2);
  } finally {
    await close();
  }
});

test('계정에 붙은 다른 기기는 로그아웃의 영향을 받지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { first, second } = await accountWithTwoDevices(db, clock());
    const firstIdentity = (await db.select().from(userIdentities)).find((i) => i.id === first.session.identityId);

    await logout(db, second.session, second.tokenHash);

    assert.deepEqual(await findSession(db, first.tokenHash, clock()), first.session, '다른 기기의 세션은 그대로 통한다');
    assert.deepEqual(
      (await db.select().from(userIdentities)).find((i) => i.id === first.session.identityId),
      firstIdentity,
    );
    assert.equal((await registerOrLoginGuest(db, first.secret, clock(), TTL_DAYS)).userId, first.userId, '다른 기기는 기기 비밀값으로 계속 들어간다');
    assert.equal((await db.select().from(sessions)).filter((s) => s.identityId === first.session.identityId).length, 2);

    // 마지막 기기까지 로그아웃해도 계정은 남는다 (구글 수단만 붙은 채로)
    await logout(db, first.session, first.tokenHash);
    assert.deepEqual(await listProviders(db, first.userId), ['google']);
    assert.equal((await db.select().from(users)).filter((u) => u.id === first.userId).length, 1);
    assert.equal((await db.select().from(sessions)).length, 0);
  } finally {
    await close();
  }
});

test('손님뿐인 사용자는 409 guest_cannot_logout', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const guest = await loginGuest(db, clock());
    const before = await dumpAppSchema(db);
    await assert.rejects(logout(db, guest.session, guest.tokenHash), (err: unknown) => err instanceof RuleError && err.status === 409 && err.code === 'guest_cannot_logout');
    assert.deepEqual(await dumpAppSchema(db), before, '데이터를 잃지 않게 아무것도 지우지 않는다');
    assert.deepEqual(await findSession(db, guest.tokenHash, clock()), guest.session);

    const handler = accountHandler(db, clock, { verify: kit.verify });
    const res = await call(handler, 'POST', '/v2/auth/logout', { token: guest.token });
    assert.equal(res.status, 409);
    assert.equal((res.body as { error: { code: string } }).error.code, 'guest_cannot_logout');
  } finally {
    await close();
  }
});

test('POST /v2/auth/logout: 200 뒤에 그 토큰은 401이다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { first, second } = await accountWithTwoDevices(db, clock());
    const handler = accountHandler(db, clock, { verify: kit.verify });
    const res = await call(handler, 'POST', '/v2/auth/logout', { token: second.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { loggedOut: true });
    assert.equal((await call(handler, 'POST', '/v2/auth/logout', { token: second.token })).status, 401);
    assert.equal((await call(handler, 'PUT', '/v2/me/settings', { token: second.token, body: {} })).status, 401);
    assert.equal((await call(handler, 'PUT', '/v2/me/settings', { token: first.token, body: {} })).status, 200);
  } finally {
    await close();
  }
});
