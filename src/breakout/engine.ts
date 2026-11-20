import { circleRect, reflect } from '../arcade/collision.ts';
import {
  BALLS_PER_GAME,
  BALL_R,
  DROP_SIZE,
  DROP_SPEED,
  FIELD_H,
  FIELD_W,
  LAUNCH_SPREAD,
  MAX_BALLS,
  MAX_BOUNCE_ANGLE,
  MAX_COINS_PER_RUN,
  MAX_SCORE,
  MIN_VERTICAL,
  PADDLE_H,
  PADDLE_W,
  PADDLE_WIDE_W,
  PADDLE_Y,
  POINTS,
  POWER_TIME,
  IDLE_NUDGE_AFTER,
  NUDGE_MAX,
  NUDGE_MIN,
  ballSpeed,
  chainMultiplier,
  coinPayout,
  stageBonus,
} from './rules.ts';
import { buildStage, type Brick, type BrickKind, type PowerKind, type Special, type StageOptions } from './stages.ts';

/**
 * 벽돌깨기 엔진 — 한 판의 규칙과 움직임. 화면·소리·저장과 무관하다.
 * 입력(movePaddle·launch)과 시간(step)을 받아 상태를 바꾸고, 일어난 일을 이벤트로 남긴다.
 * 화면은 상태를 그리고, 이벤트로 소리·진동·연출을 낸다.
 */

/** 장착 아이템 능력 — 코인 얻는 양에만 영향을 준다 (점수·순위에는 영향 없음) */
export interface BreakoutGear {
  /** 동전 벽돌이 더 많이 나오는 비율 */
  coinSpawn: number;
  /** 동전 하나에서 받는 코인이 느는 비율 */
  coinValue: number;
}

export const BREAKOUT_NO_GEAR: BreakoutGear = { coinSpawn: 0, coinValue: 0 };

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Paddle {
  /** 가운데 x */
  x: number;
  /** 윗면 y */
  y: number;
  w: number;
  h: number;
}

export type DropKind = 'coin' | PowerKind;

export interface Drop {
  id: number;
  /** 가운데 */
  x: number;
  y: number;
  kind: DropKind;
}

export type EngineState = 'ready' | 'live' | 'over';

export type BreakoutEvent =
  | { type: 'launch' }
  | { type: 'wall'; x: number; y: number }
  | { type: 'paddle'; x: number; y: number }
  | { type: 'brickHit'; x: number; y: number; row: number }
  | { type: 'brickBreak'; x: number; y: number; row: number; kind: BrickKind; special: Special; points: number }
  | { type: 'chain'; multiplier: number }
  | { type: 'coin'; x: number; y: number; coins: number }
  | { type: 'power'; kind: PowerKind; x: number; y: number }
  | { type: 'ballLost'; x: number }
  | { type: 'lifeLost'; livesLeft: number }
  | { type: 'stageClear'; stage: number; bonus: number }
  | { type: 'gameOver' };

export type StageBuilder = (stage: number, rng: () => number, opts: StageOptions) => Brick[];

export interface EngineOptions {
  rng?: () => number;
  gear?: BreakoutGear;
  /** 스테이지 벽돌을 만드는 방법 (테스트에서 바꿔 끼운다) */
  stageBuilder?: StageBuilder;
}

/** 한 번에 움직이는 시간 — 가장 빠른 공도 한 번에 반지름보다 적게 움직여 벽돌을 뚫지 않는다 */
const SUBSTEP = 1 / 240;
const MAX_FRAME = 0.05;

export class BreakoutEngine {
  state: EngineState = 'ready';
  stage = 1;
  lives = BALLS_PER_GAME;
  score = 0;
  coinsEarned = 0;
  /** 패들에 닿지 않고 이어서 깬 벽돌 수 */
  chain = 0;
  /** 이번 스테이지에서 공이 날아다닌 시간(초) — 공이 점점 빨라진다 */
  stageTime = 0;
  /** 판이 시작되고 흐른 시간(초) — 화면 깜빡임 등에 쓴다 */
  time = 0;
  /** 마지막으로 벽돌을 맞힌 뒤 흐른 시간(초) — 길어지면 튀는 각도를 흔든다 */
  idleTime = 0;
  readonly paddle: Paddle = { x: FIELD_W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H };
  balls: Ball[] = [];
  bricks: Brick[] = [];
  drops: Drop[] = [];
  /** 아이템 남은 시간(초) */
  readonly powers = { wide: 0, slow: 0 };

