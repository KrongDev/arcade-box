import { BALL_R } from './rules.ts';

/**
 * 핀볼 판 배치 — 판 크기, 벽, 장치가 놓이는 자리. 물리와 규칙은 engine.ts가 맡는다.
 * 좌표는 판 논리 단위(TABLE_W × TABLE_H)이고 왼쪽 위가 (0, 0)이다.
 */

export const TABLE_W = 400;
export const TABLE_H = 700;

/** 벽의 두께(반지름) — 벽은 두께 있는 선분(캡슐)이다 */
export const WALL_R = 2;

export interface Point {
  x: number;
  y: number;
}

export interface Wall {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  bounce: number;
  /** 아래로 떨어지는 공만 막는다 (발사대 바닥: 당겼다 놓은 공은 위로 통과) */
  oneWay?: boolean;
}

/** 슬링샷 모양. 세 꼭짓점 중 top–corner, corner–tip은 그냥 벽이고 tip–top 면이 공을 차는 면이다 */
export interface SlingShape {
  side: 'left' | 'right';
  top: Point;
  corner: Point;
  tip: Point;
  /** 차는 면이 바라보는 쪽에 있는 한 점 (판 안쪽) */
  toward: Point;
}

export interface FlipperShape {
  side: 'left' | 'right';
  px: number;
  py: number;
  len: number;
  /** 쉬는 각과 올린 각 (라디안) */
  rest: number;
  up: number;
}

export const LANE_X = 350;
export const RIGHT_X = 392;
export const PLUNGER_Y = 610;
/** 발사대 위에서 기다리는 공의 자리 */
export const REST_X = (LANE_X + RIGHT_X) / 2;
export const REST_Y = PLUNGER_Y - BALL_R - WALL_R;
/** 플리퍼 사이 가운데의 두 배 — 왼쪽 장치를 오른쪽으로 비출 때 쓴다 */
const MIRROR = 360;

/** 발사대: 누르고 있는 동안 스프링이 당겨지고, 떼면 당긴 만큼의 힘으로 발사한다 */
export const CHARGE_TIME = 1.0; // 끝까지 당기는 데 걸리는 시간(초) — 그 뒤로는 최대 힘에 머문다
export const PULL_DISTANCE = 44; // 끝까지 당겼을 때 공이 내려가는 거리
export const LAUNCH_MIN = 600; // 살짝 눌렀을 때 발사 속도
export const LAUNCH_MAX = 1300; // 끝까지 당겼을 때 발사 속도
export const PLUNGER_TOP = PLUNGER_Y;

function polyline(points: [number, number][], bounce: number): Wall[] {
  const walls: Wall[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    walls.push({ ax, ay, bx, by, bounce });
  }
  return walls;
}

const mirror = (p: Point): Point => ({ x: MIRROR - p.x, y: p.y });

/** 슬링샷 — 왼쪽을 정하고 오른쪽은 비춰서 만든다 */
const LEFT_SLING = { top: { x: 56, y: 440 }, corner: { x: 56, y: 508 }, tip: { x: 102, y: 556 } };
const SLING_TOWARD: Point = { x: MIRROR / 2, y: 380 };

export const SLINGS: SlingShape[] = [
  { side: 'left', ...LEFT_SLING, toward: SLING_TOWARD },
  { side: 'right', top: mirror(LEFT_SLING.top), corner: mirror(LEFT_SLING.corner), tip: mirror(LEFT_SLING.tip), toward: SLING_TOWARD },
];

/** 위쪽 레인 사이 기둥 */
export const LANE_POSTS: Wall[] = [110, 160, 210, 260].map((x) => ({ ax: x, ay: 44, bx: x, by: 86, bounce: 0.4 }));

export const WALLS: Wall[] = [
  // 바깥 테두리: 왼쪽 → 위 → 오른쪽(발사 레인 바깥벽까지)
  ...polyline(
    [
      [8, 700],
      [8, 90],
      [22, 50],
      [50, 22],
      [90, 8],
      [310, 8],
      [350, 16],
      [378, 36],
      [RIGHT_X, 64],
      [RIGHT_X, 700],
    ],
    0.45,
  ),
  // 발사 레인 안쪽 벽
  { ax: LANE_X, ay: 700, bx: LANE_X, by: 180, bounce: 0.3 },
  // 발사대 바닥 (그림은 스프링으로 따로 그린다)
  { ax: LANE_X, ay: PLUNGER_Y, bx: RIGHT_X, by: PLUNGER_Y, bounce: 0, oneWay: true },
  // 플리퍼로 모아 주는 아래쪽 경사
  { ax: 8, ay: 500, bx: 104, by: 598, bounce: 0.35 },
  { ax: LANE_X, ay: 500, bx: 256, by: 598, bounce: 0.35 },
  ...LANE_POSTS,
];

/** 공이 레인을 빠져나간 뒤 닫히는 문 — 공이 레인으로 다시 떨어지지 않게 한다 */
export const GATE: Wall = { ax: LANE_X, ay: 180, bx: RIGHT_X, by: 140, bounce: 0.4 };

/** 오른쪽 구멍(세이커) */
export const SAUCER = { x: 322, y: 292, r: 13 };

export const BUMPERS: { x: number; y: number; r: number }[] = [
  { x: 135, y: 170, r: 22 },
  { x: 235, y: 170, r: 22 },
  { x: 185, y: 245, r: 22 },
];

/** 드롭 타깃 — 왼쪽 벽 앞의 세로 막대 */
export const DROP_TARGETS: { x: number; y1: number; y2: number }[] = [
  { x: 24, y1: 262, y2: 286 },
  { x: 24, y1: 292, y2: 316 },
  { x: 24, y1: 322, y2: 346 },
];

/** 위쪽 레인의 불 */
export const LANES: Point[] = [135, 185, 235].map((x) => ({ x, y: 66 }));

export const FLIPPERS: FlipperShape[] = [
  { side: 'left', px: 110, py: 604, len: 58, rest: 0.5, up: -0.45 },
  { side: 'right', px: 250, py: 604, len: 58, rest: Math.PI - 0.5, up: Math.PI + 0.45 },
];
