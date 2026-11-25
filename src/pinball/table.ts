import { makeTrack, type Track } from './path.ts';
import { BALL_R } from './rules.ts';

/**
 * 핀볼 판 배치 — 판 크기, 벽, 장치가 놓이는 자리. 물리와 규칙은 engine.ts가 맡는다.
 * 좌표는 판 논리 단위(TABLE_W × TABLE_H)이고 왼쪽 위가 (0, 0)이다.
 *
 * 판은 화면보다 길다. 위에서부터
 *   꼭대기   위쪽 레인 4개
 *   위쪽     범퍼 5개. 왼쪽 벽을 따라 꼭대기로 이어지는 돌아가는 길(입구에 스피너)
 *   2층 다락 왼쪽 위에 떠 있는 방. 램프로 올라가고, 출구에서 레일을 타고 왼쪽 플리퍼로 내려온다.
 *            타깃 3개, 잭팟 구멍, 범퍼 3개, 자동 키커
 *   가운데   램프, 오른쪽 벽 타깃 3개, 보너스 구멍, 왼쪽 드롭 타깃 3개, 오른쪽 잠금 구멍
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
  /** 2층 다락의 테두리나 램프 난간 — 그릴 때 바닥 벽이 아니라 위층 그림으로 그린다 */
  upper?: boolean;
}

