/**
 * 핀볼 물리 엔진 — DOM에 의존하지 않는 순수 로직.
 * 좌표는 판 논리 단위(TABLE_W × TABLE_H), 시간은 초. 판 배치는 table.ts, 점수 숫자는 rules.ts에 있다.
 *
 * 규칙
 *   위쪽 레인       공이 지나가면 불이 켜진다. 플리퍼를 누르면 켜진 불이 옆으로 옮겨 간다.
 *                   다 켜면 보너스 배율 +1 (최대 5배, 공을 잃으면 1배로)
 *   팝 범퍼         닿으면 공을 세게 차 낸다
 *   드롭 타깃       맞으면 쓰러진다. 다 쓰러뜨리면 잠금 구멍에 '잠금' 불이 켜진다
 *   잠금 구멍       공을 잠깐 붙잡았다 뱉는다. 잠금 불이 켜져 있으면 멀티볼(공 2개, 점수 2배),
 *                   멀티볼 중에 넣으면 잭팟
 *   보너스 구멍     들어갈 때마다 정해진 차례대로 보상을 준다 (rules.ts BONUS_ORDER)
 *   스피너          돌아가는 길 입구. 공이 빠르게 지나갈수록 여러 번 돌고, 돌 때마다 점수
 *   램프와 2층 다락 램프를 올라간 공은 2층(level 1)이 된다. 다락은 같은 평면의 닫힌 방이고 누르는 플리퍼가 없다 —
 *                   범퍼와 자동 키커가 공을 튕긴다. 타깃 셋을 맞히면 잭팟 불, 그 뒤 구멍에 넣으면 다락 잭팟.
 *                   램프를 12초 안에 또 올리면 점수가 2배, 3배…(최대 5배)
 *   레일            다락 출구로 나온 공은 레일을 타고 왼쪽 안쪽 길 위로 내려온다
 *   슬링샷          플리퍼 위 삼각 튕김대. 맞으면 공을 가운데로 차 낸다
 *   바깥 길         옆으로 들어간 공은 판 밖으로 빠진다
 *   킥백            왼쪽 바깥 길 바닥에 닿은 공을 한 번 살려 준다 (정해진 길을 따라 판 안으로 올려 보낸다).
 *                   공을 새로 받으면 켜지고, 오른쪽 타깃을 다 맞혀도 다시 켜진다
 *   오른쪽 타깃     맞히면 불이 켜진다. 셋 다 켜면 보너스와 함께 킥백이 다시 켜진다
 *   공 살리기       발사 뒤 BALL_SAVE_TIME초 안에 공을 잃으면 한 번 돌려준다
 *   콤보            짧은 간격으로 계속 맞히면 5번마다 보너스
 */

import {
  ATTIC_MAX_STAY,
  BALL_R,
  BALL_SAVE_TIME,
  BALLS_PER_GAME,
  BONUS_COINS,
  BONUS_ORDER,
  COIN_PICKUP_VALUE,
  MAX_COINS_ON_TABLE,
  MAX_COINS_PER_RUN,
  MAX_MULTIPLIER,
  MAX_RAMP_COMBO,
  MAX_SCORE,
  MILESTONES,
  POINTS,
  RAMP_COMBO_WINDOW,
  type BonusAward,
} from './rules.ts';
import {
  ATTIC,
  ATTIC_EXIT_GATE,
  ATTIC_MOUTH_GATE,
  ATTIC_TARGETS,
  BONUS_CHUTE,
  BUMPERS,
  CHARGE_TIME,
  COIN_ZONES,
  DROP_TARGETS,
  FLIPPERS,
  FLIPPER_Y,
  GATE,
  KICKBACK,
  LANES,
  LANE_X,
  PLUNGER_Y,
  PULL_DISTANCE,
  RAIL,
  RAMP,
  REST_X,
  REST_Y,
  SAUCERS,
  SLINGS,
  SPINNER,
  STANDUPS,
  TABLE_H,
  WALLS,
  WALL_R,
  inPolygon,
  launchSpeed,
  type Point,
  type RideDef,
  type SaucerId,
  type SlingShape,
  type Zone,
} from './table.ts';
import { trackAt } from './path.ts';

