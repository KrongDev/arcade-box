import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLIPPERS } from '../../src/pinball/table.ts';
import { engineWith, placeBall } from './helpers.ts';

/**
 * 경사면 위의 공 — 면에 얹혀 내려올 때는 미끄러지며 점점 빨라져야 한다.
 * 닿아 있는 동안 계속 속도를 깎으면 공이 일정한 속도로 기어 내려오고, 그 속도가 프레임 간격에 따라 달라진다.
 */

/** 엔진의 중력 가속도 */
const GRAVITY = 900;
/** 왼쪽 안쪽 길의 경사 (36,1129)-(104,1198). 그 맨 위에 공을 얹은 자리 */
const INLANE_ANGLE = Math.atan2(1198 - 1129, 104 - 36);
const ON_INLANE = { x: 49.4, y: 1126.5 };
/** 쉬는 왼쪽 플리퍼 위, 축 가까운 자리 */
const LEFT = FLIPPERS[0];
const ON_FLIPPER = { x: LEFT.px + 11, y: LEFT.py - 8 };

/** 가만히 놓은 공의 seconds초 뒤 속력 */
function speedAfter(at: { x: number; y: number }, seconds: number, dt = 1 / 120): number {
  const e = engineWith();
  e.kickbackLit = false;
  const ball = placeBall(e, at);
  for (let t = 0; t < seconds - 1e-9; t += dt) e.step(dt);
  assert.ok(e.balls.includes(ball), '공이 판에서 사라졌어요');
  return Math.hypot(ball.vx, ball.vy);
}

test('경사면에 얹힌 공은 미끄러지며 점점 빨라진다 (일정한 속도로 기어 내려오지 않는다)', () => {
  const early = speedAfter(ON_INLANE, 0.2);
  const late = speedAfter(ON_INLANE, 0.4);
  const free = GRAVITY * Math.sin(INLANE_ANGLE) * 0.4; // 마찰 없이 미끄러질 때
  assert.ok(late >= free * 0.85 && late <= free * 1.05, `0.4초 뒤 속력 ${late.toFixed(0)} (마찰이 없으면 ${free.toFixed(0)})`);
  assert.ok(late >= early * 1.7, `0.2초 ${early.toFixed(0)} → 0.4초 ${late.toFixed(0)}: 빨라지지 않아요`);
});

test('경사면을 내려오는 빠르기는 프레임 간격에 따라 달라지지 않는다', () => {
  const at30 = speedAfter(ON_INLANE, 0.4, 1 / 30);
  const at60 = speedAfter(ON_INLANE, 0.4, 1 / 60);
  const at120 = speedAfter(ON_INLANE, 0.4, 1 / 120);
  for (const [name, v] of [['30', at30], ['120', at120]] as const) {
    assert.ok(Math.abs(v - at60) <= at60 * 0.05, `1초에 60번 ${at60.toFixed(0)}, ${name}번 ${v.toFixed(0)}`);
  }
});

test('쉬는 플리퍼 위의 공도 점점 빨라지며 굴러 내려간다', () => {
  const early = speedAfter(ON_FLIPPER, 0.15);
  const late = speedAfter(ON_FLIPPER, 0.3);
  const free = GRAVITY * Math.sin(LEFT.rest) * 0.3;
  assert.ok(late >= free * 0.8 && late <= free * 1.05, `0.3초 뒤 속력 ${late.toFixed(0)} (마찰이 없으면 ${free.toFixed(0)})`);
  assert.ok(late >= early * 1.6, `0.15초 ${early.toFixed(0)} → 0.3초 ${late.toFixed(0)}: 빨라지지 않아요`);
});
