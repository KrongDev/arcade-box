import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Q, Tx } from '../shared/db/index.ts';
import { entitlements, equippedItems, type EntitlementSource, type RevokeReason } from './schema.ts';

const active = (userId: string, productId: string) => and(eq(entitlements.userId, userId), eq(entitlements.productId, productId), isNull(entitlements.revokedAt));

/** 켜진 보유가 있는지 */
export async function hasActive(q: Q, userId: string, productId: string): Promise<boolean> {
  const rows = await q.select({ id: entitlements.id }).from(entitlements).where(active(userId, productId));
  return rows.length > 0;
}

/**
 * 켜진 보유를 잡고(FOR SHARE) 있는지 본다. 잡은 동안 같은 보유의 회수(UPDATE)는 이 트랜잭션이 끝나기를 기다린다.
 * 회수가 먼저 잡았으면 여기서 기다렸다가, 회수된 행이라 조건에 맞지 않아 거짓이 된다.
 */
export async function holdActive(tx: Tx, userId: string, productId: string): Promise<boolean> {
  const rows = await tx.select({ id: entitlements.id }).from(entitlements).where(active(userId, productId)).for('share');
  return rows.length > 0;
}

/** 켜진 보유를 넣는다. 이미 있으면(유일 색인 `entitlements_one_active`, 동시에 온 지급 포함) 넣지 않고 null */
export async function insertActive(tx: Tx, row: { userId: string; productId: string; source: EntitlementSource; adminActionId: number | null }): Promise<number | null> {
  const created = await tx.insert(entitlements).values(row).onConflictDoNothing().returning({ id: entitlements.id });
  return created[0]?.id ?? null;
}

/**
 * 켜진 보유를 회수한다. 회수한 것이 있었으면 참.
 * `entitlementId`를 주면 켜진 보유가 바로 그 행일 때만 회수한다 (그 행이 이미 회수됐고 지금 켜진 것은 다른 행이면 거짓).
 */
export async function revokeActive(tx: Tx, userId: string, productId: string, reason: RevokeReason, entitlementId?: number): Promise<boolean> {
  const done = await tx
    .update(entitlements)
    .set({ revokedAt: sql`now()`, revokeReason: reason })
    .where(entitlementId === undefined ? active(userId, productId) : and(active(userId, productId), eq(entitlements.id, entitlementId)))
    .returning({ id: entitlements.id });
  return done.length > 0;
}

export async function readOwnedIds(q: Q, userId: string): Promise<string[]> {
  const rows = await q
    .select({ productId: entitlements.productId })
    .from(entitlements)
    .where(and(eq(entitlements.userId, userId), isNull(entitlements.revokedAt)))
    .orderBy(asc(entitlements.productId));
  return rows.map((r) => r.productId);
}

// ── 장착 ────────────────────────────────────────────────────

/** 이 게임·자리의 장착을 이 아이템으로 (있으면 바꾼다) */
export async function upsertEquipped(tx: Tx, row: { userId: string; gameId: string; slot: string; productId: string }): Promise<void> {
  await tx
    .insert(equippedItems)
    .values(row)
    .onConflictDoUpdate({ target: [equippedItems.userId, equippedItems.gameId, equippedItems.slot], set: { productId: row.productId, updatedAt: sql`now()` } });
}

export async function deleteEquippedProduct(tx: Tx, userId: string, productId: string): Promise<void> {
  await tx.delete(equippedItems).where(and(eq(equippedItems.userId, userId), eq(equippedItems.productId, productId)));
}

export async function readEquipped(q: Q, userId: string): Promise<Array<{ gameId: string; slot: string; productId: string }>> {
  return q
    .select({ gameId: equippedItems.gameId, slot: equippedItems.slot, productId: equippedItems.productId })
    .from(equippedItems)
    .where(eq(equippedItems.userId, userId))
    .orderBy(asc(equippedItems.gameId), asc(equippedItems.slot));
}

/** 이 사용자의 장착과 보유를 지운다 (장착이 보유를 가리키지 않지만 순서를 정해 둔다) */
export async function deleteUserRows(tx: Tx, userId: string): Promise<void> {
  await tx.delete(equippedItems).where(eq(equippedItems.userId, userId));
  await tx.delete(entitlements).where(eq(entitlements.userId, userId));
}
