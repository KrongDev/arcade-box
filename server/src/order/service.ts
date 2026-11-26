import { listDeletedUsers, removeDeletedUser } from '../account/index.ts';
import { grant, owns, revoke } from '../entitlement/index.ts';
import { getGame, type Game, type LiveVersion } from '../game/index.ts';
import { activePrice, getProduct } from '../product/index.ts';
import type { Db, Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { idempotencyKey as checkKey, isUuid, obj } from '../shared/validate.ts';
import { applyCoins, hasLedgerKey, listLedger, lockWallet } from '../wallet/index.ts';
import {
  countExpired,
  deleteCoinOrders,
  deleteExpired,
  detachKeptOrders,
  existsMoneyOrder,
  findOrderByKey,
  insertEvent,
  insertOrder,
  lockOrder,
  readEvents,
  readOrder,
  selectRecentOrders,
  selectUserOrders,
  usersWithOrders,
  writeEntitlement,
  writeStatus,
  type OrderRow,
} from './repo.ts';
import type { OrderActor, OrderEventType, OrderStatus, PaymentMethod } from './schema.ts';

// ── 거절하는 말 ───────────────────────────────────────────────

const noProduct = () => new RuleError(404, 'not_found', '없는 상품이에요');
const noOrder = () => new RuleError(404, 'not_found', '없는 주문이에요');
const notForSale = () => new RuleError(409, 'not_for_sale', '지금은 코인으로 살 수 없는 상품이에요');
const alreadyOwned = () => new RuleError(409, 'already_owned', '이미 가지고 있어요');
const idempotencyMismatch = () => new RuleError(409, 'idempotency_mismatch', '같은 요청 키로 다른 내용을 보냈어요');

// ── 주문의 상태와 사건 ──────────────────────────────────────────

/**
 * 주문의 상태가 갈 수 있는 길. 결제를 기다리다(pending) 끝나거나(completed) 실패하거나(failed) 그만두고(canceled),
 * 끝난 주문만 환불된다(refunded). 그 밖의 길은 없다 — 환불된 주문은 다시 환불되지 않는다.
 */
const NEXT: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['completed', 'failed', 'canceled'],
  completed: ['refunded'],
  refunded: [],
  canceled: [],
  failed: [],
};

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT[from].includes(to);
}

interface OrderEvent {
  type: OrderEventType;
  /** 주면 주문의 상태도 이 값으로 바꾼다 */
  to?: OrderStatus;
  actor: OrderActor;
  ledgerId?: number | null;
  adminActionId?: number | null;
  detail?: unknown;
  now: Date;
}

/**
 * 주문에 사건을 하나 쌓는다. `to`를 주면 주문의 상태도 함께 바꾼다.
 *
 * **`orders.status`를 바꾸는 곳은 이 함수 하나다** (스펙 5.3): 사건 추가와 상태 갱신이 부른 쪽의 한 트랜잭션에서 함께 일어나므로
 * `orders.status`는 늘 마지막으로 상태를 바꾼 사건의 `to_status`와 같다. 새 주문은 `open`이 `pending`으로 넣으면서
 * `created` 사건을 함께 쌓는다.
 *
 * `order.status`는 부른 쪽이 잠그고 읽은 지금 상태다. 갈 수 없는 길이거나 그사이 상태가 달라졌으면 던진다 (트랜잭션이 되돌아간다).
 * 바뀐 뒤의 상태를 `order.status`에 적어 주므로 이어서 다시 부를 수 있다.
 */
async function record(tx: Tx, order: { id: string; status: OrderStatus }, e: OrderEvent): Promise<void> {
  const from = order.status;
  if (e.to !== undefined) {
    if (!canMove(from, e.to)) throw new Error(`주문의 상태를 ${from}에서 ${e.to}로 바꿀 수 없어요`);
    if (!(await writeStatus(tx, order.id, from, e.to, e.now))) throw new Error('주문의 상태가 그사이 바뀌었어요');
  }
  await insertEvent(tx, {
    orderId: order.id,
    type: e.type,
    fromStatus: e.to === undefined ? null : from,
    toStatus: e.to ?? null,
    actor: e.actor,
    detail: e.detail,
    ledgerId: e.ledgerId ?? null,
    adminActionId: e.adminActionId ?? null,
    now: e.now,
  });
  if (e.to !== undefined) order.status = e.to;
}

