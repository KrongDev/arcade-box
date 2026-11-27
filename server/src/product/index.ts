/**
 * product — 상품, 가격(바뀐 내역), 스토어 상품 코드 (스펙 5.2, 5.6).
 * 다른 도메인은 이 파일로만 가져온다 (테이블에 외래 키를 걸 때만 `schema.ts`).
 */
export { commands, type ProductEnv } from './commands.ts';
export { checkProductShape, isProductId, type Currency, type Product, type ProductAccess, type ProductKind, type ProductStatus, type Store } from './rules.ts';
export {
  activePrice,
  clearPrice,
  createProduct,
  gameProduct,
  getProduct,
  listCatalogProducts,
  setPrice,
  setSku,
  updateProduct,
  type NewProduct,
  type ProductPatch,
} from './service.ts';
