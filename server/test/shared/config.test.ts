import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../../src/shared/config.ts';

const BASE = { DATABASE_URL: 'postgres://u:p@db:5432/arcade' };

test('환경 변수가 DATABASE_URL뿐이면 기본값으로 채운다', () => {
  assert.deepEqual(loadConfig(BASE), {
    host: '0.0.0.0',
    port: 8080,
    production: false,
    databaseUrl: BASE.DATABASE_URL,
    allowedOrigins: ['https://localhost', 'capacitor://localhost'],
    sessionTtlDays: 30,
    googleClientIds: [],
    bundlePublicKey: null,
    dataDir: './data',
    devAuth: false,
    clientIpHeader: null,
  });
});

test('환경 변수로 준 값을 읽는다', () => {
  const config = loadConfig({
    ...BASE,
    HOST: '127.0.0.1',
    PORT: '9000',
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: ' https://localhost , http://localhost:5173,',
    SESSION_TTL_DAYS: '7',
    GOOGLE_CLIENT_IDS: 'a.apps.googleusercontent.com, b.apps.googleusercontent.com',
    BUNDLE_PUBLIC_KEY: 'AAAA',
    DATA_DIR: '/data',
    CLIENT_IP_HEADER: 'CF-Connecting-IP',
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 9000);
  assert.equal(config.production, true);
  assert.deepEqual(config.allowedOrigins, ['https://localhost', 'http://localhost:5173']);
  assert.equal(config.sessionTtlDays, 7);
  assert.deepEqual(config.googleClientIds, ['a.apps.googleusercontent.com', 'b.apps.googleusercontent.com']);
  assert.equal(config.bundlePublicKey, 'AAAA');
  assert.equal(config.dataDir, '/data');
  assert.equal(config.devAuth, false);
  assert.equal(config.clientIpHeader, 'cf-connecting-ip');
});

test('빈 글자열로 온 환경 변수는 정하지 않은 것으로 본다', () => {
  // compose에서 `ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}`처럼 넘기고 값을 안 정하면 빈 글자열이 온다
  const config = loadConfig({ ...BASE, HOST: '', PORT: '', ALLOWED_ORIGINS: '', SESSION_TTL_DAYS: '', GOOGLE_CLIENT_IDS: '', BUNDLE_PUBLIC_KEY: '', DATA_DIR: '', AUTH_DEV: '', CLIENT_IP_HEADER: '' });
  assert.deepEqual(config, loadConfig(BASE));
  assert.deepEqual(loadConfig({ ...BASE, ALLOWED_ORIGINS: ' , ,' }).allowedOrigins, ['https://localhost', 'capacitor://localhost']);
  assert.throws(() => loadConfig({ DATABASE_URL: '' }), /DATABASE_URL/);
});

test('DATABASE_URL이 없으면 던진다', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
});

test('개발용 로그인은 AUTH_DEV=1일 때만 켜지고, 운영에서 켜면 던진다', () => {
  assert.equal(loadConfig({ ...BASE, AUTH_DEV: '1' }).devAuth, true);
  assert.equal(loadConfig({ ...BASE, AUTH_DEV: 'true' }).devAuth, false);
  assert.equal(loadConfig({ ...BASE, AUTH_DEV: '0' }).devAuth, false);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'x', AUTH_DEV: '1' }));
});

test('숫자가 아닌 포트·세션 기간, 헤더 이름이 아닌 CLIENT_IP_HEADER는 던진다', () => {
  for (const PORT of ['abc', '0', '70000', '80.5']) assert.throws(() => loadConfig({ ...BASE, PORT }), /PORT/, PORT);
  for (const SESSION_TTL_DAYS of ['abc', '0', '-1', '1.5']) assert.throws(() => loadConfig({ ...BASE, SESSION_TTL_DAYS }), /SESSION_TTL_DAYS/, SESSION_TTL_DAYS);
  for (const CLIENT_IP_HEADER of ['x forwarded', 'a:b', '한글']) assert.throws(() => loadConfig({ ...BASE, CLIENT_IP_HEADER }), /CLIENT_IP_HEADER/, CLIENT_IP_HEADER);
});

test('오류 메시지에 DATABASE_URL의 값이 들어가지 않는다', () => {
  const secret = 'postgres://u:very-secret@db:5432/arcade';
  for (const env of [
    { DATABASE_URL: secret, PORT: 'abc' },
    { DATABASE_URL: secret, NODE_ENV: 'production', AUTH_DEV: '1' },
  ]) {
    assert.throws(
      () => loadConfig(env),
      (err: Error) => !err.message.includes('very-secret'),
    );
  }
});