/** 슬링샷 모양. 세 꼭짓점 중 top–corner, corner–tip은 그냥 벽이고 tip–top 면이 공을 차는 면이다 */
export interface SlingShape {
  side: 'left' | 'right';
  top: Point;
  corner: Point;
  tip: Point;
  /** 차는 면이 바라보는 쪽에 있는 한 점 (판 안쪽) */
  toward: Point;
  /** 2층 다락의 자동 키커 */
  kicker?: boolean;
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
const pt = ([x, y]: [number, number]): Point => ({ x, y });

/** 점이 다각형 안에 있는지 */
export function inPolygon(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const mirrorXY = ([x, y]: [number, number]): [number, number] => [MIRROR - x, y];

/** 돌아가는 길 안쪽 벽의 x — 2층 다락의 왼쪽 테두리와 같은 줄 */
const ORBIT_X = 48;

/** 슬링샷 — 왼쪽을 정하고 오른쪽은 비춰서 만든다 */
const LEFT_SLING = { top: { x: 66, y: 1040 }, corner: { x: 66, y: 1108 }, tip: { x: 102, y: 1156 } };
const SLING_TOWARD: Point = { x: MIRROR / 2, y: 980 };

export const SLINGS: SlingShape[] = [
  { side: 'left', ...LEFT_SLING, toward: SLING_TOWARD },
  { side: 'right', top: mirror(LEFT_SLING.top), corner: mirror(LEFT_SLING.corner), tip: mirror(LEFT_SLING.tip), toward: SLING_TOWARD },
  // 2층 다락의 자동 키커: 왼쪽 아래 모서리에 딱 붙어 있다. 공이 닿으면 다락 안쪽으로 차 올린다
  { side: 'left', top: { x: 52, y: 532 }, corner: { x: 52, y: 608 }, tip: { x: 102, y: 608 }, toward: { x: 150, y: 470 }, kicker: true },
];

/**
 * 2층 다락 — 같은 평면 위의 닫힌 방이라 층이 겹치는 계산이 없다. 램프 입구(mouth)와 출구(exit) 두 곳으로만 바깥과 이어진다.
 *   입구   램프를 올라온 공만 지나간다. 다락 안의 공에게는 벽이다 (되돌아 내려가지 않는다)
 *   출구   다락 안의 공만 지나간다. 아래에서 올라오는 1층 공에게는 벽이다
 */
const ATTIC_POLYGON: [number, number][] = [
  [ORBIT_X, 345],
  [175, 332],
  [212, 372],
  [212, 596], // 입구 오른쪽 끝
  [164, 612], // 입구 왼쪽 끝
  [142, 618], // 출구 오른쪽 끝
  [108, 618], // 출구 왼쪽 끝
  [ORBIT_X, 618],
];
export const ATTIC = {
  polygon: ATTIC_POLYGON.map(pt),
  mouth: [pt(ATTIC_POLYGON[3]), pt(ATTIC_POLYGON[4])] as [Point, Point],
  exit: [pt(ATTIC_POLYGON[5]), pt(ATTIC_POLYGON[6])] as [Point, Point],
};
/**
 * 다락 테두리 벽 (입구와 출구는 뚫려 있다). 바닥은 오른쪽이 높아서 공이 출구 쪽으로 굴러간다.
 * 왼쪽 테두리는 돌아가는 길의 안쪽 벽과 한 줄이다 — 어긋나면 그 틈에 공이 얹혀 멈춘다.
 */
const ATTIC_RIM: [number, number][][] = [
  [ATTIC_POLYGON[6], ATTIC_POLYGON[7], ATTIC_POLYGON[0], ATTIC_POLYGON[1], ATTIC_POLYGON[2], ATTIC_POLYGON[3]],
  [ATTIC_POLYGON[4], ATTIC_POLYGON[5]],
];
/** 입구와 출구의 한 방향 벽 — 엔진이 공의 층을 보고 고른다 */
export const ATTIC_MOUTH_GATE: Wall = { ax: ATTIC.mouth[0].x, ay: ATTIC.mouth[0].y, bx: ATTIC.mouth[1].x, by: ATTIC.mouth[1].y, bounce: 0.35, upper: true };
export const ATTIC_EXIT_GATE: Wall = { ax: ATTIC.exit[0].x, ay: ATTIC.exit[0].y, bx: ATTIC.exit[1].x, by: ATTIC.exit[1].y, bounce: 0.35, upper: true };

/** 2층 타깃 — 다락 위쪽 테두리 앞의 가로 막대 */
export const ATTIC_TARGETS: { x1: number; x2: number; y: number }[] = [
  { x1: 84, x2: 106, y: 358 },
  { x1: 113, x2: 135, y: 355 },
  { x1: 142, x2: 164, y: 352 },
];

/**
 * 램프 — 1층에서 다락 입구로 올라가는 길. 양옆 난간은 벽이고, 안에서는 아래로 당기는 힘(pull)이 더해진다(오르막).
 * 플리퍼 가운데쯤으로 친 공은 판 가운데(x 167~193)로 거의 곧게 올라가서, 입구를 그 자리에 뒀다 — 어느 플리퍼로도 올릴 수 있다.
 * 난간은 아래가 넓고 위로 천천히 좁아진다. 급하게 꺾이면 공이 크게 튕겨서 못 올라간다.
 */
const RAMP_LEFT: [number, number][] = [
  [146, 850],
  [156, 780],
  [160, 700],
  ATTIC_POLYGON[4],
];
const RAMP_RIGHT: [number, number][] = [
  [214, 850],
  [206, 780],
  [208, 700],
  ATTIC_POLYGON[3],
];

export const RAMP = {
  /** 가운데 선: 아래 입구 → 다락 입구 가운데 */
  center: RAMP_LEFT.map(([x, y], i) => ({ x: (x + RAMP_RIGHT[i][0]) / 2, y: (y + RAMP_RIGHT[i][1]) / 2 })),
  left: RAMP_LEFT.map(pt),
  right: RAMP_RIGHT.map(pt),
  /** 난간 사이 — 이 안의 1층 공은 램프 위에 있다 */
  polygon: [...RAMP_LEFT, ...[...RAMP_RIGHT].reverse()].map(pt),
  /** 램프 위의 공을 아래로 당기는 가속 (중력에 더해진다) */
  pull: 600,
};

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
/**
 * 바깥 길의 안쪽 벽을 판 바닥까지 잇는다. 이 벽이 없으면 경사 아래가 뚫려 있어서,
 * 플리퍼 사이로 빠진 공이 옆으로 날아와 킥백을 받거나 바깥 길의 공이 킥백 자리를 비켜 간다.
 */
const LEFT_APRON: [number, number][] = [
  [36, 1129],
  [36, TABLE_H],
];
const LEFT_ROOF: [number, number][] = [
  [8, 950],
  [34, 990],
];
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
  ...polyline(LEFT_APRON, 0.35),
  ...polyline(LEFT_APRON.map(mirrorXY), 0.35),
  ...polyline(LEFT_ROOF, 0.35),
  ...polyline(RIGHT_ROOF, 0.35),
  // 돌아가는 길의 안쪽 벽 — 왼쪽 바깥벽과 이 벽 사이가 길이다. 위로는 다락의 왼쪽 테두리가 이어받는다
  { ax: ORBIT_X, ay: 772, bx: ORBIT_X, by: 618, bounce: 0.35 },
  ...LANE_POSTS,
  // 2층 다락의 테두리와 램프 난간
  ...ATTIC_RIM.flatMap((line) => polyline(line, 0.35)).map((w) => ({ ...w, upper: true })),
  ...polyline(RAMP_LEFT, 0.35).map((w) => ({ ...w, upper: true })),
  ...polyline(RAMP_RIGHT, 0.35).map((w) => ({ ...w, upper: true })),
];

/** 공이 레인을 빠져나간 뒤 닫히는 문 — 공이 레인으로 다시 떨어지지 않게 한다 */
export const GATE: Wall = { ax: LANE_X, ay: 180, bx: RIGHT_X, by: 140, bounce: 0.4 };

/** 구멍(세이커): 공을 잠깐 붙잡았다 뱉는다. catchR 안으로 들어온 공을 붙잡는다 */
export type SaucerId = 'lock' | 'bonus' | 'attic';
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
  bonus: { x: 82, y: 774, r: 12, catchR: 10 },
  /** 2층 잭팟 구멍 — 2층 타깃을 다 맞혀 불이 켜졌을 때 들어가면 다락 잭팟 */
  attic: { x: 72, y: 398, r: 11, catchR: 9 },
};

