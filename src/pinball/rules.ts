/**
 * 핀볼 규칙의 숫자 — 엔진과 화면이 함께 읽는다.
 * 코인·점수 상한은 서버(server/src/domain.ts)와 같아야 한다 (test/parity.test.ts가 확인한다).
 */

export const BALL_R = 9;
export const BALLS_PER_GAME = 3;
/** 판 위 동전 1개를 주웠을 때 받는 코인 */
export const COIN_PICKUP_VALUE = 5;
/**
 * 판 위에 한꺼번에 놓이는 동전 수와 새 동전이 생기는 간격(초).
 * 예전 판(3개, 3.5초)보다 판이 길어져서, 봇으로 잰 코인 수입이 예전 판과 같아지는 값으로 늘렸다.
 * 판 스킨의 "동전 더 자주" 능력은 이 간격을 줄인다.
 */
export const MAX_COINS_ON_TABLE = 5;
export const COIN_SPAWN_INTERVAL = 2.8;
/** 한 판에 받을 수 있는 코인 상한 — 서버(server/src/domain.ts BOARDS의 pinball.maxCoinsPerRun)와 같다 */
export const MAX_COINS_PER_RUN = 400;
export const MAX_MULTIPLIER = 5;
/** 한 판 점수 상한 — 서버(server/src/domain.ts MAX_SCORE)와 같다. 넘으면 서버가 기록을 받지 않는다 */
export const MAX_SCORE = 5_000_000;
/** 발사 뒤 이 시간 안에 공을 잃으면 한 번 돌려준다 */
export const BALL_SAVE_TIME = 8;

/**
 * 기본 점수 — 보너스 배율과 멀티볼 2배가 곱해진다.
 * 예전 판에도 있던 장치(범퍼부터 콤보까지)는 예전 값 그대로이고, 새 장치의 값은 봇으로 균형을 맞춘 결과다
 * (test/pinball/balance.test.ts).
 */
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
  standup: 500,
  standupBank: 3000,
  /** 스피너가 한 번 돌 때 */
  spinner: 400,
  /** 보너스 구멍의 점수 보상 두 가지 */
  bonusSmall: 5000,
  bonusBig: 10000,
  /** 램프로 2층에 올라갔을 때 (연속으로 올리면 2배, 3배…) */
  ramp: 3000,
  /** 2층 다락: 범퍼, 자동 키커, 타깃, 불 꺼진 구멍, 잭팟 */
  atticBumper: 300,
  kicker: 50,
  atticTarget: 1500,
  atticHole: 3000,
  atticJackpot: 30000,
} as const;

/** 점수 구간 보너스 코인 */
export const MILESTONES = [
  { score: 10000, coins: 10 },
  { score: 30000, coins: 20 },
  { score: 50000, coins: 30 },
] as const;

/**
 * 보너스 구멍이 주는 보상의 차례 — 들어갈 때마다 다음 것을 준다. 무작위가 아니다
 * (등급 신고와 스토어 설문에 "무작위로 아이템이 나오는 뽑기는 없다"고 적었다).
 *   small 5,000점 · coins 코인 10개 · big 10,000점 · save 공 살리기 다시 켜기 · lock 잠금 불 켜기
 */
export const BONUS_ORDER = ['small', 'coins', 'big', 'save', 'lock'] as const;
export type BonusAward = (typeof BONUS_ORDER)[number];
/** 보너스 구멍의 코인 보상 (공 스킨의 코인 능력은 붙지 않는다) */
export const BONUS_COINS = 10;

/** 램프를 이 시간(초) 안에 또 올리면 점수 배수가 하나 오른다 (최대 MAX_RAMP_COMBO배) */
export const RAMP_COMBO_WINDOW = 12;
export const MAX_RAMP_COMBO = 5;
/** 공이 2층에 이 시간(초)보다 오래 있으면 출구로 내보낸다 (끼임 방지) */
export const ATTIC_MAX_STAY = 20;
