import { eq, sql } from 'drizzle-orm';
import { findSession } from '../../src/account/index.ts';
import { setNumber, type ConfigKey } from '../../src/admin/index.ts';
import { routes } from '../../src/reward/index.ts';
import { rewardClaims } from '../../src/reward/schema.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { createHandler } from '../../src/shared/http/index.ts';
import type { Clock } from '../../src/shared/time.ts';
import { testConfig } from '../account/helpers.ts';
import type { Handler } from '../helpers/http.ts';

/** 2026-11-26 12:00 KST */
export const NOON = new Date('2026-11-26T03:00:00Z');

export const rule = (status: number, code: string) => (err: unknown) => err instanceof RuleError && err.status === status && err.code === code;

/** 운영자가 `config set`으로 바꾸는 것과 같은 일 */
export const setConfig = (db: Db, key: ConfigKey, value: number) => db.transaction((tx) => setNumber(tx, key, value));

export function claimsOf(db: Db, userId: string) {
  return db.select().from(rewardClaims).where(eq(rewardClaims.userId, userId)).orderBy(rewardClaims.id);
}

/** 보상·코인 기록의 수와 잔액을 SQL로 직접 센다 (reward와 wallet의 함수를 거치지 않는다) */
export async function counts(db: Db, userId: string): Promise<{ claims: number; ledger: number; balance: number | null }> {
  const out = (await db.execute(sql`
    select
      (select count(*)::text from app.reward_claims where user_id = ${userId}) as claims,
      (select count(*)::text from app.coin_ledger where user_id = ${userId}) as ledger,
      (select balance::text from app.wallets where user_id = ${userId}) as balance
  `)) as unknown as { rows: Array<{ claims: string; ledger: string; balance: string | null }> };
  const row = out.rows[0];
  return { claims: Number(row.claims), ledger: Number(row.ledger), balance: row.balance === null ? null : Number(row.balance) };
}

/** reward의 경로만 붙인 HTTP 처리기. 세션은 진짜 `findSession`으로 찾는다 */
export function rewardHandler(db: Db, clock: Clock): Handler {
  return createHandler(routes({ db }), {
    allowedOrigins: testConfig.allowedOrigins,
    now: clock,
    findSession: (tokenHash, now) => findSession(db, tokenHash, now),
  });
}
