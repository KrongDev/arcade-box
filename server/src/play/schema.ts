import { sql } from 'drizzle-orm';
import { bigint, boolean, check, doublePrecision, index, integer, jsonb, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { users } from '../account/schema.ts';
import { games } from '../game/schema.ts';
import { app } from '../shared/db/schema.ts';
import { coinLedger } from '../wallet/schema.ts';
import { ORDERINGS } from './rules.ts';

const at = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * 순위표 (스펙 5.2 "게임"). 기록을 재는 단위이고, 판 결과를 어떻게 확인할지도 여기 적는다.
 *
 * 값(`min_value`, `max_value`, 아래 `best_value`·`value`)은 double precision이다: 점수는 정수지만
 * 시간 순위표의 값은 0.1초 단위라 정수 열에 담을 수 없다. 범위는 ±10^12 안이라 정수와 0.1 단위 값이 그대로 견줘진다.
 *
 * `validator`에는 CHECK를 두지 않는다: 이름은 서버 코드(`validators.ts`)가 알고, 모르는 이름의 행이 있으면
 * 그 순위표의 판 결과만 `503 board_unavailable`로 거절한다 (서버를 이전 버전으로 되돌려도 죽지 않게).
 */
export const boards = app.table(
  'boards',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    label: text('label').notNull(),
    ordering: text('ordering', { enum: ORDERINGS }).notNull(),
    minValue: doublePrecision('min_value').notNull(),
    maxValue: doublePrecision('max_value').notNull(),
    maxCoinsPerRun: integer('max_coins_per_run').notNull(),
    /** 이 순위표(단계)를 깨야 판을 낼 수 있다 */
    requiresBoardId: text('requires_board_id').references((): AnyPgColumn => boards.id),
    validator: text('validator').notNull().default('caps'),
    /** 검증기 설정. 서버는 검증기를 거쳐서만 읽는다 (지뢰찾기의 판 크기 `{ safe, mines, par }`) */
    validatorParams: jsonb('validator_params'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    check('boards_id_check', sql`${t.id} ~ '^[a-z][a-z0-9.-]{1,63}$'`),
    check('boards_ordering_check', sql`${t.ordering} in (${inList(ORDERINGS)})`),
    // NaN은 PostgreSQL에서 무한대보다 크다: max < Infinity가 NaN과 무한대를 함께 막는다
    check('boards_range_check', sql`${t.minValue} > '-Infinity' and ${t.minValue} <= ${t.maxValue} and ${t.maxValue} < 'Infinity'`),
    check('boards_max_coins_per_run_check', sql`${t.maxCoinsPerRun} >= 0`),
    check('boards_requires_check', sql`${t.requiresBoardId} <> ${t.id}`),
    // 게임의 순위표를 순서대로 (목록, `board list`)
    index('boards_game_id_idx').on(t.gameId),
  ],
);

/**
 * 한 사용자가 한 순위표에서 쌓은 기록. `runs`의 집계를 일부러 중복해 둔 값이다 (스펙 5.3):
 * 순위표와 내 최고 기록을 빨리 읽으려는 것이고, 판 결과를 저장하는 트랜잭션(`submitRun`)만 쓴다.
 *
 * - `best_value`: 최고 기록 (higher면 가장 큰 값, lower면 가장 작은 값). 기록이 된 판이 없으면 null
 * - `best_at`: 그 기록을 낸 때. 같은 값이면 먼저 낸 사람이 앞이다
 * - `best_seconds`: 깬 판 가운데 가장 짧은 시간 (점수 순위표인 지뢰찾기도 시간을 따로 남긴다)
 * - `cleared_at`: 처음 깬 때. 다음 단계(`requires_board_id`)가 이것으로 열린다
 */
export const boardRecords = app.table(
  'board_records',
  {
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    bestValue: doublePrecision('best_value'),
    bestAt: at('best_at'),
    bestSeconds: doublePrecision('best_seconds'),
    clearedAt: at('cleared_at'),
    playCount: integer('play_count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    check('board_records_play_count_check', sql`${t.playCount} >= 0`),
    // 순위표의 위쪽 N명과 "나보다 좋은 기록의 수"
    index('board_records_board_id_best_value_idx').on(t.boardId, t.bestValue),
    // 내 기록 전부(`/v2/me`), 계정 삭제. 기본 키가 board_id로 시작해서 따로 둔다
    index('board_records_user_id_idx').on(t.userId),
  ],
);

/**
 * 판. 받아들인 판 결과마다 한 줄이 쌓이고 고치지 않는다 (`ledger_id`만 같은 트랜잭션에서 채운다).
 *
 * - `value`·`seconds`·`won`: 검증기가 읽어 낸 것 (`RunResult`). `value`가 null이면 기록이 아닌 판이다
 * - `ledger_id`: 이 판으로 번 코인의 기록. 코인이 0이면 null이다. 코인 기록이 왜 생겼는지는 이쪽이 가리킨다 (스펙 5.2)
 * - `idempotency_key`: 사용자마다 따로다. 같은 사용자의 같은 키는 한 줄뿐이고, 키가 없는(null) 줄은 몇 개든 된다
 */
export const runs = app.table(
  'runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    value: doublePrecision('value'),
    seconds: doublePrecision('seconds'),
    won: boolean('won'),
    coins: integer('coins').notNull(),
    ledgerId: bigint('ledger_id', { mode: 'number' }).references(() => coinLedger.id),
    gameVersion: integer('game_version'),
    idempotencyKey: text('idempotency_key'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('runs_coins_check', sql`${t.coins} >= 0`),
    uniqueIndex('runs_user_idempotency_key').on(t.userId, t.idempotencyKey),
    // 이 사용자의 직전 판(3초 간격)과, 다시 보낸 판의 답을 만들 때 그 판보다 앞선 판들
    index('runs_user_id_id_idx').on(t.userId, t.id),
    // 계정을 지울 때 코인 기록을 지우면서 하는 외래 키 확인이 테이블 전체를 훑지 않게
    index('runs_ledger_id_idx').on(t.ledgerId),
  ],
);
