import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PinballEngine } from '../../src/pinball/engine.ts';
import { MAX_COINS_PER_RUN, MAX_SCORE } from '../../src/pinball/rules.ts';
import { TABLE_H } from '../../src/pinball/table.ts';
import { median, playGame, randomBot, reactiveBot, seeded, type GameStats } from './helpers.ts';

/**
 * 균형 — 봇으로 여러 판을 돌려 점수·코인·판 길이가 정해 둔 범위에 드는지 본다.
 * 기준은 예전 판(400×700)에서 같은 봇으로 잰 값이다: 무작위 봇 점수 중앙값 약 25,000, 코인 중앙값 45.
 * 지금 새 판은 1,200판으로 재면 점수 중앙값 29,000, 코인 중앙값 45다 (200판 중앙값은 ±3,000쯤 흔들린다).
 * (docs/superpowers/specs/2026-11-25-pinball-tower-design.md 6.2)
 *
 * 무작위 봇은 기준대로 200판을 돌린다. 반응 봇은 한 판이 4~5분이라 40판만 돌린다 —
 * 반응 봇의 기준(상한에 안 닿음, 2~8분)은 여유가 커서 40판으로도 흔들리지 않는다. 200판 잰 값은 스펙 6.2에 있다.
 */

const randomGames: GameStats[] = Array.from({ length: 200 }, (_, i) => playGame(new PinballEngine(seeded((i + 1) * 31)), randomBot(i + 1), 1800));
const reactiveGames: GameStats[] = Array.from({ length: 40 }, (_, i) => playGame(new PinballEngine(seeded((i + 1) * 31)), reactiveBot(i + 1, TABLE_H), 1800));

test('무작위 봇: 점수 중앙값이 예전 판의 1~2.5배(25,000~62,000)다', () => {
  const score = median(randomGames.map((g) => g.score));
  assert.ok(score >= 25_000 && score <= 62_000, `점수 중앙값 ${score}`);
});

test('무작위 봇: 코인 중앙값이 30~90개다', () => {
  const coins = median(randomGames.map((g) => g.coins));
  assert.ok(coins >= 30 && coins <= 90, `코인 중앙값 ${coins}`);
});

test('무작위 봇: 바깥 길로 잃는 공이 전체의 3분의 1을 넘지 않는다', () => {
  const sum = (pick: (g: GameStats) => number) => randomGames.reduce((n, g) => n + pick(g), 0);
  const side = sum((g) => g.losses.left + g.losses.right);
  const all = side + sum((g) => g.losses.center);
  assert.ok(side / all <= 1 / 3, `바깥 길 ${((side / all) * 100).toFixed(0)}%`);
});

test('반응 봇: 점수 중앙값이 상한에 닿지 않고, 한 판 길이 중앙값이 2~8분이다', () => {
  const score = median(reactiveGames.map((g) => g.score));
  const seconds = median(reactiveGames.map((g) => g.seconds));
  assert.ok(score < MAX_SCORE, `점수 중앙값 ${score}`);
  assert.ok(seconds >= 120 && seconds <= 480, `한 판 길이 중앙값 ${seconds.toFixed(0)}초`);
});

test('어느 판도 점수 500만, 코인 400개를 넘지 않고 문제 없이 끝난다', () => {
  for (const g of [...randomGames, ...reactiveGames]) {
    assert.ok(g.score <= MAX_SCORE && g.coins <= MAX_COINS_PER_RUN);
    assert.deepEqual(g.problems, []);
    assert.equal(g.over, true);
  }
});
