import { getGame } from '../game/index.ts';
import type { Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import {
  deactivatePrice,
  insertActivePrice,
  insertProduct,
  lockProduct,
  readActivePrice,
  readActivePrices,
  readGameProduct,
  readProduct,
  readProducts,
  skuOwner,
  upsertSku,
  writeProduct,
} from './repo.ts';
import {
  CURRENCIES,
  checkAmount,
  checkCurrency,
  checkProductShape,
  checkSku,
  checkStore,
  isProductId,
  type Currency,
  type Product,
  type ProductAccess,
  type ProductKind,
  type ProductStatus,
  type Store,
} from './rules.ts';

const noProduct = () => new RuleError(404, 'not_found', '없는 상품이에요');
const gameProductExists = (gameId: string) => new RuleError(409, 'game_product_exists', `게임 ${gameId}에는 이미 game 상품이 있어요 (게임 하나에 하나)`);

export interface NewProduct {
  id: string;
  kind: ProductKind;
  name: string;
  description?: string;
  iconPath?: string | null;
  gameId?: string | null;
  slot?: string | null;
  access: ProductAccess;
  /** 없으면 draft */
  status?: ProductStatus;
  /** 없으면 coin_pack만 참 */
  consumable?: boolean;
  grantCoins?: number | null;
  sortOrder?: number;
}

/** 적지 않은 칸을 기본값으로 채운 상품 한 줄. 규칙에 맞는지는 `checkProductShape`가 본다 */
export function newProductRow(input: NewProduct): Product {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    description: input.description ?? '',
    iconPath: input.iconPath ?? null,
    gameId: input.gameId ?? null,
    slot: input.slot ?? null,
    access: input.access,
    status: input.status ?? 'draft',
    consumable: input.consumable ?? input.kind === 'coin_pack',
    grantCoins: input.grantCoins ?? null,
    sortOrder: input.sortOrder ?? 0,
  };
}

/**
 * 상품을 만든다. 규칙(`checkProductShape`)을 어기면 `400`, 같은 ID가 있으면 `409 already_exists`,
 * 없는 게임이면 `404 not_found`, 그 게임에 game 상품이 이미 있으면 `409 game_product_exists`.
 */
export async function createProduct(tx: Tx, input: NewProduct): Promise<void> {
  const row = newProductRow(input);
  checkProductShape(row);
  if (row.gameId !== null && !(await getGame(tx, row.gameId))) throw new RuleError(404, 'not_found', `없는 게임이에요: ${row.gameId}`);
  if (await readProduct(tx, row.id)) throw new RuleError(409, 'already_exists', `이미 있는 상품이에요: ${row.id}`);
  if (row.kind === 'game' && (await readGameProduct(tx, row.gameId!))) throw gameProductExists(row.gameId!);
  // 같은 순간에 다른 명령이 같은 ID나 같은 게임의 game 상품을 넣었으면 유일 제약에 걸려 넣지 않는다
  if (!(await insertProduct(tx, row))) {
    if (await readProduct(tx, row.id)) throw new RuleError(409, 'already_exists', `이미 있는 상품이에요: ${row.id}`);
    throw gameProductExists(row.gameId ?? '');
  }
}

/** 고칠 수 있는 칸. id·kind와, 장착이 베껴 두는 game_id·slot, 종류에 딸린 consumable은 고치지 않는다 */
export interface ProductPatch {
  name?: string;
  description?: string;
  iconPath?: string | null;
  access?: ProductAccess;
  status?: ProductStatus;
  grantCoins?: number | null;
  sortOrder?: number;
}

const UPDATABLE = new Set<string>(['name', 'description', 'iconPath', 'access', 'status', 'grantCoins', 'sortOrder']);

/**
 * 준 칸만 고친다. 고친 뒤의 상품도 규칙에 맞아야 한다.
 * 고칠 수 없는 칸(id, kind, gameId, slot, consumable)을 주면 `400 not_updatable`, 고칠 것이 없으면 `400 nothing_to_update`.
 */
