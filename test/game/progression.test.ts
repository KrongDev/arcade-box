import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestRecord, isUnlockMet, newlyUnlocked, unlockProgress, type Progress } from '../../src/game/progression.ts';
import { getGame } from '../../src/game/registry.ts';

const start: Progress = { best: {}, bestScore: {}, cleared: [], unlocked: ['pinball'] };

test('점수 조건: 그 게임 최고 점수가 기준 이상이면 열린다', () => {
  const rule = { kind: 'score', gameId: 'pinball', score: 30000 } as const;
  assert.equal(isUnlockMet(rule, start), false);
  assert.equal(isUnlockMet(rule, { ...start, best: { pinball: 30000 } }), true);
});

test('단계 조건: 그 단계를 깼으면 열린다', () => {
  const rule = { kind: 'clear', stage: 'minesweeper.hard' } as const;
  assert.equal(isUnlockMet(rule, { ...start, cleared: ['minesweeper.easy'] }), false);
  assert.equal(isUnlockMet(rule, { ...start, cleared: ['minesweeper.hard'] }), true);
});

test('핀볼 30,000점이면 지뢰찾기, 지뢰찾기 고급을 깨면 벽돌깨기가 새로 열린다', () => {
  assert.deepEqual(newlyUnlocked({ ...start, best: { pinball: 31000 } }), ['minesweeper']);
  assert.deepEqual(
    newlyUnlocked({ ...start, unlocked: ['pinball', 'minesweeper'], cleared: ['minesweeper.easy', 'minesweeper.normal', 'minesweeper.hard'] }),
    ['breakout'],
  );
});

test('이미 열린 게임은 다시 열리지 않는다', () => {
  assert.deepEqual(newlyUnlocked({ ...start, unlocked: ['pinball', 'minesweeper'], best: { pinball: 50000 } }), []);
});

test('잠금 진행도: 점수 조건은 점수, 단계 조건은 깬 여부', () => {
  assert.deepEqual(unlockProgress({ kind: 'score', gameId: 'pinball', score: 30000 }, { ...start, best: { pinball: 12000 } }), { current: 12000, target: 30000 });
  assert.deepEqual(unlockProgress({ kind: 'clear', stage: 'minesweeper.hard' }, start), { current: 0, target: 1 });
});

test('대표 기록: 순위표가 하나인 게임은 최고 점수, 단계가 여러 개면 가장 어려운 단계부터 기록이 있는 것', () => {
  assert.equal(bestRecord(getGame('pinball'), { ...start, best: { pinball: 4200 } }), 4200);
  assert.equal(bestRecord(getGame('pinball'), start), null);
  assert.equal(
    bestRecord(getGame('minesweeper'), { ...start, bestScore: { 'minesweeper.easy': 900, 'minesweeper.normal': 1500 } }),
    1500,
  );
  assert.equal(bestRecord(getGame('breakout'), { ...start, best: { breakout: 7700 } }), 7700);
});
