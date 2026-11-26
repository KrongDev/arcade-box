import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import type { Q, Tx } from '../shared/db/index.ts';
import type { GameStatus, VersionStatus } from './rules.ts';
import { games, gameVersions } from './schema.ts';

export interface LiveVersion {
  version: number;
  sizeBytes: number;
  sha256: string;
  signature: string;
  minShellApi: number;
}

export interface GameRow {
  id: string;
  name: string;
  description: string;
  iconPath: string | null;
  status: GameStatus;
  sortOrder: number;
  liveVersion: LiveVersion | null;
}

const gameColumns = {
  id: games.id,
  name: games.name,
  description: games.description,
  iconPath: games.iconPath,
  status: games.status,
  sortOrder: games.sortOrder,
  version: gameVersions.version,
  sizeBytes: gameVersions.sizeBytes,
  sha256: gameVersions.sha256,
  signature: gameVersions.signature,
  minShellApi: gameVersions.minShellApi,
};


function toGame(row: {
  id: string;
  name: string;
  description: string;
  iconPath: string | null;
  status: GameStatus;
  sortOrder: number;
  version: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  signature: string | null;
  minShellApi: number | null;
}): GameRow {
  const { version, sizeBytes, sha256, signature, minShellApi, ...game } = row;
  const liveVersion = version === null ? null : { version, sizeBytes: sizeBytes!, sha256: sha256!, signature: signature!, minShellApi: minShellApi! };
  return { ...game, liveVersion };
}

/** 게임과 지금 버전 (지금 버전이 없으면 버전 열이 모두 null) */
function selectGames(q: Q) {
  return q.select(gameColumns).from(games).leftJoin(gameVersions, eq(gameVersions.id, games.liveVersionId));
}

export async function readGame(q: Q, id: string): Promise<GameRow | null> {
  const [row] = await selectGames(q).where(eq(games.id, id));
  return row ? toGame(row) : null;
}

/** live 게임을 순서(sort_order, id)대로 */
export async function readLiveGames(q: Q): Promise<GameRow[]> {
  const rows = await selectGames(q).where(eq(games.status, 'live')).orderBy(asc(games.sortOrder), asc(games.id));
  return rows.map(toGame);
}

/** 모든 게임 (명령줄 `game list`) */
export async function readAllGames(q: Q): Promise<GameRow[]> {
  const rows = await selectGames(q).orderBy(asc(games.sortOrder), asc(games.id));
  return rows.map(toGame);
}

/** 새 게임. 같은 ID가 이미 있으면 거짓 */
export async function insertGame(tx: Tx, row: { id: string; name: string; description: string; sortOrder: number }): Promise<boolean> {
  const created = await tx.insert(games).values(row).onConflictDoNothing().returning({ id: games.id });
  return created.length > 0;
}

/** 고친 것이 있으면 참 (없는 게임이면 거짓) */
export async function patchGame(
  tx: Tx,
  id: string,
  patch: { name?: string; description?: string; sortOrder?: number; status?: GameStatus; iconPath?: string },
): Promise<boolean> {
  const changed = await tx
    .update(games)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(games.id, id))
    .returning({ id: games.id });
  return changed.length > 0;
}

/**
 * 게임 행을 잠그고 상태와 지금 버전의 행 번호를 준다. 버전 올리기·내보내기·되돌리기가 이 게임에서 한 번에 하나씩 돈다.
 * 없으면 null.
 */
export async function lockGame(tx: Tx, id: string): Promise<{ status: GameStatus; liveVersionId: number | null } | null> {
  const [row] = await tx.select({ status: games.status, liveVersionId: games.liveVersionId }).from(games).where(eq(games.id, id)).for('update');
  return row ?? null;
}

export async function setLiveVersion(tx: Tx, id: string, liveVersionId: number, status?: GameStatus): Promise<void> {
  await tx
    .update(games)
    .set({ liveVersionId, ...(status ? { status } : {}), updatedAt: sql`now()` })
    .where(eq(games.id, id));
}

// ── 버전 ────────────────────────────────────────────────────

export interface VersionRow {
  id: number;
  version: number;
  status: VersionStatus;
  bundlePath: string;
}

const versionColumns = { id: gameVersions.id, version: gameVersions.version, status: gameVersions.status, bundlePath: gameVersions.bundlePath };

export async function readVersion(q: Q, gameId: string, version: number): Promise<VersionRow | null> {
  const [row] = await q.select(versionColumns).from(gameVersions).where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.version, version)));
  return row ?? null;
}

export async function readVersionById(q: Q, id: number): Promise<VersionRow | null> {
  const [row] = await q.select(versionColumns).from(gameVersions).where(eq(gameVersions.id, id));
  return row ?? null;
}

/** 이 게임의 가장 큰 버전 번호 (거둬들인 것 포함). 버전이 없으면 0 */
export async function maxVersion(q: Q, gameId: string): Promise<number> {
  const [row] = await q
    .select({ max: sql<number | null>`max(${gameVersions.version})` })
    .from(gameVersions)
    .where(eq(gameVersions.gameId, gameId));
  return row?.max === null || row?.max === undefined ? 0 : Number(row.max);
}

/** `below`보다 낮은 live 버전 가운데 가장 높은 것 */
export async function previousLive(q: Q, gameId: string, below: number): Promise<VersionRow | null> {
  const [row] = await q
    .select(versionColumns)
    .from(gameVersions)
    .where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.status, 'live'), lt(gameVersions.version, below)))
    .orderBy(desc(gameVersions.version))
    .limit(1);
  return row ?? null;
}

export async function insertVersion(
  tx: Tx,
  row: { gameId: string; version: number; bundlePath: string; sizeBytes: number; sha256: string; signature: string; minShellApi: number; notes: string | null },
): Promise<void> {
  await tx.insert(gameVersions).values({ ...row, status: 'uploaded' });
}

export async function setVersionStatus(tx: Tx, id: number, status: VersionStatus, published: boolean): Promise<void> {
  await tx
    .update(gameVersions)
    .set({ status, ...(published ? { publishedAt: sql`now()` } : {}) })
    .where(eq(gameVersions.id, id));
}

/** 이 게임의 모든 버전 (명령줄 `game list`) */
export async function readVersions(q: Q, gameId: string): Promise<Array<{ version: number; status: VersionStatus; sizeBytes: number; minShellApi: number }>> {
  return q
    .select({ version: gameVersions.version, status: gameVersions.status, sizeBytes: gameVersions.sizeBytes, minShellApi: gameVersions.minShellApi })
    .from(gameVersions)
    .where(eq(gameVersions.gameId, gameId))
    .orderBy(asc(gameVersions.version));
}
