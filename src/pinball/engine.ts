/**
 * 핀볼 물리 엔진 — DOM에 의존하지 않는 순수 로직.
 * 좌표는 테이블 논리 단위(TABLE_W × TABLE_H), 시간은 초.
 *
 * 판 구성
 *   위쪽 레인 3개   공이 지나가면 불이 켜진다. 플리퍼를 누르면 켜진 불이 옆으로 옮겨 간다.
 *                   셋 다 켜면 보너스 배율 +1 (최대 5배, 공을 잃으면 1배로)
 *   팝 범퍼 3개     닿으면 공을 세게 차 낸다
 *   왼쪽 타깃 3개   맞으면 쓰러진다. 셋 다 쓰러뜨리면 오른쪽 구멍에 '잠금' 불이 켜진다
 *   오른쪽 구멍     공을 잠깐 붙잡았다 뱉는다. 잠금 불이 켜져 있으면 멀티볼(공 2개, 점수 2배),
 *                   멀티볼 중에 넣으면 잭팟
 *   슬링샷 2개      플리퍼 위 삼각 튕김대. 맞으면 공을 가운데로 차 낸다
 *   공 살리기       발사 뒤 BALL_SAVE_TIME초 안에 공을 잃으면 한 번 돌려준다
 *   콤보            짧은 간격으로 계속 맞히면 5번마다 보너스
 */

export const TABLE_W = 400;
export const TABLE_H = 700;
export const BALL_R = 9;

const GRAVITY = 900;
const MAX_SPEED = 1500;
const SUBSTEPS = 8;
const WALL_R = 2;
const FLIPPER_R = 7;
const TARGET_R = 3;

export const BALLS_PER_GAME = 3;
/** 판 위 동전 1개를 주웠을 때 받는 코인 */
export const COIN_PICKUP_VALUE = 5;
/** 한 판에 받을 수 있는 코인 상한 — 서버(server/src/domain.ts BOARDS의 pinball.maxCoinsPerRun)와 같다 */
export const MAX_COINS_PER_RUN = 400;
const COIN_SPAWN_INTERVAL = 3.5;
export const MAX_MULTIPLIER = 5;
/** 한 판 점수 상한 — 서버(server/src/domain.ts MAX_PINBALL_SCORE)와 같다. 넘으면 서버가 기록을 받지 않는다 */
export const MAX_SCORE = 5_000_000;
/** 발사 뒤 이 시간 안에 공을 잃으면 한 번 돌려준다 */
export const BALL_SAVE_TIME = 8;
const COMBO_WINDOW = 1.2;
const COMBO_STEP = 5;

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
} as const;

/** 점수 구간 보너스 코인 (밸런싱 단계에서 조정) */
export const MILESTONES = [
  { score: 10000, coins: 10 },
  { score: 30000, coins: 20 },
  { score: 50000, coins: 30 },
] as const;

const BUMPER_KICK = 720;
const SLING_KICK = 760;
/** 슬링샷이 반응하는 최소 충돌 속도 — 굴러 내려오는 공은 차지 않는다 */
const SLING_TRIGGER = 90;
const TARGET_TRIGGER = 40;

export const LANE_X = 350;
export const RIGHT_X = 392;
const PLUNGER_Y = 610;
const REST_X = (LANE_X + RIGHT_X) / 2;
const REST_Y = PLUNGER_Y - BALL_R - WALL_R;
/** 플리퍼 사이 가운데 — 왼쪽 장치를 오른쪽으로 비출 때 기준 */
const MIRROR = 360;

/** 발사대: 누르고 있는 동안 스프링이 당겨지고, 떼면 당긴 만큼의 힘으로 발사한다 */
export const CHARGE_TIME = 1.0; // 끝까지 당기는 데 걸리는 시간(초) — 그 뒤로는 최대 힘에 머문다
export const PULL_DISTANCE = 44; // 끝까지 당겼을 때 공이 내려가는 거리
export const LAUNCH_MIN = 600; // 살짝 눌렀을 때 발사 속도
export const LAUNCH_MAX = 1300; // 끝까지 당겼을 때 발사 속도
export const PLUNGER_TOP = PLUNGER_Y;

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

