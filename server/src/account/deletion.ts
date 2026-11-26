import type { Db, Q, Tx } from '../shared/db/index.ts';
import { deleteDeletedUserRow, deleteLoginData, deleteUserRow, lockUser, markUserDeleted, readDeletedUserIds } from './repo.ts';

/**
 * 계정을 지울 때 다른 도메인이 할 일. account는 아래 단이라 지갑·보유·주문을 직접 가져오지 못하니,
 * 서버를 조립하는 쪽이 넣어 준다 (스펙 5.14).
 *
 * - `mustKeepUserRow`: 참이면 사용자 행을 `deleted`로 남긴다 (현금 주문이 있어서 5년 보관해야 할 때)
 * - `purge`: 이 사용자의 데이터를 지우는 함수들. 적힌 순서대로 부른다 (외래 키를 거는 쪽부터)
 */
export interface DeletionPolicy {
  mustKeepUserRow(tx: Tx, userId: string): Promise<boolean>;
  purge: Array<(tx: Tx, userId: string) => Promise<void>>;
}

/**
 * 부른 쪽의 트랜잭션 안에서 계정을 지운다 (충돌 정리가 손님을 지울 때도 쓴다).
 * 사용자 행을 먼저 잠가서, 지우는 동안 이 사용자에게 새 행(세션, 코인 기록 …)이 붙지 못하게 한다.
 *
 * 없는 사용자와 이미 지운(`deleted`로 행만 남은) 사용자에게는 아무것도 하지 않는다: `purge`도 부르지 않고 행도 그대로 둔다.
 * 그래서 이 함수로는 남은 사용자 행을 지울 수 없다. 현금 주문의 보관 기간(5년)이 지난 뒤 그 행을 지우는 길은
 * `listDeletedUsers`와 `removeDeletedUser`다 (order의 `orders purge-expired`가 부른다).
 */
export async function deleteAccountInTx(tx: Tx, userId: string, policy: DeletionPolicy, now: Date): Promise<void> {
  if (!(await lockUser(tx, userId))) return;
  const keep = await policy.mustKeepUserRow(tx, userId);
  for (const purge of policy.purge) await purge(tx, userId);
  await deleteLoginData(tx, userId);
  if (keep) await markUserDeleted(tx, userId, now);
  else await deleteUserRow(tx, userId);
}

/**
 * 계정 삭제 (스펙 5.4). 한 트랜잭션으로 다른 도메인의 데이터(`policy.purge`)와 로그인 수단·세션·설정을 지운다.
 * `mustKeepUserRow`가 참이면 사용자 행만 `deleted`로 남고(`deleted_at`은 `now`), 거짓이면 사용자 행까지 지운다.
 * 지운 뒤 같은 기기 비밀값으로 들어오면 새 손님이다.
 */
export async function deleteAccount(db: Db, userId: string, policy: DeletionPolicy, now: Date): Promise<void> {
  await db.transaction((tx) => deleteAccountInTx(tx, userId, policy, now));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 계정을 지울 때 `deleted`로 남겨 둔 사용자 행의 ID 전부 (ID 순서). 읽기만 한다.
 * order(`orders purge-expired`)가 이 가운데 주문이 하나도 남지 않은 사용자를 골라 `removeDeletedUser`로 지운다.
 */
export async function listDeletedUsers(q: Q): Promise<string[]> {
  return readDeletedUserIds(q);
}

/**
 * 계정을 지울 때 `deleted`로 남겨 둔 사용자 행을 마저 지운다. 지웠으면 참.
 *
 * 그 행은 보관해야 하는 현금 주문이 가리키고 있어서 남긴 것이다 (스펙 5.4). 보관 기간이 끝나 주문이 모두 지워진 뒤에
 * order(`orders purge-expired`)가 같은 트랜잭션에서 부른다. 살아 있는(`active`) 사용자와 없는 사용자에게는 아무것도 하지 않고 거짓을 준다.
 * 아직 이 사용자를 가리키는 행(남은 주문 등)이 있으면 외래 키 오류로 실패하고 부른 쪽의 트랜잭션이 되돌아간다.
 */
export async function removeDeletedUser(tx: Tx, userId: string): Promise<boolean> {
  if (!UUID.test(userId)) return false;
  return deleteDeletedUserRow(tx, userId);
}
