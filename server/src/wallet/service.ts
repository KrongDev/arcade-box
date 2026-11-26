import { requireActiveUser } from '../account/index.ts';
import type { Db, Q, Tx } from '../shared/db/index.ts';
import { idempotencyKey as checkKey } from '../shared/validate.ts';
import { deleteCoins, findByKey, insertEntry, lockWallet as lockWalletRow, readBalance, selectEntries, selectMismatched, setBalance, type Mismatch } from './repo.ts';
import { checkDelta, checkLedgerPage, idempotencyMismatch, nextBalance, sameRequest, type LedgerPage, type LedgerReason } from './rules.ts';

/**
 * 코인이 변하는 유일한 길 (스펙 5.5, 5.15). 판 결과·출석·광고 보상·구매·환불·운영자 지급이 모두 이 함수를 부른다.
 * 다른 코드는 `wallets`와 `coin_ledger`에 쓰지 않는다.
 *
 * 부른 쪽의 트랜잭션(`tx`) 안에서만 일하고 스스로 트랜잭션을 열지 않는다. 그래서 잔액과 기록은 부른 쪽의 일
 * (판 저장, 주문 …)과 함께 남거나 함께 사라진다: 부른 쪽이 뒤에서 실패하면 코인도 남지 않는다.
 * 트랜잭션의 격리 수준은 기본(READ COMMITTED)이어야 한다.
 *
 * 순서: 사용자 잡기 → 지갑 잠금 → (키가 있으면) 같은 키의 기록 찾기 → 잔액 확인 → 기록 추가 → 잔액 갱신.
 * 잠그는 순서는 늘 사용자 행 → 지갑 행 → 그 밖이다.
 *
 * - `delta`: 0이 아닌 안전한 정수. 아니면 `400 invalid_delta`
 * - 잔액이 모자라면 `409 insufficient_coins`, 상한(9,000,000,000,000,000)을 넘으면 `409 balance_limit`. 둘 다 아무것도 쓰지 않는다
 * - `idempotencyKey`: 같은 사용자가 같은 키로 다시 보내면 처음 결과를 `replayed: true`로 그대로 준다 (그사이 잔액이 바뀌었어도).
 *   증감이나 까닭이 처음과 다르면 `409 idempotency_mismatch`. 키는 사용자마다 따로다
 * - `adminActionId`: 운영자 지급·조정일 때 그 운영 기록의 번호
 * - `now`: 기록과 지갑에 남는 시각. 요청을 받은 시각(`ctx.now`)을 넘긴다. 없으면 DB의 지금이다
 * - 없거나 지워진 사용자면 `401 unauthorized`
 */
export async function applyCoins(
  tx: Tx,
  input: { userId: string; delta: number; reason: LedgerReason; adminActionId?: number; idempotencyKey?: string | null; now?: Date },
): Promise<{ ledgerId: number; balance: number; replayed: boolean }> {
  const delta = checkDelta(input.delta);
  const key = checkKey(input.idempotencyKey);
  const { userId, reason, now } = input;

  // 계정 삭제와 겹치면 삭제가 끝나기를 기다렸다가 401로 끝난다. 잡지 않으면 지워진 사용자에 지갑이 붙는다
  await requireActiveUser(tx, userId);
  const balance = await lockWalletRow(tx, userId, now);

  // 같은 키의 기록은 지갑을 잠근 뒤에 찾는다. 같은 키가 동시에 두 번 와도 뒤의 요청은 앞의 요청이 끝난 뒤
  // 여기에 오므로 앞에서 넣은 줄을 본다 (유일 제약에 부딪혀 500이 나는 일이 없다)
  if (key !== null) {
    const first = await findByKey(tx, userId, key);
    if (first) {
      if (!sameRequest(first, { delta, reason })) throw idempotencyMismatch();
      return { ledgerId: first.id, balance: first.balanceAfter, replayed: true };
    }
  }

  const next = nextBalance(balance, delta);
  const ledgerId = await insertEntry(tx, { userId, delta, balanceAfter: next, reason, adminActionId: input.adminActionId ?? null, idempotencyKey: key, now });
  await setBalance(tx, userId, next, now);
  return { ledgerId, balance: next, replayed: false };
}

/**
 * 이 사용자의 지갑 행을 잠그고 지금 잔액을 준다. 코인은 바꾸지 않는다.
 *
 * 한 사용자의 요청을 차례로 세울 때 쓴다 (판 결과의 3초 간격, 보상의 하루 한도): 확인을 시작하기 전에 이것을 부르면
 * 같은 사용자의 다른 요청은 이 트랜잭션이 끝날 때까지 여기서 기다린다. 코인이 0이라 `applyCoins`를 부르지 않는 요청도
 * 같은 줄에 선다. 잠그는 순서는 `applyCoins`와 같다: 사용자 행 → 지갑 행 → 그 밖. 뒤에서 `applyCoins`를 불러도 된다.
 *
 * 지갑이 없으면 잔액 0인 지갑이 생긴다 (잠글 행이 있어야 해서). 코인 기록은 생기지 않고, 부른 쪽이 실패하면 지갑도 남지 않는다.
 * `now`는 새로 생기는 지갑에 남는 시각이다. 없거나 지워진 사용자면 `401 unauthorized`.
 */
export async function lockWallet(tx: Tx, userId: string, now?: Date): Promise<number> {
  await requireActiveUser(tx, userId);
  return lockWalletRow(tx, userId, now);
}

/** 지금 잔액. 지갑이 없으면(코인을 받은 적이 없으면) 0 */
export async function getBalance(q: Q, userId: string): Promise<number> {
  return (await readBalance(q, userId)) ?? 0;
}

export interface LedgerEntry {
  id: number;
  delta: number;
  balanceAfter: number;
  reason: LedgerReason;
  createdAt: string;
}

/**
 * 이 사용자의 코인 기록을 최신부터 `limit`개(1~100) 준다. 더 있으면 `next`에 다음 쪽의 `before`로 쓸 번호를,
 * 없으면 null을 준다. 다른 사용자의 기록은 `before`를 어떻게 주든 나오지 않는다.
 */
export async function listLedger(db: Db, userId: string, page: LedgerPage): Promise<{ entries: LedgerEntry[]; next: number | null }> {
  const { before, limit } = checkLedgerPage(page);
  // 하나 더 읽어서 다음 쪽이 있는지 안다
  const rows = await selectEntries(db, userId, before, limit + 1);
  const shown = rows.slice(0, limit);
  return {
    entries: shown.map((row) => ({ id: row.id, delta: row.delta, balanceAfter: row.balanceAfter, reason: row.reason, createdAt: row.createdAt.toISOString() })),
    next: rows.length > limit ? shown[shown.length - 1].id : null,
  };
}

/**
 * 어긋난 지갑만 준다: 잔액이 기록의 합과 다르거나 마지막 `balance_after`와 다른 것 (스펙 5.3).
 * 멀쩡하면 빈 목록이다. 읽기만 하고 고치지 않는다. `userId`를 주면 그 사용자만 본다.
 */
export async function verifyWallets(db: Db, userId?: string): Promise<Mismatch[]> {
  return selectMismatched(db, userId);
}

/**
 * 이 사용자의 지갑과 코인 기록을 지운다 (계정 삭제, 스펙 5.4). 계정 삭제의 트랜잭션 안에서 사용자 행이 잠긴 채 불린다.
 * 코인 기록을 가리키는 쪽(판, 보상, 주문 사건)을 먼저 지운 뒤에 불러야 한다.
 */
export async function purgeUser(tx: Tx, userId: string): Promise<void> {
  await deleteCoins(tx, userId);
}
