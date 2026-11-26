import { randomToken, sha256Hex } from '../shared/crypto.ts';
import type { Db, Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import type { Session } from '../shared/http/index.ts';
import {
  deleteExpiredSessions,
  deleteUserRow,
  distinctProviders,
  findIdentity,
  findLiveSession,
  holdUser,
  insertIdentityIfAbsent,
  insertSession,
  insertUser,
  readSettings,
  touchIdentity,
  upsertSettings,
} from './repo.ts';
import { DEFAULT_SETTINGS, parseDeviceSecret, parseSettingsPatch, sessionExpiry, type Provider, type Settings } from './rules.ts';

/** 세션을 하나 만들어 토큰 원문을 돌려준다. 원문은 여기서 한 번만 나가고 DB에는 해시만 남는다 */
export async function issueSession(tx: Tx, userId: string, identityId: number, now: Date, ttlDays: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = sessionExpiry(now, ttlDays);
  await insertSession(tx, { tokenHash: sha256Hex(token), userId, identityId, expiresAt, now });
  return { token, expiresAt };
}

/**
 * 손님 등록·재로그인 (스펙 5.4). 기기 비밀값의 해시가 기기 수단으로 있으면 그 수단이 붙은 사용자의 세션을 주고,
 * 없으면 새 사용자와 기기 수단을 만든다. 기기 수단이 계정에 붙어 있으면 그 계정으로 들어간다.
 */
export async function registerOrLoginGuest(
  db: Db,
  deviceSecret: string,
  now: Date,
  ttlDays: number,
): Promise<{ userId: string; token: string; expiresAt: Date; created: boolean }> {
  const subject = sha256Hex(parseDeviceSecret(deviceSecret));
  // 끝난 세션은 로그인할 때 치운다. 로그인과 따로 끝나는 한 문장이라 로그인을 막지 않는다
  await deleteExpiredSessions(db, now);
  return db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await findIdentity(tx, 'guest', subject);
      if (existing) {
        // 잠그는 순서는 늘 사용자 → 수단이다 (계정 삭제·로그아웃·충돌 정리와 같은 순서라 서로 물고 서지 않는다).
        // 읽은 사이에 사용자가 지워졌거나 수단이 사라졌거나 다른 계정으로 옮겨졌으면 처음부터 다시 본다
        if (!(await holdUser(tx, existing.userId))) continue;
        if ((await touchIdentity(tx, existing.id, now)) !== existing.userId) continue;
        return { userId: existing.userId, ...(await issueSession(tx, existing.userId, existing.id, now, ttlDays)), created: false };
      }
      const userId = await insertUser(tx, now);
      const identityId = await insertIdentityIfAbsent(tx, { userId, provider: 'guest', subject, now });
      if (identityId !== null) return { userId, ...(await issueSession(tx, userId, identityId, now, ttlDays)), created: true };
      // 같은 기기 비밀값의 다른 요청이 한발 먼저 만들었다 (유일 제약). 방금 만든 사용자 행을 치우고 그 사용자로 로그인한다
      await deleteUserRow(tx, userId);
    }
    throw new RuleError(503, 'try_again', '잠시 뒤 다시 시도해 주세요');
  });
}

/** 세션 토큰의 해시로 세션을 찾는다. 없거나 끝났으면 null (끝나는 시각부터는 통하지 않는다) */
export async function findSession(db: Db, tokenHash: string, now: Date): Promise<Session | null> {
  return findLiveSession(db, tokenHash, now);
}

export async function getSettings(q: Q, userId: string): Promise<Settings> {
  return (await readSettings(q, userId)) ?? { ...DEFAULT_SETTINGS };
}

/** 보낸 것만 바꾸고 바뀐 뒤의 설정을 준다. 틀린 것이 하나라도 있으면 `400 invalid_settings`로 전부 거절한다 */
export async function updateSettings(db: Db, userId: string, patch: unknown): Promise<Settings> {
  return upsertSettings(db, userId, parseSettingsPatch(patch));
}

/** 이 사용자에게 붙은 로그인 수단의 종류 (중복 없이, guest → google → apple 순서) */
export async function listProviders(q: Q, userId: string): Promise<Provider[]> {
  const order: Provider[] = ['guest', 'google', 'apple'];
  const found = await distinctProviders(q, userId);
  return order.filter((p) => found.includes(p));
}
