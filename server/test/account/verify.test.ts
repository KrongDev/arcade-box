import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { createLocalJWKSet, generateKeyPair, SignJWT } from 'jose';
import { devVerifier, googleVerifier } from '../../src/account/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { GOOGLE_CLIENT_ID, googleKit } from './helpers.ts';

const kit = await googleKit();
const CLAIMS = { sub: '110169484474386276334', nonce: 'n-abc_123', email: 'someone@example.com', email_verified: true, name: '홍길동' };

function tokenInvalid(token: string) {
  return (err: unknown) => {
    assert.ok(err instanceof RuleError, `RuleError가 아니에요: ${String(err)}`);
    assert.equal(err.status, 401);
    assert.equal(err.code, 'token_invalid');
    // 오류에 토큰이나 그 안의 값이 실려 나가지 않는다
    for (const secret of [token, CLAIMS.email, CLAIMS.name, CLAIMS.sub]) {
      if (secret) assert.ok(!`${err.message} ${JSON.stringify(err.detail ?? {})}`.includes(secret));
    }
    return true;
  };
}

test('맞는 구글 토큰에서 sub와 nonce를 얻는다', async () => {
  const got = await kit.verify('google', await kit.sign(CLAIMS));
  // 이메일과 이름은 돌려주지도 않는다: sub와 nonce만 쓴다
  assert.deepEqual(got, { provider: 'google', sub: CLAIMS.sub, nonce: CLAIMS.nonce });

  // 발급자는 두 가지 모양 모두 구글이다
  assert.deepEqual(await kit.verify('google', await kit.sign(CLAIMS, { issuer: 'accounts.google.com' })), { provider: 'google', sub: CLAIMS.sub, nonce: CLAIMS.nonce });
  // nonce가 없는 토큰은 nonce가 null이다 (연결은 이런 토큰을 받지 않는다)
  assert.deepEqual(await kit.verify('google', await kit.sign({ sub: 'abc' })), { provider: 'google', sub: 'abc', nonce: null });
  // 대상은 우리 앱 ID 가운데 하나면 된다
  const two = googleVerifier(['other.apps.googleusercontent.com', GOOGLE_CLIENT_ID], kit.jwks);
  assert.equal((await two('google', await kit.sign(CLAIMS))).sub, CLAIMS.sub);
});

const otherKey = await generateKeyPair('RS256');
const bads: Record<string, () => Promise<string>> = {
  '서명이 다른 키': () => kit.sign(CLAIMS, { key: otherKey.privateKey }),
  '발급자가 다름': () => kit.sign(CLAIMS, { issuer: 'https://accounts.example.com' }),
  '대상이 우리 앱이 아님': () => kit.sign(CLAIMS, { audience: 'someone-else.apps.googleusercontent.com' }),
  '만료됨': () => kit.sign(CLAIMS, { expiresInSeconds: -1 }),
  '방식이 HS256': () => kit.sign(CLAIMS, { alg: 'HS256', key: new TextEncoder().encode('0123456789abcdef0123456789abcdef') }),
};
for (const [bad, make] of Object.entries(bads)) {
  test(`${bad}: 401 token_invalid`, async () => {
    const token = await make();
    await assert.rejects(kit.verify('google', token), tokenInvalid(token));
  });
}

