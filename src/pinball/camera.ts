import { TABLE_H, VIEW_H } from './table.ts';

/**
 * 화면 따라가기 — 판(TABLE_H)이 화면(VIEW_H)보다 길어서, 보이는 범위의 위쪽 끝(cam)을 공에 맞춰 움직인다.
 * 그리기와 떼어 낸 순수 함수라 테스트에서 바로 돌린다.
 */

/** cam이 움직일 수 있는 가장 아래 */
const MAX_CAM = TABLE_H - VIEW_H;
/**
 * 공을 화면의 이 높이쯤에 둔다 (화면 위에서부터). 가운데보다 조금 위라서 공 아래쪽이 더 많이 보이고,
 * 공이 판 아래쪽 3분의 1에 있으면 화면이 맨 아래에 붙어 플리퍼가 다 보인다.
 */
const ANCHOR = VIEW_H * 0.38;
/** 아래로 빠르게 내려오는 공은 가는 쪽을 미리 더 보여 준다: 속도에 이 값을 곱한 만큼, 위아래 한계 안에서 */
const LEAD = 0.3;
const LEAD_UP = 140;
const LEAD_DOWN = 330;
/** 1초에 남은 거리의 몇 배로 따라가는지 (클수록 빨리 붙는다) */
const FOLLOW_RATE = 12;
/** 공이 화면 위·아래 끝에서 이만큼 안쪽을 벗어나려 하면 바로 따라붙는다 */
const EDGE_TOP = 60;
const EDGE_BOTTOM = 80;
/** 그림 한 칸(판 좌표 3)에 맞춘다 — 칸 사이에 걸치면 픽셀이 떨려 보인다 */
const CELL = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface CameraBall {
  y: number;
  level: 0 | 1;
  held: number;
  ride: unknown;
}

/**
 * 따라갈 공. 하나면 그 공, 여럿이면 1층에서 굴러다니는 공 중 가장 아래(플리퍼에 가장 가까운) 공.
 * 1층에 공이 없으면 가장 아래 공.
 */
export function focusBall<T extends CameraBall>(balls: T[]): T | null {
  if (balls.length === 0) return null;
  const lowest = (list: T[]) => list.reduce((a, b) => (b.y > a.y ? b : a));
  const onFloor = balls.filter((b) => b.level === 0 && !b.ride);
  return lowest(onFloor.length > 0 ? onFloor : balls);
}

/** 그 공을 볼 때 화면이 가야 할 자리. 공이 없으면 맨 아래(발사대와 플리퍼) */
export function cameraTarget(ball: { y: number; vy: number } | null): number {
  if (!ball) return MAX_CAM;
  return clamp(ball.y - ANCHOR + clamp(ball.vy * LEAD, -LEAD_UP, LEAD_DOWN), 0, MAX_CAM);
}

/** 한 프레임 뒤의 화면 자리. ballY를 주면 공이 화면 밖으로 나가지 않게 따라붙는다 */
export function stepCamera(cam: number, target: number, ballY: number | null, dt: number): number {
  const t = clamp(dt, 0, 0.05);
  let next = cam + (clamp(target, 0, MAX_CAM) - cam) * (1 - Math.exp(-FOLLOW_RATE * t));
  if (ballY !== null) {
    if (ballY > next + VIEW_H - EDGE_BOTTOM) next = ballY - VIEW_H + EDGE_BOTTOM;
    if (ballY < next + EDGE_TOP) next = ballY - EDGE_TOP;
  }
  return clamp(next, 0, MAX_CAM);
}

/** 그릴 때 쓰는 자리 — 그림 칸에 맞춘 값 */
export function snapCamera(cam: number): number {
  return Math.round(cam / CELL) * CELL;
}
