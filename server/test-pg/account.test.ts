import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { deleteAccount, devVerifier, issueNonce, linkIdentity, logout, registerOrLoginGuest, resolveLink } from '../src/account/index.ts';
import { authNonces, sessions, userIdentities, users } from '../src/account/schema.ts';
import { sha256Hex } from '../src/shared/crypto.ts';
import type { Db } from '../src/shared/db/index.ts';
import { accountHandler, loginGuest, noPolicy } from '../test/account/helpers.ts';
import { fakeClock } from '../test/helpers/clock.ts';
import { call } from '../test/helpers/http.ts';
import { pgTestDb, SKIP } from './helpers.ts';

const NOW = new Date('2026-11-26T03:00:00Z');
const TTL_DAYS = 30;

test('같은 기기 비밀값으로 동시에 5번 등록하면 사용자는 하나이고 다섯 요청 모두 그 사용자의 세션을 받는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    // 한 번으로는 우연히 지나갈 수 있어서 기기 비밀값을 바꿔 가며 여러 번 한다
    for (let round = 0; round < 5; round++) {
      const secret = randomBytes(32).toString('base64url');
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => registerOrLoginGuest(db, secret, NOW, TTL_DAYS)));
      const failed = results.filter((r) => r.status === 'rejected');
      assert.deepEqual(
        failed.map((r) => String((r as PromiseRejectedResult).reason?.cause?.code ?? (r as PromiseRejectedResult).reason)),
        [],
        '다섯 요청 모두 성공해야 해요',
      );
      const ok = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof registerOrLoginGuest>>>).value);

      const identityRows = await db.select().from(userIdentities);
      const mine = identityRows.filter((i) => i.subject === sha256Hex(secret));
      assert.equal(mine.length, 1, '기기 수단은 하나다');
      assert.deepEqual([...new Set(ok.map((r) => r.userId))], [mine[0].userId], '모두 같은 사용자다');
      assert.equal(ok.filter((r) => r.created).length, 1, '만든 요청은 하나뿐이다');
      assert.equal(new Set(ok.map((r) => r.token)).size, 5, '세션은 저마다 다르다');

      const sessionRows = await db.select().from(sessions);
      for (const r of ok) {
        const row = sessionRows.find((s) => s.tokenHash === sha256Hex(r.token));
        assert.ok(row, '받은 토큰의 세션이 DB에 있다');
        assert.equal(row.userId, mine[0].userId);
        assert.equal(row.identityId, mine[0].id);
      }
      assert.equal((await db.select().from(users)).length, round + 1, '수단이 붙지 않은 사용자 행이 남지 않는다');
    }
  } finally {
    await close();
  }
});

const summarize = async () => ({ coins: 0, games: 0 });

/** nonce를 받아 개발용 토큰(`dev:<sub>:<nonce>`)을 만든다. 서명은 PGlite 테스트가 보고, 여기서는 동시에 온 요청만 본다 */
async function devToken(db: Db, sub: string): Promise<{ provider: string; idToken: string }> {
  return { provider: 'google', idToken: `dev:${sub}:${await issueNonce(db, NOW)}` };
}

const codeOf = (res: { status: number; body: unknown }) => `${res.status} ${(res.body as { error?: { code?: string } } | null)?.error?.code ?? 'ok'}`;

test('같은 nonce와 토큰으로 연결을 동시에 두 번 보내면 수단은 하나만 붙고 어느 쪽도 500이 아니다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    const handler = accountHandler(db, fakeClock(NOW.toISOString()), { verify: devVerifier() });
    for (let round = 0; round < 5; round++) {
      const me = await loginGuest(db, NOW);
      const body = await devToken(db, `same-nonce-${round}`);
      const results = await Promise.all([1, 2].map(() => call(handler, 'POST', '/v2/auth/link', { token: me.token, body })));
      // nonce는 한 번만 쓰인다: 하나는 연결되고 하나는 이미 쓴 nonce로 거절된다
      assert.deepEqual(results.map(codeOf).sort(), ['200 ok', '401 token_invalid'], `${round}번째`);
      const google = (await db.select().from(userIdentities)).filter((i) => i.provider === 'google' && i.subject === `same-nonce-${round}`);
      assert.equal(google.length, 1, '구글 수단은 하나만 붙는다');
      assert.equal(google[0].userId, me.userId);
    }
    assert.deepEqual(await db.select().from(authNonces), [], '쓴 nonce는 남지 않는다');
  } finally {
    await close();
  }
});

test('두 기기가 같은 구글 계정을 동시에 처음 연결하면 하나만 붙고 다른 쪽은 409 link_conflict다 (500 없음)', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    const handler = accountHandler(db, fakeClock(NOW.toISOString()), { verify: devVerifier() });
    for (let round = 0; round < 5; round++) {
      const sub = `race-${round}`;
      const devices = [await loginGuest(db, NOW), await loginGuest(db, NOW)];
      const bodies = [await devToken(db, sub), await devToken(db, sub)];
      const results = await Promise.all(devices.map((d, i) => call(handler, 'POST', '/v2/auth/link', { token: d.token, body: bodies[i] })));
      assert.deepEqual(results.map(codeOf).sort(), ['200 ok', '409 link_conflict'], `${round}번째`);
      const google = (await db.select().from(userIdentities)).filter((i) => i.provider === 'google' && i.subject === sub);
      assert.equal(google.length, 1);
      const winner = devices[results.findIndex((r) => r.status === 200)];
      assert.equal(google[0].userId, winner.userId);
    }
    // 충돌로 끝난 쪽의 nonce는 쓰지 않은 것으로 남는다 (같은 토큰으로 resolve를 부를 수 있다)
    assert.equal((await db.select().from(authNonces)).length, 5);
  } finally {
    await close();
  }
});

