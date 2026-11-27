import { createGame } from '../../src/game/index.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { RuleError } from '../../src/shared/errors.ts';
import { createProduct } from '../../src/product/index.ts';

export const rule = (status: number, code: string) => (err: unknown) => err instanceof RuleError && err.status === status && err.code === code;

/** DB가 거절했을 때의 PostgreSQL 오류 코드와 제약 이름 (Drizzle이 감싼 속의 오류에서) */
export function pgError(err: unknown): { code: string; constraint: string } {
  const inner = ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
  return { code: inner.code ?? '', constraint: inner.constraint ?? '' };
}

export async function games(db: Db, ids: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const id of ids) await createGame(tx, { id, name: id, description: '' });
  });
}

export type ProductInput = Parameters<typeof createProduct>[1];

export const add = (db: Db, input: ProductInput) => db.transaction((tx) => createProduct(tx, input));
