import { PinballEngine, makeBall, type Ball, type PinballEvent } from '../../src/pinball/engine.ts';

/**
 * 같은 씨앗이면 같은 수열을 주는 난수 (테스트 재현용).
 * 씨앗은 먼저 한 번 섞는다 — 그대로 쓰면 작은 씨앗의 첫 값이 모두 0 근처로 나오고,
 * 씨앗이 두 배면 수열도 두 배로 따라가서 씨앗을 바꿔도 같은 경우만 겪는다.
 */
export function seeded(seed: number): () => number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  let s = (((h ^ (h >>> 16)) >>> 0) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** 난수를 고정한 엔진 */
export function engineWith(gear: { coinSpawn?: number; coinValue?: number } = {}, seed = 7): PinballEngine {
  return new PinballEngine(seeded(seed), gear);
}

/** 발사대를 비우고 판 위 원하는 자리에 공 하나를 놓는다 (문은 닫힌 상태) */
export function placeBall(e: PinballEngine, at: { x: number; y: number; vx?: number; vy?: number }): Ball {
  e.plungerLoaded = false;
  e.gateClosed = true;
  const ball = makeBall({ id: 1000 + e.balls.length, ...at });
  e.balls.push(ball);
  return ball;
}

/** 판 위의 공을 모두 치운다 (공을 잃은 것으로 세지 않는다) */
export function clearBalls(e: PinballEngine): void {
  e.balls.length = 0;
}

/** seconds초 동안 돌리고 그동안 나온 사건을 모아 준다 */
export function run(e: PinballEngine, seconds: number, dt = 1 / 120): PinballEvent[] {
  const events: PinballEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    e.step(dt);
    events.push(...e.drainEvents());
  }
  return events;
}

/** 조건에 맞는 사건이 나올 때까지(최대 maxSeconds초) 돌리고 지금까지 모은 사건을 준다 */
export function runUntil(e: PinballEngine, pred: PinballEvent['type'] | ((ev: PinballEvent) => boolean), maxSeconds = 3, dt = 1 / 120): PinballEvent[] {
  const match = typeof pred === 'string' ? (ev: PinballEvent) => ev.type === pred : pred;
  const events: PinballEvent[] = [];
  for (let t = 0; t < maxSeconds; t += dt) {
    e.step(dt);
    const evs = e.drainEvents();
    events.push(...evs);
    if (evs.some(match)) break;
  }
  return events;
}

/** 모은 사건에서 그 종류만 고른다 */
export function ofType<T extends PinballEvent['type']>(events: PinballEvent[], type: T): Extract<PinballEvent, { type: T }>[] {
  return events.filter((ev): ev is Extract<PinballEvent, { type: T }> => ev.type === type);
}

// ───────── 봇: 균형과 안정성을 재는 가짜 플레이어 (docs/superpowers/specs의 6.2)

/** 매 프레임 불려서 발사하고 플리퍼를 누른다 */
export type Bot = (e: PinballEngine, dt: number) => void;

const SIDES = ['left', 'right'] as const;

/** 무작위 봇: 0.15~0.65초마다 왼쪽이나 오른쪽을 아무렇게나 0.12~0.32초 누른다. 발사 세기 75~100% */
export function randomBot(seed: number): Bot {
  const r = seeded(seed);
  const hold = { left: 0, right: 0 };
  let wait = 0;
  return (e, dt) => {
    if (e.ballState === 'ready' && !e.charging) e.launch(0.75 + r() * 0.25);
    wait -= dt;
    if (wait <= 0) {
      hold[r() < 0.5 ? 'left' : 'right'] = 0.12 + r() * 0.2;
      wait = 0.15 + r() * 0.5;
    }
    for (const side of SIDES) {
      e.setFlipper(side, hold[side] > 0);
      hold[side] -= dt;
    }
  };
}

/** 반응 봇: 공이 플리퍼 바로 위(판 바닥에서 70~130 위)로 내려오면 그쪽 플리퍼를 누른다 */
export function reactiveBot(seed: number, tableH: number): Bot {
  const r = seeded(seed);
  const hold = { left: 0, right: 0 };
  return (e, dt) => {
    if (e.ballState === 'ready' && !e.charging) e.launch(0.75 + r() * 0.25);
    for (const b of e.balls) {
      if (b.held > 0 || b.ride || b.vy < 0) continue;
      if (b.y > tableH - 130 && b.y < tableH - 70) {
        const side = b.x < 180 ? 'left' : 'right';
        if (hold[side] <= 0 && r() < 0.35) hold[side] = 0.14 + r() * 0.1;
      }
    }
    for (const side of SIDES) {
      e.setFlipper(side, hold[side] > 0);
      hold[side] -= dt;
    }
  };
}

export interface GameStats {
  score: number;
  coins: number;
  seconds: number;
  over: boolean;
  /** 공을 잃은 곳 (남은 공 수가 줄어든 것만 센다) */
  losses: { center: number; left: number; right: number };
  /** 있으면 안 되는 일: 숫자가 깨짐, 공이 판 밖으로 샘, 공이 끼어서 엔진이 튕겨 줌 */
  problems: string[];
}

/** 봇으로 한 판을 끝까지(최대 maxSeconds초) 돌린다 */
export function playGame(e: PinballEngine, bot: Bot, maxSeconds: number, tableW = 400): GameStats {
  const dt = 1 / 60;
  const losses = { center: 0, left: 0, right: 0 };
  const problems: string[] = [];
  let t = 0;
  while (!e.over && t < maxSeconds) {
    bot(e, dt);
    e.step(dt);
    t += dt;
    for (const ev of e.drainEvents()) {
      if (ev.type === 'drain') losses[ev.x < 60 ? 'left' : ev.x > 300 ? 'right' : 'center']++;
      // 공이 2.5초 넘게 멈춰 있어서 엔진이 튕겨 준 것 — 그 자리에 공이 낀다는 뜻이다
      if (ev.type === 'nudge') problems.push(`끼어서 튕겨 줌 (${ev.x.toFixed(0)}, ${ev.y.toFixed(0)}) t=${t.toFixed(1)}`);
    }
    for (const b of e.balls) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) problems.push(`숫자가 깨짐 t=${t.toFixed(1)}`);
      else if (b.x < 0 || b.x > tableW || b.y < -5) problems.push(`판 밖 (${b.x.toFixed(0)}, ${b.y.toFixed(0)}) t=${t.toFixed(1)}`);
    }
    if (problems.length > 5) break;
  }
  return { score: e.score, coins: e.coinsEarned, seconds: t, over: e.over, losses, problems };
}

/** 정렬해서 가운데 값 */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
