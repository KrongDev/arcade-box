/**
 * entitlement — 보유, 지급과 회수, 장착 (스펙 5.6, 5.10).
 * 다른 도메인은 이 파일로만 가져온다 (테이블에 외래 키를 걸 때만 `schema.ts`).
 */
export { commands } from './commands.ts';
export { routes, type EntitlementDeps } from './routes.ts';
export type { EntitlementSource, RevokeReason } from './schema.ts';
export { activeEntitlementId, canPlayGame, countOwnedGames, equip, grant, listEquipped, listOwned, owns, purgeUser, revoke } from './service.ts';
