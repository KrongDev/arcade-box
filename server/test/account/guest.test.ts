import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listProviders, registerOrLoginGuest } from '../../src/account/index.ts';
import { sessions, userIdentities, users, userSettings } from '../../src/account/schema.ts';
import { sha256Hex } from '../../src/shared/crypto.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { dumpAppSchema, tablesContaining } from '../helpers/scan.ts';
import { accountHandler, DAY_MS, deviceSecret, TTL_DAYS } from './helpers.ts';

const NOW = new Date('2026-11-26T03:00:00Z');

test('처음 보는 기기 비밀값이면 사용자·기기 수단·세션이 생기고 created가 true다', async () => {
  const { db, close } = await testDb();
  try {
    const secret = deviceSecret();
    const result = await registerOrLoginGuest(db, secret, NOW, TTL_DAYS);
    assert.equal(result.created, true);
    assert.match(result.userId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.match(result.token, /^[A-Za-z0-9_-]{43}$/, '세션 토큰은 32바이트 난수(base64url)다'); // K7
    assert.equal(result.expiresAt.getTime(), NOW.getTime() + TTL_DAYS * DAY_MS);

    const userRows = await db.select().from(users);
    assert.equal(userRows.length, 1);
    assert.equal(userRows[0].id, result.userId);
    assert.equal(userRows[0].status, 'active');
    assert.equal(userRows[0].deletedAt, null);

    const identityRows = await db.select().from(userIdentities);
    assert.equal(identityRows.length, 1);
    assert.equal(identityRows[0].userId, result.userId);
    assert.equal(identityRows[0].provider, 'guest');

    const sessionRows = await db.select().from(sessions);
    assert.equal(sessionRows.length, 1);
    assert.equal(sessionRows[0].userId, result.userId);
    assert.equal(sessionRows[0].identityId, identityRows[0].id, '어느 기기 수단으로 들어왔는지 세션에 남는다');
    assert.equal(sessionRows[0].expiresAt.getTime(), result.expiresAt.getTime());

    assert.deepEqual(await listProviders(db, result.userId), ['guest']);
    assert.deepEqual(await db.select().from(userSettings), [], '설정 행은 바꿀 때 생긴다');
  } finally {
    await close();
  }
});

test('같은 기기 비밀값으로 다시 부르면 같은 사용자의 새 세션을 준다', async () => {
  const { db, close } = await testDb();
  try {
    const secret = deviceSecret();
    const first = await registerOrLoginGuest(db, secret, NOW, TTL_DAYS);
    const later = new Date(NOW.getTime() + 60_000);
    const second = await registerOrLoginGuest(db, secret, later, TTL_DAYS);
    assert.equal(second.created, false);
    assert.equal(second.userId, first.userId);
    assert.notEqual(second.token, first.token);
    assert.equal(second.expiresAt.getTime(), later.getTime() + TTL_DAYS * DAY_MS);

    assert.equal((await db.select().from(users)).length, 1);
    const identityRows = await db.select().from(userIdentities);
    assert.equal(identityRows.length, 1);
    assert.equal(identityRows[0].lastUsedAt.getTime(), later.getTime(), '수단을 마지막으로 쓴 때가 바뀐다');
    assert.equal((await db.select().from(sessions)).length, 2, '먼저 받은 세션도 끝날 때까지 통한다');

    // 다른 기기 비밀값은 다른 사용자다
    const other = await registerOrLoginGuest(db, deviceSecret(), later, TTL_DAYS);
    assert.equal(other.created, true);
    assert.notEqual(other.userId, first.userId);
  } finally {
    await close();
  }
});

test('DB 어디에도 기기 비밀값과 세션 토큰의 원문이 없다', async () => {
  const { db, close } = await testDb();
  try {
    const secret = deviceSecret();
    const a = await registerOrLoginGuest(db, secret, NOW, TTL_DAYS);
    const b = await registerOrLoginGuest(db, secret, NOW, TTL_DAYS);

    // 저장된 것은 SHA-256 해시다
    const [identity] = await db.select().from(userIdentities);
    assert.equal(identity.subject, sha256Hex(secret));
    const hashes = (await db.select().from(sessions)).map((s) => s.tokenHash).sort();
    assert.deepEqual(hashes, [sha256Hex(a.token), sha256Hex(b.token)].sort());

    // 모든 테이블의 모든 열을 훑는다
    assert.deepEqual(await tablesContaining(db, [secret, a.token, b.token]), []);
    // 훑는 도구가 진짜로 읽고 있다: 해시는 찾아낸다
    assert.deepEqual(await tablesContaining(db, [sha256Hex(secret)]), ['user_identities']);
    assert.deepEqual(await tablesContaining(db, [sha256Hex(a.token)]), ['sessions']);
    assert.deepEqual(Object.keys(await dumpAppSchema(db)).filter((t) => ['users', 'user_identities', 'sessions', 'auth_nonces', 'user_settings'].includes(t)).length, 5);
  } finally {
    await close();
  }
});

test('42자 기기 비밀값과 base64url이 아닌 글자가 든 값은 400 invalid_device_secret', async () => {
  const { db, close } = await testDb();
  try {
    const good = deviceSecret();
    const bad: unknown[] = ['a'.repeat(42), 'a'.repeat(129), `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`, `${'a'.repeat(42)}=`, `${'a'.repeat(42)} `, `${'a'.repeat(42)}한`, `${'a'.repeat(42)}\n`, '', 12345, null, undefined, { a: 1 }, [good]];
    for (const value of bad) {
      await assert.rejects(
        registerOrLoginGuest(db, value as string, NOW, TTL_DAYS),
        (err: unknown) => err instanceof RuleError && err.status === 400 && err.code === 'invalid_device_secret',
        JSON.stringify(value),
      );
    }
    assert.deepEqual(await db.select().from(users), [], '거절한 요청은 아무것도 남기지 않는다');

    // 경계: 43자와 128자는 된다
    assert.equal((await registerOrLoginGuest(db, 'a'.repeat(43), NOW, TTL_DAYS)).created, true);
    assert.equal((await registerOrLoginGuest(db, 'b'.repeat(128), NOW, TTL_DAYS)).created, true);

    // HTTP로도 같다. 오류 응답에 보낸 값이 되돌아 나오지 않는다
    const handler = accountHandler(db, fakeClock(NOW.toISOString()));
    const tooShort = 'Z'.repeat(42);
    const res = await call(handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: tooShort } });
    assert.equal(res.status, 400);
    assert.equal((res.body as { error: { code: string } }).error.code, 'invalid_device_secret');
    assert.ok(!res.raw.toString('utf8').includes(tooShort));
    for (const body of [{}, { deviceSecret: 7 }, [], 'null']) {
      const r = await call(handler, 'POST', '/v2/auth/guest', { body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  } finally {
    await close();
  }
});

test('POST /v2/auth/guest는 세션 토큰과 만료 시각을 주고, 그 토큰으로 로그인이 된다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(NOW.toISOString());
    const handler = accountHandler(db, clock);
    const secret = deviceSecret();
    const first = await call(handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: secret } });
    assert.equal(first.status, 200);
    const body = first.body as { userId: string; token: string; expiresAt: string; created: boolean };
    assert.equal(body.created, true);
    assert.equal(body.expiresAt, new Date(NOW.getTime() + TTL_DAYS * DAY_MS).toISOString());
    assert.equal(first.headers['cache-control'], 'no-store');

    const again = await call(handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: secret } });
    assert.equal((again.body as { userId: string }).userId, body.userId);
    assert.equal((again.body as { created: boolean }).created, false);

    const settings = await call(handler, 'PUT', '/v2/me/settings', { token: body.token, body: { sound: false } });
    assert.equal(settings.status, 200);
  } finally {
    await close();
  }
});

test('POST /v2/auth/guest는 IP당 분당 10번까지다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(NOW.toISOString());
    const handler = accountHandler(db, clock);
    for (let i = 0; i < 10; i++) {
      const ok = await call(handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: deviceSecret() }, ip: '203.0.113.9' });
      assert.equal(ok.status, 200, `${i + 1}번째`);
    }
    const blocked = await call(handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: deviceSecret() }, ip: '203.0.113.9' });
    assert.equal(blocked.status, 429);
    assert.equal((blocked.body as { error: { code: string } }).error.code, 'rate_limited');
    assert.equal((await db.select().from(users)).length, 10, '막힌 요청은 사용자를 만들지 않는다');

    // 다른 IP는 따로 세고, 1분 뒤에는 다시 된다
    assert.equal((await call(handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: deviceSecret() }, ip: '203.0.113.10' })).status, 200);
    clock.advance(60_000);
    assert.equal((await call(handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: deviceSecret() }, ip: '203.0.113.9' })).status, 200);
  } finally {
    await close();
  }
});
