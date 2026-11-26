import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Db, Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import type { LedgerReason } from './rules.ts';
import { coinLedger, wallets } from './schema.ts';

// ── 지갑 ────────────────────────────────────────────────────

/**
 * 지갑 행을 잠그고 지금 잔액을 준다. 이 트랜잭션이 끝날 때까지 같은 지갑의 다른 요청은 여기서 기다린다.
 *
 * 행이 없으면 잠글 것이 없어서 먼저 잔액 0으로 만든다 (`ON CONFLICT DO NOTHING`: 같은 순간에 온 다른 요청이
 * 먼저 만들었으면 그 요청이 끝나기를 기다렸다가 넘어간다). 그다음 `FOR UPDATE`로 읽는다.
 * 격리 수준은 기본(READ COMMITTED)이어야 한다: 기다린 뒤에는 앞 요청이 바꾼 잔액을 다시 읽는다.
 */
export async function lockWallet(tx: Tx, userId: string, now?: Date): Promise<number> {
  await tx.insert(wallets).values({ userId, balance: 0, updatedAt: now }).onConflictDoNothing();
  const [row] = await tx.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, userId)).for('update');
  // 방금 만들었거나 이미 있던 행이라 늘 있다. 없다면 누가 그사이 지갑을 지운 것이니 잠그지 못한 채 쓰지 않는다
  if (!row) throw new RuleError(503, 'try_again', '잠시 뒤 다시 시도해 주세요');
  return row.balance;
}

export async function setBalance(tx: Tx, userId: string, balance: number, now?: Date): Promise<void> {
  await tx
    .update(wallets)
    .set({ balance, updatedAt: now ?? sql`now()` })
    .where(eq(wallets.userId, userId));
}

/** 지갑의 잔액. 지갑이 없으면 null */
export async function readBalance(q: Q, userId: string): Promise<number | null> {
  const [row] = await q.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, userId));
  return row?.balance ?? null;
}

// ── 코인 기록 ─────────────────────────────────────────────────

export interface KeyedEntry {
  id: number;
  delta: number;
  balanceAfter: number;
  reason: LedgerReason;
}

/** 이 사용자가 이 키로 남긴 기록. 지갑을 잠근 뒤에 불러야 같은 키의 다른 요청이 방금 넣은 줄이 보인다 */
export async function findByKey(tx: Tx, userId: string, idempotencyKey: string): Promise<KeyedEntry | null> {
  const [row] = await tx
    .select({ id: coinLedger.id, delta: coinLedger.delta, balanceAfter: coinLedger.balanceAfter, reason: coinLedger.reason })
    .from(coinLedger)
    .where(and(eq(coinLedger.userId, userId), eq(coinLedger.idempotencyKey, idempotencyKey)));
  return row ?? null;
}

export async function insertEntry(
  tx: Tx,
  row: { userId: string; delta: number; balanceAfter: number; reason: LedgerReason; adminActionId: number | null; idempotencyKey: string | null; now?: Date },
): Promise<number> {
  const [created] = await tx
    .insert(coinLedger)
    .values({
      userId: row.userId,
      delta: row.delta,
      balanceAfter: row.balanceAfter,
      reason: row.reason,
      adminActionId: row.adminActionId,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.now,
    })
    .returning({ id: coinLedger.id });
  return created.id;
}

export interface EntryRow {
  id: number;
  delta: number;
  balanceAfter: number;
  reason: LedgerReason;
  createdAt: Date;
}

/** 이 사용자의 기록을 최신부터 `limit`개. `before`가 있으면 그 번호보다 앞의 것부터 */
export async function selectEntries(q: Q, userId: string, before: number | undefined, limit: number): Promise<EntryRow[]> {
  return q
    .select({ id: coinLedger.id, delta: coinLedger.delta, balanceAfter: coinLedger.balanceAfter, reason: coinLedger.reason, createdAt: coinLedger.createdAt })
    .from(coinLedger)
    .where(before === undefined ? eq(coinLedger.userId, userId) : and(eq(coinLedger.userId, userId), lt(coinLedger.id, before)))
    .orderBy(desc(coinLedger.id))
    .limit(limit);
}

/** 이 사용자의 지갑과 기록을 지운다. 조건이 `user_id`뿐이라 다른 사용자의 행은 잠그지도 건드리지도 않는다 */
export async function deleteCoins(tx: Tx, userId: string): Promise<void> {
  await tx.delete(coinLedger).where(eq(coinLedger.userId, userId));
  await tx.delete(wallets).where(eq(wallets.userId, userId));
}

// ── 점검 ────────────────────────────────────────────────────

export interface Mismatch {
  userId: string;
  balance: number;
  ledgerSum: number;
  lastBalanceAfter: number | null;
}

/**
 * 잔액이 기록의 합이나 마지막 `balance_after`와 다른 지갑 (사용자 ID 순서). 읽기만 한다.
 *
 * - 지갑 행이 없으면 잔액 0으로, 기록이 없으면 합 0으로 본다. 그래서 기록만 있거나 지갑만 있는 사용자도 걸린다
 * - 한 문장이라 도는 중에 코인이 변해도 잔액과 기록을 같은 순간의 것으로 읽는다 (어긋났다고 잘못 알리지 않는다)
 * - 견주는 일은 DB가 한다. 숫자는 글로 받아 바꾼다 (합이 2^53을 넘게 망가져 있어도 견준 결과는 맞다)
 */
export async function selectMismatched(db: Db, userId?: string): Promise<Mismatch[]> {
  const ofLedger = userId === undefined ? sql`` : sql`where ${coinLedger.userId} = ${userId}`;
  const ofWallet = userId === undefined ? sql`` : sql`where ${wallets.userId} = ${userId}`;
  const out = (await db.execute(sql`
    with sums as (
      select ${coinLedger.userId} as user_id, sum(${coinLedger.delta}) as ledger_sum, max(${coinLedger.id}) as last_id
      from ${coinLedger} ${ofLedger}
      group by ${coinLedger.userId}
    ), owned as (
      select ${wallets.userId} as user_id, ${wallets.balance} as balance from ${wallets} ${ofWallet}
    )
    select
      coalesce(owned.user_id, sums.user_id)::text as user_id,
      coalesce(owned.balance, 0)::text as balance,
      coalesce(sums.ledger_sum, 0)::text as ledger_sum,
      ${coinLedger.balanceAfter}::text as last_balance_after
    from owned
    full outer join sums on sums.user_id = owned.user_id
    left join ${coinLedger} on ${coinLedger.id} = sums.last_id
    where coalesce(owned.balance, 0) <> coalesce(sums.ledger_sum, 0)
       or coalesce(owned.balance, 0) <> coalesce(${coinLedger.balanceAfter}, 0)
    order by coalesce(owned.user_id, sums.user_id)
  `)) as unknown as { rows: Array<{ user_id: string; balance: string; ledger_sum: string; last_balance_after: string | null }> };
  return out.rows.map((row) => ({
    userId: row.user_id,
    balance: Number(row.balance),
    ledgerSum: Number(row.ledger_sum),
    lastBalanceAfter: row.last_balance_after === null ? null : Number(row.last_balance_after),
  }));
}