/**
 * 새 주문을 연다: `pending` 주문과 `created` 사건을 함께 넣는다. 구매 당시의 상품 이름·종류·가격을 여기서 한 번 베낀다 (스펙 5.3).
 * 돌려준 것을 `record`에 넘겨 상태를 이어 바꾼다.
 */
async function open(
  tx: Tx,
  row: { userId: string; productId: string; paymentMethod: PaymentMethod; productName: string; productKind: string; priceAmount: number; priceCurrency: string; idempotencyKey: string | null; now: Date },
): Promise<{ id: string; status: OrderStatus }> {
  const id = await insertOrder(tx, row);
  await insertEvent(tx, { orderId: id, type: 'created', fromStatus: null, toStatus: 'pending', actor: 'user', detail: null, ledgerId: null, adminActionId: null, now: row.now });
  return { id, status: 'pending' };
}

// ── 코인으로 사기 ──────────────────────────────────────────────

/** 산 게임과 그 게임의 지금 버전. 앱이 목록을 다시 받지 않고 바로 묶음을 받을 수 있게 구매의 답에 넣는다 (스펙 5.6의 5번) */
export interface PurchasedGame {
  id: string;
  /** 지금 받을 버전 (`/v2/catalog`의 `liveVersion`과 같은 모양). 내보낸 버전이 없거나 게임이 live가 아니면 null */
  liveVersion: LiveVersion | null;
}

export interface Purchased {
  orderId: string;
  productId: string;
  /** 게임 상품을 샀으면 그 게임과 지금 버전, 게임 상품이 아니면 null */
  game: PurchasedGame | null;
  /** 사고 난 뒤의 잔액 */
  balance: number;
  /** 같은 키로 다시 보낸 요청이라 처음 답을 준 것인지 */
  replayed: boolean;
}

/** 구매의 답에 넣는 게임 정보. 묶음은 live 게임의 live 버전만 받을 수 있으니 게임이 live가 아니면 버전을 주지 않는다 */
const purchasedGame = (game: Game): PurchasedGame => ({ id: game.id, liveVersion: game.status === 'live' ? game.liveVersion : null });

/**
 * 같은 키로 다시 온 구매: 새로 사지 않고 처음 답을 다시 만들어 준다 (Review Focus 2).
 * 같은 키인데 상품이 다르거나 코인 주문이 아니면 `409 idempotency_mismatch`.
 *
 * 처음 답은 저장해 두지 않는다: 그때의 잔액은 그 구매의 코인 기록(`completed` 사건이 가리키는 줄)에서 읽는다
 * (그사이 잔액이 바뀌어도 처음과 같다). 가격이 0이라 코인 기록이 없는 주문은 `completed` 사건의 `detail.balance`에 적어 둔 값을 준다.
 * 그사이 상품이 숨겨지거나 가격이 바뀌거나 주문이 환불됐어도 주문·상품·잔액은 처음 그대로다.
 *
 * `game`만은 처음 값이 아니라 **지금** 값이다: 그 게임의 지금 live 버전이다 (지휘자 결정). 앱이 이제 받을 것을 알려 주는 값이라,
 * 그사이 새 버전을 내보냈으면 새 버전을, 게임을 내렸으면 null을 준다.
 */
