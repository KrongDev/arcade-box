import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSession, findUserByIdentity, getUser, issueNonce, linkIdentity, listProviders, registerOrLoginGuest, resolveLink, updateSettings, type DeletionPolicy } from '../../src/account/index.ts';
import { authNonces, sessions, userIdentities, users } from '../../src/account/schema.ts';
import { sha256Hex } from '../../src/shared/crypto.ts';
import type { Db, Q } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { fakeClock } from '../helpers/clock.ts';
import { testDb } from '../helpers/db.ts';
import { call } from '../helpers/http.ts';
import { dumpAppSchema, tablesContaining } from '../helpers/scan.ts';
import { accountHandler, DAY_MS, googleKit, loginGuest, noPolicy, TTL_DAYS, type Guest } from './helpers.ts';

const START = '2026-11-26T03:00:00.000Z';
const kit = await googleKit();

const rule = (status: number, code: string) => (err: unknown) => {
  assert.ok(err instanceof RuleError, `RuleError가 아니에요: ${String(err)}`);
  assert.equal(`${err.status} ${err.code}`, `${status} ${code}`);
  return true;
};

/** 코인과 게임 수를 사용자별로 정해 둔 가짜 요약 (진짜는 조립이 wallet·entitlement로 만든다) */
function fakeSummaries() {
  const byUser = new Map<string, { coins: number; games: number }>();
  const summarize = async (_q: Q, userId: string) => byUser.get(userId) ?? { coins: 0, games: 0 };
  return { byUser, summarize };
}

/** nonce를 받아 그 nonce가 든 구글 토큰을 만든다 (앱이 구글 로그인에 nonce를 넣어 받는 것과 같다) */
async function googleToken(db: Db, now: Date, sub: string, extra: Record<string, unknown> = {}): Promise<string> {
  const nonce = await issueNonce(db, now);
  return kit.sign({ sub, nonce, ...extra });
}

/** 구글 계정이 붙은 사용자를 하나 만든다 */
async function linkedUser(db: Db, now: Date, sub: string): Promise<Guest> {
  const device = await loginGuest(db, now);
  const { summarize } = fakeSummaries();
  await linkIdentity(db, device.session, { provider: 'google', idToken: await googleToken(db, now, sub) }, kit.verify, now, summarize);
  return device;
}

test('처음 연결: 지금 사용자에게 구글 수단이 붙고 기기 수단은 그대로다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { summarize } = fakeSummaries();
    const me = await loginGuest(db, clock());
    const before = await db.select().from(userIdentities);
    const idToken = await googleToken(db, clock(), 'google-sub-1');
    assert.equal((await db.select().from(authNonces)).length, 1);

    const result = await linkIdentity(db, me.session, { provider: 'google', idToken }, kit.verify, clock(), summarize);
    assert.deepEqual(result, { linked: true, providers: ['guest', 'google'] });

    const after = await db.select().from(userIdentities);
    assert.equal(after.length, 2);
    assert.deepEqual(
      after.find((i) => i.provider === 'guest'),
      before[0],
      '기기 수단은 그대로다',
    );
    const google = after.find((i) => i.provider === 'google');
    assert.equal(google?.userId, me.userId);
    assert.equal(google?.subject, 'google-sub-1');
    assert.deepEqual(await listProviders(db, me.userId), ['guest', 'google']);
    assert.equal(await findUserByIdentity(db, 'google', 'google-sub-1'), me.userId);
    assert.equal(await findUserByIdentity(db, 'google', 'nobody'), null);
    assert.equal(await findUserByIdentity(db, 'apple', 'google-sub-1'), null);

    assert.deepEqual(await db.select().from(authNonces), [], 'nonce는 한 번 쓰면 지워진다');
    assert.equal((await db.select().from(users)).length, 1);
    // 세션은 그대로 통한다
    assert.deepEqual(await findSession(db, me.tokenHash, clock()), me.session);
  } finally {
    await close();
  }
});

