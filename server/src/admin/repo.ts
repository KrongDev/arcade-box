import { eq, sql } from 'drizzle-orm';
import type { Q, Tx } from '../shared/db/index.ts';
import { adminActions, appConfig } from './schema.ts';

export async function insertAction(
  tx: Tx,
  row: { actor: string; action: string; targetUserId: string | null; targetRef: string | null; params: unknown; reason: string },
): Promise<number> {
  const [created] = await tx.insert(adminActions).values(row).returning({ id: adminActions.id });
  return created.id;
}

/** 저장된 설정값. 행이 없으면 undefined */
export async function readConfig(q: Q, key: string): Promise<unknown> {
  const [row] = await q.select({ value: appConfig.value }).from(appConfig).where(eq(appConfig.key, key));
  return row?.value;
}

export async function writeConfig(tx: Tx, key: string, value: number): Promise<void> {
  await tx
    .insert(appConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: appConfig.key, set: { value, updatedAt: sql`now()` } });
}
