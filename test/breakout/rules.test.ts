import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SPEED_MAX, SPEED_START, ballSpeed, chainMultiplier, coinPayout, stageBonus } from '../../src/breakout/rules.ts';

test('연속 배수: 패들에 닿지 않고 5개를 깰 때마다 한 단계씩, 최대 5배', () => {
  assert.equal(chainMultiplier(1), 1);
  assert.equal(chainMultiplier(4), 1);
  assert.equal(chainMultiplier(5), 2);
  assert.equal(chainMultiplier(10), 3);
  assert.equal(chainMultiplier(500), 5);
});

test('공 속력: 스테이지가 오르고 시간이 갈수록 빨라지지만 상한을 넘지 않는다', () => {
  assert.equal(ballSpeed(1, 0, false), SPEED_START);
  assert.ok(ballSpeed(2, 0, false) > ballSpeed(1, 0, false));
  assert.ok(ballSpeed(1, 20, false) > ballSpeed(1, 0, false));
  assert.equal(ballSpeed(99, 9999, false), SPEED_MAX);
});

test('느린 공 아이템이 켜지면 속력이 줄어든다', () => {
  assert.ok(ballSpeed(3, 10, true) < ballSpeed(3, 10, false));
});

test('스테이지 보너스는 스테이지가 오를수록 크다', () => {
  assert.ok(stageBonus(2) > stageBonus(1));
});

test('동전 하나의 코인: 기본 5, 능력이 있으면 그만큼 더', () => {
  assert.equal(coinPayout(0), 5);
  assert.equal(coinPayout(0.2), 6);
});
