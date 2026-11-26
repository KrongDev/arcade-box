import type { Db, Tx } from '../shared/db/index.ts';
import { deleteLoginData, deleteUserRow, lockUser, markUserDeleted } from './repo.ts';

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
 * 이미 없는 사용자면 아무것도 하지 않는다.
 */
export async function deleteAccountInTx(tx: Tx, userId: string, policy: DeletionPolicy): Promise<void> {
  if (!(await lockUser(tx, userId))) return;
  const keep = await policy.mustKeepUserRow(tx, userId);
  for (const purge of policy.purge) await purge(tx, userId);
  await deleteLoginData(tx, userId);
  if (keep) await markUserDeleted(tx, userId);
  else await deleteUserRow(tx, userId);
}

/**
 * 계정 삭제 (스펙 5.4). 한 트랜잭션으로 다른 도메인의 데이터(`policy.purge`)와 로그인 수단·세션·설정을 지운다.
 * `mustKeepUserRow`가 참이면 사용자 행만 `deleted`로 남고, 거짓이면 사용자 행까지 지운다.
 * 지운 뒤 같은 기기 비밀값으로 들어오면 새 손님이다.
 */
export async function deleteAccount(db: Db, userId: string, policy: DeletionPolicy): Promise<void> {
  await db.transaction((tx) => deleteAccountInTx(tx, userId, policy));
}