async function replay(tx: Tx, a: { userId: string; productId: string; first: OrderRow; balance: number }): Promise<Purchased> {
  if (a.first.paymentMethod !== 'coin' || a.first.productId !== a.productId) throw idempotencyMismatch();
  const product = await getProduct(tx, a.first.productId);
  const game = product?.kind === 'game' && product.gameId !== null ? await getGame(tx, product.gameId) : null;
  const out = { orderId: a.first.id, productId: a.first.productId, game: game ? purchasedGame(game) : null, replayed: true };
  const paid = (await readEvents(tx, a.first.id)).find((e) => e.type === 'completed');
  if (!paid || paid.ledgerId === null) {
    const noted = (paid?.detail as { balance?: unknown } | null | undefined)?.balance;
    return { ...out, balance: typeof noted === 'number' ? noted : a.balance };
  }
  // 이 사용자의 코인 기록 가운데 그 번호의 줄 (번호가 그 줄보다 큰 것을 빼고 가장 최신 하나)
  const [entry] = (await listLedger(tx, a.userId, { before: paid.ledgerId + 1, limit: 1 })).entries;
  if (entry?.id !== paid.ledgerId) throw new Error('주문과 코인 기록이 어긋났어요');
  return { ...out, balance: entry.balanceAfter };
}

/**
 * 코인으로 산다 (스펙 5.6 `POST /v2/shop/purchase`, 표 K17). 게임도 아이템도 같은 길이다. 입력은 `{ productId, idempotencyKey? }`이고
 * 그 밖의 값(앱이 보낸 가격 등)은 보지 않는다: 가격은 서버가 켜진 COIN 가격에서 읽는다.
 *
 * 한 트랜잭션으로, 이 순서다.
 * 1. 사용자 행 → 지갑 행을 잡는다 (`lockWallet`). **같은 사용자의 구매는 차례로 처리된다**: 연타한 구매와 동시에 온 여러 구매가
 *    앞의 것이 끝난 뒤에 잔액과 가진 것을 본다. 잔액 1000에서 300짜리 10개가 겹치면 3개만 되고, 같은 상품 둘이 겹치면 하나만 팔린다.
 *    잠그는 순서는 판 결과·보상과 같다: 사용자 → 지갑 → 그 밖
 * 2. 같은 키의 주문이 있으면 처음 답을 `replayed: true`로 준다 (`replay`). 가진 것을 확인하기 전에 본다 — 안 그러면 다시 보낸 구매가 `already_owned`를 받는다
 * 3. 팔 수 있는지: 없는 상품이면 `404 not_found`. `on_sale`이 아니거나, `access`가 `purchase`가 아니거나, 소모되는 상품(코인 묶음)이거나,
 *    게임 상품인데 그 게임이 `live`가 아니거나, 켜진 COIN 가격이 없으면 `409 not_for_sale`.
 *    게임의 상태는 게임 상품에만 본다 (그 게임의 아이템은 상품 상태만 본다)
 * 4. 이미 가졌으면 `409 already_owned`
 * 5. 코인을 뺀다 (`applyCoins`, 까닭 `purchase`). 모자라면 `409 insufficient_coins`. 가격이 0이면 코인 기록을 만들지 않는다
 * 6. 주문(구매 당시 이름·종류·가격)과 사건 셋(created → completed → granted), 보유, `orders.entitlement_id`를 넣는다
 *
 * 어디서 실패하든 아무것도 남지 않는다: 코인이 모자라면 주문·사건·보유·코인 기록이 하나도 생기지 않고, 보유를 넣다 실패하면
 * 빠진 코인과 주문도 함께 되돌아간다. 운영자 지급이 같은 순간에 같은 상품을 먼저 줬으면 `409 already_owned`이고 코인은 나가지 않는다.
 *
 * 키는 사용자마다 따로이고 코인 기록에도 넘긴다: 같은 키를 이미 다른 코인 기록(판 결과, 보상)에 썼으면 `409 idempotency_mismatch`다
 * (가격이 0이라 코인 기록을 만들지 않는 구매도 같다 — 2번 바로 뒤에서 `hasLedgerKey`로 본다).
 * 사면서 장착하지는 않는다 (표 D7). 없거나 지워진 사용자면 `401 unauthorized`.
 *
 * 답의 `game`: 게임 상품을 샀으면 그 게임과 지금 live 버전(번호, 크기, sha256, 서명, min_shell_api)이고, 게임 상품이 아니면 null이다.
 */
