import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLIPPERS } from '../../src/pinball/table.ts';
import { engineWith, placeBall } from './helpers.ts';

/**
 * 물리는 화면 주사율과 상관없이 늘 같은 간격으로 계산한다.
 * 프레임 길이를 그대로 나눠 쓰면 120Hz 폰과 60Hz 폰, 절전 모드(30Hz) 폰에서
 * 플리퍼로 친 공의 세기와 각도가 달라져서 같은 순위표를 쓰는 사람들의 판이 서로 달라진다.
 */

const [LEFT] = FLIPPERS;

/** 왼쪽 플리퍼 위로 떨어지는 공을 닿을 때쯤 쳐 올리고, 0.6초 뒤 공의 자리와 속도를 준다. 입력은 30분의 1초 단위로 맞춘다 */
function flipShot(fps: number): number[] {
  const e = engineWith();
  const ball = placeBall(e, { x: LEFT.px + 36, y: LEFT.py - 60, vy: 150 });
  const perTick = fps / 30;
  for (let tick = 0; tick < 18; tick++) {
    if (tick === 7) e.setFlipper('left', true);
    for (let i = 0; i < perTick; i++) e.step(1 / fps);
  }
  return [ball.x, ball.y, ball.vx, ball.vy];
}

const close = (a: number[], b: number[], eps: number) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

test('플리퍼로 친 공은 초당 30번·60번·120번 어느 화면에서나 같은 자리로 간다', () => {
  const at30 = flipShot(30);
  const at60 = flipShot(60);
  const at120 = flipShot(120);
  // 정말 쳐 올린 공이어야 한다 (플리퍼 위쪽으로 한참 올라가 있다)
  assert.ok(at120[1] < LEFT.py - 150, `공이 올라가지 않았어요 y=${at120[1].toFixed(0)}`);
  const fmt = (v: number[]) => v.map((n) => n.toFixed(1)).join(', ');
  assert.ok(close(at30, at120, 1e-6), `30Hz (${fmt(at30)}) ≠ 120Hz (${fmt(at120)})`);
  assert.ok(close(at60, at120, 1e-6), `60Hz (${fmt(at60)}) ≠ 120Hz (${fmt(at120)})`);
});

/** 아무것도 없는 곳에서 0.5초 떨어진 공의 높이 */
function fallFor(fps: number): number {
  const e = engineWith();
  const ball = placeBall(e, { x: 240, y: 620 });
  for (let i = 0; i < fps / 2; i++) e.step(1 / fps);
  return ball.y;
}

test('주사율이 계산 간격으로 나눠떨어지지 않아도(90Hz, 144Hz) 흐른 시간만큼 계산한다', () => {
  const at60 = fallFor(60);
  // 계산 한 번만큼(공이 0.5px쯤 움직이는 시간)은 다음 프레임으로 넘어갈 수 있다
  for (const fps of [90, 144]) {
    const y = fallFor(fps);
    assert.ok(Math.abs(y - at60) < 1, `${fps}Hz: ${y.toFixed(2)}, 60Hz: ${at60.toFixed(2)}`);
  }
});

test('프레임 시간이 음수나 숫자가 아니어도 판이 깨지지 않는다', () => {
  const e = engineWith();
  const ball = placeBall(e, { x: 240, y: 620 });
  e.step(-0.02);
  e.step(Number.NaN);
  for (let i = 0; i < 12; i++) e.step(1 / 120);
  assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y) && Number.isFinite(e.time), `(${ball.x}, ${ball.y}) time=${e.time}`);
  assert.ok(ball.y > 620, `공이 떨어지지 않았어요 y=${ball.y}`);
});