test('nonce가 토큰의 것과 다르거나, 이미 썼거나, 5분이 지났으면 401 token_invalid', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { summarize } = fakeSummaries();
    const me = await loginGuest(db, clock());
    const link = (idToken: string) => linkIdentity(db, me.session, { provider: 'google', idToken }, kit.verify, clock(), summarize);

    // 서버가 준 적 없는 nonce
    await issueNonce(db, clock());
    await assert.rejects(link(await kit.sign({ sub: 'g-1', nonce: 'made-up-by-the-app-0123456789' })), rule(401, 'token_invalid'));
    // nonce가 없는 토큰
    await assert.rejects(link(await kit.sign({ sub: 'g-1' })), rule(401, 'token_invalid'));
    // nonce의 해시를 nonce 자리에 넣은 토큰 (DB를 본 사람이 해시로는 연결하지 못한다)
    const [stored] = await db.select().from(authNonces);
    await assert.rejects(link(await kit.sign({ sub: 'g-1', nonce: stored.nonceHash })), rule(401, 'token_invalid'));
    assert.deepEqual(await listProviders(db, me.userId), ['guest'], '아무것도 붙지 않았다');

    // 5분: 4분 59초에는 되고, 5분이 되는 시각부터는 안 된다
    const late = await googleToken(db, clock(), 'g-late');
    const inTime = await googleToken(db, clock(), 'g-1');
    clock.advance(5 * 60_000 - 1000);
    assert.equal((await link(inTime)).linked, true);
    clock.advance(1000);
    await assert.rejects(link(late), rule(401, 'token_invalid'));

    // 이미 쓴 nonce: 같은 토큰을 다시 보내면 거절한다
    await assert.rejects(link(inTime), rule(401, 'token_invalid'));
    // 다른 기기가 훔친 토큰을 다시 써도 마찬가지다
    const thief = await loginGuest(db, clock());
    await assert.rejects(linkIdentity(db, thief.session, { provider: 'google', idToken: inTime }, kit.verify, clock(), summarize), rule(401, 'token_invalid'));
    await assert.rejects(resolveLink(db, thief.session, { provider: 'google', idToken: inTime }, kit.verify, clock(), TTL_DAYS, noPolicy), rule(401, 'token_invalid'));
    assert.deepEqual(await listProviders(db, thief.userId), ['guest']);
    assert.equal(await findUserByIdentity(db, 'google', 'g-1'), me.userId);

    // 지난 nonce는 새 nonce를 받을 때 치워진다
    await issueNonce(db, clock());
    assert.equal((await db.select().from(authNonces)).length, 1);
  } finally {
    await close();
  }
});

test('연결 요청의 모양이 틀리면 400이고, 못 믿을 토큰은 401 token_invalid다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { summarize } = fakeSummaries();
    const me = await loginGuest(db, clock());
    const idToken = await googleToken(db, clock(), 'g-1');
    const link = (input: unknown) => linkIdentity(db, me.session, input, kit.verify, clock(), summarize);
    for (const input of [null, [], 'x', 7]) await assert.rejects(link(input), rule(400, 'invalid_body'), JSON.stringify(input));
    for (const input of [{}, { provider: 'google' }, { provider: 'google', idToken: 7 }, { provider: 'google', idToken: '' }, { provider: 'google', idToken: 'a'.repeat(8193) }]) {
      await assert.rejects(link(input), rule(400, 'invalid_id_token'), JSON.stringify(input)?.slice(0, 60));
    }
    for (const input of [{ idToken }, { provider: 7, idToken }, { provider: 'apple', idToken }, { provider: 'guest', idToken }]) {
      await assert.rejects(link(input), rule(400, 'invalid_provider'), JSON.stringify(input).slice(0, 40));
    }
    await assert.rejects(link({ provider: 'google', idToken: await kit.sign({ sub: 'g-1', nonce: 'x' }, { expiresInSeconds: -5 }) }), rule(401, 'token_invalid'));
    // 거절된 요청은 nonce를 쓰지 않았다: 같은 토큰이 아직 통한다
    assert.equal((await link({ provider: 'google', idToken })).linked, true);
  } finally {
    await close();
  }
});

