import { bigint, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { app } from '../shared/db/schema.ts';

/**
 * 운영자가 명령줄로 바꾼 일의 기록. 한 번 바꿀 때마다 한 줄이 쌓이고 고치거나 지우지 않는다.
 * `target_user_id`에는 외래 키를 걸지 않는다 (사용자가 지워져도 기록은 남는다).
 */
export const adminActions = app.table('admin_actions', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  targetUserId: uuid('target_user_id'),
  targetRef: text('target_ref'),
  params: jsonb('params').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** 운영자가 조정하는 숫자 (출석 코인, 광고 보상 코인, 하루 광고 보상 횟수, 하루에 판으로 버는 코인 상한). 행이 없으면 기본값이다 */
export const appConfig = app.table('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
