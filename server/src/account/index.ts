/**
 * account — 사용자, 로그인 수단, 세션, 계정 연결과 충돌 정리, 로그아웃, 계정 삭제, 설정 (스펙 5.4).
 * 다른 도메인은 이 파일로만 가져온다 (테이블에 외래 키를 걸 때만 `schema.ts`).
 */
export { deleteAccount, type DeletionPolicy } from './deletion.ts';
export { issueNonce, linkIdentity, resolveLink, type Summarize } from './link.ts';
export { routes, type AccountDeps } from './routes.ts';
export type { AccountProvider, Provider, Settings } from './rules.ts';
export { findSession, findUserByIdentity, getSettings, getUser, listProviders, logout, registerOrLoginGuest, requireActiveUser, updateSettings } from './service.ts';
export { devVerifier, googleVerifier, type IdTokenVerifier, type JWKSource } from './verify.ts';
