import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeTrack, trackAt } from '../../src/pinball/path.ts';

/** 정해진 길(레일·킥백) — 점을 이은 길을 부드럽게 만들고, 지나온 거리로 위치와 방향을 구한다 */

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('길이는 점 사이 거리의 합이다', () => {
  assert.equal(makeTrack([{ x: 0, y: 0 }, { x: 30, y: 40 }], 0).length, 50);
  assert.ok(near(makeTrack([{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 60, y: 80 }]).length, 100), '곧은 길은 부드럽게 해도 길이가 같다');
});

test('거리 0과 끝은 양 끝점이다', () => {
  const track = makeTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  const start = trackAt(track, 0);
  const end = trackAt(track, track.length);
  assert.deepEqual([start.x, start.y], [0, 0]);
  assert.ok(near(end.x, 100) && near(end.y, 100));
});

test('모서리를 깎아서 꺾인 곳이 둥글어진다', () => {
  const track = makeTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.ok(track.length < 200);
  assert.ok(!track.points.some((p) => p.x === 100 && p.y === 0), '모서리 점이 그대로 남아 있어요');
});

test('방향은 길을 따라가는 단위 벡터다', () => {
  const track = makeTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  for (const s of [0, 10, track.length / 2, track.length - 10, track.length]) {
    const at = trackAt(track, s);
    assert.ok(near(Math.hypot(at.tx, at.ty), 1), `s=${s}`);
  }
  assert.ok(near(trackAt(track, 5).tx, 1), '처음에는 오른쪽으로');
  assert.ok(near(trackAt(track, track.length - 5).ty, 1), '끝에는 아래로');
});

test('범위를 벗어난 거리는 양 끝으로 자른다', () => {
  const track = makeTrack([{ x: 0, y: 0 }, { x: 30, y: 40 }], 0);
  assert.deepEqual(trackAt(track, -5), trackAt(track, 0));
  assert.deepEqual(trackAt(track, 999), trackAt(track, 50));
});