export async function purchaseWithCoins(db: Db, userId: string, input: unknown, now: Date): Promise<Purchased> {
  const body = obj(input, 'body');
  const productId = body.productId;
  if (typeof productId !== 'string') throw new RuleError(400, 'invalid_product_id', 'productId 값이 올바르지 않아요');
  const key = checkKey(body.idempotencyKey);

  return db.transaction(async (tx) => {
    const balance = await lockWallet(tx, userId, now);
    if (key !== null) {
      const first = await findOrderByKey(tx, userId, key);
      if (first) return replay(tx, { userId, productId, first, balance });
      // 이 키의 주문은 없는데 코인 기록은 있다: 같은 키를 다른 일(판 결과, 보상)에 쓴 것이다.
      // 가격이 0이면 아래에서 `applyCoins`를 부르지 않아 키를 볼 곳이 없으니 가격과 상관없이 여기서 거절한다
      if (await hasLedgerKey(tx, userId, key)) throw idempotencyMismatch();
    }

    const product = await getProduct(tx, productId);
    if (!product) throw noProduct();
    if (product.status !== 'on_sale' || product.access !== 'purchase' || product.consumable) throw notForSale();
    // 게임 상품은 그 게임이 live일 때만 판다: 아직 내보내지 않았거나(draft) 내린(retired) 게임은 사도 할 수 없다
    const game = product.kind === 'game' && product.gameId !== null ? await getGame(tx, product.gameId) : null;
    if (product.kind === 'game' && game?.status !== 'live') throw notForSale();
    const price = await activePrice(tx, product.id, 'COIN');
    if (!price) throw notForSale();
    if (await owns(tx, userId, product)) throw alreadyOwned();

    // 코인을 먼저 뺀다. 모자라면 여기서 거절되고 아직 아무것도 쓰지 않았다
    let after = balance;
    let ledgerId: number | null = null;
    if (price.amount > 0) {
      const paid = await applyCoins(tx, { userId, delta: -price.amount, reason: 'purchase', idempotencyKey: key, now });
      // 이 키의 주문은 없는데 코인 기록은 있다: 같은 키를 다른 일에 쓴 흔적이다. 코인이 나가지 않았으니 팔지 않는다
      if (paid.replayed) throw idempotencyMismatch();
      ledgerId = paid.ledgerId;
      after = paid.balance;
    }

    const order = await open(tx, {
      userId,
      productId: product.id,
      paymentMethod: 'coin',
      productName: product.name,
      productKind: product.kind,
      priceAmount: price.amount,
      priceCurrency: 'COIN',
      idempotencyKey: key,
      now,
    });
    // 코인 기록이 없는 주문(가격 0)은 그때의 잔액을 사건에 적어 둔다: 같은 키로 다시 보낸 요청에 처음 잔액을 답하려고
    await record(tx, order, { type: 'completed', to: 'completed', actor: 'system', ledgerId, detail: ledgerId === null ? { balance: after } : undefined, now });
    // 운영자 지급이 같은 순간에 먼저 줬으면 여기서 `409 already_owned`로 던져지고 위의 코인과 주문이 함께 되돌아간다
    const entitlementId = await grant(tx, { userId, productId: product.id, source: 'coin_purchase' });
    await writeEntitlement(tx, order.id, entitlementId);
    await record(tx, order, { type: 'granted', actor: 'system', detail: { entitlementId }, now });
    return { orderId: order.id, productId: product.id, game: game ? purchasedGame(game) : null, balance: after, replayed: false };
  });
}

// ── 환불 ────────────────────────────────────────────────────

/**
 * 환불할 수 있는 주문인지: 코인 주문이고(`409 not_coin_order`), 아직 환불하지 않았고(`409 already_refunded`),
 * 결제가 끝난 주문이다(`409 not_refundable`). 명령줄이 확인을 묻기 전에도 이것으로 본다.
 */