test('이미 있는 계정: 409 link_conflict와 양쪽 요약을 주고 아무것도 바뀌지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { byUser, summarize } = fakeSummaries();
    const account = await linkedUser(db, clock(), 'g-1'); // 예전 폰
    const device = await loginGuest(db, clock()); // 새 폰의 손님
    byUser.set(account.userId, { coins: 5200, games: 3 });
    byUser.set(device.userId, { coins: 40, games: 1 });

    const idToken = await googleToken(db, clock(), 'g-1');
    const before = await dumpAppSchema(db);
    await assert.rejects(linkIdentity(db, device.session, { provider: 'google', idToken }, kit.verify, clock(), summarize), (err: unknown) => {
      assert.ok(err instanceof RuleError);
      assert.equal(`${err.status} ${err.code}`, '409 link_conflict');
      assert.deepEqual(err.detail, { account: { coins: 5200, games: 3 }, device: { coins: 40, games: 1 } });
      return true;
    });
    assert.deepEqual(await dumpAppSchema(db), before, '아무것도 바뀌지 않는다 (nonce도 쓰지 않은 것으로 남는다)');

    // HTTP로는 오류 본문에 양쪽 요약이 실려 나간다
    const handler = accountHandler(db, clock, { verify: kit.verify, summarize });
    const res = await call(handler, 'POST', '/v2/auth/link', { token: device.token, body: { provider: 'google', idToken } });
    assert.equal(res.status, 409);
    const error = (res.body as { error: Record<string, unknown> }).error;
    assert.equal(error.code, 'link_conflict');
    assert.equal(typeof error.message, 'string');
    assert.deepEqual(error.account, { coins: 5200, games: 3 });
    assert.deepEqual(error.device, { coins: 40, games: 1 });
    assert.ok(!res.raw.toString('utf8').includes(account.userId), '상대 계정의 사용자 번호는 알려 주지 않는다');
    assert.deepEqual(await dumpAppSchema(db), before);
  } finally {
    await close();
  }
});

test('충돌 뒤 같은 토큰으로 resolve: 기기 수단이 그 계정으로 옮겨지고, 손님 사용자가 지워지고, 그 계정의 세션을 준다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { summarize } = fakeSummaries();
    const account = await linkedUser(db, clock(), 'g-1');
    const device = await loginGuest(db, clock());
    await updateSettings(db, device.userId, { sound: false });
    const purged: string[] = [];
    const policy: DeletionPolicy = {
      mustKeepUserRow: async () => false,
      purge: [async (_tx, userId) => void purged.push(userId)],
    };

    const input = { provider: 'google', idToken: await googleToken(db, clock(), 'g-1') };
    await assert.rejects(linkIdentity(db, device.session, input, kit.verify, clock(), summarize), rule(409, 'link_conflict'));
    clock.advance(30_000); // 앱이 물어보는 동안
    const resolved = await resolveLink(db, device.session, input, kit.verify, clock(), TTL_DAYS, policy);

    assert.equal(resolved.userId, account.userId);
    assert.match(resolved.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(resolved.expiresAt.getTime(), clock().getTime() + TTL_DAYS * DAY_MS);

    // 기기 수단이 그 계정으로 옮겨졌다 (같은 행)
    const identityRows = await db.select().from(userIdentities);
    const moved = identityRows.find((i) => i.id === device.session.identityId);
    assert.equal(moved?.userId, account.userId);
    assert.equal(moved?.subject, sha256Hex(device.secret));
    assert.equal(identityRows.length, 3, '계정의 기기 수단, 구글 수단, 옮겨 온 기기 수단');
    assert.ok(identityRows.every((i) => i.userId === account.userId));

    // 손님 사용자와 그 데이터가 지워졌다. 합치지 않는다
    assert.equal(await getUser(db, device.userId), null);
    assert.deepEqual(purged, [device.userId], '다른 도메인의 손님 데이터도 지우라고 시킨다');
    assert.deepEqual(await tablesContaining(db, [device.userId]), []);
    assert.equal(await findSession(db, device.tokenHash, clock()), null, '손님의 세션은 끝났다');

    // 받은 세션은 그 계정의 것이고, 이 기기의 수단으로 들어온 것이다
    assert.deepEqual(await findSession(db, sha256Hex(resolved.token), clock()), { userId: account.userId, identityId: device.session.identityId });
    // 계정의 예전 기기는 그대로다
    assert.deepEqual(await findSession(db, account.tokenHash, clock()), account.session);
    assert.deepEqual(await listProviders(db, account.userId), ['guest', 'google']);

    // nonce를 썼다: 같은 토큰을 다시 보내면 거절한다
    const session = (await findSession(db, sha256Hex(resolved.token), clock()))!;
    await assert.rejects(resolveLink(db, session, input, kit.verify, clock(), TTL_DAYS, policy), rule(401, 'token_invalid'));
    assert.deepEqual(await db.select().from(authNonces), []);
  } finally {
    await close();
  }
});

