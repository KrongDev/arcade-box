import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALLS_PER_GAME } from '../../src/pinball/rules.ts';
import { FLIPPERS, LANE_X, TABLE_H, TABLE_W } from '../../src/pinball/table.ts';
import { engineWith, ofType, placeBall, run } from './helpers.ts';

/** 긴 판(400×1300)의 발사와 아래쪽 길 — 안쪽 길은 플리퍼로, 바깥 길은 판 밖으로 */

const [LEFT, RIGHT] = FLIPPERS;
/** 쉬는 플리퍼 위(축에서 끝 쪽)의 가로 범위 */
const onLeftFlipper = (x: number) => x > LEFT.px + 4 && x < LEFT.px + LEFT.len;
const onRightFlipper = (x: number) => x < RIGHT.px - 4 && x > RIGHT.px - RIGHT.len;
const nearFlipperHeight = (y: number) => y > LEFT.py - 24 && y < LEFT.py + 40;

/** seconds초 동안 돌리며 공 하나의 자취를 모은다 */
function trace(e: ReturnType<typeof engineWith>, seconds: number) {
  const points: { x: number; y: number }[] = [];
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 120) {
    e.step(1 / 120);
    events.push(...e.drainEvents());
    const b = e.balls[0];
    if (b) points.push({ x: b.x, y: b.y });
  }
  return { points, events };
}

test('판은 400×1300이다', () => {
  assert.deepEqual([TABLE_W, TABLE_H], [400, 1300]);
});

test('끝까지 당겨 쏘면 레인을 빠져나가 판에 들어간다', () => {
  const e = engineWith();
  assert.equal(e.launch(1), true);
  run(e, 3);
  assert.equal(e.gateClosed, true);
  assert.ok(e.balls[0].x < LANE_X, `공 x=${e.balls[0]?.x}`);
});

test('40%만 당겨도 레인을 빠져나간다', () => {
  const e = engineWith();
  e.launch(0.4);
  run(e, 3);
  assert.equal(e.gateClosed, true);
});

test('아주 약하게 쏘면 공을 잃지 않고 발사대로 돌아온다', () => {
  const e = engineWith();
  e.launch(0);
  const events = run(e, 5);
  assert.equal(e.plungerLoaded, true);
  assert.equal(e.ballsLeft, BALLS_PER_GAME);
  assert.equal(ofType(events, 'drain').length, 0);
  assert.equal(ofType(events, 'ballSaved').length, 0);
});

test('살짝만 누른 발사는 짧게 튀었다가 2초 안에 발사대로 돌아온다', () => {
  const e = engineWith();
  e.launch(0.1);
  run(e, 2);
  assert.equal(e.plungerLoaded, true);
});

test('바깥 길로 들어간 공은 잃는다', () => {
  for (const x of [22, 338]) {
    const e = engineWith();
    placeBall(e, { x, y: LEFT.py - 144 });
    const events = run(e, 2);
    assert.equal(ofType(events, 'drain').length, 1, `x=${x}`);
    assert.equal(e.ballsLeft, BALLS_PER_GAME - 1);
  }
});

test('쉬는 플리퍼 사이로 떨어진 공은 빠진다', () => {
  const e = engineWith();
  placeBall(e, { x: (LEFT.px + RIGHT.px) / 2, y: LEFT.py - 100 });
  const events = run(e, 2);
  assert.equal(ofType(events, 'drain').length, 1);
});

test('안쪽 길로 들어온 공은 플리퍼까지 굴러간다', () => {
  for (const [x, onFlipper] of [[51, onLeftFlipper], [309, onRightFlipper]] as const) {
    const e = engineWith();
    placeBall(e, { x, y: LEFT.py - 160 });
    const { points } = trace(e, 3);
    assert.ok(points.some((p) => onFlipper(p.x) && nearFlipperHeight(p.y)), `x=${x}에서 출발한 공이 플리퍼에 닿지 않았어요`);
  }
});

test('벽을 타고 내려온 공은 지붕 가이드를 따라 안쪽 길로 간다', () => {
  for (const [x, onFlipper, inOutlane] of [
    [20, onLeftFlipper, (px: number) => px < 36],
    [338, onRightFlipper, (px: number) => px > 324],
  ] as const) {
    const e = engineWith();
    for (const t of e.targets) t.down = true; // 벽 앞 타깃이 공을 튕겨 내지 않게
    placeBall(e, { x, y: LEFT.py - 354 });
    const { points } = trace(e, 4);
    assert.ok(points.some((p) => onFlipper(p.x) && nearFlipperHeight(p.y)), `x=${x}: 플리퍼에 닿지 않았어요`);
    assert.ok(!points.some((p) => inOutlane(p.x) && p.y > LEFT.py - 150 && p.y < TABLE_H), `x=${x}: 바깥 길로 들어갔어요`);
  }
});

test('프레임 간격이 아주 길어도 공이 판 밖으로 나가지 않는다', () => {
  const e = engineWith();
  e.launch(1);
  for (let i = 0; i < 40; i++) {
    e.step(5);
    e.drainEvents();
    for (const b of e.balls) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), 'NaN');
      assert.ok(b.x > 0 && b.x < TABLE_W && b.y > 0, `(${b.x}, ${b.y})`);
    }
  }
});
