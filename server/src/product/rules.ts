import { RuleError } from '../shared/errors.ts';

/** 상품 종류 (스펙 5.2): 게임을 할 수 있게 하는 것, 꾸미는 아이템, 코인 묶음(2차) */
export const PRODUCT_KINDS = ['game', 'item', 'coin_pack'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** 누가 가질 수 있나: 모두(보유 행 없음) · 사거나 받은 사람 */
export const PRODUCT_ACCESS = ['everyone', 'purchase'] as const;
export type ProductAccess = (typeof PRODUCT_ACCESS)[number];

/** 상품의 상태. 게임의 상태와 낱말이 겹치지만 따로 바뀌는 다른 것이다 (스펙 5.15) */
export const PRODUCT_STATUSES = ['draft', 'on_sale', 'hidden', 'retired'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const CURRENCIES = ['COIN', 'KRW'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const STORES = ['google_play', 'app_store'] as const;
export type Store = (typeof STORES)[number];

export interface Product {
  id: string;
  kind: ProductKind;
  name: string;
  description: string;
  iconPath: string | null;
  gameId: string | null;
  slot: string | null;
  access: ProductAccess;
  status: ProductStatus;
  consumable: boolean;
  grantCoins: number | null;
  sortOrder: number;
}

/** 상품 ID: 영문 소문자로 시작하는 소문자·숫자·`.`·`-` 2~64자 (예: 'game.minesweeper', 'pinball.table.neon') */
export const PRODUCT_ID = /^[a-z][a-z0-9.-]{1,63}$/;
/** 아이템의 자리: 영문 소문자로 시작하는 소문자·숫자·`-` 1~32자 (예: 'table', 'ball'). 서버는 뜻을 모른다 */
export const SLOT = /^[a-z][a-z0-9-]{0,31}$/;
const GAME_ID = /^[a-z][a-z0-9-]{1,31}$/;
const ICON_NAME = /^[0-9a-f]{64}\.(png|webp)$/;

export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 1000;
export const SORT_MAX = 1_000_000;
/** 가격·코인 묶음의 코인 수 상한 (지갑 상한과 같은 크기) */
export const AMOUNT_MAX = 9_000_000_000_000_000;

const invalid = (name: string, message: string) => new RuleError(400, `invalid_${name}`, message);
const shape = (message: string) => new RuleError(400, 'invalid_product_shape', message);

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);

export function isProductId(v: unknown): v is string {
  return typeof v === 'string' && PRODUCT_ID.test(v);
}

export function checkProductId(v: unknown): string {
  if (!isProductId(v)) throw invalid('product_id', '상품 ID는 영문 소문자로 시작하는 소문자·숫자·.·- 2~64자예요 (예: pinball.table.neon)');
  return v;
}

export function checkCurrency(v: unknown): Currency {
  if (!oneOf(CURRENCIES, v)) throw invalid('currency', `화폐는 ${CURRENCIES.join(', ')} 가운데 하나예요`);
  return v;
}

export function checkAmount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > AMOUNT_MAX) throw invalid('amount', '금액은 0 이상의 정수예요');
  return v;
}

export function checkStore(v: unknown): Store {
  if (!oneOf(STORES, v)) throw invalid('store', `스토어는 ${STORES.join(', ')} 가운데 하나예요`);
  return v;
}

/** 스토어 상품 코드: 영문·숫자·`.`·`_`·`-` 1~100자 (구글 플레이와 앱 스토어가 받는 글자) */
export function checkSku(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(v)) throw invalid('sku', '스토어 상품 코드는 영문·숫자·.·_·- 1~100자예요');
  return v;
}

/**
 * 설명: 0~1000자. 여러 줄일 수 있어서 줄바꿈(LF)만 받고 그 밖의 제어 문자는 받지 않는다.
 * (게임의 설명도 같은 규칙이지만 게임과 상품은 따로 바뀌는 것이라 같은 함수를 나눠 쓰지 않는다 — 스펙 5.15)
 */
export function checkDescription(v: unknown): string {
  if (typeof v !== 'string' || v.length > DESCRIPTION_MAX || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(v)) {
    throw invalid('description', `설명은 ${DESCRIPTION_MAX}자까지이고, 줄바꿈 말고 다른 제어 문자는 넣을 수 없어요`);
  }
  return v;
}

