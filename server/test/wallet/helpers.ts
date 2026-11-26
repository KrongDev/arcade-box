import { eq, sql } from 'drizzle-orm';
import { findSession } from '../../src/account/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { createHandler } from '../../src/shared/http/index.ts';
import type { Clock } from '../../src/shared/time.ts';
import { applyCoins, routes } from '../../src/wallet/index.ts';
import { coinLedger, wallets } from '../../src/wallet/schema.ts';
import { testConfig } from '../account/helpers.ts';
import type { Handler } from '../helpers/http.ts';

export const NOW = new Date('2026-11-26T03:00:00Z');

/** 잔액 상한 (스펙 5.2의 CHECK). 테스트는 wallet의 상수를 가져오지 않고 스펙의 숫자를 직접 적는다 */
export const MAX_BALANCE = 9_000_000_000_000_000;

export type ApplyInput = Parameters<typeof applyCoins>[1];

/** 트랜잭션 하나로 `applyCoins`를 한 번 부른다 (판 결과·구매 같은 부르는 쪽이 하는 것처럼) */
export function apply(db: Db, input: ApplyInput): ReturnType<typeof applyCoins> {
  return db.transaction((tx) => applyCoins(tx, input));
}

/** `assert.rejects`에 넣는 확인: 이 상태와 코드의 `RuleError`인지 */
export const rule = (status: number, code: string) => (err: unknown) => err instanceof RuleError && err.status === status && err.code === code;

export function ledgerOf(db: Db, userId: string) {
  return db.select().from(coinLedger).where(eq(coinLedger.userId, userId)).orderBy(coinLedger.id);
}

export async function walletOf(db: Db, userId: string) {
  const [row] = await db.select().from(wallets).where(eq(wallets.userId, userId));
  return row ?? null;
}

/**
 * 잔액, 기록의 합, 마지막 balance_after, 기록 수를 SQL로 직접 센다. wallet의 함수와 Drizzle의 열 변환을 거치지 않는다
 * (그 함수들이 틀려도 이 값은 맞게). 지갑이 없으면 `balance`는 null이다.
 */
export async function totals(db: Db, userId: string): Promise<{ balance: number | null; sum: number; last: number | null; count: number }> {
  const out = (await db.execute(sql`
    select
      (select balance::text from app.wallets where user_id = ${userId}) as balance,
      (select coalesce(sum(delta), 0)::text from app.coin_ledger where user_id = ${userId}) as sum,
      (select balance_after::text from app.coin_ledger where user_id = ${userId} order by id desc limit 1) as last,
      (select count(*)::text from app.coin_ledger where user_id = ${userId}) as count
  `)) as unknown as { rows: Array<{ balance: string | null; sum: string; last: string | null; count: string }> };
  const row = out.rows[0];
  return { balance: row.balance === null ? null : Number(row.balance), sum: Number(row.sum), last: row.last === null ? null : Number(row.last), count: Number(row.count) };
}

/** wallet의 경로만 붙인 HTTP 처리기. 세션은 진짜 `findSession`으로 찾는다 */
export function walletHandler(db: Db, clock: Clock): Handler {
  return createHandler(routes({ db }), {
    allowedOrigins: testConfig.allowedOrigins,
    now: clock,
    findSession: (tokenHash, now) => findSession(db, tokenHash, now),
  });
}
