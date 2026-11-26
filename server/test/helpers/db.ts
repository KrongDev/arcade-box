import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_DIR, type Db } from '../../src/shared/db/index.ts';

/**
 * 마이그레이션을 적용한 빈 DB의 본. 테스트 파일(프로세스)마다 한 번만 만든다.
 * PGlite를 새로 띄우면 0.4초쯤 걸리고 본에서 불러오면 0.1초쯤이라, 테스트마다 새 DB를 써도 느려지지 않는다.
 */
let template: Promise<Blob | File> | null = null;

async function buildTemplate(): Promise<Blob | File> {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
    return await client.dumpDataDir('none');
  } finally {
    await client.close();
  }
}

/**
 * 메모리 안의 PostgreSQL(PGlite)에 운영과 같은 마이그레이션(`server/drizzle`)을 적용해서 준다.
 * 부를 때마다 빈 DB가 새로 생기고 서로 섞이지 않는다. 다 쓰면 `close()`를 부른다.
 */
export async function testDb(): Promise<{ db: Db; close(): Promise<void> }> {
  template ??= buildTemplate();
  const client = new PGlite({ loadDataDir: await template });
  await client.waitReady;
  return { db: drizzle(client), close: () => client.close() };
}
