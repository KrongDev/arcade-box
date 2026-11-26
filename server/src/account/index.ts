/**
 * account — 사용자, 로그인 수단, 세션, 설정 (스펙 5.4).
 * 다른 도메인은 이 파일로만 가져온다 (테이블에 외래 키를 걸 때만 `schema.ts`).
 */
export { routes, type AccountDeps } from './routes.ts';
export type { Provider, Settings } from './rules.ts';
export { findSession, getSettings, listProviders, registerOrLoginGuest, updateSettings } from './service.ts';
