import { makeTrack, type Track } from './path.ts';
import { BALL_R } from './rules.ts';

/**
 * 핀볼 판 배치 — 판 크기, 벽, 장치가 놓이는 자리. 물리와 규칙은 engine.ts가 맡는다.
 * 좌표는 판 논리 단위(TABLE_W × TABLE_H)이고 왼쪽 위가 (0, 0)이다.
 *
 * 판은 화면보다 길다. 위에서부터
 *   꼭대기   위쪽 레인 4개
 *   위쪽     범퍼 5개. 왼쪽 벽을 따라 꼭대기로 이어지는 돌아가는 길(입구에 스피너)
 *   가운데   오른쪽 벽 타깃 3개, 보너스 구멍, 왼쪽 드롭 타깃 3개, 오른쪽 잠금 구멍
 *   아래쪽   슬링샷 2개, 플리퍼 2개. 안쪽 길은 플리퍼로, 바깥 길은 판 밖으로 이어진다 (왼쪽에는 킥백)
 * 오른쪽 끝은 판 전체 높이의 발사 레인이다.
 */

export const TABLE_W = 400;
export const TABLE_H = 1300;
/** 화면에 한 번에 보이는 범위 — 화면이 공을 따라 세로로 움직인다 (camera.ts) */
export const VIEW_W = 400;
export const VIEW_H = 700;

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

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const LANE_X = 350;
export const RIGHT_X = 392;
/** 플리퍼 축의 높이 */
export const FLIPPER_Y = 1204;
export const PLUNGER_Y = 1210;
/** 발사대 위에서 기다리는 공의 자리 */
export const REST_X = (LANE_X + RIGHT_X) / 2;
export const REST_Y = PLUNGER_Y - BALL_R - WALL_R;
/** 플리퍼 사이 가운데의 두 배 — 왼쪽 장치를 오른쪽으로 비출 때 쓴다 */
const MIRROR = 360;

/**
 * 발사대: 누르고 있는 동안 스프링이 당겨지고, 떼면 당긴 만큼의 힘으로 발사한다.
 * 레인이 판 전체 높이라서 꼭대기 아치까지 가려면 1,440쯤의 속도가 필요하다.
 *   3분의 1 넘게 당기면   레인을 빠져나간다. 세게 쏠수록 꼭대기에 빠르게 도착해서 더 왼쪽 레인까지 간다
 *   그보다 약하면          짧게 튀었다가 발사대로 돌아온다 (긴 레인을 다 올라갔다 내려오면 3초나 걸려서)
 */
export const CHARGE_TIME = 1.0; // 끝까지 당기는 데 걸리는 시간(초) — 그 뒤로는 최대 힘에 머문다
export const PULL_DISTANCE = 44; // 끝까지 당겼을 때 공이 내려가는 거리
/** 이만큼(0~1) 넘게 당겨야 레인을 빠져나간다 */
export const LAUNCH_EXIT_AT = 1 / 3;
export const LAUNCH_MIN = 1460; // 레인을 빠져나가는 가장 약한 발사 속도
export const LAUNCH_MAX = 1700; // 끝까지 당겼을 때 발사 속도

/** 당긴 정도(0~1)에 따른 발사 속도 */
export function launchSpeed(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  if (p < LAUNCH_EXIT_AT) return 520 + 1500 * p;
  return LAUNCH_MIN + ((LAUNCH_MAX - LAUNCH_MIN) * (p - LAUNCH_EXIT_AT)) / (1 - LAUNCH_EXIT_AT);
}
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
const mirrorXY = ([x, y]: [number, number]): [number, number] => [MIRROR - x, y];

/** 슬링샷 — 왼쪽을 정하고 오른쪽은 비춰서 만든다 */
const LEFT_SLING = { top: { x: 66, y: 1040 }, corner: { x: 66, y: 1108 }, tip: { x: 102, y: 1156 } };
const SLING_TOWARD: Point = { x: MIRROR / 2, y: 980 };

