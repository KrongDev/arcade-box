import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB_TIMEOUT_DEFAULTS, type DbTimeouts } from '../config.ts';

export { app } from './schema.ts';

/** Drizzle DB. 운영은 node-postgres, 테스트는 PGlite이고 도메인 코드는 어느 쪽인지 모른다 */
export type Db = PgDatabase<PgQueryResultHKT, Record<string, never>>;
/** `db.transaction` 콜백이 받는 것 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** 읽기만 하거나, 부른 쪽의 트랜잭션에 얹혀 쓰는 함수가 받는 것 */
export type Q = Db | Tx;

/** drizzle-kit이 만든 마이그레이션 SQL이 있는 곳 (`server/drizzle`) */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/** 마이그레이션을 한 번에 하나씩 적용하려고 잡는 권고 잠금의 번호 (이 서버만 쓰는 임의의 값) */
const MIGRATION_LOCK = 727_105_131;

/**
 * 진짜 PostgreSQL에 붙는다. `migrate()`는 `server/drizzle`의 SQL 가운데 아직 적용하지 않은 것을 적용한다.
 * 적용 기록은 Drizzle이 스키마 `drizzle`에 둔다 (v1의 `public`은 건드리지 않는다).
 *
 * 연결 풀에는 시간 제한이 걸려 있다 (`timeouts`, 없으면 기본값). 넘으면 그 요청이 오류로 끝나고 트랜잭션은 되돌아간다:
 * - 연결을 얻기까지 `connectMs` — 연결 10개가 모두 쓰이는 중이면 기다리다 `timeout exceeded when trying to connect`
 * - 쿼리 하나에 `statementMs` — 다른 요청이 잠근 지갑을 기다리는 쿼리도 여기서 끊긴다 (PostgreSQL 오류 57014)
 * - 트랜잭션을 연 채 쉬는 시간 `idleInTxMs` — DB가 그 연결을 끊고 잡고 있던 잠금을 푼다 (25P03)
 */
export function connectPg(url: string, timeouts: DbTimeouts = DB_TIMEOUT_DEFAULTS): { db: Db; migrate(): Promise<void>; close(): Promise<void> } {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: timeouts.connectMs,
    statement_timeout: timeouts.statementMs,
    idle_in_transaction_session_timeout: timeouts.idleInTxMs,
  });
  // 쉬고 있던 연결이 끊기면 pool이 'error'를 낸다. 듣는 곳이 없으면 서버가 죽는다
  pool.on('error', (err) => console.error('[db] idle connection error:', err.message));
  // 쓰이는 중인 연결(트랜잭션을 연 채 쉬다가 DB가 끊은 것 등)은 pool이 아니라 그 연결이 'error'를 낸다. 이것도 듣는 곳이 없으면
  // 서버가 죽는다. 그 연결로 보낸 다음 쿼리가 오류를 받아 요청은 실패로 끝나고, pool이 끊긴 연결을 버린다
  pool.on('connect', (client) => {
    client.on('error', (err) => console.error('[db] connection error:', err.message));
  });
  const db = drizzle(pool);
  return {
    db,
    // 서버 둘이 같은 순간에 빈 DB를 마이그레이션하면 스키마·기록 테이블을 함께 만들다 하나가 죽는다.
    // 권고 잠금을 잡아 한 번에 하나씩 적용한다 (뒤에 온 쪽은 앞의 것이 끝난 뒤 할 일이 없음을 본다).
    // 마이그레이션은 풀이 아니라 따로 연 연결 하나에서 한다: 쿼리 시간 제한이 없어야 해서다
    // (앞선 서버의 마이그레이션을 기다리는 시간과, 큰 테이블을 고치는 문장이 요청용 제한에 걸리면 안 된다)
    migrate: async () => {
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeouts.connectMs });
      client.on('error', (err) => console.error('[db] migration connection error:', err.message));
      await client.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
        try {
          await applyMigrations(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
        } finally {
          await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
        }
      } finally {
        await client.end();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * 마이그레이션을 적용한 DB인지 (스키마 `app`이 있는지). 명령줄은 마이그레이션을 하지 않아서,
 * 서버를 한 번도 띄우지 않은 DB에 명령을 부르면 쿼리 오류 대신 할 일을 알려 주려고 먼저 본다.
 */
export async function isMigrated(q: Q): Promise<boolean> {
  const found = (await q.execute(sql`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app'`)) as unknown as { rows: unknown[] };
  return found.rows.length > 0;
}