test('resolve 뒤 세션이 끝나도 기기 비밀값만으로 그 계정에 다시 들어간다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const account = await linkedUser(db, clock(), 'g-1');
    const device = await loginGuest(db, clock());
    const input = { provider: 'google', idToken: await googleToken(db, clock(), 'g-1') };
    const resolved = await resolveLink(db, device.session, input, kit.verify, clock(), TTL_DAYS, noPolicy);

    clock.advance(TTL_DAYS * DAY_MS + 1000);
    assert.equal(await findSession(db, sha256Hex(resolved.token), clock()), null, '세션이 끝났다');

    // 다시 로그인하지 않아도 기기 비밀값만으로 같은 계정이다
    const again = await registerOrLoginGuest(db, device.secret, clock(), TTL_DAYS);
    assert.equal(again.userId, account.userId);
    assert.equal(again.created, false);
    assert.deepEqual(await findSession(db, sha256Hex(again.token), clock()), { userId: account.userId, identityId: device.session.identityId });
    // 계정의 처음 기기도 마찬가지다
    assert.equal((await registerOrLoginGuest(db, account.secret, clock(), TTL_DAYS)).userId, account.userId);
    assert.equal((await db.select().from(users)).length, 1);
  } finally {
    await close();
  }
});

test('충돌 뒤 resolve를 부르지 않으면(취소) 손님 사용자와 그 세션이 그대로다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { summarize } = fakeSummaries();
    const account = await linkedUser(db, clock(), 'g-1');
    const device = await loginGuest(db, clock());
    await updateSettings(db, device.userId, { haptic: false });
    const input = { provider: 'google', idToken: await googleToken(db, clock(), 'g-1') };
    const before = await dumpAppSchema(db);

    await assert.rejects(linkIdentity(db, device.session, input, kit.verify, clock(), summarize), rule(409, 'link_conflict'));
    // 사용자가 "취소"를 골랐다: 앱은 아무것도 보내지 않는다
    clock.advance(10 * 60_000);

    assert.deepEqual(await dumpAppSchema(db), before);
    assert.deepEqual(await getUser(db, device.userId), { id: device.userId, status: 'active', createdAt: START });
    assert.deepEqual(await findSession(db, device.tokenHash, clock()), device.session, '손님의 세션이 그대로 통한다');
    assert.deepEqual(await listProviders(db, device.userId), ['guest']);
    assert.equal(await findUserByIdentity(db, 'google', 'g-1'), account.userId);
    // 같은 기기 비밀값은 여전히 그 손님이다
    assert.equal((await registerOrLoginGuest(db, device.secret, clock(), TTL_DAYS)).userId, device.userId);
    // 5분이 지나서 그 토큰으로는 이제 정리할 수 없다
    await assert.rejects(resolveLink(db, device.session, input, kit.verify, clock(), TTL_DAYS, noPolicy), rule(401, 'token_invalid'));
    assert.deepEqual(await getUser(db, device.userId), { id: device.userId, status: 'active', createdAt: START });
  } finally {
    await close();
  }
});

test('지금 사용자에게 이미 계정 수단이 있고 다른 계정의 구글을 연결하려 하면 409 linked_elsewhere', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { summarize } = fakeSummaries();
    const first = await linkedUser(db, clock(), 'g-1');
    const second = await linkedUser(db, clock(), 'g-2');
    const input = { provider: 'google', idToken: await googleToken(db, clock(), 'g-1') };
    const before = await dumpAppSchema(db);

    await assert.rejects(linkIdentity(db, second.session, input, kit.verify, clock(), summarize), rule(409, 'linked_elsewhere'));
    // 진짜 계정 둘은 resolve로도 합치지 않는다
    await assert.rejects(resolveLink(db, second.session, input, kit.verify, clock(), TTL_DAYS, noPolicy), rule(409, 'linked_elsewhere'));
    assert.deepEqual(await dumpAppSchema(db), before, '아무것도 바뀌지 않는다');
    assert.equal(await findUserByIdentity(db, 'google', 'g-1'), first.userId);
    assert.equal(await findUserByIdentity(db, 'google', 'g-2'), second.userId);

    // 어디에도 붙지 않은 구글 계정이어도, 구글 수단은 사용자마다 하나다
    const third = { provider: 'google', idToken: await googleToken(db, clock(), 'g-3') };
    await assert.rejects(linkIdentity(db, second.session, third, kit.verify, clock(), summarize), rule(409, 'already_linked'));
    assert.equal(await findUserByIdentity(db, 'google', 'g-3'), null);
  } finally {
    await close();
  }
});

