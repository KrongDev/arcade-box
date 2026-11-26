/**
 * 처음 자료를 넣는다 (스펙 5.13). 명령 `seed --reason <까닭>`.
 * 이미 있는 id는 건드리지 않는다: 두 번 돌려도 두 번째는 아무것도 만들지 않고, 운영자가 고친 것(이름·가격·상태)을 되돌리지 않는다.
 */
import { mutation } from './admin/index.ts';
import { createGame, getGame, updateGame } from './game/index.ts';
import { createBoard, listBoards } from './play/index.ts';
import { createProduct, getProduct, setPrice, type Currency } from './product/index.ts';
import { SEED } from './seed-data.ts';
import type { Command } from './shared/cli/index.ts';
import type { Db, Tx } from './shared/db/index.ts';

export interface SeedResult {
  /** 새로 만든 게임·순위표·상품의 수 */
  created: number;
  /** 이미 있어서 건너뛴 수 */
  skipped: number;
}

/** 부른 쪽의 트랜잭션 안에서 처음 자료를 넣는다. 하나라도 실패하면 트랜잭션째 되돌아간다 */
export async function seedIn(tx: Tx): Promise<SeedResult> {
  let created = 0;
  let skipped = 0;

  for (const game of SEED.games) {
    if (await getGame(tx, game.id)) {
      skipped++;
      continue;
    }
    await createGame(tx, game);
    // 묶음 버전이 없어도 live다: 목록에 나오고 살 수 있다. 버전은 2번 작업에서 올린다
    await updateGame(tx, game.id, { status: 'live' });
    created++;
  }

  for (const board of SEED.boards) {
    if ((await listBoards(tx, board.gameId)).some((b) => b.id === board.id)) {
      skipped++;
      continue;
    }
    await createBoard(tx, board);
    created++;
  }

  for (const { prices, ...product } of SEED.products) {
    if (await getProduct(tx, product.id)) {
      skipped++;
      continue;
    }
    await createProduct(tx, product);
    for (const [currency, amount] of Object.entries(prices) as Array<[Currency, number]>) await setPrice(tx, product.id, currency, amount);
    created++;
  }

  return { created, skipped };
}

/** 처음 자료를 한 트랜잭션으로 넣는다 */
export function seed(db: Db): Promise<SeedResult> {
  return db.transaction((tx) => seedIn(tx));
}

/** 명령 `seed`. 바꾸는 명령이라 `--reason`이 있어야 하고 운영 기록을 남긴다 */
export function seedCommand(db: Db, actor: string): Command {
  return {
    name: 'seed',
    usage: 'seed --reason <까닭> [--yes]',
    run: mutation(db, actor, {
      action: 'seed',
      describe: () => `처음 자료(게임 ${SEED.games.length}, 순위표 ${SEED.boards.length}, 상품 ${SEED.products.length})를 넣어요. 이미 있는 것은 건드리지 않아요`,
      apply: (tx) => seedIn(tx),
      report: (r) => `만들었어요 ${r.created}, 이미 있어서 건너뜀 ${r.skipped}`,
    }),
  };
}
