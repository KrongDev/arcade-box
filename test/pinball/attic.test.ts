import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBall, type PinballEngine } from '../../src/pinball/engine.ts';
import { ATTIC_MAX_STAY, MAX_RAMP_COMBO, MAX_SCORE, POINTS, RAMP_COMBO_WINDOW } from '../../src/pinball/rules.ts';
import { ATTIC, FLIPPERS, RAMP, SAUCERS } from '../../src/pinball/table.ts';
import { clearBalls, engineWith, ofType, placeBall, run, runUntil } from './helpers.ts';

/** 램프와 2층 다락 — 램프로 올라가고, 다락 안에서는 공이 알아서 튕긴다 (누르는 플리퍼는 아래 두 개뿐) */

const inAttic = (p: { x: number; y: number }) => {
  let inside = false;
  const pts = ATTIC.polygon;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (pts[i].y > p.y !== pts[j].y > p.y && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
};

/** 램프 입구 안쪽에서 램프 방향으로 공을 쏜다 */
function shootRamp(e: PinballEngine, speed: number) {
  const [a, b] = RAMP.center;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  clearBalls(e);
  return placeBall(e, { x: a.x + ((b.x - a.x) / len) * 14, y: a.y + ((b.y - a.y) / len) * 14, vx: ((b.x - a.x) / len) * speed, vy: ((b.y - a.y) / len) * speed });
}

/** 다락 안 원하는 자리에 2층 공을 놓는다 */
function placeInAttic(e: PinballEngine, at: { x: number; y: number; vx?: number; vy?: number }) {
  clearBalls(e);
  e.plungerLoaded = false;
  e.gateClosed = true;
  const ball = makeBall({ id: 2000 + e.balls.length, level: 1, ...at });
  e.balls.push(ball);
  return ball;
}

/** 2층 타깃 하나를 아래에서 세게 맞힌다 */
function hitAtticTarget(e: PinballEngine, index: number) {
  const t = e.atticTargets[index];
  placeInAttic(e, { x: (t.x1 + t.x2) / 2, y: t.y + 30, vy: -500 });
  return run(e, 0.2);
}

test('램프 입구에 빠르게 들어온 공은 2층에 올라가고 3,000점을 받는다', () => {
  const e = engineWith();
  const ball = shootRamp(e, 1100);
  const [ramp] = ofType(runUntil(e, 'ramp', 2), 'ramp');
  assert.ok(ramp, '램프에 올라가지 못했어요');
  assert.deepEqual([ramp.points, ramp.combo], [POINTS.ramp, 1]);
  assert.equal(ball.level, 1);
  assert.ok(inAttic(ball));
});

test('느린 공은 램프를 되굴러 나온다', () => {
  const e = engineWith();
  const ball = shootRamp(e, 400);
  let cameOut = false;
  const events = [];
  for (let t = 0; t < 3; t += 1 / 120) {
    e.step(1 / 120);
    events.push(...e.drainEvents());
    if (ball.y > RAMP.center[0].y + 12) cameOut = true;
  }
  assert.equal(ofType(events, 'ramp').length, 0);
  assert.equal(cameOut, true, '공이 입구 아래로 나오지 않았어요');
});

test('12초 안에 또 올리면 점수가 2배, 3배로 커지고 5배에서 멈춘다', () => {
  const e = engineWith();
  const combos: number[] = [];
  const points: number[] = [];
  for (let i = 0; i < MAX_RAMP_COMBO + 2; i++) {
    shootRamp(e, 1100);
    const [ramp] = ofType(runUntil(e, 'ramp', 2), 'ramp');
    combos.push(ramp.combo);
    points.push(ramp.points);
  }
  assert.deepEqual(combos, [1, 2, 3, 4, 5, 5, 5]);
  assert.deepEqual(points, [1, 2, 3, 4, 5, 5, 5].map((m) => POINTS.ramp * m));
});

test('12초가 지난 뒤에 올리면 다시 1배부터다', () => {
  const e = engineWith();
  shootRamp(e, 1100);
  runUntil(e, 'ramp', 2);
  clearBalls(e);
  run(e, RAMP_COMBO_WINDOW + 0.5);
  shootRamp(e, 1100);
  const [ramp] = ofType(runUntil(e, 'ramp', 2), 'ramp');
  assert.equal(ramp.combo, 1);
});

test('2층 공은 램프로 되돌아 내려가지 않는다', () => {
  const e = engineWith();
  const [a, b] = ATTIC.mouth;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // 입구에서 다락 안쪽으로 30 들어간 곳에서 입구 쪽으로 굴린다
  const inward = { x: -(b.y - a.y), y: b.x - a.x };
  const len = Math.hypot(inward.x, inward.y);
  let nx = inward.x / len;
  let ny = inward.y / len;
  if (!inAttic({ x: mid.x + nx * 20, y: mid.y + ny * 20 })) { nx = -nx; ny = -ny; }
  const ball = placeInAttic(e, { x: mid.x + nx * 30, y: mid.y + ny * 30, vx: -nx * 600, vy: -ny * 600 });
  for (let t = 0; t < 0.6; t += 1 / 120) {
    e.step(1 / 120);
    assert.ok(ball.ride || inAttic(ball) || ball.y > ATTIC.exit[0].y, `입구로 빠져나갔어요 (${ball.x.toFixed(0)}, ${ball.y.toFixed(0)})`);
  }
});

test('1층 공은 다락 벽이나 출구로 들어가지 못한다', () => {
  const shots = [
    { x: 262, y: 450, vx: -1500, vy: 0 },
    { x: 130, y: 285, vx: 0, vy: 1500 },
    { x: 85, y: 680, vx: 0, vy: -1500 },
    { x: 30, y: 450, vx: 1500, vy: 0 },
    { x: (ATTIC.exit[0].x + ATTIC.exit[1].x) / 2, y: ATTIC.exit[0].y + 50, vx: 0, vy: -1500 },
    { x: 250, y: 300, vx: -1000, vy: 1000 },
  ];
  for (const shot of shots) {
    const e = engineWith();
    const ball = placeBall(e, shot);
    for (let t = 0; t < 0.5; t += 1 / 120) {
      e.step(1 / 120);
      assert.ok(!inAttic(ball) && ball.level === 0, `(${shot.x}, ${shot.y})에서 쏜 공이 다락에 들어갔어요`);
    }
  }
});

test('2층 타깃을 맞히면 불이 켜지고 1,500점을 받는다', () => {
  const e = engineWith();
  const [hit] = ofType(hitAtticTarget(e, 0), 'atticTarget');
  assert.equal(hit.points, POINTS.atticTarget);
  assert.equal(e.atticTargets[0].lit, true);
});

test('2층 타깃 셋을 맞히면 잭팟 불이 켜지고, 구멍에 넣으면 30,000점을 받는다', () => {
  const e = engineWith();
  const events = e.atticTargets.flatMap((_, i) => hitAtticTarget(e, i));
  assert.equal(ofType(events, 'jackpotLit').length, 1);
  assert.equal(e.jackpotLit, true);

  placeInAttic(e, { x: SAUCERS.attic.x, y: SAUCERS.attic.y });
  const [hole] = ofType(run(e, 1 / 120), 'atticHole');
  assert.deepEqual([hole.jackpot, hole.points], [true, POINTS.atticJackpot]);
  assert.equal(e.jackpotLit, false);
});

test('불이 꺼진 2층 구멍은 3,000점을 준다', () => {
  const e = engineWith();
  placeInAttic(e, { x: SAUCERS.attic.x, y: SAUCERS.attic.y });
  const [hole] = ofType(run(e, 1 / 120), 'atticHole');
  assert.deepEqual([hole.jackpot, hole.points], [false, POINTS.atticHole]);
});

test('2층 범퍼는 300점, 자동 키커는 50점을 준다', () => {
  const e = engineWith();
  const bumper = e.bumpers.find((b) => b.attic);
  assert.ok(bumper);
  placeInAttic(e, { x: bumper.x, y: bumper.y - bumper.r - 12, vy: 300 });
  assert.equal(ofType(runUntil(e, 'bumper', 1), 'bumper')[0].points, POINTS.atticBumper);

  const kicker = e.slings.find((s) => s.kicker);
  assert.ok(kicker);
  const mx = (kicker.top.x + kicker.tip.x) / 2;
  const my = (kicker.top.y + kicker.tip.y) / 2;
  placeInAttic(e, { x: mx + kicker.nx * 24, y: my + kicker.ny * 24, vx: -kicker.nx * 400, vy: -kicker.ny * 400 });
  assert.equal(ofType(runUntil(e, 'sling', 1), 'sling')[0].points, POINTS.kicker);
});

test('2층에 20초 넘게 있으면 출구로 나온다', () => {
  const e = engineWith();
  const ball = placeInAttic(e, { x: 130, y: 400 });
  ball.atticTime = ATTIC_MAX_STAY - 0.05;
  run(e, 0.2);
  assert.ok(ball.ride || (!inAttic(ball) && ball.y > ATTIC.exit[0].y), `아직 다락 안이에요 (${ball.x.toFixed(0)}, ${ball.y.toFixed(0)})`);
});

test('점수 상한에 닿은 뒤의 다락 잭팟은 점수를 넘기지 않는다', () => {
  const e = engineWith();
  e.score = MAX_SCORE - 100;
  e.jackpotLit = true;
  placeInAttic(e, { x: SAUCERS.attic.x, y: SAUCERS.attic.y });
  const [hole] = ofType(run(e, 1 / 120), 'atticHole');
  assert.equal(hole.points, 100);
  assert.equal(e.score, MAX_SCORE);
});

test('동전은 다락이나 램프 안에 생기지 않는다', () => {
  const e = engineWith();
  const seen: { x: number; y: number }[] = [];
  for (let i = 0; i < 400; i++) {
    run(e, 4);
    seen.push(...e.coins.map((c) => ({ x: c.x, y: c.y })));
    e.coins.length = 0;
  }
  assert.ok(seen.length > 100);
  assert.ok(seen.every((c) => !inAttic(c)), '다락 안에 동전이 생겼어요');
  // 램프 난간 사이에도, 난간에서 12 안쪽에도 없어야 한다
  const nearRail = (c: { x: number; y: number }) =>
    [RAMP.left, RAMP.right].some((rail) =>
      rail.slice(1).some((b, k) => {
        const a = rail[k];
        const t = Math.max(0, Math.min(1, ((c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2)));
        return Math.hypot(c.x - (a.x + (b.x - a.x) * t), c.y - (a.y + (b.y - a.y) * t)) < 12;
      }),
    );
  const inRamp = (c: { x: number; y: number }) => {
    let inside = false;
    const pts = RAMP.polygon;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if (pts[i].y > c.y !== pts[j].y > c.y && c.x < ((pts[j].x - pts[i].x) * (c.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
    }
    return inside;
  };
  assert.ok(seen.every((c) => !inRamp(c) && !nearRail(c)), '램프 자리에 동전이 생겼어요');
});

test('어느 플리퍼로든, 굴러온 공을 제때 치면 램프에 올라간다 (칠 수 있는 시간의 폭이 0.04초 이상)', () => {
  for (const flipper of FLIPPERS) {
    const startX = flipper.side === 'left' ? 51 : 309;
    let best = 0;
    let streak = 0;
    for (let delay = 0.4; delay < 1.4; delay += 0.01) {
      const e = engineWith();
      placeBall(e, { x: startX, y: flipper.py - 160 });
      let made = false;
      for (let t = 0; t < delay + 2 && !made; t += 1 / 120) {
        if (t >= delay) e.setFlipper(flipper.side, true);
        e.step(1 / 120);
        if (e.drainEvents().some((ev) => ev.type === 'ramp')) made = true;
      }
      streak = made ? streak + 1 : 0;
      best = Math.max(best, streak);
    }
    assert.ok(best * 0.01 >= 0.04, `${flipper.side} 플리퍼: 램프에 올라가는 시간의 폭이 ${(best * 0.01).toFixed(2)}초뿐이에요`);
  }
});