export function checkRefundable(order: { paymentMethod: PaymentMethod; status: OrderStatus }): void {
  if (order.paymentMethod !== 'coin') throw new RuleError(409, 'not_coin_order', '코인으로 산 주문만 환불할 수 있어요 (현금 주문의 환불은 스토어에서 해요)');
  if (order.status === 'refunded') throw new RuleError(409, 'already_refunded', '이미 환불한 주문이에요');
  if (order.status !== 'completed') throw new RuleError(409, 'not_refundable', `결제가 끝난 주문만 환불할 수 있어요 (지금 상태: ${order.status})`);
}

/**
 * 코인 주문을 환불한다 (스펙 5.7, 명령줄 `order refund`). 운영 명령의 트랜잭션(`mutation`) 안에서 불리고, 한 번에 다 되거나 하나도 안 된다:
 * 코인이 돌아오고(까닭 `refund`), 이 주문으로 생긴 보유가 회수되고(장착도 풀린다), 주문이 `refunded`가 되고, 사건에 `refunded`·`revoked`가 쌓인다.
 * 두 사건은 `adminActionId`(운영 기록)를 가리키고, `refunded` 사건이 돌아온 코인의 기록을 가리킨다.
 *
 * - 없는 주문이면 `404 not_found`, 현금 주문이면 `409 not_coin_order` (현금 주문의 환불은 스토어가 한다 — 3번 작업),
 *   이미 환불했으면 `409 already_refunded`. 환불은 주문마다 한 번이다
 * - 같은 주문의 환불이 동시에 와도 한 번만 된다: 사용자 행 → 지갑 행 → 주문 행 순서로 잡고 상태를 다시 본다
 * - **이 주문이 만든 보유만 회수한다.** 운영자가 그 보유를 이미 회수했으면 (그 뒤에 다시 받았더라도) 지금 가진 것은 건드리지 않고,
 *   코인만 돌려준 뒤 `revoked` 대신 `note` 사건을 남긴다
 * - **지워진 사용자의 주문은 환불하지 않는다**: `404 not_found`. 계정을 지우면 코인 주문도 함께 지워지므로, 삭제와 겹친 환불은
 *   삭제가 끝난 뒤의 모습(없는 주문)으로 답한다. 돌려줄 지갑이 없다
 * - 코인을 돌려줄 수 없으면(지갑 상한 `409 balance_limit`) 환불 전체가 거절된다. 가격이 0이던 주문은 코인 기록 없이 보유만 회수한다
 *
 * `now`는 사건과 `refunded_at`, 코인 기록에 남는 시각이다. 없으면 지금이다.
 */
export async function refundCoinOrder(tx: Tx, orderId: string, adminActionId: number, now: Date = new Date()): Promise<void> {
  const seen = isUuid(orderId) ? await readOrder(tx, orderId) : null;
  if (!seen) throw noOrder();
  checkRefundable(seen);

  try {
    await lockWallet(tx, seen.userId, now);
  } catch (err) {
    if (err instanceof RuleError && err.code === 'unauthorized') throw new RuleError(404, 'not_found', '없는 주문이에요 (지워진 계정의 코인 주문은 계정과 함께 지워져요)');
    throw err;
  }
  // 잠근 뒤에 다시 본다: 같은 주문의 다른 환불이 앞에서 끝났으면 여기서 `already_refunded`다
  const order = await lockOrder(tx, orderId);
  if (!order) throw noOrder();
  checkRefundable(order);

  // 코인 기록이 왜 생겼는지는 사건이 가리킨다. 코인 기록의 admin_action_id는 운영자 지급·조정에만 쓴다 (스펙 5.2)
  let ledgerId: number | null = null;
  if (order.priceAmount > 0) ledgerId = (await applyCoins(tx, { userId: order.userId, delta: order.priceAmount, reason: 'refund', now })).ledgerId;
  await record(tx, order, { type: 'refunded', to: 'refunded', actor: 'admin', ledgerId, adminActionId, now });

  // 코인 주문에는 늘 그 주문이 만든 보유가 있다. 없다면(손으로 고친 자료) 회수할 것이 없으니 코인만 돌려준다
  const entitlementId = order.entitlementId;
  if (entitlementId === null) return;
  try {
    await revoke(tx, { userId: order.userId, productId: order.productId, reason: 'refund', entitlementId });
  } catch (err) {
    // 이 주문의 보유가 이미 회수돼 있다 (운영자의 `revoke`). 지금 켜진 보유가 있더라도 다른 길로 받은 것이라 두고 간다
    if (!(err instanceof RuleError) || err.code !== 'not_owned') throw err;
    await record(tx, order, { type: 'note', actor: 'admin', adminActionId, detail: { entitlement: 'already_revoked', entitlementId }, now });
    return;
  }
  await record(tx, order, { type: 'revoked', actor: 'admin', adminActionId, detail: { entitlementId }, now });
}

