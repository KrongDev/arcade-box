import { findSession } from '../../src/account/index.ts';
import { addVersion, createGame, publish, updateGame } from '../../src/game/index.ts';
import { createBoard } from '../../src/play/index.ts';
import { createProduct, setPrice, type NewProduct } from '../../src/product/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { createHandler } from '../../src/shared/http/index.ts';
import type { Clock } from '../../src/shared/time.ts';
import { routes } from '../../src/view/index.ts';
import { testConfig } from '../account/helpers.ts';
import type { GameKit } from '../game/helpers.ts';
import type { Handler } from '../helpers/http.ts';

/** 2026-11-26 12:00 KST */
export const NOW = new Date('2026-11-26T03:00:00Z');

/**
 * 목록에 나와야 하는 것과 나오면 안 되는 것을 섞은 자료.
 * - 게임: pinball(live), minesweeper(live, 버전 1·2를 차례로 내보냄), breakout(draft)
 * - 상품: 팔리는 것(on_sale)과 숨김·초안, 그리고 draft 게임(breakout)에 딸린 on_sale 상품
 */
const PRODUCTS: Array<NewProduct & { coin?: number; krw?: number }> = [
  { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'everyone', gameId: 'pinball', status: 'on_sale' },
  { id: 'game.minesweeper', kind: 'game', name: '지뢰찾기', access: 'purchase', gameId: 'minesweeper', status: 'on_sale', coin: 3000 },
  { id: 'game.breakout', kind: 'game', name: '벽돌깨기', access: 'purchase', gameId: 'breakout', status: 'on_sale', coin: 3000 },
  { id: 'pinball.table.classic', kind: 'item', name: '기본 판', access: 'everyone', gameId: 'pinball', slot: 'table', status: 'on_sale' },
  { id: 'pinball.table.sunset', kind: 'item', name: '노을 판', access: 'purchase', gameId: 'pinball', slot: 'table', status: 'on_sale', coin: 1000 },
  { id: 'pinball.table.neon', kind: 'item', name: '네온 시티 판', access: 'purchase', gameId: 'pinball', slot: 'table', status: 'hidden', krw: 3300 },
  { id: 'pinball.ball.draft', kind: 'item', name: '초안 공', access: 'purchase', gameId: 'pinball', slot: 'ball', status: 'draft', coin: 500 },
  { id: 'breakout.paddle.mint', kind: 'item', name: '민트 패들', access: 'purchase', gameId: 'breakout', slot: 'paddle', status: 'on_sale', coin: 1000 },
];

export async function seedView(kit: GameKit): Promise<void> {
  const { db } = kit;
  await db.transaction(async (tx) => {
    await createGame(tx, { id: 'pinball', name: '핀볼', description: '플리퍼로 공을 튕겨요', sortOrder: 1 });
    await createGame(tx, { id: 'minesweeper', name: '지뢰찾기', description: '지뢰를 피해요', sortOrder: 2 });
    await createGame(tx, { id: 'breakout', name: '벽돌깨기', description: '벽돌을 깨요', sortOrder: 3 });
    await updateGame(tx, 'pinball', { status: 'live' });
    for (const p of PRODUCTS) {
      const { coin, krw, ...product } = p;
      await createProduct(tx, product);
      if (coin !== undefined) await setPrice(tx, p.id, 'COIN', coin);
      if (krw !== undefined) await setPrice(tx, p.id, 'KRW', krw);
    }
    await createBoard(tx, { id: 'pinball', gameId: 'pinball', label: '핀볼', ordering: 'higher', minValue: 0, maxValue: 5_000_000, maxCoinsPerRun: 400 });
    await createBoard(tx, { id: 'breakout', gameId: 'breakout', label: '벽돌깨기', ordering: 'higher', minValue: 0, maxValue: 5_000_000, maxCoinsPerRun: 400 });
    await createBoard(tx, {
      id: 'minesweeper.easy',
      gameId: 'minesweeper',
      label: '초급',
      ordering: 'higher',
      minValue: 0,
      maxValue: 5_000_000,
      maxCoinsPerRun: 69,
      validator: 'minesweeper',
      validatorParams: { safe: 70, mines: 10, par: 180 },
      sortOrder: 1,
    });
    await createBoard(tx, {
      id: 'minesweeper.normal',
      gameId: 'minesweeper',
      label: '중급',
      ordering: 'higher',
      minValue: 0,
      maxValue: 5_000_000,
      maxCoinsPerRun: 131,
      requiresBoardId: 'minesweeper.easy',
      validator: 'minesweeper',
      validatorParams: { safe: 180, mines: 36, par: 480 },
      sortOrder: 2,
    });
  });
  // 지뢰찾기는 버전 1과 2를 차례로 내보낸다 (publish가 draft 게임을 live로 바꾼다)
  for (const version of [1, 2]) {
    const b = await kit.bundle('minesweeper', version);
    await db.transaction(async (tx) => {
      await addVersion(tx, { gameId: 'minesweeper', version, filePath: b.filePath, signature: b.signature, minShellApi: 1 }, kit.env);
      await publish(tx, 'minesweeper', version);
    });
  }
}

/** view의 경로만 붙인 HTTP 처리기. 세션은 진짜 `findSession`으로 찾는다 */
export function viewHandler(db: Db, clock: Clock): Handler {
  return createHandler(routes({ db }), {
    allowedOrigins: testConfig.allowedOrigins,
    now: clock,
    findSession: (tokenHash, now) => findSession(db, tokenHash, now),
  });
}