test('이미 내게 붙은 구글 계정을 다시 연결하면 그대로 성공이고, 충돌이 없는데 resolve를 부르면 409 no_link_conflict', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { summarize } = fakeSummaries();
    const me = await linkedUser(db, clock(), 'g-1');
    const again = { provider: 'google', idToken: await googleToken(db, clock(), 'g-1') };
    assert.deepEqual(await linkIdentity(db, me.session, again, kit.verify, clock(), summarize), { linked: true, providers: ['guest', 'google'] });
    assert.equal((await db.select().from(userIdentities)).length, 2);

    // 내 계정을 가리키는 토큰으로 resolve
    const mine = { provider: 'google', idToken: await googleToken(db, clock(), 'g-1') };
    await assert.rejects(resolveLink(db, me.session, mine, kit.verify, clock(), TTL_DAYS, noPolicy), rule(409, 'no_link_conflict'));
    // 아무에게도 붙지 않은 구글 계정으로 resolve
    const guest = await loginGuest(db, clock());
    const nobody = { provider: 'google', idToken: await googleToken(db, clock(), 'g-new') };
    await assert.rejects(resolveLink(db, guest.session, nobody, kit.verify, clock(), TTL_DAYS, noPolicy), rule(409, 'no_link_conflict'));
    assert.deepEqual(await getUser(db, guest.userId), { id: guest.userId, status: 'active', createdAt: START }, '손님은 그대로다');
    // 거절된 resolve는 nonce를 쓰지 않았다: 같은 토큰으로 연결이 된다
    assert.equal((await linkIdentity(db, guest.session, nobody, kit.verify, clock(), summarize)).linked, true);
  } finally {
    await close();
  }
});

test('현금 주문이 있는 손님을 resolve로 지우면 사용자 행만 deleted로 남는다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const account = await linkedUser(db, clock(), 'g-1');
    const device = await loginGuest(db, clock());
    const policy: DeletionPolicy = { mustKeepUserRow: async (_tx, userId) => userId === device.userId, purge: [] };
    const input = { provider: 'google', idToken: await googleToken(db, clock(), 'g-1') };
    const resolved = await resolveLink(db, device.session, input, kit.verify, clock(), TTL_DAYS, policy);
    assert.equal(resolved.userId, account.userId);
    assert.equal((await getUser(db, device.userId))?.status, 'deleted');
    assert.deepEqual(await listProviders(db, device.userId), []);
    assert.equal((await db.select().from(sessions)).filter((s) => s.userId === device.userId).length, 0);
  } finally {
    await close();
  }
});

test('DB에 이메일이나 이름이 저장되지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const clock = fakeClock(START);
    const { summarize } = fakeSummaries();
    const personal = {
      email: 'gildong.hong@example.com',
      email_verified: true,
      name: '홍길동',
      given_name: '길동',
      family_name: '홍씨집안',
      picture: 'https://lh3.googleusercontent.com/a/photo-of-gildong',
      locale: 'ko-KR-x-private',
    };
    const me = await loginGuest(db, clock());
    const nonce = await issueNonce(db, clock());
    const idToken = await kit.sign({ sub: 'google-sub-77', nonce, ...personal });
    await linkIdentity(db, me.session, { provider: 'google', idToken }, kit.verify, clock(), summarize);

    // 충돌과 정리를 거친 기기도 마찬가지다
    const device = await loginGuest(db, clock());
    const nonce2 = await issueNonce(db, clock());
    const idToken2 = await kit.sign({ sub: 'google-sub-77', nonce: nonce2, ...personal });
    await assert.rejects(linkIdentity(db, device.session, { provider: 'google', idToken: idToken2 }, kit.verify, clock(), summarize), rule(409, 'link_conflict'));
    const stillThere = await db.select().from(authNonces);
    assert.deepEqual(stillThere.map((n) => n.nonceHash), [sha256Hex(nonce2)], 'nonce도 해시로만 둔다');
    const resolved = await resolveLink(db, device.session, { provider: 'google', idToken: idToken2 }, kit.verify, clock(), TTL_DAYS, noPolicy);

    // users, user_identities를 비롯한 모든 테이블의 모든 열을 훑는다
    const needles = [personal.email, 'gildong', personal.name, personal.given_name, personal.family_name, personal.picture, personal.locale, 'example.com'];
    assert.deepEqual(await tablesContaining(db, needles), []);
    // 토큰 원문, nonce 원문, 기기 비밀값, 세션 토큰도 없다
    assert.deepEqual(await tablesContaining(db, [idToken, idToken2, idToken.split('.')[1], nonce, nonce2, me.secret, device.secret, me.token, device.token, resolved.token]), []);
    // 저장된 것은 sub뿐이다
    assert.deepEqual(await tablesContaining(db, ['google-sub-77']), ['user_identities']);
    const columns = Object.keys((await db.select().from(userIdentities))[0]).sort();
    assert.deepEqual(columns, ['createdAt', 'id', 'lastUsedAt', 'provider', 'subject', 'userId']);
    assert.deepEqual(Object.keys((await db.select().from(users))[0]).sort(), ['createdAt', 'deletedAt', 'id', 'status']);
  } finally {
    await close();
  }
});

