import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectPg, isMigrated } from '../src/shared/db/index.ts';
import { emptyPgDb, SKIP } from './helpers.ts';

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
