import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { devVerifier } from '../src/account/index.ts';
import { seed } from '../src/seed.ts';
import { buildServer } from '../src/server.ts';
import { connectPg, isMigrated } from '../src/shared/db/index.ts';
import { testConfig } from '../test/account/helpers.ts';
import { call } from '../test/helpers/http.ts';
import { emptyPgDb, SKIP } from './helpers.ts';

/** 2026-11-26 12:00 KST */
const NOW = new Date('2026-11-26T03:00:00Z');

test('빈 DB에 서버 셋이 같은 순간에 마이그레이션을 적용해도 모두 성공한다 (한 번에 하나씩)', { skip: SKIP }, async () => {
  const { url, drop } = await emptyPgDb();
  const conns = [connectPg(url), connectPg(url), connectPg(url)];
  try {
    const results = await Promise.allSettled(conns.map((c) => c.migrate()));
    assert.deepEqual(
      results.map((r) => (r.status === 'rejected' ? String((r.reason as Error).cause ?? r.reason) : 'ok')),
      ['ok', 'ok', 'ok'],
    );
    assert.equal(await isMigrated(conns[0].db), true);
  } finally {
    for (const c of conns) await c.close();
    await drop();
  }
});

/**
 * v1 서버가 `public`에 만들던 테이블 (지워진 `store-pg.ts`의 DDL 그대로). v2의 테이블과 이름이 겹친다 (`users`, `sessions`, `runs`).
 */
const V1_SCHEMA = `
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
CREATE TABLE user_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE records (
  board TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value DOUBLE PRECISION NOT NULL,
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board, user_id)
);
CREATE INDEX records_board_value_idx ON records (board, value);
CREATE TABLE runs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board TEXT NOT NULL,
  value DOUBLE PRECISION,
  coins INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO users (id, anon_key) VALUES ('11111111-1111-4111-8111-111111111111', 'v1-anon-a'), ('22222222-2222-4222-8222-222222222222', 'v1-anon-b');
INSERT INTO sessions VALUES ('v1-token-hash', '11111111-1111-4111-8111-111111111111', now() + interval '30 days');
INSERT INTO user_state (user_id, state) VALUES ('11111111-1111-4111-8111-111111111111', '{"coins":{"pinball":1234},"owned":["pinball.table.sunset"]}');
INSERT INTO records (board, user_id, value) VALUES ('pinball', '11111111-1111-4111-8111-111111111111', 45000), ('pinball', '22222222-2222-4222-8222-222222222222', 100);
INSERT INTO runs (user_id, board, value, coins) VALUES ('11111111-1111-4111-8111-111111111111', 'pinball', 45000, 120);
`;

/** `public`의 모습: 테이블과 열의 목록, 인덱스와 제약, 그리고 테이블마다 모든 행의 내용 */
async function publicSnapshot(client: pg.Client): Promise<Record<string, unknown>> {
  const rows = async (text: string) => (await client.query(text)).rows as unknown[];
  const tables = (await rows(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)) as Array<{ tablename: string }>;
  const out: Record<string, unknown> = {
    tables: tables.map((t) => t.tablename),
    columns: await rows(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`),
    indexes: await rows(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`),
    constraints: await rows(`SELECT conrelid::regclass::text AS on_table, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conname`),
    sequences: await rows(`SELECT sequencename, last_value::text FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`),
  };
  // 이름은 위 쿼리가 준 public의 테이블 이름이다
  for (const { tablename } of tables) out[`rows:${tablename}`] = await rows(`SELECT t::text AS row FROM public."${tablename}" t ORDER BY 1`);
  return out;
}

test('v1 테이블이 있는 DB에 v2를 띄워도 public은 그대로다 (마이그레이션·처음 자료·요청이 app 스키마만 쓴다)', { skip: SKIP }, async () => {
  const { url, drop } = await emptyPgDb();
  const raw = new pg.Client({ connectionString: url });
  await raw.connect();
  const conn = connectPg(url);
  try {
    await raw.query(V1_SCHEMA);
    const before = await publicSnapshot(raw);
    assert.deepEqual(before.tables, ['records', 'runs', 'sessions', 'user_state', 'users']);

    // 서버가 뜰 때 하는 일(마이그레이션)과, 그 뒤의 처음 자료·요청: 이름이 겹치는 테이블(users, sessions, runs)을 쓰는 것들이다
    await conn.migrate();
    await conn.migrate();
    await seed(conn.db);
    const handler = buildServer({ db: conn.db, config: testConfig, now: () => NOW, verify: devVerifier() });
    const login = await call(handler, 'POST', '/v2/auth/guest', { body: { deviceSecret: randomBytes(32).toString('base64url') } });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const token = (login.body as { token: string }).token;
    const run = await call(handler, 'POST', '/v2/me/runs', { token, body: { boardId: 'pinball', score: 5000, coins: 100 } });
    assert.equal(run.status, 200, JSON.stringify(run.body));
    assert.equal((await call(handler, 'POST', '/v2/me/attendance', { token, body: {} })).status, 200);
    assert.equal((await call(handler, 'GET', '/v2/leaderboards/pinball', { token })).status, 200);
    assert.equal((await call(handler, 'DELETE', '/v2/me', { token })).status, 200);

    assert.deepEqual(await publicSnapshot(raw), before, 'public의 테이블·열·인덱스·제약·행이 하나도 바뀌지 않았다');
    // v2가 만든 것은 app(테이블)과 drizzle(적용 기록)에만 있다
    const made = await raw.query(`SELECT schemaname, count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'public') GROUP BY schemaname ORDER BY schemaname`);
    assert.deepEqual(made.rows.map((r: { schemaname: string }) => r.schemaname), ['app', 'drizzle']);
    assert.ok((made.rows[0] as { n: number }).n >= 20, 'app 스키마에 v2 테이블이 있다');
  } finally {
    await conn.close();
    await raw.end();
    await drop();
  }
});
