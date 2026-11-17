import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOARDS, minesweeperScore } from '../src/domain.ts';

const spec = (id: string) => BOARDS.find((b) => b.id === id)!.minesweeper!;

describe('지뢰찾기 점수 식', () => {
  it('깬 판: 연 칸 + 깃발 + 클리어 보너스 + 시간 보너스', () => {
    assert.equal(minesweeperScore(spec('minesweeper.easy'), { opened: 70, correctFlags: 10, wrongFlags: 0, won: true, seconds: 40 }), 3000);
  });
  it('0.1초 빠를수록 1점 더', () => {
    const a = minesweeperScore(spec('minesweeper.easy'), { opened: 70, correctFlags: 0, wrongFlags: 0, won: true, seconds: 40.0 });
    const b = minesweeperScore(spec('minesweeper.easy'), { opened: 70, correctFlags: 0, wrongFlags: 0, won: true, seconds: 39.9 });
    assert.equal(b - a, 1);
  });
  it('기준 시간보다 느리면 시간 보너스는 0 (음수 아님)', () => {
    assert.equal(minesweeperScore(spec('minesweeper.easy'), { opened: 70, correctFlags: 0, wrongFlags: 0, won: true, seconds: 999 }), 1400);
  });
  it('못 깬 판: 시간 보너스·클리어 보너스 없음, 틀린 깃발 감점, 0점 아래로 안 내려감', () => {
    assert.equal(minesweeperScore(spec('minesweeper.easy'), { opened: 30, correctFlags: 3, wrongFlags: 1, won: false, seconds: 5 }), 350);
    assert.equal(minesweeperScore(spec('minesweeper.easy'), { opened: 0, correctFlags: 0, wrongFlags: 5, won: false, seconds: 5 }), 0);
  });
  it('깬 판은 늘 못 깬 판보다 높다 (같은 난이도)', () => {
    for (const id of ['minesweeper.easy', 'minesweeper.normal', 'minesweeper.hard']) {
      const sp = spec(id);
      const slowWinNoFlags = minesweeperScore(sp, { opened: sp.safe, correctFlags: 0, wrongFlags: 0, won: true, seconds: 99999 });
      const bestLoss = minesweeperScore(sp, { opened: sp.safe - 1, correctFlags: sp.mines, wrongFlags: 0, won: false, seconds: 1 });
      assert.ok(slowWinNoFlags > bestLoss, id);
    }
  });
});

describe('지뢰 보호 감점', () => {
  it('보호를 쓰면 합계의 70% (내림)', () => {
    const sp = spec('minesweeper.easy');
    const raw = minesweeperScore(sp, { opened: 33, correctFlags: 1, wrongFlags: 0, won: false, seconds: 5 });
    const shielded = minesweeperScore(sp, { opened: 33, correctFlags: 1, wrongFlags: 0, won: false, seconds: 5, shields: 1 });
    assert.equal(raw, 350);
    assert.equal(shielded, 245);
  });
});