export * from './rules.ts';
export * from './table.ts';

const GRAVITY = 900;
/** 속도 상한 — 한 번 나눠 적분할 때 3.6쯤 움직여서 벽(공 반지름 9 + 벽 2)을 뚫지 못한다 */
const MAX_SPEED = 1700;
const SUBSTEPS = 8;
const FLIPPER_R = 7;
const TARGET_R = 3;

const COIN_SPAWN_INTERVAL = 3.5;
const COMBO_WINDOW = 1.2;
const COMBO_STEP = 5;

const SLING_KICK = 760;
/** 슬링샷이 반응하는 최소 충돌 속도 — 굴러 내려오는 공은 차지 않는다 */
const SLING_TRIGGER = 90;
const TARGET_TRIGGER = 40;

const SAUCER_HOLD = 0.9;
const SAUCER_LOCK_HOLD = 1.6;
/** 구멍이 공을 뱉은 뒤 다시 붙잡기까지 */
const SAUCER_COOLDOWN = 0.5;

/** 스피너: 지나가는 속도 180마다 한 번 돌고(1~8번), 이 간격으로 한 번씩 점수를 준다 */
const SPINNER_SPEED_PER_SPIN = 180;
const SPINNER_MAX_SPINS = 8;
const SPINNER_TICK = 0.06;

