import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Q, Tx } from '../shared/db/index.ts';
import type { Currency, Product, Store } from './rules.ts';
import { productPrices, products, storeSkus } from './schema.ts';

const productColumns = {
  id: products.id,
  kind: products.kind,
  name: products.name,
  description: products.description,
  iconPath: products.iconPath,
  gameId: products.gameId,
  slot: products.slot,
  access: products.access,
  status: products.status,
  consumable: products.consumable,
  grantCoins: products.grantCoins,
  sortOrder: products.sortOrder,
};

export async function readProduct(q: Q, id: string): Promise<Product | null> {
  const [row] = await q.select(productColumns).from(products).where(eq(products.id, id));
  return row ?? null;
}

/**
 * 상품 행을 잠그고 읽는다 (고치기·가격 바꾸기가 한 상품에서 한 번에 하나씩 돈다).
 * `FOR NO KEY UPDATE`라서 이 상품을 외래 키로 가리키는 행을 넣는 요청(지급, 장착)은 기다리지 않는다.
 */
export async function lockProduct(tx: Tx, id: string): Promise<Product | null> {
  const [row] = await tx.select(productColumns).from(products).where(eq(products.id, id)).for('no key update');
  return row ?? null;
}

export async function readGameProduct(q: Q, gameId: string): Promise<Product | null> {
  const [row] = await q
    .select(productColumns)
    .from(products)
    .where(and(eq(products.gameId, gameId), eq(products.kind, 'game')));
  return row ?? null;
}

export async function readProducts(q: Q, onSaleOnly: boolean): Promise<Product[]> {
  return q
    .select(productColumns)
    .from(products)
    .where(onSaleOnly ? eq(products.status, 'on_sale') : undefined)
    .orderBy(asc(products.sortOrder), asc(products.id));
}

/** 새 상품. 같은 ID나 같은 게임의 game 상품이 이미 있으면(유일 제약) 넣지 않고 거짓 */
export async function insertProduct(tx: Tx, row: Product): Promise<boolean> {
  const created = await tx.insert(products).values(row).onConflictDoNothing().returning({ id: products.id });
  return created.length > 0;
}

export async function writeProduct(tx: Tx, row: Product): Promise<void> {
  const { id, ...rest } = row;
  await tx
    .update(products)
    .set({ ...rest, updatedAt: sql`now()` })
    .where(eq(products.id, id));
}

// ── 가격 ────────────────────────────────────────────────────

export async function readActivePrice(q: Q, productId: string, currency: Currency): Promise<{ id: number; amount: number } | null> {
  const [row] = await q
    .select({ id: productPrices.id, amount: productPrices.amount })
    .from(productPrices)
    .where(and(eq(productPrices.productId, productId), eq(productPrices.currency, currency), eq(productPrices.active, true)));
  return row ?? null;
}

/** 켜진 가격을 끈다. 끈 것이 있었으면 참 */
export async function deactivatePrice(tx: Tx, productId: string, currency: Currency): Promise<boolean> {
  const off = await tx
    .update(productPrices)
    .set({ active: false })
    .where(and(eq(productPrices.productId, productId), eq(productPrices.currency, currency), eq(productPrices.active, true)))
    .returning({ id: productPrices.id });
  return off.length > 0;
}

export async function insertActivePrice(tx: Tx, productId: string, currency: Currency, amount: number): Promise<void> {
  await tx.insert(productPrices).values({ productId, currency, amount, active: true });
}

/** 상품들의 켜진 가격 (화폐 순서) */
export async function readActivePrices(q: Q, productIds: string[]): Promise<Array<{ productId: string; currency: Currency; amount: number }>> {
  if (productIds.length === 0) return [];
  return q
    .select({ productId: productPrices.productId, currency: productPrices.currency, amount: productPrices.amount })
    .from(productPrices)
    .where(and(inArray(productPrices.productId, productIds), eq(productPrices.active, true)))
    .orderBy(asc(productPrices.currency));
}

/** 한 상품의 가격 내역 (최신부터, 명령줄 `product show`) */
export async function readPriceHistory(q: Q, productId: string) {
  return q
    .select({ currency: productPrices.currency, amount: productPrices.amount, active: productPrices.active, createdAt: productPrices.createdAt })
    .from(productPrices)
    .where(eq(productPrices.productId, productId))
    .orderBy(desc(productPrices.id));
}

// ── 스토어 상품 코드 ────────────────────────────────────────────

/** 이 스토어에서 이 코드를 쓰는 다른 상품 */
export async function skuOwner(q: Q, store: Store, sku: string, exceptProductId: string): Promise<string | null> {
  const [row] = await q
    .select({ productId: storeSkus.productId })
    .from(storeSkus)
    .where(and(eq(storeSkus.store, store), eq(storeSkus.sku, sku), ne(storeSkus.productId, exceptProductId)));
  return row?.productId ?? null;
}

/** 상품·스토어의 코드를 정한다 (있으면 바꾼다) */
export async function upsertSku(tx: Tx, productId: string, store: Store, sku: string): Promise<void> {
  await tx
    .insert(storeSkus)
    .values({ productId, store, sku })
    .onConflictDoUpdate({ target: [storeSkus.productId, storeSkus.store], set: { sku } });
}

export async function readSkus(q: Q, productId: string): Promise<Array<{ store: Store; sku: string }>> {
  return q.select({ store: storeSkus.store, sku: storeSkus.sku }).from(storeSkus).where(eq(storeSkus.productId, productId)).orderBy(asc(storeSkus.store));
}