export const SLINGS: SlingShape[] = [
  { side: 'left', ...LEFT_SLING, toward: SLING_TOWARD },
  { side: 'right', top: mirror(LEFT_SLING.top), corner: mirror(LEFT_SLING.corner), tip: mirror(LEFT_SLING.tip), toward: SLING_TOWARD },
];

export const FLIPPERS: FlipperShape[] = [
  { side: 'left', px: 110, py: FLIPPER_Y, len: 58, rest: 0.5, up: -0.45 },
  { side: 'right', px: 250, py: FLIPPER_Y, len: 58, rest: Math.PI - 0.5, up: Math.PI + 0.45 },
];

/** 위쪽 레인의 불과 그 사이 기둥 */
export const LANES: Point[] = [105, 155, 205, 255].map((x) => ({ x, y: 66 }));
export const LANE_POSTS: Wall[] = [80, 130, 180, 230, 280].map((x) => ({ ax: x, ay: 44, bx: x, by: 86, bounce: 0.4 }));

/**
 * 아래쪽 길 (왼쪽 기준, 오른쪽은 대칭).
 * 나눔벽 왼쪽이 바깥 길(판 밖으로 빠짐), 오른쪽이 안쪽 길(경사를 타고 플리퍼로)이다.
 * 지붕 가이드는 벽을 타고 내려온 공을 안쪽 길로 보낸다 — 바깥 길에는 지붕 끝과 나눔벽 꼭대기 사이 틈으로,
 * 옆에서 튕겨 온 공만 들어간다.
 */
const LEFT_DIVIDER: [number, number][] = [
  [36, 1030],
  [36, 1129],
  [104, 1198],
];
const LEFT_ROOF: [number, number][] = [
  [8, 950],
  [34, 990],
];
/** 돌아가는 길 안쪽 벽의 x */
const ORBIT_X = 48;

const RIGHT_ROOF: [number, number][] = [
  [LANE_X, 950],
  [326, 990],
];

export const WALLS: Wall[] = [
  // 바깥 테두리: 왼쪽 → 위 → 오른쪽(발사 레인 바깥벽까지)
  ...polyline(
    [
      [8, TABLE_H],
      [8, 90],
      [22, 50],
      [50, 22],
      [90, 8],
      [310, 8],
      [350, 16],
      [378, 36],
      [RIGHT_X, 64],
      [RIGHT_X, TABLE_H],
    ],
    0.45,
  ),
  // 발사 레인 안쪽 벽
  { ax: LANE_X, ay: TABLE_H, bx: LANE_X, by: 180, bounce: 0.3 },
  // 발사대 바닥 (그림은 스프링으로 따로 그린다)
  { ax: LANE_X, ay: PLUNGER_Y, bx: RIGHT_X, by: PLUNGER_Y, bounce: 0, oneWay: true },
  ...polyline(LEFT_DIVIDER, 0.35),
  ...polyline(LEFT_DIVIDER.map(mirrorXY), 0.35),
  ...polyline(LEFT_ROOF, 0.35),
  ...polyline(RIGHT_ROOF, 0.35),
  // 돌아가는 길의 안쪽 벽 — 왼쪽 바깥벽과 이 벽 사이가 길이다
  { ax: ORBIT_X, ay: 772, bx: ORBIT_X, by: 340, bounce: 0.35 },
  ...LANE_POSTS,
];

/** 공이 레인을 빠져나간 뒤 닫히는 문 — 공이 레인으로 다시 떨어지지 않게 한다 */
export const GATE: Wall = { ax: LANE_X, ay: 180, bx: RIGHT_X, by: 140, bounce: 0.4 };