export interface Bumper {
  x: number;
  y: number;
  r: number;
  flash: number;
  cooldown: number;
}

export interface Sling {
  side: 'left' | 'right';
  /** 세 꼭짓점: top–corner, corner–tip은 그냥 벽이고 tip–top 면이 공을 차는 면이다 */
  top: Point;
  corner: Point;
  tip: Point;
  /** 차는 면이 판 안쪽을 보는 방향 */
  nx: number;
  ny: number;
  flash: number;
  cooldown: number;
}

export interface DropTarget {
  x: number;
  y1: number;
  y2: number;
  down: boolean;
  flash: number;
}

export interface RolloverLane {
  x: number;
  y: number;
  lit: boolean;
  flash: number;
  cooldown: number;
}

export interface CoinPickup {
  id: number;
  x: number;
  y: number;
  r: number;
  age: number;
}

export interface Flipper {
  side: 'left' | 'right';
  px: number;
  py: number;
  len: number;
  rest: number;
  up: number;
  angle: number;
  angVel: number;
  pressed: boolean;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 구멍에 붙잡혀 있는 남은 시간 (0이면 자유) */
  held: number;
  slow: number;
}

export type BallState = 'ready' | 'live';

export type PinballEvent =
  | { type: 'launch'; power: number; auto: boolean }
  | { type: 'flip'; side: 'left' | 'right' }
  | { type: 'bumper'; x: number; y: number; points: number; index: number }
  | { type: 'sling'; x: number; y: number; points: number; nx: number; ny: number }
  | { type: 'target'; x: number; y: number; points: number }
  | { type: 'bank'; points: number }
  | { type: 'rollover'; x: number; y: number; points: number }
  | { type: 'lanes'; multiplier: number; points: number }
  | { type: 'saucer'; x: number; y: number; points: number; jackpot: boolean }
  | { type: 'multiball' }
  | { type: 'multiballEnd' }
  | { type: 'ballSaved' }
  | { type: 'combo'; count: number; points: number }
  | { type: 'coin'; x: number; y: number; coins: number; points: number }
  | { type: 'milestone'; score: number; coins: number }
  | { type: 'drain'; ballsLeft: number }
  | { type: 'gameOver' };

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

/** 슬링샷 모양 — 왼쪽을 정하고 오른쪽은 비춰서 만든다 */
const LEFT_SLING = { top: { x: 56, y: 440 }, corner: { x: 56, y: 508 }, tip: { x: 102, y: 556 } };

