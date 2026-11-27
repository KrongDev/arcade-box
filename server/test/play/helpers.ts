import { eq, sql } from 'drizzle-orm';
import { findSession } from '../../src/account/index.ts';
import { grant } from '../../src/entitlement/index.ts';
import { createGame, updateGame } from '../../src/game/index.ts';
import { createBoard, routes, submitRun, type NewBoard } from '../../src/play/index.ts';
import { boardRecords, runs } from '../../src/play/schema.ts';
import { createProduct, type NewProduct } from '../../src/product/index.ts';
import type { Config } from '../../src/shared/config.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { createHandler } from '../../src/shared/http/index.ts';
import type { Clock } from '../../src/shared/time.ts';
import { testConfig } from '../account/helpers.ts';
import type { Handler } from '../helpers/http.ts';

export const NOW = new Date('2026-11-26T03:00:00Z');

/** `assert.rejects`에 넣는 확인: 이 상태와 코드의 `RuleError`인지 */
export const rule = (status: number, code: string) => (err: unknown) => err instanceof RuleError && err.status === status && err.code === code;

/** `assert.throws`에 넣는 확인 (순수 함수용). 위와 같다 */
export const thrown = rule;

const GAMES = ['pinball', 'minesweeper', 'breakout'];

const PRODUCTS: NewProduct[] = [
  { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'everyone', gameId: 'pinball', status: 'on_sale' },
  { id: 'game.minesweeper', kind: 'game', name: '지뢰찾기', access: 'purchase', gameId: 'minesweeper', status: 'on_sale' },
  { id: 'game.breakout', kind: 'game', name: '벽돌깨기', access: 'purchase', gameId: 'breakout', status: 'on_sale' },
];

/** v1의 판 크기 (`domain.ts`의 BOARDS): 안전한 칸, 지뢰, 기준 시간(초) */
export const MS = {
  easy: { safe: 70, mines: 10, par: 180 },
  normal: { safe: 180, mines: 36, par: 480 },
  hard: { safe: 336, mines: 80, par: 900 },
};

/**
 * v1의 순위표 다섯(표 K12: 판당 코인 상한 400·400·69·131·220, 지뢰찾기는 초급 → 중급 → 고급)과,
 * v1 코드에만 있고 쓰이지 않던 시간 순위표(`lower`)를 확인하려고 만든 `pinball.sprint` 하나.
 */
export const BOARDS: NewBoard[] = [
  { id: 'pinball', gameId: 'pinball', label: '핀볼', ordering: 'higher', minValue: 0, maxValue: 5_000_000, maxCoinsPerRun: 400 },
  { id: 'breakout', gameId: 'breakout', label: '벽돌깨기', ordering: 'higher', minValue: 0, maxValue: 5_000_000, maxCoinsPerRun: 400 },
  { id: 'minesweeper.easy', gameId: 'minesweeper', label: '초급', ordering: 'higher', minValue: 0, maxValue: 5_000_000, maxCoinsPerRun: 69, validator: 'minesweeper', validatorParams: MS.easy, sortOrder: 1 },
  {
    id: 'minesweeper.normal',
    gameId: 'minesweeper',
    label: '중급',
    ordering: 'higher',
    minValue: 0,
    maxValue: 5_000_000,
    maxCoinsPerRun: 131,
    requiresBoardId: 'minesweeper.easy',
    validator: 'minesweeper',
    validatorParams: MS.normal,
    sortOrder: 2,
  },
  {
    id: 'minesweeper.hard',
    gameId: 'minesweeper',
    label: '고급',
    ordering: 'higher',
    minValue: 0,
    maxValue: 5_000_000,
    maxCoinsPerRun: 220,
    requiresBoardId: 'minesweeper.normal',
    validator: 'minesweeper',
    validatorParams: MS.hard,
    sortOrder: 3,
  },
  { id: 'pinball.sprint', gameId: 'pinball', label: '빨리 깨기', ordering: 'lower', minValue: 1, maxValue: 86_400, maxCoinsPerRun: 50, sortOrder: 1 },
];

/**
 * 게임 셋(모두 live)과 게임 상품(핀볼은 everyone, 지뢰찾기·벽돌깨기는 purchase — 모두 on_sale), 위의 순위표 여섯.
 */
export async function seedPlay(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const id of GAMES) {
      await createGame(tx, { id, name: id, description: '' });
      await updateGame(tx, id, { status: 'live' });
    }
    for (const p of PRODUCTS) await createProduct(tx, p);
    for (const b of BOARDS) await createBoard(tx, b);
  });
}

/** 운영자 지급으로 게임을 가지게 한다 */
export async function own(db: Db, userId: string, ...gameIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const gameId of gameIds) await grant(tx, { userId, productId: `game.${gameId}`, source: 'grant' });
  });
}

/** 판 결과를 서비스에 바로 보낸다 (답 전체) */
export const sendFull = (db: Db, userId: string, input: unknown, now: Date) => submitRun(db, userId, input, now);

/**
 * 판 결과를 보내고 답에서 `coinsLeftToday`(하루 상한까지 남은 코인)를 뺀 것을 준다.
 * 하루 상한을 보지 않는 테스트가 쓴다: 그 테스트들의 판은 하루 상한(1,500)에 닿지 않는다. 상한은 `run-coins.test.ts`가 `sendFull`로 본다.
 */
export async function send(db: Db, userId: string, input: unknown, now: Date) {
  const { coinsLeftToday: _left, ...rest } = await submitRun(db, userId, input, now);
  return rest;
}

/** 지뢰찾기를 깬 판 (안전한 칸을 다 열고 지뢰에 깃발을 다 꽂음) */
export const clearRun = (boardId: string, size: { safe: number; mines: number }, seconds = 60) => ({
  boardId,
  won: true,
  seconds,
  opened: size.safe,
  correctFlags: size.mines,
  wrongFlags: 0,
  coins: 0,
});

export function runsOf(db: Db, userId: string) {
  return db.select().from(runs).where(eq(runs.userId, userId)).orderBy(runs.id);
}

export function recordsOf(db: Db, userId: string) {
  return db.select().from(boardRecords).where(eq(boardRecords.userId, userId)).orderBy(boardRecords.boardId);
}

/** 판·기록·코인 기록의 수를 SQL로 직접 센다 (play와 wallet의 함수를 거치지 않는다) */
export async function counts(db: Db, userId: string): Promise<{ runs: number; records: number; ledger: number; balance: number | null }> {
  const out = (await db.execute(sql`
    select
      (select count(*)::text from app.runs where user_id = ${userId}) as runs,
      (select count(*)::text from app.board_records where user_id = ${userId}) as records,
      (select count(*)::text from app.coin_ledger where user_id = ${userId}) as ledger,
      (select balance::text from app.wallets where user_id = ${userId}) as balance
  `)) as unknown as { rows: Array<{ runs: string; records: string; ledger: string; balance: string | null }> };
  const row = out.rows[0];
  return { runs: Number(row.runs), records: Number(row.records), ledger: Number(row.ledger), balance: row.balance === null ? null : Number(row.balance) };
}

/** play의 경로만 붙인 HTTP 처리기. 세션은 진짜 `findSession`으로 찾는다 */
export function playHandler(db: Db, clock: Clock, config: Config = testConfig): Handler {
  return createHandler(routes({ db, config }), {
    allowedOrigins: testConfig.allowedOrigins,
    now: clock,
    findSession: (tokenHash, now) => findSession(db, tokenHash, now),
  });
}