// ── 주문 내역 ─────────────────────────────────────────────────

export const ORDER_PAGE_DEFAULT = 20;
export const ORDER_PAGE_MAX = 100;

export interface OrderPage {
  /** 이 주문보다 오래된 것부터 (앞 쪽의 `next`). 없으면 가장 최신부터 */
  before?: string;
  limit: number;
}

const invalidLimit = () => new RuleError(400, 'invalid_limit', `limit은 1~${ORDER_PAGE_MAX}의 정수여야 해요`);
const invalidBefore = () => new RuleError(400, 'invalid_before', 'before는 주문 ID여야 해요');

/** 쪽 크기는 1~100, `before`는 주문 ID 모양. 어기면 `400 invalid_limit`·`invalid_before` */
export function checkOrderPage(page: OrderPage): OrderPage {
  if (typeof page.limit !== 'number' || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > ORDER_PAGE_MAX) throw invalidLimit();
  if (page.before === undefined) return { limit: page.limit };
  if (typeof page.before !== 'string' || !isUuid(page.before)) throw invalidBefore();
  return { before: page.before, limit: page.limit };
}

/**
 * `GET /v2/me/orders?before=&limit=`의 물음을 읽는다. `limit`이 없으면 20이고 숫자만 적은 글이어야 한다
 * (`1e2`, `+5`, 빈 값은 받지 않는다). 같은 이름을 두 번 보내도 받지 않는다.
 */
export function parseOrderPage(query: URLSearchParams): OrderPage {
  const limits = query.getAll('limit');
  if (limits.length > 1 || (limits.length === 1 && !/^[0-9]{1,4}$/.test(limits[0]))) throw invalidLimit();
  const befores = query.getAll('before');
  if (befores.length > 1) throw invalidBefore();
  const limit = limits.length === 1 ? Number(limits[0]) : ORDER_PAGE_DEFAULT;
  return checkOrderPage(befores.length === 1 ? { before: befores[0], limit } : { limit });
}

/** 앱에 내려 주는 주문 한 줄. 스토어 값(영수증 원문, 구매 토큰, 스토어 주문 번호)은 들지 않는다 */
export interface OrderSummary {
  id: string;
  productId: string;
  /** 구매 당시의 이름·종류·가격 */
  productName: string;
  productKind: string;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  price: { currency: string; amount: number };
  createdAt: string;
  completedAt: string | null;
  refundedAt: string | null;
}

function summarize(row: OrderRow): OrderSummary {
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    productKind: row.productKind,
    paymentMethod: row.paymentMethod,
    status: row.status,
    price: { currency: row.priceCurrency, amount: row.priceAmount },
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    refundedAt: row.refundedAt?.toISOString() ?? null,
  };
}

/**
 * 이 사용자의 주문을 최신부터 `limit`개(1~100) 준다 (스펙 5.10 `GET /v2/me/orders`). 더 있으면 `next`에 다음 쪽의 `before`로 쓸
 * 주문 ID를, 없으면 null을 준다. 다른 사용자의 주문은 `before`를 어떻게 주든 나오지 않는다 (남의 주문 ID를 주면 빈 쪽이다).
 */
