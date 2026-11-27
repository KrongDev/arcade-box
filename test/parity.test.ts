import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as breakout from '../src/breakout/rules.ts';
import { CATALOG } from '../src/game/catalog.ts';
import { GAMES } from '../src/game/registry.ts';
import { COIN_VALUE, DIFFICULTIES } from '../src/minesweeper/board.ts';
import * as pinball from '../src/pinball/engine.ts';

/**
 * 앱과 서버가 같은 규칙을 쓰는지 — 서버가 정본이고, 값이 어긋나면 기록·코인이 거절된다.
 * 한쪽 값을 바꾸면 이 테스트가 다른 쪽도 바꾸라고 알려 준다.
 *
 * 서버 쪽 값은 처음 넣는 자료(`server/src/seed-data.ts`)다. 운영 DB의 값은 운영자가 명령줄로 바꿀 수 있으니,
 * 이 테스트가 지키는 것은 "새 DB에 처음 들어가는 값이 앱과 맞는다"까지다.
 * 서버에서 없어진 것은 견주지 않는다: 점수·단계 조건으로 게임 열기(v2는 코인으로 산다)가 그렇다.
 */

/** 이 테스트가 읽는 만큼의 모양 */
interface ServerSeed {
  games: Array<{ id: string }>;
  boards: Array<{
    id: string;
    gameId: string;
    ordering: string;
    minValue: number;
    maxValue: number;
    maxCoinsPerRun: number;
    requiresBoardId?: string | null;
    validator?: string;
    validatorParams?: unknown;
  }>;
  products: Array<{ id: string; kind: string; gameId?: string | null; slot?: string | null; access: string; prices: { COIN?: number; KRW?: number } }>;
}

// 경로를 값으로 넘겨 가져온다: 이 저장소 루트의 타입 검사가 서버 소스(와 서버만 설치하는 패키지의 타입)까지 따라가지 않게.
// 그래서 모양은 위에 적어 두고, 값이 맞는지는 아래 테스트가 본다
const seedModule: string = new URL('../server/src/seed-data.ts', import.meta.url).href;
const { SEED } = (await import(seedModule)) as { SEED: ServerSeed };

const board = (id: string) => {
  const found = SEED.boards.find((b) => b.id === id);
  assert.ok(found, `서버에 순위표 ${id}가 없다`);
  return found;
};

test('게임 목록이 같다', () => {
  assert.deepEqual(SEED.games.map((g) => g.id).sort(), GAMES.map((g) => g.id).sort());
  // 게임마다 게임 상품이 하나 있다 (이 상품을 가져야 그 게임을 한다)
  assert.deepEqual(
    SEED.products
      .filter((p) => p.kind === 'game')
      .map((p) => [p.id, p.gameId])
      .sort(),
    GAMES.map((g) => [`game.${g.id}`, g.id]).sort(),
  );
});

test('순위표 ID와 게임이 같다', () => {
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  const client = GAMES.flatMap((g) => g.boards.map((b) => ({ id: b.id, gameId: g.id }))).sort(byId);
  const server = SEED.boards.map((b) => ({ id: b.id, gameId: b.gameId })).sort(byId);
  assert.deepEqual(server, client);
});

test('한 판 코인 상한과 점수 상한이 같다', () => {
  assert.equal(board('pinball').maxCoinsPerRun, pinball.MAX_COINS_PER_RUN);
  assert.equal(board('breakout').maxCoinsPerRun, breakout.MAX_COINS_PER_RUN);
  // 점수는 클수록 좋고 0부터 상한까지다
  assert.deepEqual([board('pinball').ordering, board('pinball').minValue, board('pinball').maxValue], ['higher', 0, pinball.MAX_SCORE]);
  assert.deepEqual([board('breakout').ordering, board('breakout').minValue, board('breakout').maxValue], ['higher', 0, breakout.MAX_SCORE]);
});

test('지뢰찾기 판 크기·기준 시간·단계 순서가 같다', () => {
  for (const d of DIFFICULTIES) {
    const b = board(`minesweeper.${d.id}`);
    assert.equal(b.validator, 'minesweeper', d.id);
    assert.deepEqual(b.validatorParams, { safe: d.cols * d.rows - d.mines, mines: d.mines, par: d.par }, d.id);
    assert.equal(b.requiresBoardId ?? null, d.requires ? `minesweeper.${d.requires}` : null, d.id);
  }
});

test('지뢰찾기의 한 판 코인 상한이 가장 좋은 아이템 능력으로 벌 수 있는 코인까지 받아 준다', () => {
  // (숨은 동전 + 맵의 가장 큰 덤) × 동전 값 × (1 + 발판의 가장 큰 덤) + 깬 보너스
  const ms = CATALOG.filter((i) => i.game === 'minesweeper');
  const bestCoinValue = Math.max(...ms.map((i) => i.ability?.coinValue ?? 0));
  const extra = ms.map((i) => i.ability?.extraCoins ?? [0, 0, 0]);
  DIFFICULTIES.forEach((d, k) => {
    const bestExtra = Math.max(...extra.map((e) => e[k]));
    const most = Math.ceil((d.coins + bestExtra) * COIN_VALUE * (1 + bestCoinValue)) + d.clearBonus;
    assert.equal(board(`minesweeper.${d.id}`).maxCoinsPerRun, most, d.id);
  });
});

test('상점 아이템 ID·게임·슬롯·가격이 같다', () => {
  const client = CATALOG.map((i) => ({
    id: i.id,
    gameId: i.game,
    slot: i.slot,
    price: i.price.type === 'coin' ? { type: 'coin', amount: i.price.amount } : i.price.type === 'paid' ? { type: 'paid', krw: i.price.krw } : { type: 'free' },
  }));
  // 서버: 무료는 누구나 가진 것(everyone)이고 가격이 없다. 코인 아이템은 COIN 가격, 유료는 KRW 가격(판매가)이 있다
  const server = SEED.products
    .filter((p) => p.kind === 'item')
    .map((p) => ({
      id: p.id,
      gameId: p.gameId,
      slot: p.slot,
      price:
        p.access === 'everyone'
          ? { type: 'free', ...p.prices }
          : p.prices.COIN !== undefined
            ? { type: 'coin', amount: p.prices.COIN, ...(p.prices.KRW === undefined ? {} : { krw: p.prices.KRW }) }
            : { type: 'paid', krw: p.prices.KRW },
    }));
  assert.deepEqual(server, client);
});
