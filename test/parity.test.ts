import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOARDS, GAME_IDS, ITEMS, MAP_EXTRA_COINS_MAX, MAX_COIN_BONUS, MAX_SCORE, UNLOCK_RULES } from '../server/src/domain.ts';
import * as breakout from '../src/breakout/rules.ts';
import { CATALOG } from '../src/game/catalog.ts';
import { GAMES } from '../src/game/registry.ts';
import { DIFFICULTIES } from '../src/minesweeper/board.ts';
import * as pinball from '../src/pinball/engine.ts';

/**
 * 클라이언트와 서버가 같은 규칙을 쓰는지 — 서버가 정본이고, 값이 어긋나면 기록·코인이 거절되거나 잠금이 다르게 풀린다.
 * 한쪽 값을 바꾸면 이 테스트가 다른 쪽도 바꾸라고 알려 준다.
 */

test('게임 목록과 잠금 조건이 같다', () => {
  assert.deepEqual([...GAME_IDS].sort(), GAMES.map((g) => g.id).sort());
  for (const g of GAMES) assert.deepEqual(UNLOCK_RULES[g.id] ?? null, g.unlock, g.id);
});

test('순위표 ID와 게임이 같다', () => {
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  const client = GAMES.flatMap((g) => g.boards.map((b) => ({ id: b.id, gameId: g.id }))).sort(byId);
  const server = BOARDS.map((b) => ({ id: b.id, gameId: b.gameId })).sort(byId);
  assert.deepEqual(server, client);
});

test('한 판 코인 상한과 점수 상한이 같다', () => {
  const cap = (id: string) => BOARDS.find((b) => b.id === id)?.maxCoinsPerRun;
  assert.equal(cap('pinball'), pinball.MAX_COINS_PER_RUN);
  assert.equal(cap('breakout'), breakout.MAX_COINS_PER_RUN);
  assert.equal(MAX_SCORE, pinball.MAX_SCORE);
  assert.equal(MAX_SCORE, breakout.MAX_SCORE);
});

test('지뢰찾기 판 크기·기준 시간·단계 순서가 같다', () => {
  for (const d of DIFFICULTIES) {
    const board = BOARDS.find((b) => b.id === `minesweeper.${d.id}`);
    assert.ok(board?.minesweeper, d.id);
    assert.deepEqual(board.minesweeper, { safe: d.cols * d.rows - d.mines, mines: d.mines, par: d.par });
    assert.equal(board.requires, d.requires ? `minesweeper.${d.requires}` : null);
  }
});

test('상점 아이템 ID·게임·슬롯·가격이 같다', () => {
  const client = CATALOG.map((i) => ({
    id: i.id,
    gameId: i.game,
    slot: i.slot,
    price: i.price.type === 'coin' ? { type: 'coin', amount: i.price.amount } : { type: i.price.type },
  }));
  assert.deepEqual(ITEMS, client);
});

test('서버 코인 상한이 가장 좋은 아이템 능력까지 받아 준다', () => {
  const ms = CATALOG.filter((i) => i.game === 'minesweeper');
  assert.equal(MAX_COIN_BONUS, Math.max(...ms.map((i) => i.ability?.coinValue ?? 0)));
  const extra = ms.map((i) => i.ability?.extraCoins ?? [0, 0, 0]);
  assert.deepEqual(
    [MAP_EXTRA_COINS_MAX.easy, MAP_EXTRA_COINS_MAX.normal, MAP_EXTRA_COINS_MAX.hard],
    [0, 1, 2].map((k) => Math.max(...extra.map((e) => e[k]))),
  );
});