export function checkName(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(v)) {
    throw invalid('name', `이름은 한 줄로 1~${NAME_MAX}자예요`);
  }
  return v;
}

export function checkKind(v: unknown): ProductKind {
  if (!oneOf(PRODUCT_KINDS, v)) throw invalid('kind', `종류는 ${PRODUCT_KINDS.join(', ')} 가운데 하나예요`);
  return v;
}

export function checkAccess(v: unknown): ProductAccess {
  if (!oneOf(PRODUCT_ACCESS, v)) throw invalid('access', `access는 ${PRODUCT_ACCESS.join(', ')} 가운데 하나예요`);
  return v;
}

export function checkStatus(v: unknown): ProductStatus {
  if (!oneOf(PRODUCT_STATUSES, v)) throw invalid('status', `상품 상태는 ${PRODUCT_STATUSES.join(', ')} 가운데 하나예요`);
  return v;
}

export function checkSortOrder(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > SORT_MAX) throw invalid('sort_order', `순서는 0~${SORT_MAX}의 정수예요`);
  return v;
}

export function checkIconPath(v: unknown): string | null {
  if (v !== null && (typeof v !== 'string' || !ICON_NAME.test(v))) throw invalid('icon', '아이콘 이름이 올바르지 않아요');
  return v;
}

export function checkSlot(v: unknown): string | null {
  if (v !== null && (typeof v !== 'string' || !SLOT.test(v))) throw invalid('slot', '자리는 영문 소문자로 시작하는 소문자·숫자·- 1~32자예요 (예: table)');
  return v;
}

export function checkGameRef(v: unknown): string | null {
  if (v !== null && (typeof v !== 'string' || !GAME_ID.test(v))) throw invalid('game_id', '게임 ID 모양이 아니에요');
  return v;
}

/** 코인 묶음이 주는 코인 수: 1 이상의 정수 (0·음수·소수는 모양 오류) */
export function checkGrantCoins(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0 || v > AMOUNT_MAX) throw shape('주는 코인(grant_coins)은 0보다 큰 정수예요');
  return v;
}

/**
 * 상품 한 줄이 규칙에 맞는지 본다 (순수, 스펙 5.2). 같은 규칙이 DB의 `products_kind_check`에도 있다.
 *
 * - `game`: `game_id`가 꼭 있고 `slot`이 없다
 * - `item`: `game_id`와 `slot`이 꼭 있다
 * - `coin_pack`: `consumable`이 참이고 `grant_coins`가 0보다 크다. 게임과 자리는 없다
 * - `consumable`과 `grant_coins`는 코인 묶음만 가진다 (보유로 남는 게임·아이템은 소모되지 않는다)
 */
export function checkProductShape(p: Product): void {
  checkProductId(p.id);
  checkKind(p.kind);
  checkName(p.name);
  checkDescription(p.description);
  checkIconPath(p.iconPath);
  checkGameRef(p.gameId);
  checkSlot(p.slot);
  checkAccess(p.access);
  checkStatus(p.status);
  if (typeof p.consumable !== 'boolean') throw shape('consumable은 참이나 거짓이에요');
  checkSortOrder(p.sortOrder);

  if (p.kind === 'game') {
    if (p.gameId === null || p.slot !== null) throw shape('game 상품은 게임(--game)이 꼭 있고 자리(--slot)가 없어야 해요');
  } else if (p.kind === 'item') {
    if (p.gameId === null || p.slot === null) throw shape('item 상품은 게임(--game)과 자리(--slot)가 꼭 있어야 해요');
  } else {
    if (p.gameId !== null || p.slot !== null) throw shape('coin_pack 상품은 게임과 자리가 없어요');
    if (!p.consumable) throw shape('coin_pack 상품은 consumable이 참이어야 해요');
    if (checkGrantCoins(p.grantCoins) === null) throw shape('coin_pack 상품은 주는 코인(--grant-coins)이 0보다 큰 정수여야 해요');
    return;
  }
  if (p.consumable) throw shape(`${p.kind} 상품은 consumable일 수 없어요`);
  if (p.grantCoins !== null) throw shape(`${p.kind} 상품은 주는 코인(grant_coins)이 없어요`);
}
