import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../account/schema.ts';
import { adminActions } from '../admin/schema.ts';
import { entitlements } from '../entitlement/schema.ts';
import { products } from '../product/schema.ts';
import { app } from '../shared/db/schema.ts';
import { coinLedger } from '../wallet/schema.ts';

const at = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** 무엇으로 냈나. 코인으로 산 것도 주문이다 (스펙 5.2 "결제"). 구글·애플 결제(현금 주문)는 3번 작업이 만든다 */
export const PAYMENT_METHODS = ['coin', 'google_play', 'app_store'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_STATUSES = ['pending', 'completed', 'refunded', 'canceled', 'failed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** 주문에 일어난 일. 상태를 바꾸는 것(created, completed, refunded, canceled, failed)과 바꾸지 않는 것(verified, granted, revoked, note)이 있다 */
export const ORDER_EVENT_TYPES = ['created', 'verified', 'completed', 'granted', 'refunded', 'revoked', 'canceled', 'failed', 'note'] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

/** 그 일을 한 쪽: 사용자의 요청, 서버가 이어서 한 일, 스토어의 알림, 운영자의 명령 */
export const ORDER_ACTORS = ['user', 'system', 'store', 'admin'] as const;
export type OrderActor = (typeof ORDER_ACTORS)[number];

/**
 * 주문 (스펙 5.2 "결제"). 주문 하나는 상품 하나다.
 *
 * - `product_name`·`product_kind`·`price_amount`·`price_currency`는 **구매 당시 값**이다. 주문을 만들 때 한 번 베끼고
 *   다시 고치지 않는다 — 상품의 이름이나 가격을 고쳐도 지난 주문이 바뀌지 않는다 (스펙 5.3, 2절의 실패 조건).
 *   그래서 종류에는 CHECK를 걸지 않았다: 나중에 상품 종류가 늘거나 이름이 바뀌어도 지난 주문은 그때의 낱말 그대로다
 * - `status`는 마지막 사건(`order_events`)을 일부러 중복해 둔 값이다 (스펙 5.3). 바꾸는 곳은 `service.ts`의 `record` 하나다
 * - `entitlement_id`는 이 주문으로 생긴 보유다. 계정을 지워도 남는 현금 주문에서는 비운다 (보유가 함께 지워져서)
 * - 스토어 값(`store_*`, `raw_receipt`)은 현금 주문에만 있다. 영수증 원문과 구매 토큰은 응답·명령 출력·로그에 내보내지 않는다
 * - `idempotency_key`는 사용자마다 따로다: 같은 사용자의 같은 키는 한 줄뿐이고, 키가 없는(null) 줄은 몇 개든 된다
 * - `UNIQUE(payment_method, store_order_id)`: 같은 영수증을 두 번 보내도 주문은 하나다 (스펙 5.7). 코인 주문은 null이라 걸리지 않는다
 */
export const orders = app.table(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    paymentMethod: text('payment_method', { enum: PAYMENT_METHODS }).notNull(),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('pending'),
    productName: text('product_name').notNull(),
    productKind: text('product_kind').notNull(),
    priceAmount: bigint('price_amount', { mode: 'number' }).notNull(),
    priceCurrency: text('price_currency').notNull(),
    storeSku: text('store_sku'),
    storeOrderId: text('store_order_id'),
    storePurchaseToken: text('store_purchase_token'),
    storeEnvironment: text('store_environment'),
    rawReceipt: jsonb('raw_receipt'),
    entitlementId: bigint('entitlement_id', { mode: 'number' }).references(() => entitlements.id),
    idempotencyKey: text('idempotency_key'),
    createdAt: at('created_at').notNull().defaultNow(),
    completedAt: at('completed_at'),
    refundedAt: at('refunded_at'),
  },
  (t) => [
    check('orders_payment_method_check', sql`${t.paymentMethod} in (${inList(PAYMENT_METHODS)})`),
    check('orders_status_check', sql`${t.status} in (${inList(ORDER_STATUSES)})`),
    check('orders_price_amount_check', sql`${t.priceAmount} >= 0`),
    // 코인으로 낸 주문의 가격은 코인이고, 현금 주문의 가격은 코인이 아니다
    check('orders_price_currency_check', sql`(${t.paymentMethod} = 'coin') = (${t.priceCurrency} = 'COIN')`),
    // 결제가 끝난 적이 있는 주문(completed, refunded)에는 끝난 시각이 있고, 환불한 시각은 환불된 주문에만 있다
    check('orders_completed_at_check', sql`${t.status} not in ('completed', 'refunded') or ${t.completedAt} is not null`),
    check('orders_refunded_at_check', sql`(${t.status} = 'refunded') = (${t.refundedAt} is not null)`),
    uniqueIndex('orders_payment_method_store_order_id_key').on(t.paymentMethod, t.storeOrderId),
    uniqueIndex('orders_user_idempotency_key').on(t.userId, t.idempotencyKey),
    // 내 주문을 최신부터 쪽 단위로 읽는다
    index('orders_user_id_created_at_idx').on(t.userId, t.createdAt),
    // 계정을 지울 때 보유를 지우면서 하는 외래 키 확인이 테이블 전체를 훑지 않게
    index('orders_entitlement_id_idx').on(t.entitlementId),
  ],
);

/**
 * 주문 사건 (스펙 5.2). 주문에 일이 일어날 때마다 한 줄이 쌓인다 — 사용자가 말한 결제 history다.
 * 지나간 줄의 내용은 고치지 않는다. 예외는 하나다: 계정을 지워도 남는 현금 주문의 사건에서 `ledger_id`를 비운다
 * (그 코인 기록이 계정과 함께 지워져서). 줄을 지우는 것은 주문을 지울 때뿐이다 (계정 삭제의 코인 주문, 보관 기간이 끝난 현금 주문).
 *
 * - `from_status`·`to_status`: 상태를 바꾼 사건에만 있다
 * - `ledger_id`: 이 일로 생긴 코인 기록. 구매(completed)와 환불(refunded)이 자기 코인 기록을 가리킨다 (스펙 5.2 "코인")
 * - `admin_action_id`: 운영자의 명령으로 일어난 일이면 그 운영 기록
 * - `detail`: 서버가 뜻을 해석하지 않는 덧붙임 (예: 지급된 보유의 번호). 명령줄 `order show`가 그대로 보여 주므로
 *   영수증 원문이나 구매 토큰을 여기에 넣지 않는다 (그것은 `orders.raw_receipt`·`store_purchase_token`에만 둔다)
 */
export const orderEvents = app.table(
  'order_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    type: text('type', { enum: ORDER_EVENT_TYPES }).notNull(),
    fromStatus: text('from_status', { enum: ORDER_STATUSES }),
    toStatus: text('to_status', { enum: ORDER_STATUSES }),
    actor: text('actor', { enum: ORDER_ACTORS }).notNull(),
    detail: jsonb('detail'),
    ledgerId: bigint('ledger_id', { mode: 'number' }).references(() => coinLedger.id),
    adminActionId: bigint('admin_action_id', { mode: 'number' }).references(() => adminActions.id),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('order_events_type_check', sql`${t.type} in (${inList(ORDER_EVENT_TYPES)})`),
    check('order_events_from_status_check', sql`${t.fromStatus} is null or ${t.fromStatus} in (${inList(ORDER_STATUSES)})`),
    check('order_events_to_status_check', sql`${t.toStatus} is null or ${t.toStatus} in (${inList(ORDER_STATUSES)})`),
    check('order_events_actor_check', sql`${t.actor} in (${inList(ORDER_ACTORS)})`),
    // 한 주문의 사건을 일어난 순서로 읽는다
    index('order_events_order_id_id_idx').on(t.orderId, t.id),
    // 계정을 지울 때 코인 기록을 지우면서 하는 외래 키 확인이 테이블 전체를 훑지 않게
    index('order_events_ledger_id_idx').on(t.ledgerId),
  ],
);