function createSling(side: 'left' | 'right'): Sling {
  const s = side === 'left' ? LEFT_SLING : { top: mirror(LEFT_SLING.top), corner: mirror(LEFT_SLING.corner), tip: mirror(LEFT_SLING.tip) };
  // 차는 면(tip→top)의 법선 중 판 가운데를 보는 쪽
  const ex = s.top.x - s.tip.x;
  const ey = s.top.y - s.tip.y;
  const len = Math.hypot(ex, ey);
  let nx = -ey / len;
  let ny = ex / len;
  const mx = (s.top.x + s.tip.x) / 2;
  const my = (s.top.y + s.tip.y) / 2;
  if (nx * (MIRROR / 2 - mx) + ny * (380 - my) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { side, ...s, nx, ny, flash: 0, cooldown: 0 };
}

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
const SAUCER_CATCH = 11;
const SAUCER_HOLD = 0.9;
const SAUCER_LOCK_HOLD = 1.6;

function createBumpers(): Bumper[] {
  return [
    { x: 135, y: 170, r: 22, flash: 0, cooldown: 0 },
    { x: 235, y: 170, r: 22, flash: 0, cooldown: 0 },
    { x: 185, y: 245, r: 22, flash: 0, cooldown: 0 },
  ];
}

function createTargets(): DropTarget[] {
  return [
    { x: 24, y1: 262, y2: 286, down: false, flash: 0 },
    { x: 24, y1: 292, y2: 316, down: false, flash: 0 },
    { x: 24, y1: 322, y2: 346, down: false, flash: 0 },
  ];
}

function createLanes(): RolloverLane[] {
  return [135, 185, 235].map((x) => ({ x, y: 66, lit: false, flash: 0, cooldown: 0 }));
}

function createFlippers(): Flipper[] {
  return [
    { side: 'left', px: 110, py: 604, len: 58, rest: 0.5, up: -0.45, angle: 0.5, angVel: 0, pressed: false },
    {
      side: 'right',
      px: 250,
      py: 604,
      len: 58,
      rest: Math.PI - 0.5,
      up: Math.PI + 0.45,
      angle: Math.PI - 0.5,
      angVel: 0,
      pressed: false,
    },
  ];
}

export function flipperTip(f: Flipper): { x: number; y: number } {
  return { x: f.px + Math.cos(f.angle) * f.len, y: f.py + Math.sin(f.angle) * f.len };
}

interface Contact {
  /** 부딪힐 때 면을 향하던 속도 (0 이상) */
  impact: number;
  nx: number;
  ny: number;
}

/**
 * 공과 캡슐(두께가 있는 선분)의 충돌. 표면 속도(svx, svy)는 움직이는 플리퍼용.
 * 닿았으면 충돌 정보를, 아니면 null을 돌려준다.
 */
function collideCapsule(
  ball: Ball,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  bounce: number,
  surfaceVel?: (cx: number, cy: number) => [number, number],
): Contact | null {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((ball.x - ax) * abx + (ball.y - ay) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = ball.x - cx;
  const dy = ball.y - cy;
  const dist = Math.hypot(dx, dy);
  const minDist = BALL_R + radius;
  if (dist >= minDist) return null;

  let nx: number;
  let ny: number;
  if (dist < 1e-6) {
    const l = Math.sqrt(len2) || 1;
    nx = -aby / l;
    ny = abx / l;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }
  ball.x = cx + nx * minDist;
  ball.y = cy + ny * minDist;

  const [svx, svy] = surfaceVel ? surfaceVel(cx, cy) : [0, 0];
  const rvx = ball.vx - svx;
  const rvy = ball.vy - svy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const tx = -ny;
    const ty = nx;
    const vt = rvx * tx + rvy * ty;
    const newVn = -vn * bounce;
    const newVt = vt * 0.99;
    ball.vx = svx + nx * newVn + tx * newVt;
    ball.vy = svy + ny * newVn + ty * newVt;
  }
  return { impact: Math.max(0, -vn), nx, ny };
}

export class PinballEngine {
  /** 판 위에서 움직이는(또는 구멍에 붙잡힌) 공 */
  balls: Ball[] = [];
  /** 발사대에 다음 공이 올라가 있는지 */
  plungerLoaded = true;
  ballsLeft = BALLS_PER_GAME;
  /** 스프링을 당기는 중인지, 당긴 정도(0~1) */
  charging = false;
  charge = 0;
  score = 0;
  /** 이번 판에 얻은 코인 (동전 줍기 + 점수 구간 보너스), MAX_COINS_PER_RUN까지 */
  coinsEarned = 0;
  over = false;
  gateClosed = false;
  /** 레인 보너스 배율 (1~MAX_MULTIPLIER) */
  multiplier = 1;
  /** 타깃을 다 쓰러뜨려 구멍에 잠금 불이 켜졌는지 */
  lockLit = false;
  /** 공 살리기 남은 시간 */
  saveTimer = 0;
  saveUsed = false;
  comboCount = 0;
  bumpers: Bumper[] = createBumpers();
  slings: Sling[] = [createSling('left'), createSling('right')];
  targets: DropTarget[] = createTargets();
  lanes: RolloverLane[] = createLanes();
  flippers: Flipper[] = createFlippers();
  coins: CoinPickup[] = [];
  /** 구멍에 공이 붙잡혀 있는 동안 1 → 0 */
  saucerFlash = 0;
  time = 0;

  private events: PinballEvent[] = [];
  private nextCoinId = 1;
  private nextBallId = 1;
  private coinTimer = 1.5;
  private comboTimer = 0;
  private bankReset = 0;
  private lanesReset = 0;
  private pendingLaunch = 0;
  private saucerCooldown = 0;
  private wasMultiball = false;
  private milestoneIndex = 0;
  /** 공 능력으로 생긴 코인 소수점 — 1이 쌓이면 코인 하나를 더 준다 */
  private coinCarry = 0;
  private random: () => number;
  /** 장착 능력: 판 위 동전 빈도 +비율, 동전 하나의 코인 +비율 */
  readonly coinSpawn: number;
  readonly coinValue: number;

  constructor(random: () => number = Math.random, gear: { coinSpawn?: number; coinValue?: number } = {}) {
    this.random = random;
    this.coinSpawn = Math.max(0, gear.coinSpawn ?? 0);
    this.coinValue = Math.max(0, gear.coinValue ?? 0);
  }

  /** 발사대에 공이 있으면 'ready' */
  get ballState(): BallState {
    return this.plungerLoaded ? 'ready' : 'live';
  }

  /** 공이 2개 이상 판 위에 있거나 곧 나올 예정 — 점수 2배 */
  get isMultiball(): boolean {
    return this.balls.length + (this.pendingLaunch > 0 ? 1 : 0) > 1;
  }

  /** 발사대 위 공의 위치 (발사대가 비었으면 null) */
  plungerBall(): Point | null {
    return this.plungerLoaded ? { x: REST_X, y: REST_Y + this.charge * PULL_DISTANCE } : null;
  }

  setFlipper(side: 'left' | 'right', pressed: boolean): void {
    for (const f of this.flippers) {
      if (f.side !== side || f.pressed === pressed) continue;
      f.pressed = pressed;
      if (pressed && !this.over) {
        this.events.push({ type: 'flip', side });
        this.shiftLanes(side);
      }
    }
  }

  /** 켜진 레인 불을 플리퍼 쪽으로 한 칸 옮긴다 (다 켜졌으면 그대로) */
  private shiftLanes(side: 'left' | 'right'): void {
    const lit = this.lanes.map((l) => l.lit);
    if (lit.every(Boolean) || !lit.some(Boolean)) return;
    const n = lit.length;
    for (let i = 0; i < n; i++) this.lanes[i].lit = side === 'left' ? lit[(i + 1) % n] : lit[(i + n - 1) % n];
  }

  /** 스프링을 당기기 시작한다 (발사대에 공이 있을 때만) */
  startCharge(): boolean {
    if (this.over || !this.plungerLoaded || this.charging) return false;
    this.charging = true;
    this.charge = 0;
    return true;
  }

  /** 당긴 스프링을 놓아 발사한다. 발사했으면 true */
  release(): boolean {
    if (!this.charging) return false;
    const power = this.charge;
    this.charging = false;
    this.charge = 0;
    return this.launch(power);
  }

  /** 발사하지 않고 스프링을 되돌린다 (일시정지 등) */
  cancelCharge(): void {
    this.charging = false;
    this.charge = 0;
  }

  /** 발사대에 공이 있을 때만 발사한다. power 0~1 (끝까지 당김 = 1). 발사했으면 true */
  launch(power = 1): boolean {
    if (this.over || !this.plungerLoaded) return false;
    const p = Math.max(0, Math.min(1, power));
    this.plungerLoaded = false;
    if (!this.saveUsed) this.saveTimer = BALL_SAVE_TIME;
    this.spawnLaunchedBall(p, false);
    return true;
  }

  /** 발사대 위치에서 공 하나를 위로 쏜다 */
  private spawnLaunchedBall(power: number, auto: boolean): void {
    this.gateClosed = false;
    this.balls.push({
      id: this.nextBallId++,
      x: REST_X,
      y: REST_Y + power * PULL_DISTANCE,
      vx: 0,
      vy: -(LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * power),
      held: 0,
      slow: 0,
    });
    this.events.push({ type: 'launch', power, auto });
  }

  drainEvents(): PinballEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  step(dt: number): void {
    if (this.over) return;
    const frame = Math.min(dt, 1 / 30);
    const h = frame / SUBSTEPS;
    this.time += frame;

    for (let i = 0; i < SUBSTEPS; i++) {
      this.updateFlippers(h);
      for (const ball of this.balls) if (ball.held <= 0) this.integrateBall(ball, h);
      this.collideBalls();
    }

    if (this.plungerLoaded && this.charging) this.charge = Math.min(1, this.charge + frame / CHARGE_TIME);

    this.updateTimers(frame);
    for (const c of this.coins) c.age += frame;
    this.updateCoinSpawns(frame);
    this.checkBalls(frame);

    const multi = this.isMultiball;
    if (this.wasMultiball && !multi) this.events.push({ type: 'multiballEnd' });
    this.wasMultiball = multi;
  }

  private updateTimers(frame: number): void {
    for (const b of this.bumpers) {
      b.flash = Math.max(0, b.flash - frame * 4);
      b.cooldown = Math.max(0, b.cooldown - frame);
    }
    for (const s of this.slings) {
      s.flash = Math.max(0, s.flash - frame * 5);
      s.cooldown = Math.max(0, s.cooldown - frame);
    }
    for (const t of this.targets) t.flash = Math.max(0, t.flash - frame * 3);
    for (const l of this.lanes) {
      l.flash = Math.max(0, l.flash - frame * 2);
      l.cooldown = Math.max(0, l.cooldown - frame);
    }
    this.saucerFlash = Math.max(0, this.saucerFlash - frame * 1.5);
    this.saucerCooldown = Math.max(0, this.saucerCooldown - frame);
    this.comboTimer = Math.max(0, this.comboTimer - frame);
    if (this.balls.length > 0) this.saveTimer = Math.max(0, this.saveTimer - frame);

    if (this.bankReset > 0) {
      this.bankReset -= frame;
      if (this.bankReset <= 0) for (const t of this.targets) t.down = false;
    }
    if (this.lanesReset > 0) {
      this.lanesReset -= frame;
      if (this.lanesReset <= 0) for (const l of this.lanes) l.lit = false;
    }
    if (this.pendingLaunch > 0) {
      this.pendingLaunch -= frame;
      if (this.pendingLaunch <= 0) {
        this.pendingLaunch = 0;
        this.spawnLaunchedBall(1, true);
      }
    }
    // 구멍에 붙잡힌 공을 뱉는다
    for (const ball of this.balls) {
      if (ball.held <= 0) continue;
      ball.held -= frame;
      if (ball.held <= 0) {
        ball.held = 0;
        ball.vx = -470 - this.random() * 80;
        ball.vy = -420 - this.random() * 60;
        this.saucerCooldown = 0.5;
      }
    }
  }

  private updateFlippers(h: number): void {
    for (const f of this.flippers) {
      const target = f.pressed ? f.up : f.rest;
      const speed = f.pressed ? 24 : 12;
      const prev = f.angle;
      const diff = target - f.angle;
      const stepMax = speed * h;
      f.angle = Math.abs(diff) <= stepMax ? target : f.angle + Math.sign(diff) * stepMax;
      f.angVel = (f.angle - prev) / h;
    }
  }

  private integrateBall(ball: Ball, h: number): void {
    ball.vy += GRAVITY * h;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > MAX_SPEED) {
      ball.vx = (ball.vx / speed) * MAX_SPEED;
      ball.vy = (ball.vy / speed) * MAX_SPEED;
    }
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;

    for (const w of WALLS) {
      if (w.oneWay && ball.vy < 0) continue;
      collideCapsule(ball, w.ax, w.ay, w.bx, w.by, WALL_R, w.bounce);
    }
    if (this.gateClosed) collideCapsule(ball, GATE.ax, GATE.ay, GATE.bx, GATE.by, WALL_R, GATE.bounce);
    if (!this.gateClosed && ball.x < LANE_X - BALL_R - 4 && ball.y < 300) this.gateClosed = true;

    for (const s of this.slings) this.collideSling(ball, s);
    for (const t of this.targets) this.collideTarget(ball, t);

    for (const f of this.flippers) {
      const tip = flipperTip(f);
      collideCapsule(ball, f.px, f.py, tip.x, tip.y, FLIPPER_R, 0.25, (cx, cy) => [-f.angVel * (cy - f.py), f.angVel * (cx - f.px)]);
    }

    this.bumpers.forEach((b, i) => this.collideBumper(ball, b, i));
    this.checkLanes(ball);
    this.checkSaucer(ball);

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (Math.hypot(ball.x - c.x, ball.y - c.y) < BALL_R + c.r + 2) {
        this.coins.splice(i, 1);
        this.coinCarry += COIN_PICKUP_VALUE * this.coinValue;
        const bonus = Math.floor(this.coinCarry);
        this.coinCarry -= bonus;
        const coins = Math.min(COIN_PICKUP_VALUE + bonus, MAX_COINS_PER_RUN - this.coinsEarned);
        this.coinsEarned += coins;
        const points = this.award(POINTS.coin);
        this.events.push({ type: 'coin', x: c.x, y: c.y, coins, points });
      }
    }
  }

  /** 공끼리 부딪힘 (멀티볼) — 같은 무게의 탄성 충돌 */
  private collideBalls(): void {
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i];
        const b = balls[j];
        if (a.held > 0 || b.held > 0) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= BALL_R * 2 || dist < 1e-6) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = (BALL_R * 2 - dist) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const impulse = rel * 0.95;
          a.vx += nx * impulse;
          a.vy += ny * impulse;
          b.vx -= nx * impulse;
          b.vy -= ny * impulse;
        }
      }
    }
  }

  private collideSling(ball: Ball, s: Sling): void {
    collideCapsule(ball, s.top.x, s.top.y, s.corner.x, s.corner.y, WALL_R, 0.3);
    collideCapsule(ball, s.corner.x, s.corner.y, s.tip.x, s.tip.y, WALL_R, 0.3);
    const c = collideCapsule(ball, s.tip.x, s.tip.y, s.top.x, s.top.y, WALL_R, 0.5);
    // 차는 면 쪽에서 세게 부딪혔을 때만 찬다 (모서리 뒤쪽이나 굴러 내려오는 공은 제외)
    if (!c || c.impact < SLING_TRIGGER || s.cooldown > 0 || c.nx * s.nx + c.ny * s.ny < 0.5) return;
    const vt = ball.vx * -s.ny + ball.vy * s.nx;
    ball.vx = s.nx * SLING_KICK + -s.ny * vt * 0.5;
    ball.vy = s.ny * SLING_KICK + s.nx * vt * 0.5;
    s.cooldown = 0.12;
    s.flash = 1;
    const points = this.award(POINTS.sling);
    this.events.push({ type: 'sling', x: ball.x, y: ball.y, points, nx: s.nx, ny: s.ny });
    this.hitCombo();
  }

  private collideTarget(ball: Ball, t: DropTarget): void {
    if (t.down) return;
    const c = collideCapsule(ball, t.x, t.y1, t.x, t.y2, TARGET_R, 0.35);
    if (!c || c.impact < TARGET_TRIGGER) return;
    t.down = true;
    t.flash = 1;
    const points = this.award(POINTS.target);
    this.events.push({ type: 'target', x: t.x, y: (t.y1 + t.y2) / 2, points });
    this.hitCombo();
    if (this.targets.every((x) => x.down)) {
      const bank = this.award(POINTS.bank);
      this.lockLit = true;
      this.bankReset = 1.2;
      this.events.push({ type: 'bank', points: bank });
    }
  }

  private collideBumper(ball: Ball, b: Bumper, index: number): void {
    const dx = ball.x - b.x;
    const dy = ball.y - b.y;
    const dist = Math.hypot(dx, dy);
    const minDist = BALL_R + b.r;
    if (dist >= minDist || dist < 1e-6) return;
    const nx = dx / dist;
    const ny = dy / dist;
    ball.x = b.x + nx * minDist;
    ball.y = b.y + ny * minDist;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      ball.vx -= 2 * vn * nx;
      ball.vy -= 2 * vn * ny;
    }
    // 범퍼가 공을 바깥으로 세게 차 낸다
    const out = ball.vx * nx + ball.vy * ny;
    const kick = Math.max(0, BUMPER_KICK - out);
    ball.vx += nx * kick;
    ball.vy += ny * kick;
    if (b.cooldown <= 0) {
      b.cooldown = 0.08;
      b.flash = 1;
      const points = this.award(POINTS.bumper);
      this.events.push({ type: 'bumper', x: b.x, y: b.y, points, index });
      this.hitCombo();
    }
  }

  private checkLanes(ball: Ball): void {
    for (const l of this.lanes) {
      if (l.cooldown > 0 || Math.abs(ball.x - l.x) > 14 || Math.abs(ball.y - l.y) > 16) continue;
      l.cooldown = 0.5;
      l.flash = 1;
      const wasLit = l.lit;
      l.lit = true;
      const points = this.award(POINTS.rollover);
      this.events.push({ type: 'rollover', x: l.x, y: l.y, points });
      this.hitCombo();
      if (!wasLit && this.lanes.every((x) => x.lit) && this.lanesReset <= 0) {
        this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + 1);
        const bonus = this.award(POINTS.lanes);
        this.lanesReset = 1.0;
        for (const x of this.lanes) x.flash = 1;
        this.events.push({ type: 'lanes', multiplier: this.multiplier, points: bonus });
      }
    }
  }

  private checkSaucer(ball: Ball): void {
    if (this.saucerCooldown > 0 || this.balls.some((b) => b.held > 0)) return;
    if (Math.hypot(ball.x - SAUCER.x, ball.y - SAUCER.y) > SAUCER_CATCH) return;
    ball.x = SAUCER.x;
    ball.y = SAUCER.y;
    ball.vx = 0;
    ball.vy = 0;
    this.saucerFlash = 1;
    if (this.lockLit && !this.isMultiball) {
      // 멀티볼: 이 공을 붙잡아 두는 동안 발사대에서 공 하나를 더 쏜다
      this.lockLit = false;
      ball.held = SAUCER_LOCK_HOLD;
      this.pendingLaunch = 0.5;
      const points = this.award(POINTS.saucer);
      this.events.push({ type: 'saucer', x: SAUCER.x, y: SAUCER.y, points, jackpot: false });
      this.events.push({ type: 'multiball' });
    } else {
      ball.held = SAUCER_HOLD;
      const jackpot = this.isMultiball;
      const points = this.award(jackpot ? POINTS.jackpot : POINTS.saucer);
      this.events.push({ type: 'saucer', x: SAUCER.x, y: SAUCER.y, points, jackpot });
    }
    this.hitCombo();
  }

  /** 짧은 간격으로 계속 맞히면 콤보가 쌓이고 COMBO_STEP번마다 보너스 */
  private hitCombo(): void {
    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
    this.comboTimer = COMBO_WINDOW;
    if (this.comboCount % COMBO_STEP === 0) {
      const points = this.award(this.comboCount * POINTS.comboPerHit);
      this.events.push({ type: 'combo', count: this.comboCount, points });
    }
  }

  /** 기본 점수에 배율을 곱해 더하고, 실제로 더한 점수를 돌려준다 */
  private award(base: number): number {
    const points = Math.min(base * this.multiplier * (this.isMultiball ? 2 : 1), MAX_SCORE - this.score);
    this.score += points;
    while (this.milestoneIndex < MILESTONES.length && this.score >= MILESTONES[this.milestoneIndex].score) {
      const m = MILESTONES[this.milestoneIndex];
      const coins = Math.min(m.coins, MAX_COINS_PER_RUN - this.coinsEarned);
      this.coinsEarned += coins;
      this.events.push({ type: 'milestone', score: m.score, coins });
      this.milestoneIndex++;
    }
    return points;
  }

  private updateCoinSpawns(frame: number): void {
    this.coinTimer -= frame;
    if (this.coinTimer > 0 || this.coins.length >= 3) return;
    this.coinTimer = COIN_SPAWN_INTERVAL / (1 + this.coinSpawn);
    for (let tries = 0; tries < 30; tries++) {
      const x = 60 + this.random() * 250;
      const y = 110 + this.random() * 300;
      const clearOfBumpers = this.bumpers.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + 30);
      const clearOfSaucer = Math.hypot(SAUCER.x - x, SAUCER.y - y) > 40;
      const clearOfCoins = this.coins.every((c) => Math.hypot(c.x - x, c.y - y) > 50);
      if (clearOfBumpers && clearOfSaucer && clearOfCoins) {
        this.coins.push({ id: this.nextCoinId++, x, y, r: 10, age: 0 });
        return;
      }
    }
  }

  private checkBalls(frame: number): void {
    const holding = this.flippers.some((f) => f.pressed);
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      if (ball.held > 0) continue;

      // 발사가 약해 레인으로 다시 떨어진 공은 잃지 않는다
      if (!this.gateClosed && ball.x > LANE_X && ball.y > PLUNGER_Y - 40 && Math.abs(ball.vy) < 40) {
        this.balls.splice(i, 1);
        if (this.balls.length === 0 && this.pendingLaunch <= 0) {
          this.plungerLoaded = true;
          this.charging = false;
          this.charge = 0;
        } else {
          // 멀티볼 중에는 다시 쏴 준다 (손가락이 발사대를 붙잡지 않게)
          this.pendingLaunch = Math.max(this.pendingLaunch, 0.3);
        }
        continue;
      }

      if (ball.y > TABLE_H + 30) {
        this.balls.splice(i, 1);
        if (this.balls.length === 0 && this.pendingLaunch <= 0) this.loseBall();
        continue;
      }

      // 공이 어딘가에 끼어 멈추면 살짝 튕겨 준다 (플리퍼로 공을 잡아 둔 상태는 제외)
      const speed = Math.hypot(ball.vx, ball.vy);
      ball.slow = speed < 15 && !holding ? ball.slow + frame : 0;
      if (ball.slow > 2.5) {
        ball.slow = 0;
        ball.vy = -420;
        ball.vx = (this.random() - 0.5) * 300;
      }
    }
  }

  /** 판 위의 마지막 공이 빠졌을 때 */
  private loseBall(): void {
    if (this.saveTimer > 0 && !this.saveUsed) {
      this.saveUsed = true;
      this.saveTimer = 0;
      this.plungerLoaded = true;
      this.events.push({ type: 'ballSaved' });
      return;
    }
    this.ballsLeft -= 1;
    this.multiplier = 1;
    this.saveUsed = false;
    this.saveTimer = 0;
    this.comboTimer = 0;
    for (const l of this.lanes) l.lit = false;
    if (this.ballsLeft <= 0) {
      this.ballsLeft = 0;
      this.over = true;
      this.events.push({ type: 'drain', ballsLeft: 0 });
      this.events.push({ type: 'gameOver' });
      return;
    }
    this.plungerLoaded = true;
    this.charging = false;
    this.charge = 0;
    this.gateClosed = false;
    this.events.push({ type: 'drain', ballsLeft: this.ballsLeft });
  }
}