export async function updateProduct(tx: Tx, id: string, patch: ProductPatch): Promise<void> {
  const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
  const fixed = keys.filter((k) => !UPDATABLE.has(k));
  if (fixed.length > 0) throw new RuleError(400, 'not_updatable', `고칠 수 없는 칸이에요: ${fixed.join(', ')} (새 상품으로 만들어 주세요)`);
  if (keys.length === 0) throw new RuleError(400, 'nothing_to_update', '고칠 것을 하나 이상 적어 주세요');
  const current = isProductId(id) ? await lockProduct(tx, id) : null;
  if (!current) throw noProduct();
  const next: Product = { ...current };
  for (const k of keys) (next as unknown as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
  checkProductShape(next);
  await writeProduct(tx, next);
}

export async function getProduct(q: Q, id: string): Promise<Product | null> {
  if (!isProductId(id)) return null;
  return readProduct(q, id);
}

/** 이 게임의 game 상품 (게임 하나에 하나). 없으면 null */
export async function gameProduct(q: Q, gameId: string): Promise<Product | null> {
  if (typeof gameId !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(gameId)) return null;
  return readGameProduct(q, gameId);
}

// ── 가격 ────────────────────────────────────────────────────

/**
 * 가격을 정한다: 켜진 옛 행을 끄고 새 행을 넣는다 (내역이 남는다). 상품 행을 잠가서 같은 상품의 가격 바꾸기가
 * 한 번에 하나씩 돈다. 지금과 같은 값이면 `409 same_price`.
 */
export async function setPrice(tx: Tx, productId: string, currency: Currency, amount: number): Promise<void> {
  const c = checkCurrency(currency);
  const a = checkAmount(amount);
  if (!isProductId(productId) || !(await lockProduct(tx, productId))) throw noProduct();
  if ((await readActivePrice(tx, productId, c))?.amount === a) throw new RuleError(409, 'same_price', `이미 ${c} ${a}이에요`);
  await deactivatePrice(tx, productId, c);
  await insertActivePrice(tx, productId, c, a);
}

/** 켜진 가격을 끈다 (행은 내역으로 남는다). 켜진 가격이 없으면 `409 no_price` */
export async function clearPrice(tx: Tx, productId: string, currency: Currency): Promise<void> {
  const c = checkCurrency(currency);
  if (!isProductId(productId) || !(await lockProduct(tx, productId))) throw noProduct();
  if (!(await deactivatePrice(tx, productId, c))) throw new RuleError(409, 'no_price', `켜진 ${c} 가격이 없어요`);
}

/** 켜진 가격 (주문이 가리킬 가격 행의 id와 금액). 없으면 null */
export async function activePrice(q: Q, productId: string, currency: Currency): Promise<{ id: number; amount: number } | null> {
  if (!isProductId(productId) || !(CURRENCIES as readonly unknown[]).includes(currency)) return null;
  return readActivePrice(q, productId, currency);
}

// ── 스토어 상품 코드 ────────────────────────────────────────────

/** 상품의 스토어 코드를 정한다 (있으면 바꾼다). 그 스토어에서 다른 상품이 쓰는 코드면 `409 sku_taken` */
export async function setSku(tx: Tx, productId: string, store: Store, sku: string): Promise<void> {
  const s = checkStore(store);
  const code = checkSku(sku);
  if (!isProductId(productId) || !(await lockProduct(tx, productId))) throw noProduct();
  const owner = await skuOwner(tx, s, code, productId);
  if (owner) throw new RuleError(409, 'sku_taken', `${s}의 ${code}는 이미 ${owner}가 쓰고 있어요`);
  await upsertSku(tx, productId, s, code);
}

// ── 목록 ────────────────────────────────────────────────────

/** 파는 중(on_sale)인 상품과 켜진 가격 (순서대로). draft·hidden·retired는 빠진다 */
export async function listCatalogProducts(q: Q): Promise<Array<Product & { prices: Array<{ currency: Currency; amount: number }> }>> {
  const list = await readProducts(q, true);
  const prices = await readActivePrices(
    q,
    list.map((p) => p.id),
  );
  return list.map((p) => ({ ...p, prices: prices.filter((x) => x.productId === p.id).map(({ currency, amount }) => ({ currency, amount })) }));
}
