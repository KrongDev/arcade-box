import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * v2의 모든 테이블이 들어가는 PostgreSQL 스키마. 도메인의 `schema.ts`가 `app.table(…)`로 테이블을 만든다.
 * v1 테이블이 있는 `public`은 쓰지 않는다.
 */
export const app = pgSchema('app');
