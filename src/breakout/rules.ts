/**
 * 벽돌깨기 규칙 값 — 판 크기, 공·패들·벽돌 치수, 속력, 점수, 코인.
 * 화면과 무관한 순수 값·함수다. 규칙 파일(rules·stages·engine)은 node --test로 바로 돌리므로 import에 .ts 확장자를 붙인다. 한 판 코인 상한은 서버(server/src/domain.ts BOARDS의 breakout)와 같다.
 */

/** 판 크기 (게임 좌표) */
export const FIELD_W = 360;
export const FIELD_H = 600;

export const BALL_R = 6;
export const BALLS_PER_GAME = 3;
/** 멀티볼로 한꺼번에 굴러다닐 수 있는 공 수 */
export const MAX_BALLS = 6;

/** 패들 윗면 높이와 크기 */
export const PADDLE_Y = 549;
export const PADDLE_H = 12;
export const PADDLE_W = 66;
export const PADDLE_WIDE_W = 102;
/** 패들 끝에 맞았을 때 공이 튀는 최대 각도 (세로에서 잰다) */
export const MAX_BOUNCE_ANGLE = Math.PI / 3;
/** 발사할 때 세로에서 흔들리는 각도 */
export const LAUNCH_SPREAD = Math.PI / 12;
/** 공이 너무 눕지 않게 하는 세로 속력 비율 하한 */
export const MIN_VERTICAL = 0.3;

/** 벽돌 칸: 한 줄 10칸, 위에서 BRICK_TOP부터 쌓는다. 화면 한 칸(3)의 배수라 벽돌 사이 틈이 고르게 보인다 */
export const BRICK_COLS = 10;
export const BRICK_W = 30;
export const BRICK_H = 12;
export const BRICK_GAP = 3;
export const BRICK_LEFT = (FIELD_W - (BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP)) / 2;
export const BRICK_TOP = 72;

/** 공 속력 (게임 좌표/초) */
export const SPEED_START = 300;
export const SPEED_PER_STAGE = 12;
export const SPEED_STAGE_CAP = 180;
/** 한 스테이지 안에서 초마다 붙는 속력 */
export const SPEED_RAMP = 3;
export const SPEED_MAX = 540;
export const SLOW_FACTOR = 0.7;

/** 아이템 유지 시간(초) */
export const POWER_TIME = { wide: 12, slow: 10 } as const;
/** 떨어지는 동전·아이템 속력과 크기 */
export const DROP_SPEED = 150;
export const DROP_SIZE = 14;

/** 벽돌 점수: 깨면 normal·tough, 아이템 벽돌은 special, 단단한 벽돌에 금만 가면 toughHit. 동전 벽돌은 보통 벽돌과 같다 */
export const POINTS = { normal: 10, tough: 25, special: 15, toughHit: 5 } as const;
export const CHAIN_STEP = 5;
export const MAX_MULTIPLIER = 5;

/** 동전 하나의 기본 코인 */
export const COIN_VALUE = 5;
/** 한 판에 받을 수 있는 코인 상한 — 서버와 같다 */
export const MAX_COINS_PER_RUN = 400;
/** 한 판 점수 상한 — 서버가 이보다 큰 점수를 거절한다 */
export const MAX_SCORE = 5_000_000;

/** 패들에 닿지 않고 이어서 깬 벽돌 수(이번 벽돌 포함)에 따른 점수 배수 */
export function chainMultiplier(chain: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(chain / CHAIN_STEP));
}

/** 공 속력: 스테이지와 그 스테이지에서 흐른 시간에 따라 빨라진다 */
export function ballSpeed(stage: number, stageTime: number, slow: boolean): number {
  const base = SPEED_START + Math.min(SPEED_STAGE_CAP, SPEED_PER_STAGE * (stage - 1)) + SPEED_RAMP * stageTime;
  return Math.min(SPEED_MAX, base) * (slow ? SLOW_FACTOR : 1);
}

/** 스테이지를 깼을 때 보너스 점수 */
export function stageBonus(stage: number): number {
  return 500 * stage;
}

/**
 * 동전 하나의 코인 (장착 능력 coinValue만큼 더). 소수일 수 있다 —
 * 엔진이 소수점을 모아 두었다가 1이 넘으면 코인으로 준다(작은 능력도 효과가 있게).
 */
export function coinPayout(coinValue: number): number {
  return COIN_VALUE * (1 + coinValue);
}

/** 이 시간(초) 동안 벽돌을 못 맞히면, 패들에서 튈 때 각도를 살짝 흔든다 (같은 길만 오가지 않게) */
export const IDLE_NUDGE_AFTER = 8;
export const NUDGE_MIN = Math.PI / 45;
export const NUDGE_MAX = Math.PI / 15;
