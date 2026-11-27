import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { games } from '../game/schema.ts';
import { app } from '../shared/db/schema.ts';
import { CURRENCIES, PRODUCT_ACCESS, PRODUCT_KINDS, PRODUCT_STATUSES, STORES } from './rules.ts';

const at = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const coins = (name: string) => bigint(name, { mode: 'number' });

/**
 * 상품 (스펙 5.2 "상품과 보유"). 종류별 규칙은 `products_kind_check` 하나에 모았다 — 규칙 함수 `checkProductShape`와 같은 규칙이다.
 * 게임 하나에 game 상품은 하나다 (`products_one_game_product`).
 */
export const products = app.table(
  'products',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: PRODUCT_KINDS }).notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    iconPath: text('icon_path'),
    gameId: text('game_id').references(() => games.id),
    slot: text('slot'),
    access: text('access', { enum: PRODUCT_ACCESS }).notNull(),
    status: text('status', { enum: PRODUCT_STATUSES }).notNull().default('draft'),
    consumable: boolean('consumable').notNull().default(false),
    grantCoins: coins('grant_coins'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('products_id_check', sql`${t.id} ~ '^[a-z][a-z0-9.-]{1,63}$'`),
    check(
      'products_kind_check',
      sql`(${t.kind} = 'game' and ${t.gameId} is not null and ${t.slot} is null and not ${t.consumable} and ${t.grantCoins} is null)
       or (${t.kind} = 'item' and ${t.gameId} is not null and ${t.slot} is not null and not ${t.consumable} and ${t.grantCoins} is null)
       or (${t.kind} = 'coin_pack' and ${t.gameId} is null and ${t.slot} is null and ${t.consumable} and ${t.grantCoins} is not null and ${t.grantCoins} > 0)`,
    ),
    check('products_access_check', sql`${t.access} in (${inList(PRODUCT_ACCESS)})`),
    check('products_status_check', sql`${t.status} in (${inList(PRODUCT_STATUSES)})`),
    uniqueIndex('products_one_game_product').on(t.gameId).where(sql`${t.kind} = 'game'`),
  ],
);

/**
 * 가격. 바꿀 때는 옛 행의 `active`를 끄고 새 행을 넣는다 — 가격이 바뀐 내역이 남는다.
 * 켜진 가격은 상품·화폐마다 하나다 (`product_prices_one_active`).
 */
export const productPrices = app.table(
  'product_prices',
  {
    id: coins('id').primaryKey().generatedAlwaysAsIdentity(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    currency: text('currency', { enum: CURRENCIES }).notNull(),
    amount: coins('amount').notNull(),
    active: boolean('active').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('product_prices_amount_check', sql`${t.amount} >= 0`),
    check('product_prices_currency_check', sql`${t.currency} in (${inList(CURRENCIES)})`),
    uniqueIndex('product_prices_one_active').on(t.productId, t.currency).where(sql`${t.active}`),
    index('product_prices_product_id_idx').on(t.productId),
  ],
);

/** 스토어 상품 코드. 스토어마다 다르다. 한 스토어의 한 코드는 한 상품, 한 상품의 한 스토어 코드는 하나다 */
export const storeSkus = app.table(
  'store_skus',
  {
    id: coins('id').primaryKey().generatedAlwaysAsIdentity(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    store: text('store', { enum: STORES }).notNull(),
    sku: text('sku').notNull(),
  },
  (t) => [
    check('store_skus_store_check', sql`${t.store} in (${inList(STORES)})`),
    uniqueIndex('store_skus_store_sku').on(t.store, t.sku),
    uniqueIndex('store_skus_product_id_store').on(t.productId, t.store),
  ],
);
