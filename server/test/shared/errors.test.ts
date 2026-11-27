import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { test } from 'node:test';
import { RuleError, safeMessage } from '../../src/shared/errors.ts';
import { testDb } from '../helpers/db.ts';

test('RuleError를 글로 바꾸면 상태와 코드가 보인다', () => {
  const err = new RuleError(409, 'already_owned', '이미 가지고 있어요', { productId: 'game.pinball' });
  assert.equal(String(err), 'RuleError(409 already_owned): 이미 가지고 있어요');
  assert.equal(err.message, '이미 가지고 있어요');
  assert.deepEqual(err.detail, { productId: 'game.pinball' });
  assert.ok(err instanceof Error);
  assert.equal(new RuleError(400, 'x', '틀렸어요').detail, undefined);
});

test('safeMessage: 평범한 오류는 메시지 그대로, 오류가 아닌 것은 글로 바꿔서 준다', () => {
  assert.equal(safeMessage(new Error('파일이 없어요')), '파일이 없어요');
  assert.equal(safeMessage(new TypeError('x is not a function')), 'x is not a function');
  assert.equal(safeMessage('글자열을 던짐'), '글자열을 던짐');
  assert.equal(safeMessage(undefined), 'undefined');
});

test('safeMessage: 실패한 쿼리의 SQL과 넣은 값은 빼고 PostgreSQL 오류 코드를 남긴다', async () => {
  const { db, close } = await testDb();
  const SECRET = 'SECRET-TOKEN-123';
  const failure = async (query: ReturnType<typeof sql>) => {
    try {
      await db.execute(query);
    } catch (err) {
      // Drizzle이 감싼 오류의 메시지에는 값이 들어 있다 (그래서 그대로 남기면 안 된다)
      assert.ok(String((err as Error).message).includes(SECRET));
      return safeMessage(err);
    }
    throw new Error('쿼리가 실패해야 해요');
  };
  try {
    // 22로 시작하는 코드(값이 타입에 안 맞음)는 PostgreSQL 메시지에도 그 값이 들어가서 코드만 남긴다
    const cast = await failure(sql`SELECT ${SECRET}::int`);
    assert.ok(!cast.includes(SECRET));
    assert.match(cast, /22P02/);
    const nul = await failure(sql`SELECT ${`${SECRET}\u0000`}::text`);
    assert.ok(!nul.includes(SECRET));
    assert.match(nul, /22021/);
    // 그 밖의 코드는 메시지를 남긴다 (이름만 들어 있다)
    const missing = await failure(sql`SELECT * FROM app.no_such_table WHERE a = ${SECRET}`);
    assert.ok(!missing.includes(SECRET));
    assert.match(missing, /42P01/);
    assert.match(missing, /no_such_table/);
    const constraint = await failure(sql`INSERT INTO app.app_config (key, value) VALUES (${SECRET}, NULL)`);
    assert.ok(!constraint.includes(SECRET));
    assert.match(constraint, /23502/);
  } finally {
    await close();
  }
});

test('safeMessage: DB에 닿지 못한 오류는 그 까닭(코드)을 남긴다', async () => {
  const { DrizzleQueryError } = await import('drizzle-orm/errors');
  const refused = Object.assign(new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:5432')], ''), { code: 'ECONNREFUSED' });
  const line = safeMessage(new DrizzleQueryError('select 1 where a = $1', ['SECRET-TOKEN-123'], refused));
  assert.match(line, /ECONNREFUSED/);
  assert.ok(!line.includes('SECRET-TOKEN-123'));
  assert.ok(!line.includes('select 1'));
  assert.ok(!safeMessage(new DrizzleQueryError('select $1', ['SECRET-TOKEN-123'])).includes('SECRET'));
});
