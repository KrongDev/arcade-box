import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimiter } from '../../src/shared/http/rate-limit.ts';

const MINUTE = 60_000;

test('한 키는 1분 창 안에서 한도만큼만 통과한다', () => {
  const limiter = createRateLimiter();
  const t0 = Date.parse('2026-11-26T00:00:00Z');
  assert.equal(limiter.allow('a', 2, t0), true);
  assert.equal(limiter.allow('a', 2, t0 + 10), true);
  assert.equal(limiter.allow('a', 2, t0 + 20), false);
  assert.equal(limiter.allow('b', 2, t0 + 20), true);
  assert.equal(limiter.allow('a', 2, t0 + MINUTE - 1), false);
  assert.equal(limiter.allow('a', 2, t0 + MINUTE), true);
});

test('창이 지난 항목은 지워진다', () => {
  const limiter = createRateLimiter();
  const t0 = Date.parse('2026-11-26T00:00:00Z');
  for (let i = 0; i < 1000; i++) limiter.allow(`ip:${i}`, 10, t0 + i);
  assert.equal(limiter.size(), 1000);
  // 1분이 지난 뒤 아무 요청이나 오면 지난 것들이 사라진다
  limiter.allow('later', 10, t0 + 2 * MINUTE);
  assert.equal(limiter.size(), 1);
});

test('키를 계속 바꿔 보내도 항목 수가 상한을 넘지 않고, 가장 오래된 것부터 지워진다', () => {
  const limiter = createRateLimiter(100);
  const t0 = Date.parse('2026-11-26T00:00:00Z');
  for (let i = 0; i < 10_000; i++) {
    limiter.allow(`ip:${i}`, 1, t0 + i);
    assert.ok(limiter.size() <= 100);
  }
  assert.equal(limiter.size(), 100);
  // 방금 쓴 키는 남아 있어서 한도가 그대로 걸린다
  assert.equal(limiter.allow('ip:9999', 1, t0 + 10_000), false);
  // 오래된 키는 밀려나서 처음부터 다시 센다
  assert.equal(limiter.allow('ip:0', 1, t0 + 10_000), true);
});
