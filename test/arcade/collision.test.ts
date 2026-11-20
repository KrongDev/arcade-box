import assert from 'node:assert/strict';
import { test } from 'node:test';
import { circleRect, reflect } from '../../src/arcade/collision.ts';

const box = { x: 100, y: 100, w: 40, h: 20 };

test('떨어져 있으면 충돌이 없다', () => {
  assert.equal(circleRect(80, 80, 5, box), null);
});

test('위에서 닿으면 위쪽을 향한 법선과 겹친 깊이를 준다', () => {
  const hit = circleRect(120, 97, 5, box);
  assert.ok(hit);
  assert.deepEqual([hit.nx, hit.ny], [0, -1]);
  assert.equal(hit.depth, 2);
});

test('옆에서 닿으면 옆쪽 법선을 준다', () => {
  const hit = circleRect(143, 110, 5, box);
  assert.ok(hit);
  assert.deepEqual([hit.nx, hit.ny], [1, 0]);
  assert.equal(hit.depth, 2);
});

test('모서리에 닿으면 모서리에서 바깥으로 비스듬한 법선을 준다', () => {
  const hit = circleRect(142, 97, 5, box);
  assert.ok(hit);
  assert.ok(hit.nx > 0 && hit.ny < 0);
  assert.ok(Math.abs(Math.hypot(hit.nx, hit.ny) - 1) < 1e-9);
});

test('중심이 사각형 안에 들어오면 가장 가까운 면으로 밀어낸다', () => {
  const hit = circleRect(120, 103, 5, box);
  assert.ok(hit);
  assert.deepEqual([hit.nx, hit.ny], [0, -1]);
  assert.equal(hit.depth, 8);
});

test('반사: 법선 방향으로 다가오던 속도만 뒤집는다', () => {
  assert.deepEqual(reflect(30, 200, 0, -1), { vx: 30, vy: -200 });
  assert.deepEqual(reflect(-150, 40, 1, 0), { vx: 150, vy: 40 });
});

test('반사: 이미 멀어지는 속도는 바꾸지 않는다', () => {
  assert.deepEqual(reflect(30, -200, 0, -1), { vx: 30, vy: -200 });
});