/** 스피너 — 돌아가는 길 입구에 가로로 걸린 판. 공이 지나가면 돈다 */
export const SPINNER = { x: 29, y: 744, half: 17 };

/** 범퍼. attic은 2층 다락의 작은 범퍼 — 방이 좁아서 차는 힘(kick)이 약하다 */
export const BUMPERS: { x: number; y: number; r: number; kick: number; attic?: boolean }[] = [
  { x: 118, y: 190, r: 22, kick: 720 },
  { x: 196, y: 160, r: 22, kick: 720 },
  { x: 274, y: 196, r: 22, kick: 720 },
  { x: 298, y: 300, r: 20, kick: 720 },
  { x: 262, y: 400, r: 20, kick: 720 },
  { x: 98, y: 456, r: 13, kick: 520, attic: true },
  { x: 152, y: 430, r: 13, kick: 520, attic: true },
  { x: 126, y: 508, r: 13, kick: 520, attic: true },
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

/**
 * 레일 — 다락 출구로 나온 공을 왼쪽 안쪽 길 위까지 내려 준다. 판 위에서 다른 것 위를 지나가는 유일한 길이다.
 * 느리게 출발해서 내려가며 빨라진다.
 */
export const RAIL = {
  ride: {
    track: makeTrack([
      { x: (ATTIC.exit[0].x + ATTIC.exit[1].x) / 2, y: ATTIC.exit[0].y + 6 },
      { x: 130, y: 680 },
      { x: 132, y: 780 },
      { x: 128, y: 880 },
      { x: 108, y: 970 },
      { x: 70, y: 1012 },
      { x: 52, y: 1040 },
    ]),
    startSpeed: 180,
    minSpeed: 180,
    maxSpeed: 620,
    accel: 700,
    release: { vx: 0, vy: 200 },
  } satisfies RideDef,
};

/**
 * 보너스 구멍의 미끄럼길 — 구멍이 붙잡았던 공을 왼쪽 안쪽 길까지 내려 준다.
 * 구멍이 있는 자리는 위·옆이 막혀 있어서 그냥 뱉으면 공이 슬링샷이나 플리퍼에 세게 떨어져 어디로 튈지 모른다.
 */
export const BONUS_CHUTE: RideDef = {
  track: makeTrack([
    { x: SAUCERS.bonus.x, y: SAUCERS.bonus.y },
    { x: 64, y: 850 },
    { x: 54, y: 950 },
    { x: 51, y: 1052 },
  ]),
  startSpeed: 240,
  minSpeed: 240,
  maxSpeed: 520,
  accel: 500,
  release: { vx: 0, vy: 160 },
};

/**
 * 잠금 구멍의 미끄럼길 — 구멍이 붙잡았던 공을 오른쪽 안쪽 길까지 내려 준다 (보너스 구멍과 좌우로 같은 모양).
 * 옆으로 뱉으면 램프 난간에 맞고 돌아와서 구멍에 다시 빠지거나 플리퍼 사이로 떨어진다.
 */
export const LOCK_CHUTE: RideDef = {
  track: makeTrack([
    { x: SAUCERS.lock.x, y: SAUCERS.lock.y },
    { x: 314, y: 960 },
    { x: MIRROR - 51, y: 1052 },
  ]),
  startSpeed: 240,
  minSpeed: 240,
  maxSpeed: 520,
  accel: 500,
  release: { vx: 0, vy: 160 },
};

/** 바닥 표시등: 보너스 배율 ×2~×5, 공 살리기 */
export const MULT_INSERTS: Point[] = [128, 161, 194, 227].map((x) => ({ x, y: 1000 }));
export const SAVE_INSERT: Point = { x: 180, y: 1268 };

/** 판 위 동전이 생기는 빈 자리 (1층의 열린 곳만) */
export const COIN_ZONES: Zone[] = [
  { x: 70, y: 110, w: 260, h: 200 },
  { x: 240, y: 440, w: 90, h: 400 },
  { x: 70, y: 860, w: 230, h: 110 },
];
