import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Q, Tx } from '../shared/db/index.ts';
import type { Provider, Settings } from './rules.ts';
import { sessions, userIdentities, users, userSettings } from './schema.ts';

export interface IdentityRow {
  id: number;
  userId: string;
  provider: Provider;
}

export async function findIdentity(q: Q, provider: Provider, subject: string): Promise<IdentityRow | null> {
  const [row] = await q
    .select({ id: userIdentities.id, userId: userIdentities.userId, provider: userIdentities.provider })
    .from(userIdentities)
    .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject)));
  return row ?? null;
}

export async function insertUser(tx: Tx, now: Date): Promise<string> {
  const [row] = await tx.insert(users).values({ createdAt: now }).returning({ id: users.id });
  return row.id;
}

export async function deleteUserRow(tx: Tx, userId: string): Promise<void> {
  await tx.delete(users).where(eq(users.id, userId));
}

/**
 * 수단을 붙인다. 유일 제약에 걸리면(같은 수단을 다른 요청이 방금 붙였거나, 이 사용자에게 같은 종류의 계정 수단이 이미 있으면)
 * 던지지 않고 null을 준다. 부른 쪽이 다시 읽어서 어느 경우인지 가린다.
 */
export async function insertIdentityIfAbsent(tx: Tx, row: { userId: string; provider: Provider; subject: string; now: Date }): Promise<number | null> {
  const [created] = await tx
    .insert(userIdentities)
    .values({ userId: row.userId, provider: row.provider, subject: row.subject, createdAt: row.now, lastUsedAt: row.now })
    .onConflictDoNothing()
    .returning({ id: userIdentities.id });
  return created?.id ?? null;
}

/**
 * 수단을 마지막으로 쓴 때를 적고, 그 수단이 지금 붙어 있는 사용자를 준다. 그사이 수단이 사라졌으면 null.
 * 이 UPDATE가 수단 행을 잠가서, 같은 순간의 로그아웃·계정 삭제·충돌 정리와 차례로 돈다.
 * 읽은 뒤에 수단이 다른 사용자로 옮겨졌을 수 있으니 사용자는 여기서 돌려준 값을 쓴다.
 */
export async function touchIdentity(tx: Tx, identityId: number, now: Date): Promise<string | null> {
  const [row] = await tx.update(userIdentities).set({ lastUsedAt: now }).where(eq(userIdentities.id, identityId)).returning({ userId: userIdentities.userId });
  return row?.userId ?? null;
}

export async function insertSession(tx: Tx, row: { tokenHash: string; userId: string; identityId: number; expiresAt: Date; now: Date }): Promise<void> {
  await tx.insert(sessions).values({ tokenHash: row.tokenHash, userId: row.userId, identityId: row.identityId, expiresAt: row.expiresAt, createdAt: row.now });
}

/** 끝난 세션을 지운다 (누구의 것이든) */
export async function deleteExpiredSessions(q: Q, now: Date): Promise<void> {
  await q.delete(sessions).where(lte(sessions.expiresAt, now));
}

export async function findLiveSession(q: Q, tokenHash: string, now: Date): Promise<{ userId: string; identityId: number } | null> {
  const [row] = await q
    .select({ userId: sessions.userId, identityId: sessions.identityId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  return row ?? null;
}

export async function readSettings(q: Q, userId: string): Promise<Settings | null> {
  const [row] = await q.select({ sound: userSettings.soundOn, haptic: userSettings.hapticOn }).from(userSettings).where(eq(userSettings.userId, userId));
  return row ?? null;
}

/** 보낸 것만 바꾼다. 행이 없으면 나머지는 켜진 채로 만든다 */
export async function upsertSettings(q: Q, userId: string, patch: Partial<Settings>): Promise<Settings> {
  const set: { soundOn?: boolean; hapticOn?: boolean } = {};
  if (patch.sound !== undefined) set.soundOn = patch.sound;
  if (patch.haptic !== undefined) set.hapticOn = patch.haptic;
  const [row] = await q
    .insert(userSettings)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...set, updatedAt: sql`now()` } })
    .returning({ sound: userSettings.soundOn, haptic: userSettings.hapticOn });
  return row;
}

export async function distinctProviders(q: Q, userId: string): Promise<Provider[]> {
  const rows = await q.selectDistinct({ provider: userIdentities.provider }).from(userIdentities).where(eq(userIdentities.userId, userId));
  return rows.map((r) => r.provider);
}
