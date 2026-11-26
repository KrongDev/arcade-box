import { canPlayGame } from '../entitlement/index.ts';
import { getGame, isGameId } from '../game/index.ts';
import type { Db, Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { idempotencyKey as checkKey, obj } from '../shared/validate.ts';
import { applyCoins, lockWallet } from '../wallet/index.ts';
import {
  boardsRequiring,
  countBetter,
  deleteUserRows,
  findRunByKey,
  insertBoard,
  insertRun,
  lastRunAt,
  lockBoard,
  readBoard,
  readBoards,
  readRecord,
  readRecords,
  setRunLedger,
  standingBefore,
  topRecords,
  writeBoard,
  writeRecord,
  type RunRow,
} from './repo.ts';
import {
  applyResult,
  boardUnavailable,
  checkBoardId,
  checkBoardShape,
  checkCoins,
  checkGameVersion,
  checkLimit,
  gameLocked,
  idempotencyMismatch,
  invalidRequires,
  isBoardId,
  nickname,
  NO_STANDING,
  ranked,
  stageLocked,
  tooFast,
  tooSoon,
  unknownBoard,
  type Board,
  type Ordering,
  type RunResult,
  type Standing,
} from './rules.ts';
import { canBeCleared, checkValidatorParams, findValidator } from './validators.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 판 결과 ──────────────────────────────────────────────────

export interface RunOutcome {
  boardId: string;
  /** 순위표에 올린 값. 없으면(null) 기록이 아닌 판이다 (0점, 못 깬 시간 판) */
  recordValue: number | null;
  isBest: boolean;
  firstClear: boolean;
  coins: number;
  /** 이 판을 반영한 뒤의 잔액 */
  balance: number;
  /** 같은 키로 다시 보낸 요청이라 처음 답을 그대로 준 것이면 참 */
  replayed: boolean;
}

/** 순위표가 고른 검증기로 판에 남길 것(코인, 값, 게임 버전)을 읽어 낸다. v1의 순서대로 코인을 먼저 본다 */
function readRun(board: Board, body: Record<string, unknown>): { coins: number; result: RunResult; gameVersion: number | null } {
  const coins = checkCoins(board, body.coins);
  const validator = findValidator(board.validator);
  if (!validator) throw boardUnavailable();
  return { coins, result: validator(board, body), gameVersion: checkGameVersion(body.gameVersion) };
}

/**
 * 같은 키로 다시 온 판: 새로 반영하지 않고 처음 답을 다시 만들어 준다 (Review Focus 2).
 * 내용이 처음과 다르면 `409 idempotency_mismatch`. 견주는 것은 판에 남긴 값이다: 순위표, 코인, 값·시간·깼는지, 게임 버전.
 *
 * 처음 보낼 때 이미 통과한 판이라 순위표의 지금 상한과 범위(`max_coins_per_run`, `min_value`~`max_value`)로 다시 재지 않는다:
 * 그사이 운영자가 순위표를 고쳤어도 처음 답을 받는다 (코인은 이미 들어갔는데 앱이 실패로 알게 되지 않게).
 * 값의 모양(정수인지, 판이 말이 되는지)은 검증기가 그대로 본다. 지뢰찾기의 판 크기(`validator_params`)를 그사이 고쳤다면
 * 다시 계산한 점수가 달라져 거절될 수 있다 — 판에 원문을 남기지 않아서 이것까지는 되살리지 못한다.
 *
 * 처음 답은 저장해 두지 않고 다시 계산한다: `isBest`·`firstClear`는 그 판보다 앞선 판들에서
 * (`standingBefore`), 잔액은 그 판의 코인 기록에서 (`applyCoins`가 같은 키에 처음 결과를 준다). 그 뒤에 더 좋은 기록을 냈거나
 * 코인이 변했어도 처음과 같다. 코인이 0이었던 판은 가리키는 코인 기록이 없어서 지금 잔액을 준다 (그 판은 잔액을 바꾸지 않았다).
 */
async function replay(tx: Tx, a: { userId: string; board: Board; first: RunRow; body: Record<string, unknown>; key: string; balance: number; now: Date }): Promise<RunOutcome> {
  const { userId, board, first } = a;
  if (first.boardId !== board.id || a.body.coins !== first.coins) throw idempotencyMismatch();
  const validator = findValidator(board.validator);
  if (!validator) throw boardUnavailable();
  const result = validator({ ...board, minValue: Number.NEGATIVE_INFINITY, maxValue: Number.POSITIVE_INFINITY }, a.body);
  if (result.value !== first.value || result.seconds !== first.seconds || result.won !== first.won || checkGameVersion(a.body.gameVersion) !== first.gameVersion) {
    throw idempotencyMismatch();
  }
  const { isBest, firstClear } = applyResult(board.ordering, await standingBefore(tx, userId, board.id, board.ordering, first.id), result);
  let balance = a.balance;
  if (first.ledgerId !== null) {
    const paid = await applyCoins(tx, { userId, delta: first.coins, reason: 'run', idempotencyKey: a.key, now: a.now });
    // 판이 가리키는 코인 기록이 그 키의 기록이 아니면 자료가 어긋난 것이다. 던져서 방금 한 일을 되돌린다 (코인을 또 주지 않는다)
    if (!paid.replayed || paid.ledgerId !== first.ledgerId) throw new Error('판과 코인 기록이 어긋났어요');
    balance = paid.balance;
  }
  return { boardId: board.id, recordValue: first.value, isBest, firstClear, coins: first.coins, balance, replayed: true };
}

/**
 * 판 결과를 반영한다 (스펙 5.9 `POST /v2/me/runs`): 판 저장, 기록 갱신, 코인 반영을 한 트랜잭션으로.
 * 어디서든 실패하면(코인 반영에서 지갑 상한에 걸리는 것 포함) 판도 기록도 코인도 남지 않는다.
 *
 * 입력 `{ boardId, coins, idempotencyKey?, gameVersion?, score?, seconds?, won?, opened?, correctFlags?, wrongFlags?, shields? }`.
 *
 * 확인하는 순서는 v1과 같다 (표 K8):
 * 모르는 순위표 `400 unknown_board` → 할 수 없는 게임 `403 game_locked` (게임이 live이고 그 게임 상품을 가졌어야 한다 — 표 D4)
 * → 앞 단계를 안 깼으면 `403 stage_locked` → 직전 판에서 3초 안이면 `429 too_fast` → 코인이 0~판당 상한의 정수가 아니면
 * `400 invalid_coins` → 검증기의 확인 (`invalid_score`, `invalid_seconds`, `invalid_board_stats`).
 *
 * **같은 사용자의 판 결과는 차례로 처리된다.** 확인을 시작하기 전에 사용자 행 → 지갑 행을 잡아서(`lockWallet`),
 * 동시에 온 요청은 앞의 것이 끝난 뒤에 "직전 판"과 "같은 키의 판"을 본다. 동시에 5개를 보내 3초 간격을 건너뛰거나
 * 같은 키로 코인을 두 번 받는 길이 없다. 잠그는 순서는 늘 사용자 → 지갑 → 그 밖이다.
 *
 * 같은 `idempotencyKey`로 다시 보내면 판도 코인도 한 번만 반영되고 처음과 같은 답을 `replayed: true`로 받는다 (`replay`).
 * 3초 간격보다 먼저 보므로 바로 다시 보내도 된다. 키는 사용자마다 따로다.
 */
export async function submitRun(db: Db, userId: string, input: unknown, now: Date): Promise<RunOutcome> {
  const body = obj(input, 'body');
  const boardId = body.boardId;
  if (!isBoardId(boardId)) throw unknownBoard(400);

  return db.transaction(async (tx) => {
    const balance = await lockWallet(tx, userId, now);
    const board = await readBoard(tx, boardId);
    if (!board) throw unknownBoard(400);

    const key = checkKey(body.idempotencyKey);
    if (key !== null) {
      const first = await findRunByKey(tx, userId, key);
      if (first) return replay(tx, { userId, board, first, body, key, balance, now });
    }

    if (!(await canPlayGame(tx, userId, board.gameId))) throw gameLocked();
    if (board.requiresBoardId !== null && !(await readRecord(tx, board.requiresBoardId, userId))?.clearedAt) throw stageLocked();
    if (tooSoon(await lastRunAt(tx, userId), now)) throw tooFast();
    const { coins, result, gameVersion } = readRun(board, body);

    const record = await readRecord(tx, board.id, userId);
    const prior: Standing = record ? { best: record.bestValue, bestSeconds: record.bestSeconds, cleared: record.clearedAt !== null } : NO_STANDING;
    const { isBest, firstClear, next } = applyResult(board.ordering, prior, result);

    const runId = await insertRun(tx, { userId, boardId: board.id, value: result.value, seconds: result.seconds, won: result.won, coins, gameVersion, idempotencyKey: key, now });
    await writeRecord(tx, userId, {
      boardId: board.id,
      bestValue: next.best,
      bestAt: isBest ? now : (record?.bestAt ?? null),
      bestSeconds: next.bestSeconds,
      clearedAt: firstClear ? now : (record?.clearedAt ?? null),
      playCount: (record?.playCount ?? 0) + 1,
    });

    // 코인은 맨 끝에 반영한다. 여기서 실패하면(지갑 상한 등) 위에서 넣은 판과 기록도 함께 되돌아간다
    let after = balance;
    if (coins > 0) {
      const paid = await applyCoins(tx, { userId, delta: coins, reason: 'run', idempotencyKey: key, now });
      // 이 키의 판은 없는데 코인 기록은 있다: 같은 키를 다른 판에 쓴 흔적이다. 코인이 들어가지 않았으니 판도 남기지 않는다
      if (paid.replayed) throw idempotencyMismatch();
      await setRunLedger(tx, runId, paid.ledgerId);
      after = paid.balance;
    }
    return { boardId: board.id, recordValue: result.value, isBest, firstClear, coins, balance: after, replayed: false };
  });
}

// ── 순위표 조회 ────────────────────────────────────────────────

export interface Leaderboard {
  board: { id: string; label: string; ordering: Ordering };
  top: Array<{ rank: number; name: string; value: number; me: boolean }>;
  mine: { rank: number; value: number } | null;
}

/**
 * 순위표 (스펙 5.9 `GET /v2/leaderboards/:boardId`, 표 K16): 위쪽 `limit`명(1~100)과, 로그인했으면 내 순위.
 * 같은 값이면 먼저 낸 사람이 앞이고 등수는 같다. 이름은 사용자 ID로 만든 가명이고 사용자 ID는 내보내지 않는다.
 * 없는 순위표와 아직 내보내지 않은(draft) 게임의 순위표는 `404 unknown_board`, `limit`이 범위 밖이면 `400 invalid_limit`.
 */
export async function leaderboard(db: Db, boardId: string, limit: number, userId: string | null): Promise<Leaderboard> {
  const n = checkLimit(limit);
  const board = isBoardId(boardId) ? await readBoard(db, boardId) : null;
  if (!board) throw unknownBoard(404);
  // 아직 내보내지 않은(draft) 게임의 순위표는 없는 것이다: 목록과 묶음처럼 출시 전의 것을 내보이지 않는다.
  // 내린(retired) 게임의 순위표는 쌓인 기록을 볼 수 있게 그대로 보여 준다
  if ((await getGame(db, board.gameId))?.status === 'draft') throw unknownBoard(404);
  const top = ranked(await topRecords(db, board.id, board.ordering, n)).map((r) => ({ rank: r.rank, name: nickname(r.userId), value: r.value, me: r.userId === userId }));
  let mine: Leaderboard['mine'] = null;
  if (userId !== null && UUID.test(userId)) {
    const record = await readRecord(db, board.id, userId);
    if (record && record.bestValue !== null) mine = { rank: (await countBetter(db, board.id, board.ordering, record.bestValue)) + 1, value: record.bestValue };
  }
  return { board: { id: board.id, label: board.label, ordering: board.ordering }, top, mine };
}

/** 이 사용자가 판을 낸 순위표마다의 최고 기록, 최고 시간(깬 판), 깬 적이 있는지 (`/v2/me`의 `boards`) */
export async function boardStats(q: Q, userId: string): Promise<Record<string, { best: number | null; bestSeconds: number | null; cleared: boolean }>> {
  if (!UUID.test(userId)) return {};
  const out: Record<string, { best: number | null; bestSeconds: number | null; cleared: boolean }> = {};
  for (const r of await readRecords(q, userId)) out[r.boardId] = { best: r.bestValue, bestSeconds: r.bestSeconds, cleared: r.clearedAt !== null };
  return out;
}

/** 이 게임의 순위표 (순서 → ID 순서). 게임이 없거나 게임 ID 모양이 아니면 빈 목록 */
export async function listBoards(q: Q, gameId: string): Promise<Board[]> {
  if (!isGameId(gameId)) return [];
  return readBoards(q, gameId);
}

// ── 순위표 만들기·고치기 (운영 명령) ───────────────────────────────────

export interface NewBoard {
  id: string;
  gameId: string;
  label: string;
  ordering: Ordering;
  minValue: number;
  maxValue: number;
  maxCoinsPerRun: number;
  requiresBoardId?: string | null;
  /** 적지 않으면 'caps' */
  validator?: string;
  validatorParams?: unknown;
  sortOrder?: number;
}

/** 고칠 수 있는 것. `id`·`gameId`·`ordering`은 못 바꾼다 (쌓인 기록의 뜻이 달라진다) */
export interface BoardPatch {
  label?: string;
  minValue?: number;
  maxValue?: number;
  maxCoinsPerRun?: number;
  /** null이면 앞 단계를 뗀다 */
  requiresBoardId?: string | null;
  validator?: string;
  /** null이면 설정을 비운다. 적지 않으면 지금 설정 그대로다 */
  validatorParams?: unknown;
  sortOrder?: number;
}

const noBoard = () => new RuleError(404, 'not_found', '없는 순위표예요');

/** 순위표 한 줄이 말이 되는지 (DB를 보지 않고 아는 것 전부): 칸의 모양과 검증기 설정 */
export function checkBoard(b: Board): Board {
  const shape = checkBoardShape(b);
  if (!isGameId(b.gameId)) throw new RuleError(400, 'invalid_game_id', '게임 ID 모양이 아니에요');
  return { ...shape, validator: b.validator, validatorParams: checkValidatorParams(b.validator, b.validatorParams) };
}

/**
 * 앞 단계가 있는 같은 게임의 순위표인지, 깰 수 있는 순위표인지, 따라가다 자기에게 돌아오지 않는지.
 * 단계는 앞 순위표를 깬 적이 있어야 열리므로(`cleared_at`), 깰 수 없는 순위표를 앞 단계로 두면 영영 열리지 않는다.
 */
async function checkRequires(tx: Tx, board: Board): Promise<void> {
  let next = board.requiresBoardId;
  for (let depth = 0; next !== null; depth++) {
    const found = await readBoard(tx, next);
    if (!found) throw noBoard();
    if (found.gameId !== board.gameId) throw invalidRequires('앞 단계는 같은 게임의 순위표여야 해요');
    if (found.id === board.id || depth > 100) throw invalidRequires('앞 단계가 돌고 돌아요');
    if (depth === 0 && !canBeCleared(found)) {
      throw invalidRequires(`앞 단계는 깰 수 있는 순위표여야 해요 (지뢰찾기 검증기이거나 시간 순위표). ${found.id}은 점수만 재서 깬다는 것이 없고, 앞 단계로 두면 이 단계가 열리지 않아요`);
    }
    next = found.requiresBoardId;
  }
}

/** 깰 수 없는 순위표가 되는데 다른 순위표가 이것을 앞 단계로 두고 있으면 그 단계들이 막힌다: `409 required_by_boards` */
async function checkStillClearable(tx: Tx, board: Board): Promise<void> {
  if (canBeCleared(board)) return;
  const blocked = await boardsRequiring(tx, board.id);
  if (blocked.length > 0) {
    throw new RuleError(409, 'required_by_boards', `${blocked.join(', ')}이 이 순위표를 앞 단계로 두고 있어요. 깰 수 없는 순위표로 바꾸면 그 단계가 열리지 않아요. 먼저 그 순위표의 앞 단계를 바꿔 주세요`);
  }
}

/**
 * 순위표를 만든다 (`board add`). 칸이 틀리면 `400 invalid_<칸>`, 모르는 검증기면 `400 unknown_validator`,
 * 검증기 설정이 틀리면 `400 invalid_validator_params`, 없는 게임이나 없는 앞 단계면 `404 not_found`,
 * 앞 단계가 다른 게임의 것이거나 깰 수 없는 순위표면 `400 invalid_requires`, 같은 ID가 있으면 `409 already_exists`.
 */
export async function createBoard(tx: Tx, input: NewBoard): Promise<void> {
  const board = checkBoard({
    id: input.id,
    gameId: input.gameId,
    label: input.label,
    ordering: input.ordering,
    minValue: input.minValue,
    maxValue: input.maxValue,
    maxCoinsPerRun: input.maxCoinsPerRun,
    requiresBoardId: input.requiresBoardId ?? null,
    validator: input.validator ?? 'caps',
    validatorParams: input.validatorParams ?? null,
    sortOrder: input.sortOrder ?? 0,
  });
  if (!(await getGame(tx, board.gameId))) throw new RuleError(404, 'not_found', '없는 게임이에요');
  await checkRequires(tx, board);
  if (!(await insertBoard(tx, board))) throw new RuleError(409, 'already_exists', '이미 있는 순위표예요');
}

const PATCH_KEYS = ['label', 'minValue', 'maxValue', 'maxCoinsPerRun', 'requiresBoardId', 'validator', 'validatorParams', 'sortOrder'] as const;

/**
 * 순위표를 고친다 (`board update`). 적은 것만 바꾸고, 바꾼 뒤의 한 줄 전체를 다시 확인한다
 * (범위, 검증기와 그 설정의 짝, 앞 단계). 고칠 것이 없으면 `400 nothing_to_update`, `id`·`gameId`·`ordering`을
 * 바꾸려 하면 `400 not_updatable`, 없는 순위표면 `404 not_found`, 다른 순위표가 앞 단계로 둔 순위표를 깰 수 없는 검증기로
 * 바꾸려 하면 `409 required_by_boards`. 그 밖의 거절은 `createBoard`와 같다.
 */
export async function updateBoard(tx: Tx, id: string, patch: BoardPatch): Promise<void> {
  const boardId = checkBoardId(id);
  const given = patch as Record<string, unknown>;
  for (const fixed of ['id', 'gameId', 'ordering']) {
    if (given[fixed] !== undefined) throw new RuleError(400, 'not_updatable', `${fixed}는 바꿀 수 없어요. 새 순위표를 만들어 주세요`);
  }
  const changes = Object.fromEntries(PATCH_KEYS.filter((k) => given[k] !== undefined).map((k) => [k, given[k]]));
  if (Object.keys(changes).length === 0) throw new RuleError(400, 'nothing_to_update', '고칠 것을 적어 주세요');

  const current = await lockBoard(tx, boardId);
  if (!current) throw noBoard();
  const board = checkBoard({ ...current, ...changes } as Board);
  await checkRequires(tx, board);
  await checkStillClearable(tx, board);
  await writeBoard(tx, board);
}

/**
 * 이 사용자의 판과 기록을 지운다 (계정 삭제, 스펙 5.4). 판이 코인 기록을 가리키므로(`runs.ledger_id`)
 * 지갑의 `purgeUser`보다 먼저 불려야 한다 (삭제 순서: order → reward → play → entitlement → wallet).
 */
export async function purgeUser(tx: Tx, userId: string): Promise<void> {
  await deleteUserRows(tx, userId);
}