export interface Bumper {
  x: number;
  y: number;
  r: number;
  /** 공을 차 내는 힘 */
  kick: number;
  /** 2층 다락의 범퍼 */
  attic?: boolean;
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
  /** 2층 다락의 자동 키커 */
  kicker?: boolean;
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

/** 2층 타깃 — 다락 위쪽의 가로 막대. 쓰러지지 않고 불만 켜진다 */
export interface AtticTarget {
  x1: number;
  x2: number;
  y: number;
  lit: boolean;
  flash: number;
}

/** 오른쪽 타깃 — 쓰러지지 않고 불만 켜진다 */
export interface Standup {
  x: number;
  y1: number;
  y2: number;
  lit: boolean;
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
  /** 구멍에 붙잡혀 있는 남은 시간 (0이면 자유)과 붙잡은 구멍 */
  held: number;
  heldBy: SaucerId | null;
  slow: number;
  /** 0 = 1층, 1 = 2층 다락 (다락 안에 있으면 1) */
  level: 0 | 1;
  /** 램프 난간 사이에 있는지 — 램프를 올라와서 다락에 들어간 것인지 알려고 적어 둔다 */
  onRamp: boolean;
  /** 2층에 머문 시간 */
  atticTime: number;
  /** 정해진 길(레일·킥백)을 타는 중이면 그 길과 지나온 거리·속도. 타는 동안에는 아무것과도 부딪히지 않는다 */
  ride: Ride | null;
}

export interface Ride {
  track: 'kick' | 'rail' | 'chute';
  s: number;
  v: number;
}

/** 공 하나를 만든다 (안 준 값은 멈춘 상태) */
export function makeBall(init: Partial<Ball> & { x: number; y: number }): Ball {
  return { id: 0, vx: 0, vy: 0, held: 0, heldBy: null, slow: 0, level: 0, onRamp: false, atticTime: 0, ride: null, ...init };
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
  | { type: 'combo'; count: number; points: number; x: number; y: number }
  | { type: 'coin'; x: number; y: number; coins: number; points: number }
  | { type: 'milestone'; score: number; coins: number }
  /** x는 마지막 공이 판 아래로 나간 가로 위치 */
  | { type: 'drain'; ballsLeft: number; x: number }
  | { type: 'gameOver' }
  | { type: 'kickback'; x: number; y: number }
  | { type: 'standup'; x: number; y: number; points: number }
  /** relit은 꺼져 있던 킥백이 다시 켜졌을 때 true */
  | { type: 'standupBank'; points: number; relit: boolean }
  | { type: 'spinner'; x: number; y: number; points: number }
  | { type: 'bonus'; x: number; y: number; award: BonusAward; points: number; coins: number }
  /** 램프를 올라 2층에 들어감. combo는 이번에 곱해진 배수(1~5) */
  | { type: 'ramp'; x: number; y: number; points: number; combo: number }
  | { type: 'atticTarget'; x: number; y: number; points: number }
  | { type: 'jackpotLit' }
  | { type: 'atticHole'; x: number; y: number; points: number; jackpot: boolean }
  /** 다락 출구에서 레일을 타기 시작함 / 레일 끝에서 내려옴 */
  | { type: 'rail'; x: number; y: number }
  | { type: 'railEnd'; x: number; y: number };

function createSling(shape: SlingShape): Sling {
  // 차는 면(tip→top)의 법선 중 판 안쪽(toward)을 보는 쪽
  const ex = shape.top.x - shape.tip.x;
  const ey = shape.top.y - shape.tip.y;
  const len = Math.hypot(ex, ey);
  let nx = -ey / len;
  let ny = ex / len;
  const mx = (shape.top.x + shape.tip.x) / 2;
  const my = (shape.top.y + shape.tip.y) / 2;
  if (nx * (shape.toward.x - mx) + ny * (shape.toward.y - my) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { side: shape.side, top: shape.top, corner: shape.corner, tip: shape.tip, nx, ny, kicker: shape.kicker, flash: 0, cooldown: 0 };
}

function createBumpers(): Bumper[] {
  return BUMPERS.map((b) => ({ ...b, flash: 0, cooldown: 0 }));
}

/** 정해진 길 — 길 위의 공은 물리 계산을 하지 않는다 */
const RIDES: Record<Ride['track'], RideDef> = {
  kick: KICKBACK.ride,
  chute: BONUS_CHUTE,
  rail: RAIL.ride,
};

const inZone = (p: Point, z: Zone) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

function createAtticTargets(): AtticTarget[] {
  return ATTIC_TARGETS.map((t) => ({ ...t, lit: false, flash: 0 }));
}

function createStandups(): Standup[] {
  return STANDUPS.map((t) => ({ ...t, lit: false, flash: 0 }));
}

function createTargets(): DropTarget[] {
  return DROP_TARGETS.map((t) => ({ ...t, down: false, flash: 0 }));
}

function createLanes(): RolloverLane[] {
  return LANES.map((l) => ({ ...l, lit: false, flash: 0, cooldown: 0 }));
}

function createFlippers(): Flipper[] {
  return FLIPPERS.map((f) => ({ ...f, angle: f.rest, angVel: 0, pressed: false }));
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
  slings: Sling[] = SLINGS.map(createSling);
  targets: DropTarget[] = createTargets();
  standups: Standup[] = createStandups();
  atticTargets: AtticTarget[] = createAtticTargets();
  /** 2층 타깃을 다 맞혀 잭팟 구멍에 불이 켜졌는지 */
  jackpotLit = false;
  /** 램프를 연속으로 올린 횟수(다음에 곱해질 배수는 이 값 + 1, 최대 5)와 연속이 이어지는 남은 시간 */
  rampCombo = 0;
  rampComboLeft = 0;
  /** 킥백이 켜져 있는지 — 왼쪽 바깥 길의 공을 한 번 살려 준다 */
  kickbackLit = true;
  lanes: RolloverLane[] = createLanes();
  flippers: Flipper[] = createFlippers();
  coins: CoinPickup[] = [];
  /** 구멍마다: 공을 붙잡은 순간 1 → 0으로 줄어드는 번쩍임, 뱉은 뒤 다시 붙잡기까지 남은 시간 */
  saucers: Record<SaucerId, { flash: number; cooldown: number }> = { lock: { flash: 0, cooldown: 0 }, bonus: { flash: 0, cooldown: 0 }, attic: { flash: 0, cooldown: 0 } };
  /** 보너스 구멍이 다음에 줄 보상 (BONUS_ORDER의 몇 번째인지) */
  bonusIndex = 0;
  /** 스피너: 그림용 각도·도는 빠르기, 아직 점수를 주지 않은 바퀴 수 */
  spinner = { angle: 0, speed: 0, pending: 0, flash: 0 };
  time = 0;

  private events: PinballEvent[] = [];
  private nextCoinId = 1;
  private nextBallId = 1;
  private coinTimer = 1.5;
  private comboTimer = 0;
  private bankReset = 0;
  private lanesReset = 0;
  private standupReset = 0;
  private atticReset = 0;
  private pendingLaunch = 0;
  private spinnerTick = 0;
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
    this.balls.push(makeBall({ id: this.nextBallId++, x: REST_X, y: REST_Y + power * PULL_DISTANCE, vy: -launchSpeed(power) }));
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
      for (const ball of this.balls) {
        if (ball.held > 0) continue;
        if (ball.ride) this.advanceRide(ball, h);
        else this.integrateBall(ball, h);
      }
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
    for (const t of this.standups) t.flash = Math.max(0, t.flash - frame * 3);
    for (const t of this.atticTargets) t.flash = Math.max(0, t.flash - frame * 3);
    if (this.rampComboLeft > 0) {
      this.rampComboLeft -= frame;
      if (this.rampComboLeft <= 0) {
        this.rampComboLeft = 0;
        this.rampCombo = 0;
      }
    }
    if (this.atticReset > 0) {
      this.atticReset -= frame;
      if (this.atticReset <= 0) for (const t of this.atticTargets) t.lit = false;
    }
    for (const l of this.lanes) {
      l.flash = Math.max(0, l.flash - frame * 2);
      l.cooldown = Math.max(0, l.cooldown - frame);
    }
    for (const sc of Object.values(this.saucers)) {
      sc.flash = Math.max(0, sc.flash - frame * 1.5);
      sc.cooldown = Math.max(0, sc.cooldown - frame);
    }
    this.updateSpinner(frame);
    this.comboTimer = Math.max(0, this.comboTimer - frame);
    if (this.balls.length > 0) this.saveTimer = Math.max(0, this.saveTimer - frame);

    if (this.bankReset > 0) {
      this.bankReset -= frame;
      if (this.bankReset <= 0) for (const t of this.targets) t.down = false;
    }
    if (this.standupReset > 0) {
      this.standupReset -= frame;
      if (this.standupReset <= 0) for (const t of this.standups) t.lit = false;
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
        const from = ball.heldBy ?? 'lock';
        ball.heldBy = null;
        if (from === 'bonus') {
          // 미끄럼길로 왼쪽 안쪽 길까지 내려 준다
          ball.ride = { track: 'chute', s: 0, v: BONUS_CHUTE.startSpeed };
        } else if (from === 'attic') {
          // 다락 안쪽(왼쪽 아래 범퍼 쪽)으로 내보낸다
          ball.vx = -260 - this.random() * 80;
          ball.vy = 80 + this.random() * 60;
        } else {
          ball.vx = -470 - this.random() * 80;
          ball.vy = -420 - this.random() * 60;
        }
        this.saucers[from].cooldown = SAUCER_COOLDOWN;
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
    // 램프 위에서는 오르막이라 더 세게 아래로 당겨진다
    ball.vy += (GRAVITY + (ball.onRamp ? RAMP.pull : 0)) * h;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > MAX_SPEED) {
      ball.vx = (ball.vx / speed) * MAX_SPEED;
      ball.vy = (ball.vy / speed) * MAX_SPEED;
    }
    const prevY = ball.y;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    this.checkSpinner(ball, prevY);

    for (const w of WALLS) {
      if (w.oneWay && ball.vy < 0) continue;
      collideCapsule(ball, w.ax, w.ay, w.bx, w.by, WALL_R, w.bounce);
    }
    if (this.gateClosed) collideCapsule(ball, GATE.ax, GATE.ay, GATE.bx, GATE.by, WALL_R, GATE.bounce);
    // 다락의 입구는 2층 공에게, 출구는 1층 공에게 벽이다
    const gate = ball.level === 1 ? ATTIC_MOUTH_GATE : ATTIC_EXIT_GATE;
    collideCapsule(ball, gate.ax, gate.ay, gate.bx, gate.by, WALL_R, gate.bounce);
    if (!this.gateClosed && ball.x < LANE_X - BALL_R - 4 && ball.y < 300) this.gateClosed = true;

    for (const s of this.slings) this.collideSling(ball, s);
    for (const t of this.targets) this.collideTarget(ball, t);
    for (const t of this.standups) this.collideStandup(ball, t);
    for (const t of this.atticTargets) this.collideAtticTarget(ball, t);

    for (const f of this.flippers) {
      const tip = flipperTip(f);
      collideCapsule(ball, f.px, f.py, tip.x, tip.y, FLIPPER_R, 0.25, (cx, cy) => [-f.angVel * (cy - f.py), f.angVel * (cx - f.px)]);
    }

    this.bumpers.forEach((b, i) => this.collideBumper(ball, b, i));
    this.checkKickback(ball);
    this.checkLanes(ball);
    this.checkSaucers(ball);
    this.updateLevel(ball);

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

  /** 정해진 길 위의 공을 길 따라 옮긴다. 끝에 닿으면 놓아준다 */
  private advanceRide(ball: Ball, h: number): void {
    const ride = ball.ride;
    if (!ride) return;
    const def = RIDES[ride.track];
    const here = trackAt(def.track, ride.s);
    ride.v = Math.max(def.minSpeed, Math.min(def.maxSpeed, ride.v + def.accel * here.ty * h));
    let s = ride.s + ride.v * h;
    // 같은 길의 앞 공을 지나치지 않는다
    for (const other of this.balls) {
      if (other !== ball && other.ride && other.ride.track === ride.track && other.ride.s > ride.s) s = Math.min(s, other.ride.s - 2 * BALL_R);
    }
    ride.s = Math.max(ride.s, s);
    const at = trackAt(def.track, ride.s);
    ball.x = at.x;
    ball.y = at.y;
    ball.vx = at.tx * ride.v;
    ball.vy = at.ty * ride.v;
    if (ride.s >= def.track.length) {
      ball.ride = null;
      ball.vx = def.release.vx;
      ball.vy = def.release.vy;
      if (ride.track === 'rail') {
        ball.level = 0;
        this.events.push({ type: 'railEnd', x: ball.x, y: ball.y });
      }
    }
  }

  /** 왼쪽 바깥 길 바닥에 닿은 공: 킥백이 켜져 있으면 살려서 판 안으로 올려 보낸다 */
  private checkKickback(ball: Ball): void {
    if (!this.kickbackLit || !inZone(ball, KICKBACK.sensor)) return;
    this.kickbackLit = false;
    ball.ride = { track: 'kick', s: 0, v: KICKBACK.ride.startSpeed };
    this.events.push({ type: 'kickback', x: ball.x, y: ball.y });
  }

  private collideStandup(ball: Ball, t: Standup): void {
    const c = collideCapsule(ball, t.x, t.y1, t.x, t.y2, TARGET_R, 0.35);
    // 켜진 타깃은 튕기기만 한다
    if (!c || c.impact < TARGET_TRIGGER || t.lit) return;
    t.lit = true;
    t.flash = 1;
    const y = (t.y1 + t.y2) / 2;
    const points = this.award(POINTS.standup);
    this.events.push({ type: 'standup', x: t.x, y, points });
    this.hitCombo(t.x, y);
    if (this.standups.every((x) => x.lit)) {
      const bank = this.award(POINTS.standupBank);
      const relit = !this.kickbackLit;
      this.kickbackLit = true;
      this.standupReset = 1.0;
      this.events.push({ type: 'standupBank', points: bank, relit });
    }
  }

  /** 공끼리 부딪힘 (멀티볼) — 같은 무게의 탄성 충돌 */
  private collideBalls(): void {
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i];
        const b = balls[j];
        if (a.held > 0 || b.held > 0 || a.ride || b.ride) continue;
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
    const points = this.award(s.kicker ? POINTS.kicker : POINTS.sling);
    this.events.push({ type: 'sling', x: ball.x, y: ball.y, points, nx: s.nx, ny: s.ny });
    this.hitCombo(ball.x, ball.y);
  }

  private collideTarget(ball: Ball, t: DropTarget): void {
    if (t.down) return;
    const c = collideCapsule(ball, t.x, t.y1, t.x, t.y2, TARGET_R, 0.35);
    if (!c || c.impact < TARGET_TRIGGER) return;
    t.down = true;
    t.flash = 1;
    const points = this.award(POINTS.target);
    this.events.push({ type: 'target', x: t.x, y: (t.y1 + t.y2) / 2, points });
    this.hitCombo(t.x, (t.y1 + t.y2) / 2);
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
    const kick = Math.max(0, b.kick - out);
    ball.vx += nx * kick;
    ball.vy += ny * kick;
    if (b.cooldown <= 0) {
      b.cooldown = 0.08;
      b.flash = 1;
      const points = this.award(b.attic ? POINTS.atticBumper : POINTS.bumper);
      this.events.push({ type: 'bumper', x: b.x, y: b.y, points, index });
      this.hitCombo(b.x, b.y);
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
      this.hitCombo(l.x, l.y);
      if (!wasLit && this.lanes.every((x) => x.lit) && this.lanesReset <= 0) {
        this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + 1);
        const bonus = this.award(POINTS.lanes);
        this.lanesReset = 1.0;
        for (const x of this.lanes) x.flash = 1;
        this.events.push({ type: 'lanes', multiplier: this.multiplier, points: bonus });
      }
    }
  }

  /** 구멍 가까이 온 공을 붙잡는다. 구멍마다 한 번에 공 하나 */
  private checkSaucers(ball: Ball): void {
    for (const id of Object.keys(SAUCERS) as SaucerId[]) {
      const def = SAUCERS[id];
      if (this.saucers[id].cooldown > 0 || this.balls.some((b) => b.heldBy === id)) continue;
      if (Math.hypot(ball.x - def.x, ball.y - def.y) > def.catchR) continue;
      ball.x = def.x;
      ball.y = def.y;
      ball.vx = 0;
      ball.vy = 0;
      ball.heldBy = id;
      ball.held = SAUCER_HOLD;
      this.saucers[id].flash = 1;
      if (id === 'lock') this.enterLock(ball);
      else if (id === 'bonus') this.enterBonus();
      else this.enterAtticHole();
      this.hitCombo(def.x, def.y);
      return;
    }
  }

  private enterLock(ball: Ball): void {
    const { x, y } = SAUCERS.lock;
    if (this.lockLit && !this.isMultiball) {
      // 멀티볼: 이 공을 붙잡아 두는 동안 발사대에서 공 하나를 더 쏜다
      this.lockLit = false;
      ball.held = SAUCER_LOCK_HOLD;
      this.pendingLaunch = 0.5;
      const points = this.award(POINTS.saucer);
      this.events.push({ type: 'saucer', x, y, points, jackpot: false });
      this.events.push({ type: 'multiball' });
    } else {
      const jackpot = this.isMultiball;
      const points = this.award(jackpot ? POINTS.jackpot : POINTS.saucer);
      this.events.push({ type: 'saucer', x, y, points, jackpot });
    }
  }

  /** 2층 구멍: 잭팟 불이 켜져 있으면 다락 잭팟 */
  private enterAtticHole(): void {
    const { x, y } = SAUCERS.attic;
    const jackpot = this.jackpotLit;
    this.jackpotLit = false;
    const points = this.award(jackpot ? POINTS.atticJackpot : POINTS.atticHole);
    this.events.push({ type: 'atticHole', x, y, points, jackpot });
  }

  /** 공이 어느 층에 있는지 위치로 정하고, 램프를 올라 다락에 들어온 순간에 점수를 준다 */
  private updateLevel(ball: Ball): void {
    const inAttic = inPolygon(ATTIC.polygon, ball);
    if (inAttic && ball.level === 0) {
      ball.level = 1;
      ball.atticTime = 0;
      if (ball.onRamp) this.climbedRamp(ball);
    } else if (!inAttic && ball.level === 1) {
      const [a, b] = ATTIC.exit;
      const throughExit = ball.y > a.y - BALL_R && ball.x > Math.min(a.x, b.x) - BALL_R && ball.x < Math.max(a.x, b.x) + BALL_R;
      if (throughExit) this.startRail(ball);
      else ball.level = 0;
    }
    ball.onRamp = ball.level === 0 && inPolygon(RAMP.polygon, ball);
  }

  private climbedRamp(ball: Ball): void {
    this.rampCombo = Math.min(MAX_RAMP_COMBO, this.rampCombo + 1);
    this.rampComboLeft = RAMP_COMBO_WINDOW;
    const points = this.award(POINTS.ramp * this.rampCombo);
    this.events.push({ type: 'ramp', x: ball.x, y: ball.y, points, combo: this.rampCombo });
  }

  private collideAtticTarget(ball: Ball, t: AtticTarget): void {
    const c = collideCapsule(ball, t.x1, t.y, t.x2, t.y, TARGET_R, 0.35);
    if (!c || c.impact < TARGET_TRIGGER || t.lit) return;
    t.lit = true;
    t.flash = 1;
    const x = (t.x1 + t.x2) / 2;
    const points = this.award(POINTS.atticTarget);
    this.events.push({ type: 'atticTarget', x, y: t.y, points });
    this.hitCombo(x, t.y);
    if (this.atticTargets.every((a) => a.lit)) {
      this.jackpotLit = true;
      this.atticReset = 1.0;
      this.events.push({ type: 'jackpotLit' });
    }
  }

  /** 보너스 구멍: 차례대로 다음 보상을 준다 */
  private enterBonus(): void {
    const { x, y } = SAUCERS.bonus;
    const award = BONUS_ORDER[this.bonusIndex % BONUS_ORDER.length];
    this.bonusIndex = (this.bonusIndex + 1) % BONUS_ORDER.length;
    let points = 0;
    let coins = 0;
    if (award === 'small') points = this.award(POINTS.bonusSmall);
    else if (award === 'big') points = this.award(POINTS.bonusBig);
    else if (award === 'coins') {
      coins = Math.min(BONUS_COINS, MAX_COINS_PER_RUN - this.coinsEarned);
      this.coinsEarned += coins;
    } else if (award === 'save') {
      this.saveUsed = false;
      this.saveTimer = BALL_SAVE_TIME;
    } else this.lockLit = true;
    this.events.push({ type: 'bonus', x, y, award, points, coins });
  }

  /** 공이 스피너 선을 지나갔으면 속도에 따라 몇 바퀴 돌린다 */
  private checkSpinner(ball: Ball, prevY: number): void {
    if ((prevY - SPINNER.y) * (ball.y - SPINNER.y) >= 0 || Math.abs(ball.x - SPINNER.x) > SPINNER.half) return;
    const spins = Math.max(1, Math.min(SPINNER_MAX_SPINS, Math.round(Math.abs(ball.vy) / SPINNER_SPEED_PER_SPIN)));
    this.spinner.pending += spins;
    this.spinner.speed = Math.sign(ball.vy || 1) * (8 + spins * 4);
  }

  /** 스피너가 도는 동안 한 바퀴에 한 번씩 점수를 준다 */
  private updateSpinner(frame: number): void {
    const sp = this.spinner;
    sp.flash = Math.max(0, sp.flash - frame * 6);
    sp.angle += sp.speed * frame;
    if (sp.pending <= 0) {
      // 다 돌았으면 천천히 멈춘다
      sp.speed *= Math.max(0, 1 - frame * 4);
      return;
    }
    this.spinnerTick -= frame;
    while (this.spinnerTick <= 0 && sp.pending > 0) {
      this.spinnerTick += SPINNER_TICK;
      sp.pending -= 1;
      sp.flash = 1;
      const points = this.award(POINTS.spinner);
      this.events.push({ type: 'spinner', x: SPINNER.x, y: SPINNER.y, points });
    }
    if (sp.pending <= 0) this.spinnerTick = 0;
  }

  /** 짧은 간격으로 계속 맞히면 콤보가 쌓이고 COMBO_STEP번마다 보너스 */
  private hitCombo(x: number, y: number): void {
    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
    this.comboTimer = COMBO_WINDOW;
    if (this.comboCount % COMBO_STEP === 0) {
      const points = this.award(this.comboCount * POINTS.comboPerHit);
      this.events.push({ type: 'combo', count: this.comboCount, points, x, y });
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
    if (this.coinTimer > 0 || this.coins.length >= MAX_COINS_ON_TABLE) return;
    this.coinTimer = COIN_SPAWN_INTERVAL / (1 + this.coinSpawn);
    const area = COIN_ZONES.reduce((sum, z) => sum + z.w * z.h, 0);
    for (let tries = 0; tries < 30; tries++) {
      // 넓이에 비례해 구역 하나를 고르고 그 안의 한 점을 잡는다
      let pick = this.random() * area;
      const zone = COIN_ZONES.find((z) => (pick -= z.w * z.h) < 0) ?? COIN_ZONES[0];
      const x = zone.x + this.random() * zone.w;
      const y = zone.y + this.random() * zone.h;
      const clearOfBumpers = this.bumpers.every((b) => Math.hypot(b.x - x, b.y - y) > b.r + 30);
      const clearOfSaucer = Object.values(SAUCERS).every((sc) => Math.hypot(sc.x - x, sc.y - y) > 40);
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
      if (ball.held > 0 || ball.ride) continue;

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
        if (this.balls.length === 0 && this.pendingLaunch <= 0) this.loseBall(ball.x);
        continue;
      }

      // 2층에 너무 오래 머문 공은 출구 바로 아래로 내보낸다
      if (ball.level === 1) {
        ball.atticTime += frame;
        if (ball.atticTime > ATTIC_MAX_STAY) this.leaveAttic(ball);
      }

      // 공이 어딘가에 끼어 멈추면 살짝 튕겨 준다 (플리퍼로 공을 잡아 둔 상태는 제외)
      const speed = Math.hypot(ball.vx, ball.vy);
      // 올린 플리퍼 위에 받쳐 둔 공만 봐준다. 플리퍼에서 먼 곳에 멈춘 공은 누르고 있어도 튕겨 준다
      const cradled = holding && ball.y > FLIPPER_Y - 60;
      ball.slow = speed < 15 && !cradled ? ball.slow + frame : 0;
      if (ball.slow > 2.5) {
        ball.slow = 0;
        ball.vy = -420;
        ball.vx = (this.random() - 0.5) * 300;
      }
    }
  }

  /** 다락 안에 너무 오래 있던 공을 출구로 옮겨 레일을 태운다 */
  private leaveAttic(ball: Ball): void {
    this.startRail(ball);
  }

  /** 레일 타기 시작 — 타는 동안은 2층(level 1)으로 둔다 (그릴 때 위층, 화면은 1층 공을 먼저 따라간다) */
  private startRail(ball: Ball): void {
    ball.level = 1;
    ball.atticTime = 0;
    ball.onRamp = false;
    ball.ride = { track: 'rail', s: 0, v: RAIL.ride.startSpeed };
    this.events.push({ type: 'rail', x: ball.x, y: ball.y });
  }

  /** 판 위의 마지막 공이 빠졌을 때 (x는 공이 나간 가로 위치) */
  private loseBall(x: number): void {
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
      this.events.push({ type: 'drain', ballsLeft: 0, x });
      this.events.push({ type: 'gameOver' });
      return;
    }
    this.plungerLoaded = true;
    this.charging = false;
    this.charge = 0;
    this.gateClosed = false;
    this.kickbackLit = true;
    this.events.push({ type: 'drain', ballsLeft: this.ballsLeft, x });
  }
}