test('그 밖의 못 믿을 토큰도 401 token_invalid: 만료가 없음, sub가 없음, 깨진 글, 서명 없음(alg none), 공개 키를 비밀값으로 쓴 HS256, 모르는 키', async () => {
  const noExp = await kit.sign(CLAIMS, { expiresInSeconds: null });
  await assert.rejects(kit.verify('google', noExp), tokenInvalid(noExp));

  for (const claims of [{ nonce: 'n' }, { sub: '', nonce: 'n' }, { sub: 12345, nonce: 'n' }, { sub: 'x'.repeat(256), nonce: 'n' }, { sub: 'ok', nonce: 7 }, { sub: 'ok', nonce: '' }]) {
    const token = await kit.sign(claims);
    await assert.rejects(kit.verify('google', token), tokenInvalid(token), JSON.stringify(claims));
  }

  for (const broken of ['', 'abc', 'a.b.c', 'a.b', `${noExp}x`, '한글.토큰.이에요']) {
    await assert.rejects(kit.verify('google', broken), tokenInvalid(broken), broken);
  }

  // 서명을 바꿔 붙인 토큰
  const good = await kit.sign(CLAIMS);
  const [h, p, s] = good.split('.');
  const flipped = `${h}.${p}.${s.slice(0, -4)}${s.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;
  await assert.rejects(kit.verify('google', flipped), tokenInvalid(flipped));
  // 내용을 바꾼 토큰 (서명은 그대로)
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'attacker' })).toString('base64url');
  await assert.rejects(kit.verify('google', `${h}.${forgedPayload}.${s}`), tokenInvalid(`${h}.${forgedPayload}.${s}`));

  // 서명이 없는 토큰
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...CLAIMS, iss: 'https://accounts.google.com', aud: GOOGLE_CLIENT_ID, exp })}.`;
  await assert.rejects(kit.verify('google', unsigned), tokenInvalid(unsigned));

  // 공개 키의 내용을 HMAC 비밀값으로 쓴 HS256 (방식 바꿔치기)
  const confused = await kit.sign(CLAIMS, { alg: 'HS256', key: new TextEncoder().encode(JSON.stringify(kit.publicJwk)) });
  await assert.rejects(kit.verify('google', confused), tokenInvalid(confused));

  // jwks에 없는 kid
  const unknownKid = await kit.sign(CLAIMS, { kid: 'rotated-away' });
  await assert.rejects(kit.verify('google', unknownKid), tokenInvalid(unknownKid));

  // 같은 RSA 키로 서명했어도 방식이 RS256이 아니면 받지 않는다 (공개 키 목록에 방식이 적혀 있지 않은 경우에도).
  // node의 RSA 키는 어느 RSA 방식으로든 서명할 수 있어서 이 확인에 쓴다
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const anyAlg = googleVerifier([GOOGLE_CLIENT_ID], createLocalJWKSet({ keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: 'no-alg' }] }));
  const signAs = (alg: string) =>
    new SignJWT(CLAIMS).setProtectedHeader({ alg, kid: 'no-alg' }).setIssuer('https://accounts.google.com').setAudience(GOOGLE_CLIENT_ID).setExpirationTime('1h').sign(rsa.privateKey);
  assert.equal((await anyAlg('google', await signAs('RS256'))).sub, CLAIMS.sub, 'RS256 토큰은 이 목록으로 통과한다');
  for (const alg of ['PS256', 'RS384', 'RS512']) {
    const other = await signAs(alg);
    await assert.rejects(anyAlg('google', other), tokenInvalid(other), alg);
  }

  // 대상이 여럿인 토큰은 받지 않는다 (구글 ID 토큰의 대상은 하나다)
  const manyAud = await kit.sign(CLAIMS, { audience: [GOOGLE_CLIENT_ID, 'other'] });
  await assert.rejects(kit.verify('google', manyAud), tokenInvalid(manyAud));
});

test('우리 앱 ID를 정하지 않았으면 어떤 토큰도 받지 않는다', async () => {
  const unset = googleVerifier([], kit.jwks);
  const token = await kit.sign(CLAIMS);
  await assert.rejects(unset('google', token), tokenInvalid(token));
});

test('구글이 아닌 수단은 400 invalid_provider (애플은 3번 작업)', async () => {
  const token = await kit.sign(CLAIMS);
  for (const provider of ['apple', 'guest', 'facebook', '', 'GOOGLE']) {
    await assert.rejects(kit.verify(provider, token), (err: unknown) => err instanceof RuleError && err.status === 400 && err.code === 'invalid_provider', provider);
  }
});

test('공개 키를 받아 오지 못하면 503 auth_unavailable이고 토큰 탓으로 돌리지 않는다', async () => {
  const down = googleVerifier([GOOGLE_CLIENT_ID], async () => {
    throw new TypeError('fetch failed');
  });
  const token = await kit.sign(CLAIMS);
  const logged: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  try {
    await assert.rejects(down('google', token), (err: unknown) => err instanceof RuleError && err.status === 503 && err.code === 'auth_unavailable');
  } finally {
    console.warn = original;
  }
  assert.equal(logged.length, 1, '왜 안 되는지 로그에 한 줄 남긴다');
  assert.ok(!logged.join('\n').includes(token), '로그에 토큰이 남지 않는다');
});

test('개발용 확인기는 dev:<sub>:<nonce>를 구글 수단으로 받아들인다', async () => {
  const dev = devVerifier();
  assert.deepEqual(await dev('google', 'dev:alice:nonce-1'), { provider: 'google', sub: 'alice', nonce: 'nonce-1' });
  assert.deepEqual(await dev('google', 'dev:bob_2:'), { provider: 'google', sub: 'bob_2', nonce: null });
  for (const bad of ['', 'alice', 'dev:', 'dev::n', 'dev:a b:n', 'dev:alice', 'prod:alice:n', 'dev:alice:n:extra', `dev:${'a'.repeat(65)}:n`]) {
    await assert.rejects(dev('google', bad), (err: unknown) => err instanceof RuleError && err.status === 401 && err.code === 'token_invalid', bad);
  }
  await assert.rejects(dev('apple', 'dev:alice:n'), (err: unknown) => err instanceof RuleError && err.code === 'invalid_provider');
  // 진짜 구글 토큰은 개발용 확인기를 통과하지 못한다
  await assert.rejects(dev('google', await kit.sign(CLAIMS)), /token_invalid/);
});

test('개발용 확인기는 운영 환경(NODE_ENV=production)에서는 만들어지지 않는다', () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => devVerifier(), /운영/);
    process.env.NODE_ENV = 'development';
    assert.equal(typeof devVerifier(), 'function');
    delete process.env.NODE_ENV;
    assert.equal(typeof devVerifier(), 'function');
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
