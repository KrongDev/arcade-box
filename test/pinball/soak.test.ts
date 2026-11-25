import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PinballEngine } from '../../src/pinball/engine.ts';
import { TABLE_H } from '../../src/pinball/table.ts';
import { playGame, randomBot, reactiveBot, seeded } from './helpers.ts';

/** 봇으로 여러 판을 돌려, 있으면 안 되는 일(숫자가 깨짐, 공이 판 밖으로 샘, 공이 오래 멈춤)이 없는지 본다 */

test('무작위 봇 20판: 공이 끼거나 새지 않고 판이 끝까지 간다', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const stats = playGame(new PinballEngine(seeded(seed * 31)), randomBot(seed), 900);
    assert.deepEqual(stats.problems, [], `씨앗 ${seed}`);
    assert.equal(stats.over, true, `씨앗 ${seed}: 15분 안에 끝나지 않았어요`);
  }
});

test('반응 봇 5판: 오래 버텨도 공이 끼거나 새지 않는다', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const stats = playGame(new PinballEngine(seeded(seed * 17)), reactiveBot(seed, TABLE_H), 600);
    assert.deepEqual(stats.problems, [], `씨앗 ${seed}`);
  }
});
