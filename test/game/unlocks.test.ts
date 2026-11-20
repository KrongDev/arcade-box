import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gameUnlocks, unlockHeadline, unlockMessage, unlockName, type UnlockNotice } from '../../src/game/unlocks.ts';

describe('잠금 해제 안내', () => {
  it('새 게임은 게임 이름으로, 받침에 맞는 조사로 알린다', () => {
    const [ms, bo] = gameUnlocks(['minesweeper', 'breakout']);
    assert.deepEqual(ms, { kind: 'game', gameId: 'minesweeper' });
    assert.equal(unlockMessage(ms), '새 게임 지뢰찾기가 열렸어요');
    assert.equal(unlockMessage(bo), '새 게임 벽돌깨기가 열렸어요');
    assert.equal(unlockHeadline(ms), '새 게임이 열렸어요');
    assert.equal(unlockName(bo), '벽돌깨기');
  });

  it('다음 단계는 게임 이름과 단계 이름을 함께 쓴다', () => {
    const level: UnlockNotice = { kind: 'level', gameId: 'minesweeper', level: '중급' };
    assert.equal(unlockMessage(level), '중급이 열렸어요');
    assert.equal(unlockName(level), '지뢰찾기 중급');
    assert.equal(unlockHeadline(level), '다음 단계가 열렸어요');
    assert.equal(unlockMessage({ kind: 'level', gameId: 'minesweeper', level: '고급' }), '고급이 열렸어요');
  });
});
