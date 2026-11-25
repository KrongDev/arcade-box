import { PinballEngine, makeBall, type Ball, type PinballEvent } from '../../src/pinball/engine.ts';

/** 같은 씨앗이면 같은 수열을 주는 난수 (테스트 재현용) */
export function seeded(seed: number): () => number {
  let s = seed % 2147483647 || 1;
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
