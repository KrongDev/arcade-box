/**
 * 핀볼 규칙의 숫자 — 엔진과 화면이 함께 읽는다.
 * 코인·점수 상한은 서버(server/src/domain.ts)와 같아야 한다 (test/parity.test.ts가 확인한다).
 */

export const BALL_R = 9;
export const BALLS_PER_GAME = 3;
/** 판 위 동전 1개를 주웠을 때 받는 코인 */
export const COIN_PICKUP_VALUE = 5;
/** 한 판에 받을 수 있는 코인 상한 — 서버(server/src/domain.ts BOARDS의 pinball.maxCoinsPerRun)와 같다 */
export const MAX_COINS_PER_RUN = 400;
export const MAX_MULTIPLIER = 5;
/** 한 판 점수 상한 — 서버(server/src/domain.ts MAX_SCORE)와 같다. 넘으면 서버가 기록을 받지 않는다 */
export const MAX_SCORE = 5_000_000;
/** 발사 뒤 이 시간 안에 공을 잃으면 한 번 돌려준다 */
export const BALL_SAVE_TIME = 8;

/** 기본 점수 — 보너스 배율과 멀티볼 2배가 곱해진다 */
export const POINTS = {
  bumper: 100,
  sling: 30,
  target: 500,
  bank: 5000,
  rollover: 300,
  lanes: 3000,
  saucer: 2000,
  jackpot: 20000,
  coin: 500,
  comboPerHit: 100,
  /** 오른쪽 타깃 하나, 셋을 다 맞혔을 때 */
  standup: 300,
  standupBank: 2000,
} as const;

/** 점수 구간 보너스 코인 */
export const MILESTONES = [
  { score: 10000, coins: 10 },
  { score: 30000, coins: 20 },
  { score: 50000, coins: 30 },
] as const;
