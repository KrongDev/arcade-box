import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRICK_COLS, FIELD_W } from '../../src/breakout/rules.ts';
import { LAYOUTS, buildStage } from '../../src/breakout/stages.ts';
import { seeded } from './helpers.ts';

test('모든 스테이지 배치는 한 줄에 10칸이고 쓰는 글자는 . n t 뿐이다', () => {
  for (const layout of LAYOUTS) {
    for (const row of layout) {
      assert.equal(row.length, BRICK_COLS, row);
      assert.match(row, /^[.nt]+$/);
    }
  }
});

test('벽돌은 화면 안에 겹치지 않게 놓인다', () => {
  for (let stage = 1; stage <= LAYOUTS.length; stage++) {
    const bricks = buildStage(stage, seeded(stage), { coinSpawn: 0 });
    assert.ok(bricks.length > 0);
    for (const b of bricks) {
      assert.ok(b.x >= 0 && b.x + b.w <= FIELD_W);
    }
    for (let i = 0; i < bricks.length; i++) {
      for (let j = i + 1; j < bricks.length; j++) {
        const a = bricks[i];
        const c = bricks[j];
        const overlap = a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
        assert.equal(overlap, false);
      }
    }
  }
});

test('같은 난수면 같은 스테이지가 나온다', () => {
  assert.deepEqual(buildStage(3, seeded(42), { coinSpawn: 0 }), buildStage(3, seeded(42), { coinSpawn: 0 }));
});

test('단단한 벽돌은 두 번, 보통 벽돌은 한 번 맞혀야 깨진다', () => {
  const bricks = buildStage(2, seeded(1), { coinSpawn: 0 });
  for (const b of bricks) assert.equal(b.hp, b.kind === 'tough' ? 2 : 1);
});

test('스테이지마다 동전 벽돌과 아이템 벽돌이 섞여 있고, 특수 벽돌은 보통 벽돌에만 붙는다', () => {
  const bricks = buildStage(1, seeded(9), { coinSpawn: 0 });
  assert.ok(bricks.some((b) => b.special === 'coin'));
  assert.ok(bricks.some((b) => b.special !== null && b.special !== 'coin'));
  for (const b of bricks) if (b.special !== null) assert.equal(b.kind, 'normal');
});

test('동전 벽돌 능력이 있으면 동전 벽돌이 더 많다', () => {
  let plain = 0;
  let boosted = 0;
  for (let seed = 1; seed <= 40; seed++) {
    plain += buildStage(1, seeded(seed), { coinSpawn: 0 }).filter((b) => b.special === 'coin').length;
    boosted += buildStage(1, seeded(seed), { coinSpawn: 0.5 }).filter((b) => b.special === 'coin').length;
  }
  assert.ok(boosted > plain, `${boosted} > ${plain}`);
});

test('배치를 한 바퀴 돌고 나면 단단한 벽돌이 늘어난다', () => {
  const count = (stage: number) => {
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) n += buildStage(stage, seeded(seed), { coinSpawn: 0 }).filter((b) => b.kind === 'tough').length;
    return n;
  };
  assert.ok(count(1 + LAYOUTS.length) > count(1));
});

test('동전 벽돌 능력이 작아도(+10%) 평균적으로 동전 벽돌이 늘어난다', () => {
  let plain = 0;
  let boosted = 0;
  for (let seed = 1; seed <= 200; seed++) {
    for (let stage = 1; stage <= LAYOUTS.length; stage++) {
      plain += buildStage(stage, seeded(seed * 31 + stage), { coinSpawn: 0 }).filter((b) => b.special === 'coin').length;
      boosted += buildStage(stage, seeded(seed * 31 + stage), { coinSpawn: 0.1 }).filter((b) => b.special === 'coin').length;
    }
  }
  assert.ok(boosted > plain * 1.05, `${boosted} > ${plain} × 1.05`);
});
