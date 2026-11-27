/**
 * view — 여러 도메인을 모아 한 번에 내려 주는 읽기 전용 응답(`/v2/catalog`, `/v2/me`)과 사용자를 들여다보는 명령 (스펙 5.14).
 * 모든 도메인의 index.ts를 읽기만 한다. 무엇도 바꾸지 않는다.
 */
export { commands } from './commands.ts';
export { routes, type ViewDeps } from './routes.ts';
export { catalog, me, type Catalog, type CatalogGame, type CatalogProduct, type Me } from './service.ts';