  private readonly rng: () => number;
  private readonly gear: BreakoutGear;
  private readonly stageBuilder: StageBuilder;
  private events: BreakoutEvent[] = [];
  private nextId = 1;
  /** 아직 코인이 되지 못한 동전 코인의 소수점 */
  private coinCarry = 0;

  constructor(opts: EngineOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.gear = opts.gear ?? BREAKOUT_NO_GEAR;
    this.stageBuilder = opts.stageBuilder ?? buildStage;
    this.bricks = this.stageBuilder(this.stage, this.rng, { coinSpawn: this.gear.coinSpawn });
    this.resetBall();
  }

  get multiplier(): number {
    return chainMultiplier(this.chain);
  }

  /** 지금 공 속력 */
  speed(): number {
    return ballSpeed(this.stage, this.stageTime, this.powers.slow > 0);
  }

  /** 패들 가운데를 x로 옮긴다. 공이 패들 위에서 기다리는 중이면 공도 따라온다 */
  movePaddle(x: number): void {
    const half = this.paddle.w / 2;
    this.paddle.x = Math.max(half, Math.min(FIELD_W - half, x));
    if (this.state === 'ready') this.holdBall();
  }

  /** 패들 위의 공을 쏜다. 쐈으면 true */
  launch(): boolean {
    if (this.state !== 'ready') return false;
    const ball = this.balls[0];
    const angle = (this.rng() * 2 - 1) * LAUNCH_SPREAD;
    const s = this.speed();
    ball.vx = Math.sin(angle) * s;
    ball.vy = -Math.cos(angle) * s;
    this.state = 'live';
    this.emit({ type: 'launch' });
    return true;
  }

  get isOver(): boolean {
    return this.state === 'over';
  }

  step(dt: number): void {
    if (this.isOver) return;
    let left = Math.min(Math.max(0, dt), MAX_FRAME);
    while (left > 1e-9 && !this.isOver) {
      const h = Math.min(SUBSTEP, left);
      left -= h;
      this.tick(h);
    }
  }

  drainEvents(): BreakoutEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private tick(h: number): void {
    this.time += h;
    this.tickPowers(h);
    this.moveDrops(h);
    if (this.state !== 'live') return;
    this.stageTime += h;
    this.idleTime += h;
    const speed = this.speed();
    for (const ball of [...this.balls]) this.moveBall(ball, speed, h);
    this.removeFallenBalls();
    if (this.state === 'live' && this.bricks.length === 0) this.clearStage();
  }

  private tickPowers(h: number): void {
    this.powers.slow = Math.max(0, this.powers.slow - h);
    if (this.powers.wide > 0) {
      this.powers.wide = Math.max(0, this.powers.wide - h);
      if (this.powers.wide === 0) this.setPaddleWidth(PADDLE_W);
    }
  }

  private moveBall(ball: Ball, speed: number, h: number): void {
    // 속력을 지금 속력에 맞춘다(방향은 그대로)
    const len = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = (ball.vx / len) * speed;
    ball.vy = (ball.vy / len) * speed;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;

    this.bounceWalls(ball);
    this.bouncePaddle(ball, speed);
    this.hitBrick(ball, speed);
  }

  private bounceWalls(ball: Ball): void {
    if (ball.x - BALL_R < 0) {
      ball.x = BALL_R;
      ball.vx = Math.abs(ball.vx);
      this.emit({ type: 'wall', x: ball.x, y: ball.y });
    } else if (ball.x + BALL_R > FIELD_W) {
      ball.x = FIELD_W - BALL_R;
      ball.vx = -Math.abs(ball.vx);
      this.emit({ type: 'wall', x: ball.x, y: ball.y });
    }
    if (ball.y - BALL_R < 0) {
      ball.y = BALL_R;
      ball.vy = Math.abs(ball.vy);
      this.emit({ type: 'wall', x: ball.x, y: ball.y });
    }
  }

