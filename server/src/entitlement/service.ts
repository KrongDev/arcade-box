import { requireActiveUser } from '../account/index.ts';
import { getGame } from '../game/index.ts';
import { gameProduct, getProduct, isProductId, type Product } from '../product/index.ts';
import type { Db, Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import { isUuid } from '../shared/validate.ts';
import {
  deleteEquippedProduct,
  deleteUserRows,
  hasActive,
  holdActive,
  insertActive,
  readActiveId,
  readEquipped,
  readOwnedIds,
  revokeActive,
  upsertEquipped,
} from './repo.ts';
import { ENTITLEMENT_SOURCES, REVOKE_REASONS, type EntitlementSource, type RevokeReason } from './schema.ts';

const noProduct = () => new RuleError(404, 'not_found', '없는 상품이에요');
const notOwned = (status: number) => new RuleError(status, 'not_owned', '가지고 있지 않은 상품이에요');

async function productOrThrow(q: Q, productId: string): Promise<Product> {
  const product = await getProduct(q, productId);
  if (!product) throw noProduct();
  return product;
}

/**
 * `everyone` 상품이 지금 누구에게나 주어진 것인가: `on_sale`일 때만이다 (지휘자 결정, 2026-11-26).
 * draft·hidden·retired인 `everyone` 상품은 저절로 가진 것이 아니다.
 */
function givenToEveryone(product: Product): boolean {
  return product.access === 'everyone' && product.status === 'on_sale';
}

/**
 * 이 사용자가 이 상품을 가졌나.
 * - `everyone`이고 `on_sale`이면 누구나 가진 것이다 (보유 행 없이)
 * - 그 밖에는 회수되지 않은 보유가 있어야 한다. 지급받았거나 산 보유는 상품의 status와 상관없이 가진 것이다
 *   (retired·hidden·draft로 바뀌어도 회수하기 전까지 그 사람 것)
 */
export async function owns(q: Q, userId: string, product: Product): Promise<boolean> {
  if (givenToEveryone(product)) return true;
  if (!isUuid(userId)) return false;
  return hasActive(q, userId, product.id);
}

/**
 * 이 사용자가 이 상품으로 지금 가진 보유(회수되지 않은 행)의 번호. 없으면 null — `everyone` 상품은 보유 행이 없어서 늘 null이다.
 * 주문의 환불이 "그 주문으로 생긴 보유가 아직 켜져 있나"를 미리 알려 줄 때 쓴다. 사용자 ID나 상품 ID 모양이 아니면 null.
 */
export async function activeEntitlementId(q: Q, userId: string, productId: string): Promise<number | null> {
  if (!isUuid(userId) || !isProductId(productId)) return null;
  return readActiveId(q, userId, productId);
}

/**
 * 이 게임을 할 수 있나 (스펙 5.6): 게임이 live이고, 그 게임의 game 상품을 `owns`의 규칙으로 가졌다
 * (게임 상품이 `everyone`이어도 `on_sale`이 아니면 보유가 있어야 한다). game 상품이 없는 게임은 못 한다.
 */
export async function canPlayGame(q: Q, userId: string, gameId: string): Promise<boolean> {
  const game = await getGame(q, gameId);
  if (game?.status !== 'live') return false;
  const product = await gameProduct(q, gameId);
  return product !== null && (await owns(q, userId, product));
}

/**
 * 보유를 준다 (코인 구매, 스토어 구매, 운영자 지급). 부른 쪽의 트랜잭션 안에서 일하고 새 보유의 id를 준다.
 *
 * - 없는 상품이면 `404 not_found`
 * - 소모되는 상품(코인 묶음)이나 `everyone` 상품이면 `400 not_grantable` (보유 행을 만들지 않는 것들이다)
 * - 없거나 지워진 사용자면 `401 unauthorized` (사용자 행을 잡은 뒤에 쓴다 — 계정 삭제와 겹쳐도 지워진 사용자에 붙지 않는다)
 * - 이미 가졌으면 `409 already_owned`. 같은 순간에 온 지급 둘도 유일 색인에 기대어 하나만 넣고 다른 하나는 이 거절이다
 */
export async function grant(tx: Tx, input: { userId: string; productId: string; source: EntitlementSource; adminActionId?: number }): Promise<number> {
  if (!(ENTITLEMENT_SOURCES as readonly unknown[]).includes(input.source)) throw new RuleError(400, 'invalid_source', '지급 출처가 올바르지 않아요');
  const product = await productOrThrow(tx, input.productId);
  if (product.consumable || product.access === 'everyone') {
    throw new RuleError(400, 'not_grantable', '줄 수 없는 상품이에요 (코인 묶음과 누구나 가진 상품은 보유로 주지 않아요)');
  }
  await requireActiveUser(tx, input.userId);
  const id = await insertActive(tx, { userId: input.userId, productId: product.id, source: input.source, adminActionId: input.adminActionId ?? null });
  if (id === null) throw new RuleError(409, 'already_owned', '이미 가지고 있어요');
  return id;
}

/**
 * 보유를 회수한다 (환불, 운영자 판단). 행은 지우지 않고 `revoked_at`과 까닭을 채운다. 장착하고 있었으면 장착도 푼다.
 * 없는 상품이면 `404 not_found`, 켜진 보유가 없으면 `409 not_owned`, 없거나 지워진 사용자면 `401 unauthorized`.
 *
 * `entitlementId`를 주면 지금 켜진 보유가 바로 그 보유일 때만 회수한다 (주문의 환불이 그 주문으로 생긴 보유만 회수할 때 쓴다).
 * 그 보유가 이미 회수됐으면 — 그 뒤에 같은 상품을 다시 받아 켜진 보유가 따로 있더라도 — `409 not_owned`이고 아무것도 바꾸지 않는다.
 */
export async function revoke(tx: Tx, input: { userId: string; productId: string; reason: RevokeReason; entitlementId?: number }): Promise<void> {
  if (!(REVOKE_REASONS as readonly unknown[]).includes(input.reason)) throw new RuleError(400, 'invalid_reason', '회수 까닭이 올바르지 않아요');
  await requireActiveUser(tx, input.userId);
  const product = await productOrThrow(tx, input.productId);
  if (!(await revokeActive(tx, input.userId, product.id, input.reason, input.entitlementId))) throw notOwned(409);
  await deleteEquippedProduct(tx, input.userId, product.id);
}

/** 켜진 보유가 있는 상품 id (`everyone` 상품은 들지 않는다). 상품 id 순서 */
export async function listOwned(q: Q, userId: string): Promise<string[]> {
  if (!isUuid(userId)) return [];
  return readOwnedIds(q, userId);
}

/**
 * 켜진 보유가 있는 게임 상품의 수 (`everyone` 게임은 세지 않는다). 계정 연결 충돌 때 양쪽 요약에 쓴다.
 * 상품의 종류는 `product`에 물어서 보유한 상품마다 쿼리가 하나씩이다 (`products`와 엮는 쿼리는 경계를 넘는다).
 * 연결 충돌 때만 불리고 보유는 수십 개라 괜찮다.
 */
export async function countOwnedGames(q: Q, userId: string): Promise<number> {
  let n = 0;
  for (const id of await listOwned(q, userId)) if ((await getProduct(q, id))?.kind === 'game') n++;
  return n;
}

/**
 * 아이템을 장착한다 (스펙 5.10 `PUT /v2/me/equipped`). 같은 게임·같은 자리의 장착을 바꾼다.
 * v1과 달리 종류와 상관없이 가진 것만 장착한다 (표 K18). 가졌는지는 `owns`의 규칙이다 (`on_sale`인 `everyone` 아이템은 누구나 가진 것).
 *
 * - `productId`가 글자열이 아니면 `400 invalid_product_id`, 없는 상품이면 `404 not_found`
 * - 아이템이 아니면 `400 not_item`, 가지지 않았으면 `403 not_owned`
 * - 없거나 지워진 사용자면 `401 unauthorized`
 *
 * 보유 행을 잡은 채(FOR SHARE) 장착하므로, 같은 순간에 온 회수와 겹쳐도 회수된 아이템이 장착된 채 남지 않는다.
 */
export async function equip(db: Db, userId: string, productId: unknown): Promise<void> {
  if (typeof productId !== 'string') throw new RuleError(400, 'invalid_product_id', 'productId 값이 올바르지 않아요');
  await db.transaction(async (tx) => {
    await requireActiveUser(tx, userId);
    const product = await productOrThrow(tx, productId);
    if (product.kind !== 'item' || product.gameId === null || product.slot === null) throw new RuleError(400, 'not_item', '장착할 수 있는 아이템이 아니에요');
    if (!givenToEveryone(product) && !(await holdActive(tx, userId, product.id))) throw notOwned(403);
    await upsertEquipped(tx, { userId, gameId: product.gameId, slot: product.slot, productId: product.id });
  });
}

/**
 * 장착한 아이템 가운데 지금 가진 것(`owns`)만 준다 (게임·자리 순서). 장착한 뒤에 운영자가 `everyone` 아이템을
 * `purchase`로 바꾸거나 `on_sale`이 아니게 바꾸면 장착 행은 남지만 가지지 않은 것이라 내려 주지 않는다
 * (스펙 5.10 "가진 것만 장착돼요", 표 K18). 행을 지우지는 않는다: 되돌리거나 지급하면 그대로 장착된 것으로 보인다.
 *
 * 상품과 보유를 한 쿼리로 엮지 않고 `product`의 `getProduct`로 묻는다 — 다른 도메인의 테이블은 `schema.ts`만
 * 가져올 수 있어서다 (스펙 5.14). 한 사용자의 장착은 게임마다 자리 몇 개뿐이다.
 */
export async function listEquipped(q: Q, userId: string): Promise<Array<{ gameId: string; slot: string; productId: string }>> {
  if (!isUuid(userId)) return [];
  const out = [];
  for (const row of await readEquipped(q, userId)) {
    const product = await getProduct(q, row.productId);
    if (product && (await owns(q, userId, product))) out.push(row);
  }
  return out;
}

/**
 * 이 사용자의 장착과 보유를 지운다 (계정 삭제, 스펙 5.4). 보유를 가리키는 주문을 먼저 지운 뒤에 부른다
 * (삭제 순서: order → reward → play → entitlement → wallet).
 */
export async function purgeUser(tx: Tx, userId: string): Promise<void> {
  await deleteUserRows(tx, userId);
}
