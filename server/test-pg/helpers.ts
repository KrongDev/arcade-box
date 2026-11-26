import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { DbTimeouts } from '../src/shared/config.ts';
import { connectPg, type Db } from '../src/shared/db/index.ts';

/**
 * 진짜 PostgreSQL에서만 드러나는 것(동시에 온 요청)을 보는 테스트의 틀.
 * `DATABASE_URL`이 가리키는 서버에 임의 이름의 데이터베이스를 새로 만들어 운영과 같은 마이그레이션을 적용하고,
 * `close()`가 그 데이터베이스를 지운다. `DATABASE_URL`의 데이터베이스 자체(개발용 DB의 `public` — v1 자료)는
 * 읽지도 쓰지도 않는다: 거기에는 CREATE DATABASE와 DROP DATABASE 두 문장만 보낸다.
 *
 *   docker compose -f docker-compose.dev.yml up -d db
 *   DATABASE_URL=postgres://pinball:pinball-dev@127.0.0.1:5432/pinball npm run test:pg
 */
export const PG_URL: string | undefined = process.env.DATABASE_URL || undefined;

/** `test(name, { skip: SKIP }, …)`에 넣는다. `DATABASE_URL`이 없으면 건너뛴다 */
export const SKIP: string | false = PG_URL ? false : 'DATABASE_URL이 없어요 (진짜 PostgreSQL 테스트)';

/** 이 컴퓨터나 같은 compose 안의 서버에만 붙는다. 운영 DB 주소가 환경에 남아 있어도 거기에 테스트 DB를 만들지 않게 */
function assertLocal(url: URL): void {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || !host.includes('.');
  if (!local) throw new Error('진짜 PostgreSQL 테스트는 이 컴퓨터(localhost)나 compose 안의 DB에만 붙어요. DATABASE_URL의 호스트를 확인해 주세요');
}

async function admin(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/**
 * 마이그레이션을 적용한 빈 데이터베이스를 새로 만들어 준다. 연결은 여러 개(pool)라서
 * `Promise.all`로 보낸 요청이 진짜로 동시에 돈다. 다 쓰면 `close()`를 부른다.
 * `timeouts`를 주면 연결 풀의 시간 제한을 그 값으로 한다 (시간 제한 자체를 보는 테스트용).
 */
export async function pgTestDb(timeouts?: DbTimeouts): Promise<{ db: Db; close(): Promise<void> }> {
  if (!PG_URL) throw new Error('DATABASE_URL이 필요해요');
  const url = new URL(PG_URL);
  assertLocal(url);
  // 이름은 여기서 만든 소문자·숫자뿐이라 따옴표로 감싸 그대로 넣어도 된다
  const name = `arcade_test_${randomBytes(8).toString('hex')}`;
  await admin(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const conn = connectPg(url.toString(), timeouts);
  try {
    await conn.migrate();
  } catch (err) {
    await conn.close();
    await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    throw err;
  }
  return {
    db: conn.db,
    async close() {
      await conn.close();
      await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

/**
 * 마이그레이션을 적용하지 않은 빈 데이터베이스를 새로 만들어 그 주소를 준다. `drop()`이 지운다.
 * 마이그레이션 자체(동시에 띄운 서버 둘)를 보는 테스트가 쓴다.
 */
export async function emptyPgDb(): Promise<{ url: string; drop(): Promise<void> }> {
  if (!PG_URL) throw new Error('DATABASE_URL이 필요해요');
  const url = new URL(PG_URL);
  assertLocal(url);
  const name = `arcade_test_${randomBytes(8).toString('hex')}`;
  await admin(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  return { url: url.toString(), drop: () => admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`) };
}