  /**
   * 패들 윗면에 맞으면 맞은 자리에 따라 각도를 정해 위로 튄다 (가운데는 곧장, 끝은 비스듬히).
   * 옆면에 맞으면 옆으로 밀려나기만 하고 그대로 떨어진다.
   */
  private bouncePaddle(ball: Ball, speed: number): void {
    if (ball.vy <= 0) return;
    const p = this.paddle;
    const contact = circleRect(ball.x, ball.y, BALL_R, { x: p.x - p.w / 2, y: p.y, w: p.w, h: p.h });
    if (!contact) return;
    if (ball.y > p.y + p.h / 2) {
      ball.x += contact.nx * contact.depth;
      ball.y += contact.ny * contact.depth;
      const v = reflect(ball.vx, ball.vy, contact.nx, contact.ny);
      ball.vx = v.vx;
      ball.vy = v.vy;
      return;
    }
    const offset = Math.max(-1, Math.min(1, (ball.x - p.x) / (p.w / 2)));
    let angle = offset * MAX_BOUNCE_ANGLE;
    if (this.idleTime > IDLE_NUDGE_AFTER) {
      const turn = NUDGE_MIN + this.rng() * (NUDGE_MAX - NUDGE_MIN);
      angle = Math.max(-MAX_BOUNCE_ANGLE, Math.min(MAX_BOUNCE_ANGLE, angle + (this.rng() < 0.5 ? -turn : turn)));
    }
    ball.vx = Math.sin(angle) * speed;
    ball.vy = -Math.cos(angle) * speed;
    ball.y = p.y - BALL_R;
    this.chain = 0;
    this.emit({ type: 'paddle', x: ball.x, y: p.y });
  }

  /** 한 번에 벽돌 하나만 맞힌다 (가장 깊이 겹친 벽돌) */
  private hitBrick(ball: Ball, speed: number): void {
    let target: Brick | null = null;
    let contact: ReturnType<typeof circleRect> = null;
    for (const b of this.bricks) {
      const c = circleRect(ball.x, ball.y, BALL_R, b);
      if (c && (!contact || c.depth > contact.depth)) {
        target = b;
        contact = c;
      }
    }
    if (!target || !contact) return;

    ball.x += contact.nx * contact.depth;
    ball.y += contact.ny * contact.depth;
    const v = reflect(ball.vx, ball.vy, contact.nx, contact.ny);
    ball.vx = v.vx;
    ball.vy = v.vy;
    keepSteep(ball, speed);
    this.damage(target);
  }

  private damage(brick: Brick): void {
    const cx = brick.x + brick.w / 2;
    const cy = brick.y + brick.h / 2;
    this.idleTime = 0;
    brick.hp -= 1;
    if (brick.hp > 0) {
      this.addScore(POINTS.toughHit);
      this.emit({ type: 'brickHit', x: cx, y: cy, row: brick.row });
      return;
    }
    this.bricks = this.bricks.filter((b) => b !== brick);
    const before = this.multiplier;
    this.chain += 1;
    const multiplier = this.multiplier;
    if (multiplier > before) this.emit({ type: 'chain', multiplier });
    const powerBrick = brick.special !== null && brick.special !== 'coin';
    const base = powerBrick ? POINTS.special : brick.kind === 'tough' ? POINTS.tough : POINTS.normal;
    const points = base * multiplier;
    this.addScore(points);
    this.emit({ type: 'brickBreak', x: cx, y: cy, row: brick.row, kind: brick.kind, special: brick.special, points });
    if (brick.special !== null) this.drops.push({ id: this.nextId++, x: cx, y: cy, kind: brick.special });
  }

  private moveDrops(h: number): void {
    if (this.drops.length === 0) return;
    const p = this.paddle;
    const kept: Drop[] = [];
    for (const d of this.drops) {
      d.y += DROP_SPEED * h;
      const half = DROP_SIZE / 2;
      const caught =
        this.state !== 'over' &&
        d.y + half >= p.y &&
        d.y - half <= p.y + p.h &&
        d.x + half >= p.x - p.w / 2 &&
        d.x - half <= p.x + p.w / 2;
      if (caught) this.collect(d);
      else if (d.y - half <= FIELD_H) kept.push(d);
    }
    this.drops = kept;
  }

