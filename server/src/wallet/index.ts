/**
 * wallet — 지갑과 코인 기록. 코인이 변하는 유일한 길(`applyCoins`)이 여기 있다 (스펙 5.5).
 * 다른 도메인은 이 파일로만 가져온다 (테이블에 외래 키를 걸 때만 `schema.ts`).
 */
export { commands } from './commands.ts';
export { routes, type WalletDeps } from './routes.ts';
export { MAX_BALANCE, type LedgerReason } from './rules.ts';
export { applyCoins, getBalance, hasLedgerKey, listLedger, lockWallet, purgeUser, verifyWallets, type LedgerEntry } from './service.ts';
