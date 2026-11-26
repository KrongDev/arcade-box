import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export { app } from './schema.ts';

/** Drizzle DB. 운영은 node-postgres, 테스트는 PGlite이고 도메인 코드는 어느 쪽인지 모른다 */
export type Db = PgDatabase<PgQueryResultHKT, Record<string, never>>;
/** `db.transaction` 콜백이 받는 것 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** 읽기만 하거나, 부른 쪽의 트랜잭션에 얹혀 쓰는 함수가 받는 것 */
export type Q = Db | Tx;

/** drizzle-kit이 만든 마이그레이션 SQL이 있는 곳 (`server/drizzle`) */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/**
 * 진짜 PostgreSQL에 붙는다. `migrate()`는 `server/drizzle`의 SQL 가운데 아직 적용하지 않은 것을 적용한다.
 * 적용 기록은 Drizzle이 스키마 `drizzle`에 둔다 (v1의 `public`은 건드리지 않는다).
 */
export function connectPg(url: string): { db: Db; migrate(): Promise<void>; close(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // 쉬고 있던 연결이 끊기면 pool이 'error'를 낸다. 듣는 곳이 없으면 서버가 죽는다
  pool.on('error', (err) => console.error('[db] idle connection error:', err.message));
  const db = drizzle(pool);
  return {
    db,
    migrate: () => applyMigrations(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => pool.end(),
  };
}
