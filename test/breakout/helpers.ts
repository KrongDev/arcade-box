import { BREAKOUT_NO_GEAR, BreakoutEngine, type BreakoutGear } from '../../src/breakout/engine.ts';
import { BALL_R, BRICK_H, BRICK_W } from '../../src/breakout/rules.ts';
import type { Brick, BrickKind, Special } from '../../src/breakout/stages.ts';

/** 같은 씨앗이면 같은 수열을 주는 난수 (테스트 재현용) */
export function seeded(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

let nextId = 1000;

/** 원하는 자리에 벽돌 하나 */
export function brick(x: number, y: number, kind: BrickKind = 'normal', special: Special = null): Brick {
  return { id: nextId++, row: 0, col: 0, x, y, w: BRICK_W, h: BRICK_H, kind, hp: kind === 'tough' ? 2 : 1, special };
}

/** 스테이지마다 정해 둔 벽돌로 시작하는 엔진 */
export function engineWith(stages: Brick[][], gear: BreakoutGear = BREAKOUT_NO_GEAR): BreakoutEngine {
  return new BreakoutEngine({
    rng: seeded(7),
    gear,
    stageBuilder: (stage) => (stages[stage - 1] ?? stages[stages.length - 1]).map((b) => ({ ...b })),
  });
}

/** 공을 원하는 자리·방향으로 놓는다 (속력은 엔진 속력에 맞춘다) */
export function placeBall(e: BreakoutEngine, x: number, y: number, dirX: number, dirY: number, index = 0): void {
  const s = e.speed();
  const len = Math.hypot(dirX, dirY);
  const ball = e.balls[index];
  ball.x = x;
  ball.y = y;
  ball.vx = (dirX / len) * s;
  ball.vy = (dirY / len) * s;
}

/** 이벤트가 나올 때까지(최대 seconds초) 돌리고 지금까지 모은 이벤트를 준다 */
export function runUntil(e: BreakoutEngine, type: string, seconds = 3): ReturnType<BreakoutEngine['drainEvents']> {
  const events: ReturnType<BreakoutEngine['drainEvents']> = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    e.step(1 / 60);
    const evs = e.drainEvents();
    events.push(...evs);
    if (evs.some((ev) => ev.type === type)) break;
  }
  return events;
}

export { BALL_R };
