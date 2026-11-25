import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBall, type PinballEngine } from '../../src/pinball/engine.ts';
import { ATTIC_MAX_STAY, BALLS_PER_GAME, BALL_R } from '../../src/pinball/rules.ts';
import { ATTIC, FLIPPERS, RAIL, TABLE_H } from '../../src/pinball/table.ts';
import { engineWith, ofType, run, runUntil } from './helpers.ts';

/** 다락 출구에서 왼쪽 안쪽 길로 내려오는 레일 — 레일 위의 공은 정해진 길을 따라가고 아무것과도 부딪히지 않는다 */

const EXIT_X = (ATTIC.exit[0].x + ATTIC.exit[1].x) / 2;
const EXIT_Y = ATTIC.exit[0].y;
const END = RAIL.ride.track.points[RAIL.ride.track.points.length - 1];

/** 다락 안, 출구 바로 위에 아래로 내려가는 2층 공을 놓는다 */
function dropToExit(e: PinballEngine, id = 3000) {
  e.plungerLoaded = false;
  e.gateClosed = true;
  const ball = makeBall({ id, level: 1, x: EXIT_X, y: EXIT_Y - 16, vy: 120 });
  e.balls.push(ball);
  return ball;
}

test('출구로 나온 공은 레일을 타고 왼쪽 안쪽 길 위에 내려온다', () => {
  const e = engineWith();
  const ball = dropToExit(e);
  const events = runUntil(e, 'railEnd', 4);
  assert.equal(ofType(events, 'rail').length, 1, '레일을 타지 않았어요');
  const [end] = ofType(events, 'railEnd');
  assert.ok(end, '레일 끝에 닿지 않았어요');
  assert.ok(Math.abs(ball.x - END.x) < 6 && Math.abs(ball.y - END.y) < 12, `내린 곳 (${ball.x.toFixed(0)}, ${ball.y.toFixed(0)})`);
  assert.equal(ball.level, 0);
  assert.equal(ball.ride, null);
});

test('레일은 3초 안에 끝난다', () => {
  const e = engineWith();
  dropToExit(e);
  const events = run(e, 3);
  assert.equal(ofType(events, 'railEnd').length, 1);
});

test('레일에서 내린 공은 왼쪽 플리퍼에 닿는다', () => {
  const e = engineWith();
  const left = FLIPPERS[0];
  e.setFlipper('left', true);
  const ball = dropToExit(e);
  run(e, 6);
  // 올려 둔 플리퍼 위(축 쪽)에 공이 고여 있다
  assert.ok(e.balls.includes(ball), '공을 잃었어요');
  assert.ok(ball.x > left.px - 16 && ball.x < left.px + left.len && ball.y > left.py - 40 && ball.y < left.py + 12, `공 (${ball.x.toFixed(0)}, ${ball.y.toFixed(0)})`);
  assert.ok(Math.hypot(ball.vx, ball.vy) < 40);
});

test('레일 위의 공은 1층 장치와 부딪히지 않는다', () => {
  const e = engineWith();
  // 레일 길 위에 동전과 다른 공을 놓아 둔다
  const mid = RAIL.ride.track.points[Math.floor(RAIL.ride.track.points.length / 2)];
  e.coins.push({ id: 9, x: mid.x, y: mid.y, r: 10, age: 1 });
  dropToExit(e);
  const events = runUntil(e, 'railEnd', 4);
  assert.equal(ofType(events, 'coin').length, 0, '레일 위에서 동전을 주웠어요');
  assert.equal(ofType(events, 'target').length + ofType(events, 'sling').length + ofType(events, 'bonus').length, 0);
  assert.ok(e.targets.every((t) => !t.down));
});

test('멀티볼에서 한 공이 레일 위에 있을 때 다른 공이 빠져도 공을 잃지 않는다', () => {
  const e = engineWith();
  const rider = dropToExit(e);
  runUntil(e, 'rail', 1);
  e.balls.push(makeBall({ id: 3001, x: 180, y: TABLE_H + 40 }));
  const events = run(e, 0.1);
  assert.equal(ofType(events, 'drain').length, 0);
  assert.equal(e.ballsLeft, BALLS_PER_GAME);
  assert.deepEqual(e.balls, [rider]);
});

test('두 공이 같이 타도 뒤 공이 앞 공을 지나치지 않는다', () => {
  const e = engineWith();
  const first = dropToExit(e, 3000);
  runUntil(e, 'rail', 1);
  run(e, 0.12);
  const second = dropToExit(e, 3001);
  let sawBoth = false;
  for (let t = 0; t < 3; t += 1 / 120) {
    e.step(1 / 120);
    e.drainEvents();
    if (first.ride && second.ride) {
      sawBoth = true;
      assert.ok(second.ride.s <= first.ride.s - 2 * BALL_R + 1e-6, `뒤 공 ${second.ride.s.toFixed(1)} / 앞 공 ${first.ride.s.toFixed(1)}`);
    }
  }
  assert.equal(sawBoth, true);
});

test('2층에 20초 넘게 있던 공도 레일을 타고 내려온다', () => {
  const e = engineWith();
  e.plungerLoaded = false;
  const ball = makeBall({ id: 3000, level: 1, x: 150, y: 480 });
  ball.atticTime = ATTIC_MAX_STAY - 0.05;
  e.balls.push(ball);
  const events = runUntil(e, 'railEnd', 5);
  assert.equal(ofType(events, 'rail').length, 1);
  assert.equal(ofType(events, 'railEnd').length, 1);
});
