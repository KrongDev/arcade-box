import { randomToken, sha256Hex } from '../shared/crypto.ts';
import type { Db, Q } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import type { Session } from '../shared/http/index.ts';
import { obj, str } from '../shared/validate.ts';
import { deleteAccountInTx, type DeletionPolicy } from './deletion.ts';
import {
  consumeNonce,
  deleteExpiredNonces,
  deleteGuestIdentity,
  deleteSession,
  deleteSessionsOfIdentity,
  distinctProviders,
  findIdentity,
  holdUser,
  insertIdentityIfAbsent,
  insertNonce,
  lockUser,
  moveGuestIdentity,
  readUser,
} from './repo.ts';
import { isAccountProvider, type AccountProvider } from './rules.ts';
import { issueSession, listProviders } from './service.ts';
import type { IdTokenVerifier } from './verify.ts';

/** 연결 충돌 때 양쪽을 견줘 보여 줄 요약. 조립이 지갑과 보유로 만들어 넣어 준다 */
export type Summarize = (q: Q, userId: string) => Promise<{ coins: number; games: number }>;

const NONCE_TTL_MS = 5 * 60 * 1000;
/** 구글 ID 토큰은 1~2KB다 */
const MAX_ID_TOKEN = 8192;

const tokenInvalid = () => new RuleError(401, 'token_invalid', '로그인 정보를 확인하지 못했어요. 다시 시도해 주세요');
const sessionGone = () => new RuleError(401, 'unauthorized', '로그인이 필요해요');
const tryAgain = () => new RuleError(503, 'try_again', '잠시 뒤 다시 시도해 주세요');
const linkedElsewhere = () => new RuleError(409, 'linked_elsewhere', '이 계정은 다른 사용자에게 연결돼 있어요. 이미 계정을 연결한 사용자와는 합칠 수 없어요');

/**
 * 계정 연결에 쓰는 일회용 값을 만든다. 앱이 구글 로그인에 넣고, 돌아온 ID 토큰에 같은 값이 들어 있어야 한다.
 * 5분 동안 한 번만 쓸 수 있다. 서버에는 해시만 둔다. 지난 것은 새로 만들 때 치운다.
 */
export async function issueNonce(db: Db, now: Date): Promise<string> {
  const nonce = randomToken();
  await deleteExpiredNonces(db, now);
  await insertNonce(db, sha256Hex(nonce), new Date(now.getTime() + NONCE_TTL_MS));
  return nonce;
}

function parseLinkInput(input: unknown): { provider: string; idToken: string } {
  const body = obj(input, 'body');
  return {
    idToken: str(body.idToken, 'id_token', { min: 1, max: MAX_ID_TOKEN }),
    provider: str(body.provider, 'provider', { min: 1, max: 20, pattern: /^[a-z]+$/ }),
  };
}

/** 토큰을 확인하고(트랜잭션 밖: 공개 키를 받아 오느라 기다릴 수 있다) nonce의 해시를 준다 */
async function verified(input: unknown, verify: IdTokenVerifier): Promise<{ provider: AccountProvider; sub: string; nonceHash: string }> {
  const { provider, idToken } = parseLinkInput(input);
  const id = await verify(provider, idToken);
  // nonce가 없는 토큰은 우리 서버가 시킨 로그인에서 나온 것인지 알 수 없다
  if (id.nonce === null) throw tokenInvalid();
  return { provider: id.provider, sub: id.sub, nonceHash: sha256Hex(id.nonce) };
}

/**
 * 계정 연결 (스펙 5.4). ID 토큰을 확인하고 그 사용자 고유값을 계정 수단으로 지금 사용자에게 붙인다.
 *
 * - 그 계정이 다른 사용자에게 붙어 있고 지금 사용자가 손님뿐이면 `409 link_conflict`와 양쪽 요약을 준다.
 *   아무것도 바꾸지 않고 nonce도 쓰지 않은 것으로 둬서, 앱이 같은 토큰을 `resolveLink`에 다시 보낼 수 있다.
 * - 지금 사용자에게 이미 계정 수단이 있으면 `409 linked_elsewhere` (진짜 계정 둘은 합치지 않는다).
 * - 지금 사용자에게 같은 종류의 다른 계정이 이미 붙어 있으면 `409 already_linked`.
 *
 * nonce는 트랜잭션 안에서 지우면서 확인한다. 거절로 끝나면 트랜잭션이 되돌아가 nonce가 남는다.
 */
