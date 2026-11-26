import { and, asc, desc, eq, gt, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { Q, Tx } from '../shared/db/index.ts';
import type { Board, Ordering, Standing } from './rules.ts';
import { boardRecords, boards, runs } from './schema.ts';

// ── 순위표 ───────────────────────────────────────────────────

const boardColumns = {
  id: boards.id,
  gameId: boards.gameId,
  label: boards.label,
  ordering: boards.ordering,
  minValue: boards.minValue,
  maxValue: boards.maxValue,
  maxCoinsPerRun: boards.maxCoinsPerRun,
  requiresBoardId: boards.requiresBoardId,
  validator: boards.validator,
  validatorParams: boards.validatorParams,
  sortOrder: boards.sortOrder,
};

export async function readBoard(q: Q, id: string): Promise<Board | null> {
  const [row] = await q.select(boardColumns).from(boards).where(eq(boards.id, id));
  return row ?? null;
}

/** 고치는 동안 순위표 행을 잠근다. 없으면 null */
export async function lockBoard(tx: Tx, id: string): Promise<Board | null> {
  const [row] = await tx.select(boardColumns).from(boards).where(eq(boards.id, id)).for('update');
  return row ?? null;
}

/** 순위표들. `gameId`를 주면 그 게임의 것만. 게임 → 순서 → ID 순서 */
export async function readBoards(q: Q, gameId?: string): Promise<Board[]> {
  return q
    .select(boardColumns)
    .from(boards)
    .where(gameId === undefined ? undefined : eq(boards.gameId, gameId))
    .orderBy(asc(boards.gameId), asc(boards.sortOrder), asc(boards.id));
}

/** 이 순위표를 앞 단계로 둔 순위표의 ID (ID 순서) */
export async function boardsRequiring(q: Q, id: string): Promise<string[]> {
  const rows = await q.select({ id: boards.id }).from(boards).where(eq(boards.requiresBoardId, id)).orderBy(asc(boards.id));
  return rows.map((r) => r.id);
}

/** 순위표를 넣는다. 같은 ID가 있으면 넣지 않고 거짓 */
export async function insertBoard(tx: Tx, board: Board): Promise<boolean> {
  const created = await tx.insert(boards).values(board).onConflictDoNothing().returning({ id: boards.id });
  return created.length > 0;
}

export async function writeBoard(tx: Tx, board: Board): Promise<void> {
  const { id, gameId: _gameId, ordering: _ordering, ...set } = board;
  await tx.update(boards).set(set).where(eq(boards.id, id));
}

// ── 판 ──────────────────────────────────────────────────────

export interface RunRow {
  id: number;
  boardId: string;
  value: number | null;
  seconds: number | null;
  won: boolean | null;
  coins: number;
  ledgerId: number | null;
  gameVersion: number | null;
  createdAt: Date;
}

/** 이 사용자가 이 키로 낸 판. 지갑을 잠근 뒤에 불러야 같은 키의 다른 요청이 방금 넣은 줄이 보인다 */
export async function findRunByKey(tx: Tx, userId: string, idempotencyKey: string): Promise<RunRow | null> {
  const [row] = await tx
    .select({ id: runs.id, boardId: runs.boardId, value: runs.value, seconds: runs.seconds, won: runs.won, coins: runs.coins, ledgerId: runs.ledgerId, gameVersion: runs.gameVersion, createdAt: runs.createdAt })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.idempotencyKey, idempotencyKey)));
  return row ?? null;
}

/** 이 사용자가 마지막으로 낸 판의 시각 (순위표와 상관없이). 낸 적이 없으면 null */
export async function lastRunAt(tx: Tx, userId: string): Promise<Date | null> {
  const [row] = await tx.select({ createdAt: runs.createdAt }).from(runs).where(eq(runs.userId, userId)).orderBy(desc(runs.id)).limit(1);
  return row?.createdAt ?? null;
}

/**
 * `from`부터 `to` 전까지 이 사용자가 판으로 번 코인의 합 (`runs.coins`는 실제로 들어간 코인이다).
 * `throughRunId`를 주면 그 판까지만(그 판 포함) 센다: 그 판을 반영한 직후의 합이다.
 */
export async function sumRunCoins(q: Q, userId: string, from: Date, to: Date, throughRunId?: number): Promise<number> {
  const [row] = await q
    .select({ total: sql<number>`coalesce(sum(${runs.coins}), 0)::float8` })
    .from(runs)
    .where(and(eq(runs.userId, userId), gte(runs.createdAt, from), lt(runs.createdAt, to), throughRunId === undefined ? undefined : lte(runs.id, throughRunId)));
  return row?.total ?? 0;
}

export async function insertRun(
  tx: Tx,
  row: { userId: string; boardId: string; value: number | null; seconds: number | null; won: boolean | null; coins: number; gameVersion: number | null; idempotencyKey: string | null; now: Date },
): Promise<number> {
  const [created] = await tx
    .insert(runs)
    .values({ userId: row.userId, boardId: row.boardId, value: row.value, seconds: row.seconds, won: row.won, coins: row.coins, gameVersion: row.gameVersion, idempotencyKey: row.idempotencyKey, createdAt: row.now })
    .returning({ id: runs.id });
  return created.id;
}

