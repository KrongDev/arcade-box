import { sql } from 'drizzle-orm';
import { bigint, check, integer, text, timestamp, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { app } from '../shared/db/schema.ts';
import { GAME_STATUSES, VERSION_STATUSES } from './rules.ts';

const at = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * 게임 (스펙 5.2 "게임"). `live_version_id`는 지금 내보낸 버전이고 `game_versions.status`를 일부러 중복한 값이다
 * (스펙 5.3): 내보내기·되돌리기가 버전 상태와 함께 한 트랜잭션으로 바꾼다.
 */
export const games = app.table(
  'games',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** `asset`이 저장한 아이콘의 이름 (`<sha256>.png|webp`) */
    iconPath: text('icon_path'),
    status: text('status', { enum: GAME_STATUSES }).notNull().default('draft'),
    sortOrder: integer('sort_order').notNull().default(0),
    liveVersionId: bigint('live_version_id', { mode: 'number' }).references((): AnyPgColumn => gameVersions.id),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('games_id_check', sql`${t.id} ~ '^[a-z][a-z0-9-]{1,31}$'`),
    check('games_status_check', sql`${t.status} in (${inList(GAME_STATUSES)})`),
  ],
);

/**
 * 게임 버전과 묶음. 묶음 파일은 `<dataDir>/<bundle_path>`에 있다 (`bundle_path`는 dataDir 기준 상대 경로).
 * `sha256`·`size_bytes`는 서버가 파일에서 직접 계산한 값이고, `signature`는 그 값들로 만든 글(`manifestText`)의 Ed25519 서명이다.
 */
export const gameVersions = app.table(
  'game_versions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    version: integer('version').notNull(),
    status: text('status', { enum: VERSION_STATUSES }).notNull().default('uploaded'),
    bundlePath: text('bundle_path').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    signature: text('signature').notNull(),
    minShellApi: integer('min_shell_api').notNull(),
    notes: text('notes'),
    createdAt: at('created_at').notNull().defaultNow(),
    publishedAt: at('published_at'),
  },
  (t) => [
    uniqueIndex('game_versions_game_id_version').on(t.gameId, t.version),
    check('game_versions_status_check', sql`${t.status} in (${inList(VERSION_STATUSES)})`),
    check('game_versions_version_check', sql`${t.version} >= 1`),
    check('game_versions_min_shell_api_check', sql`${t.minShellApi} >= 1`),
    check('game_versions_size_bytes_check', sql`${t.sizeBytes} >= 0`),
    check('game_versions_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);
