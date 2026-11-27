import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { Q, Tx } from '../shared/db/index.ts';
import { orderEvents, orders, type OrderActor, type OrderEventType, type OrderStatus, type PaymentMethod } from './schema.ts';

// ── 주문 ────────────────────────────────────────────────────

/**
 * 주문에서 읽는 열. 영수증 원문(`raw_receipt`)과 구매 토큰(`store_purchase_token`)은 여기에 없다:
 * 이 파일의 어떤 조회도 그 둘을 읽지 않으므로 응답·명령 출력·로그로 새어 나갈 길이 없다 (스펙 5.12).
 */
const orderColumns = {
  id: orders.id,
  userId: orders.userId,
  productId: orders.productId,
  paymentMethod: orders.paymentMethod,
  status: orders.status,
  productName: orders.productName,
  productKind: orders.productKind,
  priceAmount: orders.priceAmount,
  priceCurrency: orders.priceCurrency,
  storeSku: orders.storeSku,
  storeOrderId: orders.storeOrderId,
  storeEnvironment: orders.storeEnvironment,
  entitlementId: orders.entitlementId,
  createdAt: orders.createdAt,
  completedAt: orders.completedAt,
  refundedAt: orders.refundedAt,
};

export interface OrderRow {
  id: string;
  userId: string;
  productId: string;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  productName: string;
  productKind: string;
  priceAmount: number;
  priceCurrency: string;
  storeSku: string | null;
  storeOrderId: string | null;
  storeEnvironment: string | null;
  entitlementId: number | null;
  createdAt: Date;
  completedAt: Date | null;
  refundedAt: Date | null;
}

/** 새 주문을 `pending`으로 넣는다. 구매 당시 이름·종류·가격은 여기서 한 번 들어가고 다시 고치지 않는다 */
export async function insertOrder(
  tx: Tx,
  row: { userId: string; productId: string; paymentMethod: PaymentMethod; productName: string; productKind: string; priceAmount: number; priceCurrency: string; idempotencyKey: string | null; now: Date },
): Promise<string> {
  const [created] = await tx
    .insert(orders)
    .values({
      userId: row.userId,
      productId: row.productId,
      paymentMethod: row.paymentMethod,
      status: 'pending',
      productName: row.productName,
      productKind: row.productKind,
      priceAmount: row.priceAmount,
      priceCurrency: row.priceCurrency,
      idempotencyKey: row.idempotencyKey,
      createdAt: row.now,
    })
    .returning({ id: orders.id });
  return created.id;
}

export async function readOrder(q: Q, id: string): Promise<OrderRow | null> {
  const [row] = await q.select(orderColumns).from(orders).where(eq(orders.id, id));
  return row ?? null;
}

/** 주문 행을 잠그고 읽는다 (같은 주문의 환불이 한 번에 하나씩 돈다). 사용자 행 → 지갑 행을 잡은 뒤에 부른다 */
export async function lockOrder(tx: Tx, id: string): Promise<OrderRow | null> {
  const [row] = await tx.select(orderColumns).from(orders).where(eq(orders.id, id)).for('update');
  return row ?? null;
}

/** 이 사용자가 이 키로 만든 주문. 지갑을 잠근 뒤에 불러야 같은 키의 다른 요청이 방금 넣은 줄이 보인다 */
export async function findOrderByKey(tx: Tx, userId: string, idempotencyKey: string): Promise<OrderRow | null> {
  const [row] = await tx
    .select(orderColumns)
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, idempotencyKey)));
  return row ?? null;
}

/**
 * 주문의 상태를 `from`에서 `to`로 바꾼다. 결제가 끝나면 `completed_at`, 환불되면 `refunded_at`이 함께 들어간다.
 * 그사이 상태가 `from`이 아니게 됐으면 바꾸지 않고 거짓을 준다. `service.ts`의 `record`만 부른다.
 */
export async function writeStatus(tx: Tx, id: string, from: OrderStatus, to: OrderStatus, now: Date): Promise<boolean> {
  const done = await tx
    .update(orders)
    .set({ status: to, ...(to === 'completed' ? { completedAt: now } : {}), ...(to === 'refunded' ? { refundedAt: now } : {}) })
    .where(and(eq(orders.id, id), eq(orders.status, from)))
    .returning({ id: orders.id });
  return done.length > 0;
}

export async function writeEntitlement(tx: Tx, id: string, entitlementId: number): Promise<void> {
  await tx.update(orders).set({ entitlementId }).where(eq(orders.id, id));
}

/** `(created_at, id)`가 이 주문보다 앞선(더 오래된) 것. 그 주문이 이 사용자의 것이 아니거나 없으면 아무것도 맞지 않는다 */
const olderThan = (userId: string, before: string) =>
  sql`(${orders.createdAt}, ${orders.id}) < (select o.created_at, o.id from ${orders} o where o.id = ${before} and o.user_id = ${userId})`;

/** 이 사용자의 주문을 최신부터 `limit`개. `before`가 있으면 그 주문보다 오래된 것부터. 같은 시각의 주문은 ID 순서로 가른다 */
export async function selectUserOrders(q: Q, userId: string, before: string | undefined, limit: number): Promise<OrderRow[]> {
  return q
    .select(orderColumns)
    .from(orders)
    .where(before === undefined ? eq(orders.userId, userId) : and(eq(orders.userId, userId), olderThan(userId, before)))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit);
}

/** 모든 사용자의 주문을 최신부터 `limit`개 (명령줄 `order list`) */
export async function selectRecentOrders(q: Q, limit: number): Promise<OrderRow[]> {
  return q.select(orderColumns).from(orders).orderBy(desc(orders.createdAt), desc(orders.id)).limit(limit);
}