export async function setRunLedger(tx: Tx, runId: number, ledgerId: number): Promise<void> {
  await tx.update(runs).set({ ledgerId }).where(eq(runs.id, runId));
}

/**
 * 이 판보다 앞서 이 사용자가 이 순위표에 낸 판들의 집계: 그때까지의 최고 기록, 최고 시간, 깬 적이 있는지.
 * `board_records`가 `runs`의 집계라서(스펙 5.3), 그 판을 반영하기 직전의 기록 행과 같은 값이다.
 * 다시 보낸 판에 처음과 같은 답(`isBest`, `firstClear`)을 줄 때 쓴다.
 */
export async function standingBefore(tx: Tx, userId: string, boardId: string, ordering: Ordering, runId: number): Promise<Standing> {
  const [row] = await tx
    .select({
      best: ordering === 'higher' ? sql<number | null>`max(${runs.value})` : sql<number | null>`min(${runs.value})`,
      bestSeconds: sql<number | null>`min(${runs.seconds}) filter (where ${runs.won})`,
      cleared: sql<boolean | null>`bool_or(${runs.won})`,
    })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.boardId, boardId), lt(runs.id, runId)));
  return { best: row?.best ?? null, bestSeconds: row?.bestSeconds ?? null, cleared: row?.cleared === true };
}

// ── 기록 ────────────────────────────────────────────────────

export interface RecordRow {
  boardId: string;
  bestValue: number | null;
  bestAt: Date | null;
  bestSeconds: number | null;
  clearedAt: Date | null;
  playCount: number;
}

const recordColumns = {
  boardId: boardRecords.boardId,
  bestValue: boardRecords.bestValue,
  bestAt: boardRecords.bestAt,
  bestSeconds: boardRecords.bestSeconds,
  clearedAt: boardRecords.clearedAt,
  playCount: boardRecords.playCount,
};

export async function readRecord(q: Q, boardId: string, userId: string): Promise<RecordRow | null> {
  const [row] = await q
    .select(recordColumns)
    .from(boardRecords)
    .where(and(eq(boardRecords.boardId, boardId), eq(boardRecords.userId, userId)));
  return row ?? null;
}

/** 이 사용자의 기록 전부 (순위표 ID 순서) */
export async function readRecords(q: Q, userId: string): Promise<RecordRow[]> {
  return q.select(recordColumns).from(boardRecords).where(eq(boardRecords.userId, userId)).orderBy(asc(boardRecords.boardId));
}

/** 기록 행을 이 값으로 둔다 (없으면 만든다). 같은 사용자의 판은 차례로 처리되므로 읽은 뒤 계산해서 쓴다 */
export async function writeRecord(tx: Tx, userId: string, row: RecordRow): Promise<void> {
  const { boardId, ...set } = row;
  await tx
    .insert(boardRecords)
    .values({ boardId, userId, ...set })
    .onConflictDoUpdate({ target: [boardRecords.boardId, boardRecords.userId], set });
}

/**
 * 기록이 있는 사용자를 좋은 순서로 `limit`명. 같은 값이면 먼저 낸 사람이 앞이다
 * (낸 시각까지 같으면 사용자 ID 순서로 — 부를 때마다 순서가 바뀌지 않게).
 */
export async function topRecords(q: Q, boardId: string, ordering: Ordering, limit: number): Promise<Array<{ userId: string; value: number }>> {
  const rows = await q
    .select({ userId: boardRecords.userId, value: boardRecords.bestValue })
    .from(boardRecords)
    .where(and(eq(boardRecords.boardId, boardId), isNotNull(boardRecords.bestValue)))
    .orderBy(ordering === 'higher' ? desc(boardRecords.bestValue) : asc(boardRecords.bestValue), asc(boardRecords.bestAt), asc(boardRecords.userId))
    .limit(limit);
  return rows.flatMap((r) => (r.value === null ? [] : [{ userId: r.userId, value: r.value }]));
}

/** 이 값보다 좋은 기록의 수. 내 등수는 이 수 + 1이다 (같은 값은 같은 등수) */
export async function countBetter(q: Q, boardId: string, ordering: Ordering, value: number): Promise<number> {
  const [row] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(boardRecords)
    .where(and(eq(boardRecords.boardId, boardId), ordering === 'higher' ? gt(boardRecords.bestValue, value) : lt(boardRecords.bestValue, value)));
  return row?.n ?? 0;
}

/** 이 사용자의 판과 기록을 지운다. 조건이 `user_id`뿐이라 다른 사용자의 행은 건드리지 않는다 */
export async function deleteUserRows(tx: Tx, userId: string): Promise<void> {
  await tx.delete(runs).where(eq(runs.userId, userId));
  await tx.delete(boardRecords).where(eq(boardRecords.userId, userId));
}