export async function linkIdentity(
  db: Db,
  session: Session,
  input: unknown,
  verify: IdTokenVerifier,
  now: Date,
  summarize: Summarize,
): Promise<{ linked: true; providers: string[] }> {
  const id = await verified(input, verify);
  return db.transaction(async (tx) => {
    if (!(await consumeNonce(tx, id.nonceHash, now))) throw tokenInvalid();
    if (!(await lockUser(tx, session.userId))) throw sessionGone();
    for (let attempt = 0; attempt < 3; attempt++) {
      const mine = await distinctProviders(tx, session.userId);
      const existing = await findIdentity(tx, id.provider, id.sub);
      if (existing) {
        if (existing.userId === session.userId) break; // 이미 내게 붙어 있다
        if (mine.some(isAccountProvider)) throw linkedElsewhere();
        throw new RuleError(409, 'link_conflict', '이미 다른 기록이 있는 계정이에요. 그 계정의 기록을 쓰면 이 기기의 기록은 사라져요', {
          account: await summarize(tx, existing.userId),
          device: await summarize(tx, session.userId),
        });
      }
      if (mine.includes(id.provider)) throw new RuleError(409, 'already_linked', '이미 다른 계정이 연결돼 있어요');
      if ((await insertIdentityIfAbsent(tx, { userId: session.userId, provider: id.provider, subject: id.sub, now })) !== null) break;
      // 같은 계정을 다른 사용자가 방금 붙였다 (유일 제약). 다시 읽으면 충돌로 답하게 된다
      if (attempt === 2) throw tryAgain();
    }
    return { linked: true, providers: await listProviders(tx, session.userId) };
  });
}

/**
 * 연결 충돌 정리: "그 계정의 기록을 쓰기". `link_conflict`를 받은 앱이 같은 토큰으로 부른다.
 * 한 트랜잭션에서 이 기기의 기기 수단을 그 계정으로 옮기고, 손님 사용자와 그 데이터를 지우고, 그 계정의 세션을 준다.
 * 합치지 않는다 (손님을 여러 번 만들어 코인을 모으는 일을 막는다).
 */
export async function resolveLink(
  db: Db,
  session: Session,
  input: unknown,
  verify: IdTokenVerifier,
  now: Date,
  ttlDays: number,
  policy: DeletionPolicy,
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  const id = await verified(input, verify);
  return db.transaction(async (tx) => {
    if (!(await consumeNonce(tx, id.nonceHash, now))) throw tokenInvalid();
    if (!(await lockUser(tx, session.userId))) throw sessionGone();
    const target = await findIdentity(tx, id.provider, id.sub);
    if (!target || target.userId === session.userId) throw new RuleError(409, 'no_link_conflict', '정리할 충돌이 없어요. 연결을 다시 시도해 주세요');
    if ((await distinctProviders(tx, session.userId)).some(isAccountProvider)) throw linkedElsewhere();
    // 옮겨 갈 계정이 그사이 지워지지 않게 잡아 둔다
    if (!(await holdUser(tx, target.userId))) throw new RuleError(409, 'no_link_conflict', '정리할 충돌이 없어요. 연결을 다시 시도해 주세요');
    if (!(await moveGuestIdentity(tx, session.identityId, session.userId, target.userId))) throw sessionGone();
    await deleteAccountInTx(tx, session.userId, policy);
    const issued = await issueSession(tx, target.userId, session.identityId, now, ttlDays);
    return { userId: target.userId, ...issued };
  });
}

/**
 * 로그아웃 (스펙 5.4). 세션을 끝내고 이 기기의 기기 수단을 계정에서 떼어 지운다. 계정에 붙은 다른 기기는 그대로다.
 * 그 뒤 같은 기기 비밀값은 새 손님이 된다. 손님뿐인 사용자는 로그아웃하면 데이터를 잃으므로 거절한다.
 */
export async function logout(db: Db, session: Session, tokenHash: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await lockUser(tx, session.userId))) return; // 이미 지워진 사용자
    if (!(await distinctProviders(tx, session.userId)).some(isAccountProvider)) {
      throw new RuleError(409, 'guest_cannot_logout', '계정을 연결하지 않은 채 로그아웃하면 기록을 잃어요. 기록을 지우려면 계정 삭제를 써 주세요');
    }
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 사용자 한 명 (명령줄 `user show`가 쓴다). 없거나 사용자 번호 모양이 아니면 null */
export async function getUser(q: Q, userId: string): Promise<{ id: string; status: 'active' | 'deleted'; createdAt: string } | null> {
  if (!UUID.test(userId)) return null;
  const row = await readUser(q, userId);
  return row ? { id: row.id, status: row.status, createdAt: row.createdAt.toISOString() } : null;
}