export async function listOrders(db: Db, userId: string, page: OrderPage): Promise<{ orders: OrderSummary[]; next: string | null }> {
  const { before, limit } = checkOrderPage(page);
  if (!isUuid(userId)) return { orders: [], next: null };
  // 하나 더 읽어서 다음 쪽이 있는지 안다
  const rows = await selectUserOrders(db, userId, before, limit + 1);
  const shown = rows.slice(0, limit);
  return { orders: shown.map(summarize), next: rows.length > limit ? shown[shown.length - 1].id : null };
}

/** 운영자가 보는 주문 한 줄: 누구의 주문인지와 스토어 상품 코드·주문 번호·환경이 더 있다. 영수증 원문과 구매 토큰은 여기에도 없다 */
export interface OrderRecord extends OrderSummary {
  userId: string;
  storeSku: string | null;
  storeOrderId: string | null;
  storeEnvironment: string | null;
  entitlementId: number | null;
}

export interface OrderEventRecord {
  id: number;
  type: OrderEventType;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  actor: OrderActor;
  detail: unknown;
  ledgerId: number | null;
  adminActionId: number | null;
  createdAt: string;
}

function toRecord(row: OrderRow): OrderRecord {
  return { ...summarize(row), userId: row.userId, storeSku: row.storeSku, storeOrderId: row.storeOrderId, storeEnvironment: row.storeEnvironment, entitlementId: row.entitlementId };
}

/** 주문 하나와 그 사건(일어난 순서). 없거나 주문 ID 모양이 아니면 null (명령줄 `order show`) */
export async function getOrder(q: Q, orderId: string): Promise<(OrderRecord & { events: OrderEventRecord[] }) | null> {
  if (!isUuid(orderId)) return null;
  const row = await readOrder(q, orderId);
  if (!row) return null;
  const events = await readEvents(q, row.id);
  return { ...toRecord(row), events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) };
}

/**
 * 최근 주문을 최신부터 `limit`개(1~100) (명령줄 `order list`). `userId`를 주면 그 사용자의 것만, 없으면 모든 사용자의 것이다.
 * 사용자 ID 모양이 아니면 빈 목록이다.
 */
export async function recentOrders(q: Q, filter: { userId?: string; limit: number }): Promise<OrderRecord[]> {
  const { limit } = checkOrderPage({ limit: filter.limit });
  if (filter.userId === undefined) return (await selectRecentOrders(q, limit)).map(toRecord);
  if (!isUuid(filter.userId)) return [];
  return (await selectUserOrders(q, filter.userId, undefined, limit)).map(toRecord);
}

// ── 계정 삭제와 보관 기간 ──────────────────────────────────────────

/**
 * 이 사용자에게 현금 주문(구글·애플 결제)이 있나. 참이면 계정을 지워도 사용자 행이 `deleted`로 남는다 (스펙 5.4):
 * 대금결제 기록은 5년 보관해야 하고(전자상거래법 시행령 6조) 주문이 가리킬 사용자 행이 있어야 한다.
 * 상태와 상관없이 센다 (환불된 것도, 결제가 끝나지 않은 것도 보관할 기록이다). 코인 주문은 세지 않는다.
 */
export async function hasMoneyOrders(q: Q, userId: string): Promise<boolean> {
  if (!isUuid(userId)) return false;
  return existsMoneyOrder(q, userId);
}

/**
 * 이 사용자의 코인 주문과 그 사건을 지운다 (계정 삭제, 스펙 5.4). 현금 주문과 그 사건은 남긴다.
 *
 * 남는 주문은 계정과 함께 사라질 것을 가리키지 않게 한다: 사건의 `ledger_id`와 주문의 `entitlement_id`를 비운다.
 * 그래야 뒤따르는 보유·지갑의 `purgeUser`가 외래 키에 걸리지 않는다 (삭제 순서: order → reward → play → entitlement → wallet).
 * 구매 당시의 이름·종류·가격과 사건의 종류·시각은 그대로 남는다.
 */
