/**
 * 핀볼 물리 엔진 — DOM에 의존하지 않는 순수 로직.
 * 좌표는 테이블 논리 단위(TABLE_W × TABLE_H), 시간은 초.
 */

export const TABLE_W = 400;
export const TABLE_H = 700;
export const BALL_R = 9;

const GRAVITY = 900;
const MAX_SPEED = 1500;
const SUBSTEPS = 8;
const WALL_R = 2;
const FLIPPER_R = 7;

export const BALLS_PER_GAME = 3;
export const SCORE_BUMPER = 250;
export const SCORE_COIN = 500;
/** 판 위 동전 1개를 주웠을 때 받는 코인 */
export const COIN_PICKUP_VALUE = 5;
/** 점수 구간 보너스 (밸런싱 단계에서 조정) */
export const MILESTONES = [
  { score: 10000, coins: 10 },
  { score: 30000, coins: 20 },
  { score: 50000, coins: 30 },
] as const;

const LANE_X = 350;
const RIGHT_X = 392;
const PLUNGER_Y = 610;
const REST_X = (LANE_X + RIGHT_X) / 2;
const REST_Y = PLUNGER_Y - BALL_R - WALL_R;

/** 발사대: 누르고 있는 동안 스프링이 당겨지고, 떼면 당긴 만큼의 힘으로 발사한다 */
export const CHARGE_TIME = 1.0; // 끝까지 당기는 데 걸리는 시간(초) — 그 뒤로는 최대 힘에 머문다
export const PULL_DISTANCE = 44; // 끝까지 당겼을 때 공이 내려가는 거리
export const LAUNCH_MIN = 600; // 살짝 눌렀을 때 발사 속도
export const LAUNCH_MAX = 1300; // 끝까지 당겼을 때 발사 속도
export const PLUNGER_TOP = PLUNGER_Y;

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
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type BallState = 'ready' | 'live';

export type PinballEvent =
  | { type: 'launch'; power: number }
  | { type: 'bumper' }
  | { type: 'coin'; coins: number }
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
];

/** 공이 레인을 빠져나간 뒤 닫히는 문 — 공이 레인으로 다시 떨어지지 않게 한다 */
export const GATE: Wall = { ax: LANE_X, ay: 180, bx: RIGHT_X, by: 140, bounce: 0.4 };

