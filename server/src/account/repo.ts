import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Q, Tx } from '../shared/db/index.ts';
import type { Provider, Settings } from './rules.ts';
import { authNonces, sessions, userIdentities, users, userSettings } from './schema.ts';

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

// ── 잠금 ────────────────────────────────────────────────────
// 계정을 바꾸는 일(연결, 충돌 정리, 로그아웃, 삭제)은 먼저 사용자 행을 잠그고, 그다음에 수단 행을 건드린다.
// 로그인도 같은 순서(사용자 → 수단)로 잠가서 서로 물고 서는 일(deadlock)이 없다.

/** 계정을 바꾸는 동안 사용자 행을 잠근다 (같은 사용자의 다른 변경·로그인·외래 키를 거는 쓰기가 기다린다). 없으면 거짓 */
export async function lockUser(tx: Tx, userId: string): Promise<boolean> {
  const rows = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  return rows.length > 0;
}

/** 이 사용자가 지워지지 않게 잡아 둔다 (다른 로그인은 막지 않는다). 지워지는 중이면 끝날 때까지 기다리고, 없으면 거짓 */
export async function holdUser(tx: Tx, userId: string): Promise<boolean> {
  const rows = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('key share');
  return rows.length > 0;
}

// ── nonce ───────────────────────────────────────────────────

export async function insertNonce(q: Q, nonceHash: string, expiresAt: Date): Promise<void> {
  await q.insert(authNonces).values({ nonceHash, expiresAt });
}

export async function deleteExpiredNonces(q: Q, now: Date): Promise<void> {
  await q.delete(authNonces).where(lte(authNonces.expiresAt, now));
}

/**
 * nonce를 쓴다: 지우면서 있었는지 본다. 한 문장이라 같은 nonce가 동시에 두 번 와도 한 번만 참이다.
 * 부른 트랜잭션이 되돌아가면 nonce도 되살아난다 (충돌로 끝난 연결은 nonce를 쓰지 않은 것으로 둔다).
 */
export async function consumeNonce(tx: Tx, nonceHash: string, now: Date): Promise<boolean> {
  const rows = await tx
    .delete(authNonces)
    .where(and(eq(authNonces.nonceHash, nonceHash), gt(authNonces.expiresAt, now)))
    .returning({ nonceHash: authNonces.nonceHash });
  return rows.length > 0;
}

// ── 수단 옮기기, 지우기 ─────────────────────────────────────────

/** 이 사용자의 기기 수단을 다른 사용자에게 옮긴다. 옮겼으면 참 */
export async function moveGuestIdentity(tx: Tx, identityId: number, fromUserId: string, toUserId: string): Promise<boolean> {
  const rows = await tx
    .update(userIdentities)
    .set({ userId: toUserId })
    .where(and(eq(userIdentities.id, identityId), eq(userIdentities.userId, fromUserId), eq(userIdentities.provider, 'guest')))
    .returning({ id: userIdentities.id });
  return rows.length > 0;
}

export async function deleteSession(tx: Tx, tokenHash: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function deleteSessionsOfIdentity(tx: Tx, identityId: number): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.identityId, identityId));
}

/** 이 사용자의 기기 수단 하나를 지운다. 계정 수단은 지우지 않는다 */
export async function deleteGuestIdentity(tx: Tx, identityId: number, userId: string): Promise<void> {
  await tx.delete(userIdentities).where(and(eq(userIdentities.id, identityId), eq(userIdentities.userId, userId), eq(userIdentities.provider, 'guest')));
}

/** 이 사용자의 세션, 로그인 수단, 설정을 지운다 (사용자 행은 두고) */
export async function deleteLoginData(tx: Tx, userId: string): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
  await tx.delete(userIdentities).where(eq(userIdentities.userId, userId));
  await tx.delete(userSettings).where(eq(userSettings.userId, userId));
}

export async function markUserDeleted(tx: Tx, userId: string): Promise<void> {
  await tx
    .update(users)
    .set({ status: 'deleted', deletedAt: sql`coalesce(${users.deletedAt}, now())` })
    .where(eq(users.id, userId));
}

export async function readUser(q: Q, userId: string): Promise<{ id: string; status: 'active' | 'deleted'; createdAt: Date } | null> {
  const [row] = await q.select({ id: users.id, status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  return row ?? null;
}
