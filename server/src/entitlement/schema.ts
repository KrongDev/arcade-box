import { sql } from 'drizzle-orm';
import { bigint, check, index, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../account/schema.ts';
import { adminActions } from '../admin/schema.ts';
import { games } from '../game/schema.ts';
import { products } from '../product/schema.ts';
import { app } from '../shared/db/schema.ts';

const at = (name: string) => timestamp(name, { withTimezone: true });

export const ENTITLEMENT_SOURCES = ['coin_purchase', 'store_purchase', 'grant'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];
export const REVOKE_REASONS = ['refund', 'admin'] as const;
export type RevokeReason = (typeof REVOKE_REASONS)[number];

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * 보유 (스펙 5.2 "상품과 보유"). 회수해도 행을 지우지 않고 `revoked_at`을 채운다. 다시 주면 새 행이다.
 * 켜진(회수되지 않은) 보유는 사용자·상품마다 하나다 (`entitlements_one_active`).
 *
 * 외래 키는 `users`, `products`, `admin_actions`뿐이다. 주문이 보유를 가리킨다 (`orders.entitlement_id`, 스펙 5.14의 방향).
 * `admin_action_id`는 운영자 지급(`grant` 명령)일 때 그 운영 기록이다.
 */
export const entitlements = app.table(
  'entitlements',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    source: text('source', { enum: ENTITLEMENT_SOURCES }).notNull(),
    adminActionId: bigint('admin_action_id', { mode: 'number' }).references(() => adminActions.id),
    grantedAt: at('granted_at').notNull().defaultNow(),
    revokedAt: at('revoked_at'),
    revokeReason: text('revoke_reason', { enum: REVOKE_REASONS }),
  },
  (t) => [
    check('entitlements_source_check', sql`${t.source} in (${inList(ENTITLEMENT_SOURCES)})`),
    check('entitlements_revoke_reason_check', sql`${t.revokeReason} is null or ${t.revokeReason} in (${inList(REVOKE_REASONS)})`),
    // 회수한 시각과 까닭은 함께 있거나 함께 없다
    check('entitlements_revoked_check', sql`(${t.revokedAt} is null) = (${t.revokeReason} is null)`),
    uniqueIndex('entitlements_one_active').on(t.userId, t.productId).where(sql`${t.revokedAt} is null`),
    index('entitlements_user_id_idx').on(t.userId),
  ],
);

/**
 * 장착: 한 사용자의 한 게임·한 자리에 아이템 하나 (스펙 5.2). `game_id`·`slot`은 그 아이템 상품의 값을 베껴 둔 것이라
 * 상품의 게임과 자리는 고치지 않는다 (`updateProduct`가 막는다).
 */
export const equippedItems = app.table(
  'equipped_items',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    slot: text('slot').notNull(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameId, t.slot] })],
);
