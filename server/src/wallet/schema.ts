import { sql } from 'drizzle-orm';
import { bigint, check, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../account/schema.ts';
import { adminActions } from '../admin/schema.ts';
import { app } from '../shared/db/schema.ts';
import { LEDGER_REASONS } from './rules.ts';

const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * bigint 열은 숫자(number)로 읽는다. 잔액 상한 9,000,000,000,000,000이 2^53(9,007,199,254,740,992)보다 작아서
 * 1코인 단위까지 정확하다. bigint로 읽으면 처리기가 돌려준 값을 JSON으로 바꾸다 실패한다.
 */
const coins = (name: string) => bigint(name, { mode: 'number' });

/**
 * 지갑: 사용자의 지금 잔액. 코인 기록 `delta`의 합을 일부러 중복해 둔 값이다 (스펙 5.3).
 * 코인을 처음 받을 때 행이 생긴다. 행이 없으면 잔액은 0이다.
 * 이 테이블과 `coin_ledger`에 쓰는 코드는 `applyCoins` 하나뿐이다.
 */
export const wallets = app.table(
  'wallets',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    balance: coins('balance').notNull().default(0),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [check('wallets_balance_check', sql`${t.balance} >= 0 and ${t.balance} <= 9000000000000000`)],
);

/**
 * 코인 기록(원장). 코인이 변할 때마다 한 줄이 쌓이고 고치지 않는다. `balance_after`는 그 줄까지 반영한 잔액이다.
 *
 * 외래 키는 `users`와 `admin_actions`뿐이다. 왜 생긴 기록인지는 그 일을 한 쪽이 가리킨다
 * (`runs.ledger_id`, `reward_claims.ledger_id`, `order_events.ledger_id`). 운영자 지급·조정만 여기서 `admin_action_id`를 가진다.
 *
 * `idempotency_key`는 사용자마다 따로다: 같은 사용자의 같은 키는 한 줄뿐이고, 키가 없는(null) 줄은 몇 개든 된다.
 */
export const coinLedger = app.table(
  'coin_ledger',
  {
    id: coins('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    delta: coins('delta').notNull(),
    balanceAfter: coins('balance_after').notNull(),
    reason: text('reason', { enum: LEDGER_REASONS }).notNull(),
    adminActionId: coins('admin_action_id').references(() => adminActions.id),
    idempotencyKey: text('idempotency_key'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('coin_ledger_delta_check', sql`${t.delta} <> 0`),
    check('coin_ledger_balance_after_check', sql`${t.balanceAfter} >= 0`),
    check('coin_ledger_reason_check', sql`${t.reason} in (${sql.raw(LEDGER_REASONS.map((reason) => `'${reason}'`).join(', '))})`),
    uniqueIndex('coin_ledger_user_idempotency_key').on(t.userId, t.idempotencyKey),
    // 내 기록을 최신부터 쪽 단위로 읽는다 (user_id = ? and id < ? order by id desc)
    index('coin_ledger_user_id_id_idx').on(t.userId, t.id),
  ],
);
