import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { app } from '../shared/db/schema.ts';

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * 사용자. 손님으로 시작하고 구글·애플을 연결할 수 있다 (스펙 5.4).
 * 계정을 지워도 현금 주문이 있으면 행을 `deleted`로 남긴다 (주문이 가리킬 곳이 있어야 해서).
 */
export const users = app.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: text('status', { enum: ['active', 'deleted'] })
      .notNull()
      .default('active'),
    createdAt: at('created_at').notNull().defaultNow(),
    deletedAt: at('deleted_at'),
  },
  (t) => [check('users_status_check', sql`${t.status} in ('active', 'deleted')`)],
);

/**
 * 로그인 수단. 기기 수단(`guest`)은 기기 한 대를, 계정 수단(`google`, `apple`)은 사람을 가리킨다.
 * 한 사용자에 기기 수단은 여럿, 계정 수단은 종류마다 하나 붙는다.
 *
 * `subject`는 기기 수단이면 기기 비밀값의 SHA-256, 계정 수단이면 ID 토큰의 `sub`다.
 * 이메일과 이름은 어디에도 저장하지 않는다.
 */
export const userIdentities = app.table(
  'user_identities',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider', { enum: ['guest', 'google', 'apple'] }).notNull(),
    subject: text('subject').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    lastUsedAt: at('last_used_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_identities_provider_subject_key').on(t.provider, t.subject),
    // 계정 수단은 종류마다 하나. 기기 수단은 여럿이라 뺀다 (부분 유일 인덱스)
    uniqueIndex('user_identities_user_provider_key')
      .on(t.userId, t.provider)
      .where(sql`${t.provider} <> 'guest'`),
    index('user_identities_user_id_idx').on(t.userId),
    check('user_identities_provider_check', sql`${t.provider} in ('guest', 'google', 'apple')`),
  ],
);

/**
 * 세션. 토큰은 원문을 두지 않고 SHA-256만 둔다.
 * `identity_id`는 어느 기기 수단으로 들어왔는지다. 로그아웃이 그 기기의 수단만 계정에서 뗄 때 쓴다.
 */
export const sessions = app.table(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    identityId: bigint('identity_id', { mode: 'number' })
      .notNull()
      .references(() => userIdentities.id),
    expiresAt: at('expires_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_expires_at_idx').on(t.expiresAt), index('sessions_user_id_idx').on(t.userId), index('sessions_identity_id_idx').on(t.identityId)],
);

/** 계정 연결에 쓰는 일회용 값. 원문은 두지 않는다. 한 번 쓰면 지운다 */
export const authNonces = app.table('auth_nonces', {
  nonceHash: text('nonce_hash').primaryKey(),
  expiresAt: at('expires_at').notNull(),
});

/** 사용자 설정. 행이 없으면 둘 다 켜진 것이다 */
export const userSettings = app.table('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  soundOn: boolean('sound_on').notNull().default(true),
  hapticOn: boolean('haptic_on').notNull().default(true),
  updatedAt: at('updated_at').notNull().defaultNow(),
});