// ── 사건 ────────────────────────────────────────────────────

export interface EventRow {
  id: number;
  type: OrderEventType;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  actor: OrderActor;
  detail: unknown;
  ledgerId: number | null;
  adminActionId: number | null;
  createdAt: Date;
}

export async function insertEvent(
  tx: Tx,
  row: { orderId: string; type: OrderEventType; fromStatus: OrderStatus | null; toStatus: OrderStatus | null; actor: OrderActor; detail: unknown; ledgerId: number | null; adminActionId: number | null; now: Date },
): Promise<void> {
  await tx.insert(orderEvents).values({
    orderId: row.orderId,
    type: row.type,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actor: row.actor,
    detail: row.detail ?? null,
    ledgerId: row.ledgerId,
    adminActionId: row.adminActionId,
    createdAt: row.now,
  });
}

/** 한 주문의 사건을 일어난 순서로 */
export async function readEvents(q: Q, orderId: string): Promise<EventRow[]> {
  return q
    .select({
      id: orderEvents.id,
      type: orderEvents.type,
      fromStatus: orderEvents.fromStatus,
      toStatus: orderEvents.toStatus,
      actor: orderEvents.actor,
      detail: orderEvents.detail,
      ledgerId: orderEvents.ledgerId,
      adminActionId: orderEvents.adminActionId,
      createdAt: orderEvents.createdAt,
    })
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.id);
}

// ── 계정 삭제와 보관 기간 ──────────────────────────────────────────

/** 코인으로 내지 않은 주문 = 현금 주문 (구글·애플 결제) */
const isMoney = ne(orders.paymentMethod, 'coin');

export async function existsMoneyOrder(q: Q, userId: string): Promise<boolean> {
  const rows = await q
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.userId, userId), isMoney))
    .limit(1);
  return rows.length > 0;
}

/** 한 번에 `IN (…)`에 넣는 값의 수 (PostgreSQL의 매개변수는 한 문장에 65,535개까지다) */
const CHUNK = 1000;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/** 준 사용자 가운데 주문이 하나라도 있는 사용자 */
export async function usersWithOrders(q: Q, userIds: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks(userIds)) {
    const rows = await q.selectDistinct({ userId: orders.userId }).from(orders).where(inArray(orders.userId, part));
    for (const row of rows) found.add(row.userId);
  }
  return found;
}

/** 이 사용자의 코인 주문과 그 사건을 지운다 (사건이 주문을 가리키므로 사건부터) */
export async function deleteCoinOrders(tx: Tx, userId: string): Promise<void> {
  const mine = tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.paymentMethod, 'coin')));
  await tx.delete(orderEvents).where(inArray(orderEvents.orderId, mine));
  await tx.delete(orders).where(and(eq(orders.userId, userId), eq(orders.paymentMethod, 'coin')));
}

/**
 * 이 사용자에게 남는 주문(현금 주문)이 보유와 코인 기록을 가리키지 않게 한다: `orders.entitlement_id`와
 * 그 사건의 `ledger_id`를 비운다. 계정을 지우면 보유와 코인 기록이 사라지는데, 가리키는 채로 두면 그 삭제가 외래 키에 걸린다.
 * 구매 당시 값과 사건의 종류·시각·상태는 그대로다.
 */
export async function detachKeptOrders(tx: Tx, userId: string): Promise<void> {
  const mine = tx.select({ id: orders.id }).from(orders).where(eq(orders.userId, userId));
  await tx
    .update(orderEvents)
    .set({ ledgerId: null })
    .where(and(inArray(orderEvents.orderId, mine), isNotNull(orderEvents.ledgerId)));
  await tx
    .update(orders)
    .set({ entitlementId: null })
    .where(and(eq(orders.userId, userId), isNotNull(orders.entitlementId)));
}

/**
 * 보관 기간이 끝난 현금 주문: 마지막으로 돈이 오간 때(환불했으면 환불한 때, 아니면 결제가 끝난 때)가 `cutoff`이거나 그 전이다.
 * 끝내 결제되지 않은 주문(pending, failed, canceled)은 만든 때부터 센다. 코인 주문은 들지 않는다.
 * `userIds`의 주문만 본다: 계정을 지운 사용자의 것만 지우려고 부른 쪽이 그 사용자들을 준다.
 */
const expired = (cutoff: Date, userIds: string[]) =>
  and(isMoney, inArray(orders.userId, userIds), sql`coalesce(${orders.refundedAt}, ${orders.completedAt}, ${orders.createdAt}) <= ${cutoff.toISOString()}::timestamptz`);

/** `userIds` 가운데 보관 기간이 끝난 현금 주문의 수 */
export async function countExpired(q: Q, cutoff: Date, userIds: string[]): Promise<number> {
  let n = 0;
  for (const part of chunks(userIds)) {
    const [row] = await q
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(expired(cutoff, part));
    n += row?.n ?? 0;
  }
  return n;
}

/** `userIds`의 보관 기간이 끝난 현금 주문과 그 사건을 지우고 지운 주문의 수를 준다 */
export async function deleteExpired(tx: Tx, cutoff: Date, userIds: string[]): Promise<number> {
  let n = 0;
  for (const users of chunks(userIds)) {
    // 지울 주문을 먼저 잠가서 정한다. 사건을 지운 뒤 주문을 지우는 사이에 대상이 달라지지 않는다
    const targets = await tx.select({ id: orders.id }).from(orders).where(expired(cutoff, users)).for('update');
    for (const part of chunks(targets.map((t) => t.id))) {
      await tx.delete(orderEvents).where(inArray(orderEvents.orderId, part));
      await tx.delete(orders).where(inArray(orders.id, part));
    }
    n += targets.length;
  }
  return n;
}
