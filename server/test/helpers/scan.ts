import { sql } from 'drizzle-orm';
import type { Db } from '../../src/shared/db/index.ts';

/**
 * 스키마 `app`의 모든 테이블, 모든 행, 모든 열을 글로 바꿔 준다 (테이블마다 한 덩어리).
 * "DB 어디에도 이 값이 없다"를 확인할 때 쓴다. 테이블이 늘어도 고칠 필요가 없다.
 */
export async function dumpAppSchema(db: Db): Promise<Record<string, string>> {
  const tables = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'app' order by table_name`)) as unknown as {
    rows: Array<{ table_name: string }>;
  };
  const out: Record<string, string> = {};
  for (const { table_name } of tables.rows) {
    const rows = (await db.execute(sql`select row_to_json(t)::text as line from ${sql.identifier('app')}.${sql.identifier(table_name)} t`)) as unknown as {
      rows: Array<{ line: string }>;
    };
    out[table_name] = rows.rows.map((r) => r.line).join('\n');
  }
  return out;
}

/** `needles` 가운데 하나라도 들어 있는 테이블 이름. 없으면 빈 배열 */
export async function tablesContaining(db: Db, needles: string[]): Promise<string[]> {
  const dump = await dumpAppSchema(db);
  return Object.entries(dump)
    .filter(([, text]) => needles.some((needle) => text.includes(needle)))
    .map(([name]) => name);
}