/** 구멍(세이커): 공을 잠깐 붙잡았다 뱉는다. catchR 안으로 들어온 공을 붙잡는다 */
export type SaucerId = 'lock' | 'bonus';
export interface SaucerDef {
  x: number;
  y: number;
  r: number;
  catchR: number;
}
export const SAUCERS: Record<SaucerId, SaucerDef> = {
  /** 오른쪽 잠금 구멍 — 잠금 불이 켜져 있으면 멀티볼 */
  lock: { x: 322, y: 892, r: 13, catchR: 11 },
  /** 보너스 구멍 — 들어갈 때마다 정해진 차례대로 보상 */
  bonus: { x: 150, y: 726, r: 12, catchR: 10 },
};

/** 스피너 — 돌아가는 길 입구에 가로로 걸린 판. 공이 지나가면 돈다 */
export const SPINNER = { x: 29, y: 744, half: 17 };

export const BUMPERS: { x: number; y: number; r: number }[] = [
  { x: 118, y: 190, r: 22 },
  { x: 196, y: 160, r: 22 },
  { x: 274, y: 196, r: 22 },
  { x: 298, y: 300, r: 20 },
  { x: 262, y: 400, r: 20 },
];

/** 드롭 타깃 — 왼쪽 벽 앞의 세로 막대 */
export const DROP_TARGETS: { x: number; y1: number; y2: number }[] = [
  { x: 24, y1: 862, y2: 886 },
  { x: 24, y1: 892, y2: 916 },
  { x: 24, y1: 922, y2: 946 },
];

/** 오른쪽 타깃 — 발사 레인 벽에 붙은 세로 막대. 쓰러지지 않고 불만 켜진다 */
export const STANDUPS: { x: number; y1: number; y2: number }[] = [
  { x: 344, y1: 470, y2: 494 },
  { x: 344, y1: 500, y2: 524 },
  { x: 344, y1: 530, y2: 554 },
];

/** 공이 물리 대신 정해진 길을 따라가는 곳 */
export interface RideDef {
  track: Track;
  /** 타기 시작할 때의 속도, 가장 느린·빠른 속도 */
  startSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  /** 아래로 향할수록 빨라지는 정도 (길 방향의 세로 성분에 곱한다) */
  accel: number;
  /** 길 끝에서 공을 놓아줄 때의 속도 */
  release: { vx: number; vy: number };
}

/**
 * 킥백 — 왼쪽 바깥 길 바닥에 닿은 공을 한 번 살려 준다.
 * 바깥 길을 거슬러 올라가 지붕 가이드와 나눔벽 사이 틈으로 나온 뒤, 왼쪽 슬링샷 위에서 놓아준다.
 */
export const KICKBACK = {
  /** 이 안에 공이 들어오면 킥백이 반응한다 (바깥 길 바닥) */
  sensor: { x: 10, y: 1196, w: 26, h: TABLE_H - 1196 } as Zone,
  /** 킥백 머리(그림) */
  head: { x: 22, y: 1212 } as Point,
  ride: {
    track: makeTrack([
      { x: 22, y: 1202 },
      { x: 22, y: 1045 },
      { x: 36, y: 1010 },
      { x: 58, y: 985 },
    ]),
    startSpeed: 900,
    minSpeed: 900,
    maxSpeed: 900,
    accel: 0,
    release: { vx: 240, vy: -420 },
  } satisfies RideDef,
};

/** 바닥 표시등: 보너스 배율 ×2~×5, 공 살리기 */
export const MULT_INSERTS: Point[] = [128, 161, 194, 227].map((x) => ({ x, y: 1000 }));
export const SAVE_INSERT: Point = { x: 180, y: 1268 };

/** 판 위 동전이 생기는 빈 자리 (1층의 열린 곳만) */
export const COIN_ZONES: Zone[] = [
  { x: 70, y: 110, w: 260, h: 200 },
  { x: 235, y: 440, w: 95, h: 400 },
  { x: 70, y: 840, w: 230, h: 130 },
  { x: 70, y: 650, w: 110, h: 140 },
];
