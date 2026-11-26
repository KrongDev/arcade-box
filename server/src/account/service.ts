import { randomToken, sha256Hex } from '../shared/crypto.ts';
import type { Db, Q, Tx } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import type { Session } from '../shared/http/index.ts';
import {
  deleteExpiredSessions,
  deleteGuestIdentity,
  deleteSession,
  deleteSessionsOfIdentity,
  deleteUserRow,
  distinctProviders,
  findIdentity,
  findLiveSession,
  holdUser,
  insertIdentityIfAbsent,
  insertSession,
  insertUser,
  lockUser,
  readSettings,
  readUser,
  touchIdentity,
  upsertSettings,
} from './repo.ts';
import {
  DEFAULT_SETTINGS,
  isAccountProvider,
  parseDeviceSecret,
  parseSettingsPatch,
  sessionExpiry,
  unauthorized,
  type AccountProvider,
  type Provider,
  type Settings,
} from './rules.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * 살아 있는 사용자를 이 트랜잭션이 끝날 때까지 잡아 둔다. 세션의 `userId`로 행을 쓰는 일은 먼저 이것을 부른다.
 *
 * 세션 확인과 쓰기 사이에 계정 삭제가 끼어들 수 있다. 잡지 않고 쓰면 삭제와 겹칠 때 외래 키 오류(500)가 나거나,
 * 현금 주문 때문에 행이 `deleted`로 남은 사용자에 새 행이 붙는다. 삭제가 도는 중이면 끝날 때까지 기다리고,
 * 없거나 지워진 사용자면 `RuleError(401, 'unauthorized')`를 던진다. 같은 사용자의 다른 쓰기는 막지 않는다.
 */
export async function requireActiveUser(tx: Tx, userId: string): Promise<void> {
  if (!UUID.test(userId) || !(await holdUser(tx, userId))) throw unauthorized();
}

/**
 * 보낸 것만 바꾸고 바뀐 뒤의 설정을 준다. 틀린 것이 하나라도 있으면 `400 invalid_settings`로 전부 거절한다.
 * 그사이 지워진 사용자면 `401 unauthorized`.
 */
export async function updateSettings(db: Db, userId: string, patch: unknown, now: Date): Promise<Settings> {
  const parsed = parseSettingsPatch(patch);
  return db.transaction(async (tx) => {
    await requireActiveUser(tx, userId);
    return upsertSettings(tx, userId, parsed, now);
  });
}

/** 이 사용자에게 붙은 로그인 수단의 종류 (중복 없이, guest → google → apple 순서) */
export async function listProviders(q: Q, userId: string): Promise<Provider[]> {
  const order: Provider[] = ['guest', 'google', 'apple'];
  const found = await distinctProviders(q, userId);
  return order.filter((p) => found.includes(p));
}

/**
 * 로그아웃 (스펙 5.4). 세션을 끝내고 이 기기의 기기 수단을 계정에서 떼어 지운다. 계정에 붙은 다른 기기는 그대로다.
 * 그 뒤 같은 기기 비밀값은 새 손님이 된다. 손님뿐인 사용자는 로그아웃하면 데이터를 잃으므로 거절한다.
 */
export async function logout(db: Db, session: Session, tokenHash: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await lockUser(tx, session.userId))) return; // 이미 지워진 사용자: 세션도 수단도 없다
    if (!(await distinctProviders(tx, session.userId)).some(isAccountProvider)) {
      throw new RuleError(409, 'guest_cannot_logout', '계정을 연결하지 않은 채 로그아웃하면 기록을 잃어요. 기록을 지우려면 계정 삭제를 써 주세요');
    }
    // 이 세션은 어느 수단으로 들어왔든 끝낸다. 지금은 모든 세션이 기기 수단으로 들어와서 아래 줄이 이 세션도 지우지만,
    // "로그아웃한 세션은 끝난다"가 그 사실에 기대지 않게 따로 지운다
    await deleteSession(tx, tokenHash);
    // 이 기기가 받아 둔 다른 세션도 함께 끝낸다 (수단이 사라지면 가리킬 곳이 없다)
    await deleteSessionsOfIdentity(tx, session.identityId);
    await deleteGuestIdentity(tx, session.identityId, session.userId);
  });
}

/** 이 계정 수단이 붙은 사용자 (명령줄 `user find`가 쓴다). 없으면 null */
export async function findUserByIdentity(q: Q, provider: AccountProvider, subject: string): Promise<string | null> {
  return (await findIdentity(q, provider, subject))?.userId ?? null;
}

/** 사용자 한 명 (명령줄 `user show`가 쓴다). 없거나 사용자 번호 모양이 아니면 null */
export async function getUser(q: Q, userId: string): Promise<{ id: string; status: 'active' | 'deleted'; createdAt: string } | null> {
  if (!UUID.test(userId)) return null;
  const row = await readUser(q, userId);
  return row ? { id: row.id, status: row.status, createdAt: row.createdAt.toISOString() } : null;
}
