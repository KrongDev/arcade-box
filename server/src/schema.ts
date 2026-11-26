/**
 * 모든 도메인의 테이블을 모은 것. drizzle-kit이 이 파일을 읽어 마이그레이션을 만든다 (`npm run db:generate`).
 * 도메인에 `schema.ts`가 생기면 여기에 한 줄을 더한다.
 */
export { app } from './shared/db/schema.ts';
export * from './admin/schema.ts';
export * from './account/schema.ts';
export * from './wallet/schema.ts';
export * from './game/schema.ts';
export * from './product/schema.ts';
