import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { registerOrLoginGuest } from '../src/account/index.ts';
import { sessions, userIdentities, users } from '../src/account/schema.ts';
import { sha256Hex } from '../src/shared/crypto.ts';
import { pgTestDb, SKIP } from './helpers.ts';

const NOW = new Date('2026-11-26T03:00:00Z');
const TTL_DAYS = 30;

test('같은 기기 비밀값으로 동시에 5번 등록하면 사용자는 하나이고 다섯 요청 모두 그 사용자의 세션을 받는다', { skip: SKIP }, async () => {
  const { db, close } = await pgTestDb();
  try {
    // 한 번으로는 우연히 지나갈 수 있어서 기기 비밀값을 바꿔 가며 여러 번 한다
    for (let round = 0; round < 5; round++) {
      const secret = randomBytes(32).toString('base64url');
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => registerOrLoginGuest(db, secret, NOW, TTL_DAYS)));
      const failed = results.filter((r) => r.status === 'rejected');
      assert.deepEqual(
        failed.map((r) => String((r as PromiseRejectedResult).reason?.cause?.code ?? (r as PromiseRejectedResult).reason)),
        [],
        '다섯 요청 모두 성공해야 해요',
      );
      const ok = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof registerOrLoginGuest>>>).value);

      const identityRows = await db.select().from(userIdentities);
      const mine = identityRows.filter((i) => i.subject === sha256Hex(secret));
      assert.equal(mine.length, 1, '기기 수단은 하나다');
      assert.deepEqual([...new Set(ok.map((r) => r.userId))], [mine[0].userId], '모두 같은 사용자다');
      assert.equal(ok.filter((r) => r.created).length, 1, '만든 요청은 하나뿐이다');
      assert.equal(new Set(ok.map((r) => r.token)).size, 5, '세션은 저마다 다르다');

      const sessionRows = await db.select().from(sessions);
      for (const r of ok) {
        const row = sessionRows.find((s) => s.tokenHash === sha256Hex(r.token));
        assert.ok(row, '받은 토큰의 세션이 DB에 있다');
        assert.equal(row.userId, mine[0].userId);
        assert.equal(row.identityId, mine[0].id);
      }
      assert.equal((await db.select().from(users)).length, round + 1, '수단이 붙지 않은 사용자 행이 남지 않는다');
    }
  } finally {
    await close();
  }
});
