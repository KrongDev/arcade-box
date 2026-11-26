import { defineConfig } from 'drizzle-kit';

/** 마이그레이션 SQL 만들기 전용 (`npm run db:generate`). DB에 붙지 않는다 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['app'],
});
