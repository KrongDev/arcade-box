import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seeded } from './helpers.ts';

/** 테스트용 난수 — 씨앗마다 고르게 다른 수열이 나와야 봇과 엔진이 여러 경우를 겪는다 */

test('씨앗이 작아도 첫 난수가 0 근처로 몰리지 않는다', () => {
  const firsts = Array.from({ length: 10 }, (_, i) => seeded(i + 1)());
  // 0~1을 네 칸으로 나누면 열 개가 적어도 세 칸에 흩어진다
  const buckets = new Set(firsts.map((v) => Math.floor(v * 4)));
  assert.ok(buckets.size >= 3, `첫 값: ${firsts.map((v) => v.toFixed(5)).join(', ')}`);
});

test('씨앗이 두 배여도 수열이 두 배로 따라가지 않는다', () => {
  // 섞지 않은 수열은 seeded(2k)의 값이 seeded(k)의 값의 두 배(1을 넘으면 1을 뺀 값)로 나온다
  const a = seeded(21);
  const b = seeded(42);
  const linked = Array.from({ length: 20 }, () => {
    const x = a();
    const y = b();
    return Math.abs(((x * 2) % 1) - y) < 1e-6;
  });
  assert.ok(linked.filter(Boolean).length < 3, `두 배로 따라간 횟수 ${linked.filter(Boolean).length}/20`);
});

test('같은 씨앗이면 같은 수열, 값은 0보다 크고 1보다 작다', () => {
  const a = seeded(7);
  const b = seeded(7);
  for (let i = 0; i < 1000; i++) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v > 0 && v < 1);
  }
});