function createBumpers(): Bumper[] {
  return [
    { x: 120, y: 200, r: 24, flash: 0, cooldown: 0 },
    { x: 240, y: 200, r: 24, flash: 0, cooldown: 0 },
    { x: 180, y: 295, r: 24, flash: 0, cooldown: 0 },
    { x: 85, y: 385, r: 16, flash: 0, cooldown: 0 },
    { x: 275, y: 385, r: 16, flash: 0, cooldown: 0 },
  ];
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

/**
 * 공과 캡슐(두께가 있는 선분)의 충돌. 표면 속도(svx, svy)는 움직이는 플리퍼용.
 * 충돌하면 true.
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
): boolean {
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
  if (dist >= minDist) return false;

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
  return true;
}

export class PinballEngine {
  ball: Ball = { x: REST_X, y: REST_Y, vx: 0, vy: 0 };
  ballState: BallState = 'ready';
  ballsLeft = BALLS_PER_GAME;
  /** 스프링을 당기는 중인지, 당긴 정도(0~1) */
  charging = false;
  charge = 0;
  score = 0;
  /** 이번 판에 얻은 코인 (동전 줍기 + 점수 구간 보너스) */
  coinsEarned = 0;
  over = false;
  gateClosed = false;
  bumpers: Bumper[] = createBumpers();
  flippers: Flipper[] = createFlippers();
  coins: CoinPickup[] = [];
  time = 0;

  private events: PinballEvent[] = [];
  private nextCoinId = 1;
  private coinTimer = 1.5;
  private slowTime = 0;
  private milestoneIndex = 0;
  private random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  setFlipper(side: 'left' | 'right', pressed: boolean): void {
    for (const f of this.flippers) if (f.side === side) f.pressed = pressed;
  }

  /** 다음 공을 발사대에 올린다 — 같은 프레임 안에 발사돼도 발사대에서 출발하게 위치도 바로 옮긴다 */
  private toPlunger(): void {
    this.ballState = 'ready';
    this.charging = false;
    this.charge = 0;
    this.ball.x = REST_X;
    this.ball.y = REST_Y;
    this.ball.vx = 0;
    this.ball.vy = 0;
  }

  /** 스프링을 당기기 시작한다 (발사대에 공이 있을 때만) */
  startCharge(): boolean {
    if (this.over || this.ballState !== 'ready' || this.charging) return false;
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
    if (this.over || this.ballState !== 'ready') return false;
    const p = Math.max(0, Math.min(1, power));
    this.ballState = 'live';
    this.gateClosed = false;
    // 언제 불려도 발사대(당긴 위치)에서 출발한다
    this.ball.x = REST_X;
    this.ball.y = REST_Y + p * PULL_DISTANCE;
    this.ball.vx = 0;
    this.ball.vy = -(LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * p);
    this.events.push({ type: 'launch', power: p });
    return true;
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
      if (this.ballState === 'live') this.integrateBall(h);
    }

    if (this.ballState === 'ready') {
      if (this.charging) this.charge = Math.min(1, this.charge + frame / CHARGE_TIME);
      this.ball.x = REST_X;
      this.ball.y = REST_Y + this.charge * PULL_DISTANCE;
      this.ball.vx = 0;
      this.ball.vy = 0;
    }

    for (const b of this.bumpers) {
      b.flash = Math.max(0, b.flash - frame * 4);
      b.cooldown = Math.max(0, b.cooldown - frame);
    }
    for (const c of this.coins) c.age += frame;
    this.updateCoinSpawns(frame);
    if (this.ballState === 'live') this.checkBallStatus(frame);
  }

  private updateFlippers(h: number): void {
    for (const f of this.flippers) {
      const target = f.pressed ? f.up : f.rest;
      const speed = f.pressed ? 22 : 12;
      const prev = f.angle;
      const diff = target - f.angle;
      const stepMax = speed * h;
      f.angle = Math.abs(diff) <= stepMax ? target : f.angle + Math.sign(diff) * stepMax;
      f.angVel = (f.angle - prev) / h;
    }
  }

  private integrateBall(h: number): void {
    const ball = this.ball;
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

    for (const f of this.flippers) {
      const tip = flipperTip(f);
      collideCapsule(ball, f.px, f.py, tip.x, tip.y, FLIPPER_R, 0.25, (cx, cy) => [
        -f.angVel * (cy - f.py),
        f.angVel * (cx - f.px),
      ]);
    }

    for (const b of this.bumpers) this.collideBumper(b);

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (Math.hypot(ball.x - c.x, ball.y - c.y) < BALL_R + c.r + 2) {
        this.coins.splice(i, 1);
        this.coinsEarned += COIN_PICKUP_VALUE;
        this.addScore(SCORE_COIN);
        this.events.push({ type: 'coin', coins: COIN_PICKUP_VALUE });
      }
    }
  }

  private collideBumper(b: Bumper): void {
    const ball = this.ball;
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
    // 범퍼가 공을 바깥으로 밀어낸다
    const out = ball.vx * nx + ball.vy * ny;
    const kick = Math.max(0, 560 - out);
    ball.vx += nx * kick;
    ball.vy += ny * kick;
    if (b.cooldown <= 0) {
      b.cooldown = 0.08;
      b.flash = 1;
      this.addScore(SCORE_BUMPER);
      this.events.push({ type: 'bumper' });
    }
  }

  private addScore(points: number): void {
    this.score += points;
    while (this.milestoneIndex < MILESTONES.length && this.score >= MILESTONES[this.milestoneIndex].score) {
      const m = MILESTONES[this.milestoneIndex];
      this.coinsEarned += m.coins;
      this.events.push({ type: 'milestone', score: m.score, coins: m.coins });
      this.milestoneIndex++;
    }
  }

  private updateCoinSpawns(frame: number): void {
    this.coinTimer -= frame;
    if (this.coinTimer > 0 || this.coins.length >= 3) return;
    this.coinTimer = 3.5;
    for (let tries = 0; tries < 30; tries++) {
      const x = 40 + this.random() * 280;
      const y = 90 + this.random() * 360;
      const clearOfBumpers = this.bumpers.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + 34);
      const clearOfCoins = this.coins.every((c) => Math.hypot(c.x - x, c.y - y) > 50);
      if (clearOfBumpers && clearOfCoins) {
        this.coins.push({ id: this.nextCoinId++, x, y, r: 10, age: 0 });
        return;
      }
    }
  }

  private checkBallStatus(frame: number): void {
    const ball = this.ball;

    // 발사가 약해 레인으로 다시 떨어진 공은 잃지 않고 발사대로 돌려놓는다
    if (!this.gateClosed && ball.x > LANE_X && ball.y > PLUNGER_Y - 40 && Math.abs(ball.vy) < 40) {
      this.toPlunger();
      return;
    }

    if (ball.y > TABLE_H + 30) {
      this.ballsLeft -= 1;
      if (this.ballsLeft <= 0) {
        this.ballsLeft = 0;
        this.over = true;
        this.events.push({ type: 'drain', ballsLeft: 0 });
        this.events.push({ type: 'gameOver' });
      } else {
        this.toPlunger();
        this.gateClosed = false;
        this.events.push({ type: 'drain', ballsLeft: this.ballsLeft });
      }
      return;
    }

    // 공이 어딘가에 끼어 멈추면 살짝 튕겨 준다 (플리퍼로 공을 잡아 둔 상태는 제외)
    const speed = Math.hypot(ball.vx, ball.vy);
    const holding = this.flippers.some((f) => f.pressed);
    this.slowTime = speed < 15 && !holding ? this.slowTime + frame : 0;
    if (this.slowTime > 2.5) {
      this.slowTime = 0;
      ball.vy = -420;
      ball.vx = (this.random() - 0.5) * 300;
    }
  }
}