  private collect(d: Drop): void {
    if (d.kind === 'coin') {
      this.coinCarry += coinPayout(this.gear.coinValue);
      const whole = Math.floor(this.coinCarry + 1e-9);
      this.coinCarry -= whole;
      const coins = Math.min(whole, MAX_COINS_PER_RUN - this.coinsEarned);
      this.coinsEarned += coins;
      this.emit({ type: 'coin', x: d.x, y: d.y, coins });
      return;
    }
    if (d.kind === 'wide') {
      this.powers.wide = POWER_TIME.wide;
      this.setPaddleWidth(PADDLE_WIDE_W);
    } else if (d.kind === 'slow') {
      this.powers.slow = POWER_TIME.slow;
    } else if (this.state === 'live') {
      this.splitBalls();
    }
    this.emit({ type: 'power', kind: d.kind, x: d.x, y: d.y });
  }

  /** 굴러다니는 공마다 양옆으로 비스듬한 공을 하나씩 더 만든다 (최대 MAX_BALLS개) */
  private splitBalls(): void {
    const spread = Math.PI / 7;
    for (const ball of [...this.balls]) {
      for (const turn of [-spread, spread]) {
        if (this.balls.length >= MAX_BALLS) return;
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const copy: Ball = {
          id: this.nextId++,
          x: ball.x,
          y: ball.y,
          vx: ball.vx * cos - ball.vy * sin,
          vy: ball.vx * sin + ball.vy * cos,
        };
        keepSteep(copy, Math.hypot(copy.vx, copy.vy));
        this.balls.push(copy);
      }
    }
  }

  private removeFallenBalls(): void {
    const fallen = this.balls.filter((b) => b.y - BALL_R > FIELD_H);
    if (fallen.length === 0) return;
    this.balls = this.balls.filter((b) => !fallen.includes(b));
    if (this.balls.length > 0) {
      for (const b of fallen) this.emit({ type: 'ballLost', x: b.x });
      return;
    }
    this.lives -= 1;
    this.chain = 0;
    if (this.lives <= 0) {
      this.lives = 0;
      this.state = 'over';
      this.drops = [];
      this.emit({ type: 'gameOver' });
      return;
    }
    this.resetBall();
    this.emit({ type: 'lifeLost', livesLeft: this.lives });
  }

  private clearStage(): void {
    // 마지막 벽돌들에서 떨어지던 동전은 받은 것으로 친다 (아이템은 다음 스테이지로 넘어가지 않는다)
    for (const d of this.drops) if (d.kind === 'coin') this.collect(d);
    const bonus = stageBonus(this.stage);
    this.addScore(bonus);
    this.emit({ type: 'stageClear', stage: this.stage, bonus });
    this.stage += 1;
    this.stageTime = 0;
    this.idleTime = 0;
    this.chain = 0;
    this.bricks = this.stageBuilder(this.stage, this.rng, { coinSpawn: this.gear.coinSpawn });
    this.resetBall();
  }

  /** 공 하나만 패들 위에 올리고 아이템·떨어지던 것을 정리한다 */
  private resetBall(): void {
    this.state = 'ready';
    this.drops = [];
    this.powers.slow = 0;
    this.powers.wide = 0;
    this.setPaddleWidth(PADDLE_W);
    this.balls = [{ id: this.nextId++, x: this.paddle.x, y: 0, vx: 0, vy: 0 }];
    this.holdBall();
  }

  private holdBall(): void {
    const ball = this.balls[0];
    if (!ball) return;
    ball.x = this.paddle.x;
    ball.y = this.paddle.y - BALL_R - 1;
  }

  private setPaddleWidth(w: number): void {
    this.paddle.w = w;
    this.movePaddle(this.paddle.x);
  }

  private addScore(points: number): void {
    this.score = Math.min(MAX_SCORE, this.score + points);
  }

  private emit(ev: BreakoutEvent): void {
    this.events.push(ev);
  }
}

/** 공이 너무 눕지 않게 세로 속력을 일정 비율 이상으로 유지한다 */
function keepSteep(ball: Ball, speed: number): void {
  const minVy = speed * MIN_VERTICAL;
  if (Math.abs(ball.vy) >= minVy) return;
  const vy = (ball.vy < 0 ? -1 : 1) * minVy;
  const vx = (ball.vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, speed * speed - vy * vy));
  ball.vx = vx;
  ball.vy = vy;
}
