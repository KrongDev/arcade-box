import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { test } from 'node:test';
import { testDb } from '../helpers/db.ts';

test('PGlite에 마이그레이션을 적용하면 스키마 app이 있다', async () => {
  const { db, close } = await testDb();
  try {
    const found = (await db.execute(sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'app'`)) as { rows: unknown[] };
    assert.equal(found.rows.length, 1);
  } finally {
    await close();
  }
});

test('마이그레이션은 v1이 쓰는 public 스키마에 아무것도 만들지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    const found = (await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)) as { rows: unknown[] };
    assert.deepEqual(found.rows, []);
  } finally {
    await close();
  }
});

test('트랜잭션 안에서 던지면 그 안에서 한 일이 남지 않는다', async () => {
  const { db, close } = await testDb();
  try {
    await db.execute(sql`CREATE TABLE app.scratch (n int)`);
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO app.scratch VALUES (1)`);
        throw new Error('되돌려요');
      }),
      /되돌려요/,
    );
    await db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO app.scratch VALUES (2)`);
    });
    const rows = (await db.execute(sql`SELECT n FROM app.scratch`)) as { rows: Array<{ n: number }> };
    assert.deepEqual(rows.rows, [{ n: 2 }]);
  } finally {
    await close();
  }
});

test('testDb는 부를 때마다 서로 섞이지 않는 빈 DB를 준다', async () => {
  const a = await testDb();
  const b = await testDb();
  try {
    await a.db.execute(sql`CREATE TABLE app.only_in_a (n int)`);
    const inB = (await b.db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'only_in_a'`)) as { rows: unknown[] };
    assert.deepEqual(inB.rows, []);
  } finally {
    await a.close();
    await b.close();
  }
});