export async function purgeUser(tx: Tx, userId: string): Promise<void> {
  if (!isUuid(userId)) return;
  await deleteCoinOrders(tx, userId);
  await detachKeptOrders(tx, userId);
}

/** 결제 기록을 보관하는 햇수 (전자상거래법 시행령 6조: 대금결제와 재화 공급 기록 5년) */
export const RETENTION_YEARS = 5;

/**
 * 보관 기간의 기준 시각: `now`에서 달력으로 5년 전 (UTC). 이때이거나 그 전에 끝난 주문은 5년을 채웠다.
 * 2월 29일에는 5년 전에 같은 날이 없어서 2월 28일로 당긴다 (3월 1일로 넘기면 5년이 안 된 주문이 지워진다).
 */
export function retentionCutoff(now: Date): Date {
  const cut = new Date(now);
  cut.setUTCFullYear(cut.getUTCFullYear() - RETENTION_YEARS);
  if (cut.getUTCMonth() !== now.getUTCMonth()) cut.setUTCDate(0);
  return cut;
}

/** 지금 `purgeExpired`를 돌리면 지워질 주문의 수 (명령이 묻기 전에 보여 준다). 읽기만 한다 */
export async function countExpiredOrders(q: Q, now: Date): Promise<number> {
  return countExpired(q, retentionCutoff(now), await listDeletedUsers(q));
}

/**
 * 계정을 지운(`deleted`) 사용자의 보관 기간이 끝난 현금 주문과 그 사건을 지우고, 주문이 하나도 남지 않은 `deleted` 사용자 행도 지운다.
 * 부른 쪽의 트랜잭션 안에서 일한다 (명령줄 `orders purge-expired`가 운영 기록과 함께 한 트랜잭션으로 부른다).
 *
 * **살아 있는 사용자의 주문은 5년이 지나도 지우지 않는다** (지휘자 결정): 보관 기간은 계정을 지운 뒤에 남겨 둔 기록의 것이다 (스펙 5.4).
 * 계정을 쓰는 사람의 주문 내역과, 운영자가 문의에 답할 근거는 그대로 남는다.
 *
 * 사용자 행: 계정을 지울 때 현금 주문 때문에 `deleted`로 남겨 둔 행이다. 마지막 주문이 지워지면 남길 까닭이 없다.
 * 이번에 주문이 지워진 사용자만이 아니라 `deleted` 사용자 전부를 본다: 어떤 까닭으로든 주문 없이 남은 행
 * (계정 삭제와 이 명령이 겹친 순간에 생길 수 있다)이 다음에 돌릴 때 함께 치워진다. 아직 주문이 남은 사용자의 행은 건드리지 않는다.
 */
export async function purgeExpiredIn(tx: Tx, now: Date): Promise<{ orders: number; users: number }> {
  const deleted = await listDeletedUsers(tx);
  const orders = await deleteExpired(tx, retentionCutoff(now), deleted);
  const keep = await usersWithOrders(tx, deleted);
  let users = 0;
  for (const userId of deleted) {
    if (!keep.has(userId) && (await removeDeletedUser(tx, userId))) users++;
  }
  return { orders, users };
}

/**
 * 계정을 지운 사용자의, 완료나 환불에서 5년이 지난 현금 주문과 그 사건을 지우고 지운 주문의 수를 준다 (스펙 5.4, 명령줄 `orders purge-expired`).
 * 5년에서 하루라도 모자라면 남는다. 환불된 주문은 환불한 때부터, 끝내 결제되지 않은 주문은 만든 때부터 센다.
 * 살아 있는 사용자의 주문과 코인 주문은 지우지 않는다 (코인 주문은 계정을 지울 때 함께 지워진다).
 * 시각은 넣어 준 `now`로 잰다 (DB의 지금이 아니다).
 *
 * 주문이 하나도 남지 않은 `deleted` 사용자 행도 같은 트랜잭션에서 지운다 (`purgeExpiredIn`).
 */
export async function purgeExpired(db: Db, now: Date): Promise<number> {
  return (await db.transaction((tx) => purgeExpiredIn(tx, now))).orders;
}
