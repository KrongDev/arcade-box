/**
 * reward — 출석과 광고 보상 (스펙 5.9). 하루 한도는 한국 날짜로 세고 코인은 통일 지갑으로 간다.
 * 다른 도메인은 이 파일로만 가져온다 (테이블에 외래 키를 걸 때만 `schema.ts`).
 */
export { routes, type RewardDeps } from './routes.ts';
export type { RewardKind } from './schema.ts';
export { claimAdReward, claimAttendance, purgeUser, rewardStatus } from './service.ts';
