import { eq } from 'drizzle-orm';
import { findSession } from '../../src/account/index.ts';
import { routes } from '../../src/entitlement/index.ts';
import { entitlements } from '../../src/entitlement/schema.ts';
import { createGame, updateGame } from '../../src/game/index.ts';
import { createProduct, type NewProduct } from '../../src/product/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { createHandler } from '../../src/shared/http/index.ts';
import type { Clock } from '../../src/shared/time.ts';
import { testConfig } from '../account/helpers.ts';
import type { Handler } from '../helpers/http.ts';

export const NOW = new Date('2026-11-26T03:00:00Z');

export const rule = (status: number, code: string) => (err: unknown) => err instanceof RuleError && err.status === status && err.code === code;

const PRODUCTS: NewProduct[] = [
  { id: 'game.pinball', kind: 'game', name: '핀볼', access: 'everyone', gameId: 'pinball', status: 'on_sale' },
  { id: 'game.minesweeper', kind: 'game', name: '지뢰찾기', access: 'purchase', gameId: 'minesweeper', status: 'on_sale' },
  { id: 'game.breakout', kind: 'game', name: '벽돌깨기', access: 'everyone', gameId: 'breakout', status: 'on_sale' },
  { id: 'pinball.table.classic', kind: 'item', name: '클래식', access: 'everyone', gameId: 'pinball', slot: 'table', status: 'on_sale' },
  { id: 'pinball.table.sunset', kind: 'item', name: '노을', access: 'purchase', gameId: 'pinball', slot: 'table', status: 'on_sale' },
  { id: 'pinball.table.neon', kind: 'item', name: '네온', access: 'purchase', gameId: 'pinball', slot: 'table', status: 'hidden' },
  { id: 'pinball.ball.gold', kind: 'item', name: '금 공', access: 'purchase', gameId: 'pinball', slot: 'ball', status: 'on_sale' },
  { id: 'minesweeper.tile.mint', kind: 'item', name: '민트', access: 'purchase', gameId: 'minesweeper', slot: 'tile', status: 'on_sale' },
  { id: 'coins.1000', kind: 'coin_pack', name: '코인 1000', access: 'purchase', grantCoins: 1000, status: 'on_sale' },
];

/**
 * 게임 셋과 상품: pinball(live, game 상품 everyone), minesweeper(live, purchase), breakout(draft, everyone),
 * 핀볼 아이템(classic은 everyone, sunset·neon·gold는 purchase), 지뢰찾기 아이템 하나, 코인 묶음 하나.
 */
export async function seedCatalog(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const id of ['pinball', 'minesweeper', 'breakout']) await createGame(tx, { id, name: id, description: '' });
    await updateGame(tx, 'pinball', { status: 'live' });
    await updateGame(tx, 'minesweeper', { status: 'live' });
    for (const p of PRODUCTS) await createProduct(tx, p);
  });
}

export function rowsOf(db: Db, userId: string) {
  return db.select().from(entitlements).where(eq(entitlements.userId, userId)).orderBy(entitlements.id);
}

/** entitlement의 경로만 붙인 HTTP 처리기. 세션은 진짜 `findSession`으로 찾는다 */
export function entitlementHandler(db: Db, clock: Clock): Handler {
  return createHandler(routes({ db }), {
    allowedOrigins: testConfig.allowedOrigins,
    now: clock,
    findSession: (tokenHash, now) => findSession(db, tokenHash, now),
  });
}