test('HTTP: nonce 받기 → 연결 → 충돌 → 정리까지, 토큰은 응답과 로그에 나오지 않는다', async () => {
  const { db, close } = await testDb();
  const logged: string[] = [];
  const original = { error: console.error, warn: console.warn, log: console.log };
  const capture = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  console.error = capture;
  console.warn = capture;
  console.log = capture;
  try {
    const clock = fakeClock(START);
    const { summarize } = fakeSummaries();
    const handler = accountHandler(db, clock, { verify: kit.verify, summarize });
    const post = (path: string, token: string | undefined, body?: unknown) => call(handler, 'POST', path, { token, body });

    // 로그인해야 쓸 수 있다
    for (const path of ['/v2/auth/nonce', '/v2/auth/link', '/v2/auth/link/resolve', '/v2/auth/logout']) {
      assert.equal((await post(path, undefined, {})).status, 401, path);
    }
    assert.equal((await call(handler, 'DELETE', '/v2/me')).status, 401);

    const a = await loginGuest(db, clock());
    const nonceRes = await post('/v2/auth/nonce', a.token);
    assert.equal(nonceRes.status, 200);
    const nonce = (nonceRes.body as { nonce: string }).nonce;
    assert.match(nonce, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(nonceRes.headers['cache-control'], 'no-store');

    const idToken = await kit.sign({ sub: 'g-http', nonce, email: 'a@example.com' });
    const linked = await post('/v2/auth/link', a.token, { provider: 'google', idToken });
    assert.equal(linked.status, 200);
    assert.deepEqual(linked.body, { linked: true, providers: ['guest', 'google'] });

    // 새 기기에서 같은 구글 계정
    const b = await loginGuest(db, clock());
    const nonceB = ((await post('/v2/auth/nonce', b.token)).body as { nonce: string }).nonce;
    const idTokenB = await kit.sign({ sub: 'g-http', nonce: nonceB });
    const conflict = await post('/v2/auth/link', b.token, { provider: 'google', idToken: idTokenB });
    assert.equal(conflict.status, 409);
    const resolved = await post('/v2/auth/link/resolve', b.token, { provider: 'google', idToken: idTokenB });
    assert.equal(resolved.status, 200);
    const body = resolved.body as { userId: string; token: string; expiresAt: string };
    assert.equal(body.userId, a.userId);
    assert.equal(body.expiresAt, new Date(clock().getTime() + TTL_DAYS * DAY_MS).toISOString());
    assert.equal((await post('/v2/auth/nonce', b.token)).status, 401, '손님의 세션은 끝났다');
    assert.equal((await post('/v2/auth/nonce', body.token)).status, 200, '새 세션으로 들어간다');

    // 못 믿을 토큰: 401이고 보낸 토큰이 응답에 되돌아 나오지 않는다
    const forged = `${idToken.slice(0, -6)}AAAAAA`;
    const rejected = await post('/v2/auth/link', a.token, { provider: 'google', idToken: forged });
    assert.equal(rejected.status, 401);
    assert.equal((rejected.body as { error: { code: string } }).error.code, 'token_invalid');
    assert.ok(!rejected.raw.toString('utf8').includes(forged.slice(0, 40)));

    const everything = logged.join('\n');
    for (const secret of [idToken, idTokenB, forged, nonce, nonceB, a.token, b.token, body.token, a.secret, b.secret, 'a@example.com']) {
      assert.ok(!everything.includes(secret), '로그에 비밀값이 남지 않는다');
    }
  } finally {
    Object.assign(console, original);
    await close();
  }
});
