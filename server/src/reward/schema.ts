import { sql } from 'drizzle-orm';
import { bigint, check, date, index, integer, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../account/schema.ts';
import { app } from '../shared/db/schema.ts';
import { coinLedger } from '../wallet/schema.ts';

/** 보상의 종류. 코인 기록의 까닭(`coin_ledger.reason`)과 같은 낱말이다 */
export const REWARD_KINDS = ['attendance', 'ad_reward'] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

/**
 * 받은 보상 (스펙 5.2 "그 밖"). 출석과 광고 보상을 받을 때마다 한 줄이 쌓이고 고치지 않는다.
 *
 * - `claim_date`: 받은 날의 한국 날짜. 하루 한도는 이 날짜로 센다
 * - `seq`: 그날 그 종류로 몇 번째인지 (1부터). 하루 한도의 마지막 방어선이 `UNIQUE(user_id, kind, claim_date, seq)`다
 * - `ledger_id`: 이 보상으로 받은 코인의 기록. 코인 기록이 왜 생겼는지는 이쪽이 가리킨다.
 *   스펙의 표에는 꼭 있는 열로 적혀 있지만 비울 수 있게 했다: 운영자가 보상 코인을 0으로 두면 코인 기록이 생기지 않는데
 *   (`applyCoins`는 0을 받지 않는다) 그날 받았다는 것은 적어야 하루 한도가 지켜진다
 * - `idempotency_key`: 사용자마다 따로다. 같은 사용자의 같은 키는 한 줄뿐이고, 키가 없는(null) 줄은 몇 개든 된다.
 *   통신이 끊겨 앱이 같은 보상 요청을 다시 보내도 한 번만 받게 한다 (스펙 5.5, 5.15)
 */
export const rewardClaims = app.table(
  'reward_claims',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: REWARD_KINDS }).notNull(),
    claimDate: date('claim_date').notNull(),
    seq: integer('seq').notNull(),
    ledgerId: bigint('ledger_id', { mode: 'number' }).references(() => coinLedger.id),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('reward_claims_kind_check', sql`${t.kind} in (${sql.raw(REWARD_KINDS.map((k) => `'${k}'`).join(', '))})`),
    check('reward_claims_seq_check', sql`${t.seq} >= 1`),
    uniqueIndex('reward_claims_user_kind_date_seq').on(t.userId, t.kind, t.claimDate, t.seq),
    uniqueIndex('reward_claims_user_idempotency_key').on(t.userId, t.idempotencyKey),
    // 계정을 지울 때 코인 기록을 지우면서 하는 외래 키 확인이 테이블 전체를 훑지 않게
    index('reward_claims_ledger_id_idx').on(t.ledgerId),
  ],
);