test('같은 토큰으로 충돌 정리를 동시에 두 번 보내면 한 번만 옮겨지고 어느 쪽도 500이 아니다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    const handler = accountHandler(db, fakeClock(NOW.toISOString()), { verify: devVerifier() });
    for (let round = 0; round < 5; round++) {
      const sub = `resolve-${round}`;
      const account = await loginGuest(db, NOW);
      await linkIdentity(db, account.session, await devToken(db, sub), devVerifier(), NOW, summarize);
      const device = await loginGuest(db, NOW);
      const body = await devToken(db, sub);
      const results = await Promise.all([1, 2].map(() => call(handler, 'POST', '/v2/auth/link/resolve', { token: device.token, body })));
      assert.deepEqual(results.map(codeOf).sort(), ['200 ok', '401 token_invalid'], `${round}번째`);
      const moved = (await db.select().from(userIdentities)).find((i) => i.id === device.session.identityId);
      assert.equal(moved?.userId, account.userId, '기기 수단이 그 계정으로 옮겨졌다');
      assert.equal((await db.select().from(users)).filter((u) => u.id === device.userId).length, 0, '손님은 지워졌다');
      assert.equal((await db.select().from(sessions)).filter((s) => s.identityId === device.session.identityId && s.userId === account.userId).length, 1, '세션은 하나만 나갔다');
    }
  } finally {
    await close();
  }
});

test('계정 삭제·충돌 정리·로그아웃과 같은 기기의 로그인이 겹쳐도 500이 없고, 세션은 늘 있는 사용자와 수단을 가리킨다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    for (let round = 0; round < 10; round++) {
      // 삭제와 로그인
      const me = await loginGuest(db, NOW);
      const [, ...logins] = await Promise.allSettled([deleteAccount(db, me.userId, noPolicy), ...[1, 2, 3].map(() => registerOrLoginGuest(db, me.secret, NOW, TTL_DAYS))]);
      assert.deepEqual(logins.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.cause?.code ?? (r as PromiseRejectedResult).reason)), [], `삭제와 겹친 로그인 ${round}`);

      // 충돌 정리와 로그인
      const sub = `overlap-${round}`;
      const account = await loginGuest(db, NOW);
      await linkIdentity(db, account.session, await devToken(db, sub), devVerifier(), NOW, summarize);
      const device = await loginGuest(db, NOW);
      const body = await devToken(db, sub);
      const [resolved, ...relogins] = await Promise.allSettled([
        resolveLink(db, device.session, body, devVerifier(), NOW, TTL_DAYS, noPolicy),
        ...[1, 2, 3].map(() => registerOrLoginGuest(db, device.secret, NOW, TTL_DAYS)),
      ]);
      assert.equal(resolved.status, 'fulfilled', `충돌 정리 ${round}: ${String((resolved as PromiseRejectedResult).reason?.cause?.code ?? (resolved as PromiseRejectedResult).reason)}`);
      assert.deepEqual(relogins.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.cause?.code ?? (r as PromiseRejectedResult).reason)), [], `충돌 정리와 겹친 로그인 ${round}`);
      // 정리가 끝난 뒤에는 그 기기 비밀값이 계정을 가리킨다
      assert.equal((await registerOrLoginGuest(db, device.secret, NOW, TTL_DAYS)).userId, account.userId);

      // 로그아웃과 로그인: 로그인은 로그아웃 전이면 그 계정, 뒤면 새 손님이다
      const again = await loginGuest(db, NOW, device.secret);
      const [loggedOut, ...after] = await Promise.allSettled([logout(db, again.session, again.tokenHash), ...[1, 2, 3].map(() => registerOrLoginGuest(db, device.secret, NOW, TTL_DAYS))]);
      assert.equal(loggedOut.status, 'fulfilled', `로그아웃 ${round}: ${String((loggedOut as PromiseRejectedResult).reason?.cause?.code ?? (loggedOut as PromiseRejectedResult).reason)}`);
      assert.deepEqual(after.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason?.cause?.code ?? (r as PromiseRejectedResult).reason)), [], `로그아웃과 겹친 로그인 ${round}`);
      // 로그아웃이 끝난 뒤에는 그 기기 비밀값이 계정을 가리키지 않는다
      assert.notEqual((await registerOrLoginGuest(db, device.secret, NOW, TTL_DAYS)).userId, account.userId);
    }
    // 세션마다 사용자와 수단이 맞는다 (수단이 옮겨진 뒤 옛 사용자를 가리키는 세션이 없다)
    const identityRows = await db.select().from(userIdentities);
    for (const s of await db.select().from(sessions)) {
      assert.equal(identityRows.find((i) => i.id === s.identityId)?.userId, s.userId);
    }
  } finally {
    await close();
  }
});
