import { randomToken, sha256Hex } from '../shared/crypto.ts';
import type { Db, Q } from '../shared/db/index.ts';
import { RuleError } from '../shared/errors.ts';
import type { Session } from '../shared/http/index.ts';
import { deleteAccountInTx, type DeletionPolicy } from './deletion.ts';
import { consumeNonce, deleteExpiredNonces, distinctProviders, findIdentity, holdUser, insertIdentityIfAbsent, insertNonce, lockUser, moveGuestIdentity } from './repo.ts';
import { isAccountProvider, parseLinkInput, tokenInvalid, unauthorized, type AccountProvider } from './rules.ts';
import { issueSession, listProviders } from './service.ts';
import type { IdTokenVerifier } from './verify.ts';

/** 연결 충돌 때 양쪽을 견줘 보여 줄 요약. 조립이 지갑과 보유로 만들어 넣어 준다 */
export type Summarize = (q: Q, userId: string) => Promise<{ coins: number; games: number }>;

const NONCE_TTL_MS = 5 * 60 * 1000;

const tryAgain = () => new RuleError(503, 'try_again', '잠시 뒤 다시 시도해 주세요');
const linkedElsewhere = () => new RuleError(409, 'linked_elsewhere', '이 계정은 다른 사용자에게 연결돼 있어요. 이미 계정을 연결한 사용자와는 합칠 수 없어요');
const noLinkConflict = () => new RuleError(409, 'no_link_conflict', '정리할 충돌이 없어요. 연결을 다시 시도해 주세요');

/**
 * 저장하는 nonce 해시. 받은 사용자의 ID를 섞어서, 남의 세션에서 받은 nonce가 든 토큰은 내 세션에서 통하지 않는다
 * (다른 사람이 로그인해 받은 토큰을 내 세션에 끼워 넣어 그 사람의 계정을 내게 붙이는 일을 막는다).
 * 사용자 ID는 uuid라 `:`가 없어서 두 값의 경계가 헷갈리지 않는다.
 */
function nonceHash(userId: string, nonce: string): string {
  return sha256Hex(`${userId}:${nonce}`);
}

/**
 * 계정 연결에 쓰는 일회용 값을 만든다. 앱이 구글 로그인에 넣고, 돌아온 ID 토큰에 같은 값이 들어 있어야 한다.
 * 5분 동안, 받은 사용자의 세션에서, 한 번만 쓸 수 있다. 서버에는 해시만 둔다. 지난 것은 새로 만들 때 치운다.
 */
export async function issueNonce(db: Db, userId: string, now: Date): Promise<string> {
  const nonce = randomToken();
  await deleteExpiredNonces(db, now);
  await insertNonce(db, nonceHash(userId, nonce), new Date(now.getTime() + NONCE_TTL_MS));
  return nonce;
}

/** 토큰을 확인하고(트랜잭션 밖: 공개 키를 받아 오느라 기다릴 수 있다) 지금 세션의 사용자가 받은 nonce라면 저장돼 있을 해시를 준다 */
async function verified(session: Session, input: unknown, verify: IdTokenVerifier): Promise<{ provider: AccountProvider; sub: string; nonceHash: string }> {
  const { provider, idToken } = parseLinkInput(input);
  const id = await verify(provider, idToken);
  // nonce가 없는 토큰은 우리 서버가 시킨 로그인에서 나온 것인지 알 수 없다
  if (id.nonce === null) throw tokenInvalid();
  return { provider: id.provider, sub: id.sub, nonceHash: nonceHash(session.userId, id.nonce) };
}

/**
 * 계정 연결 (스펙 5.4). ID 토큰을 확인하고 그 사용자 고유값을 계정 수단으로 지금 사용자에게 붙인다.
 *
 * - 그 계정이 다른 사용자에게 붙어 있고 지금 사용자가 손님뿐이면 `409 link_conflict`와 양쪽 요약을 준다.
 *   아무것도 바꾸지 않고 nonce도 쓰지 않은 것으로 둬서, 앱이 같은 토큰을 `resolveLink`에 다시 보낼 수 있다.
 * - 지금 사용자에게 이미 계정 수단이 있으면 `409 linked_elsewhere` (진짜 계정 둘은 합치지 않는다).
 * - 지금 사용자에게 같은 종류의 다른 계정이 이미 붙어 있으면 `409 already_linked`.
 * - 세션은 통했는데 그사이 사용자가 지워졌으면 `401 unauthorized`.
 *
 * nonce는 지금 세션의 사용자가 받은 것이어야 하고, 트랜잭션 안에서 지우면서 확인한다. 거절로 끝나면 트랜잭션이 되돌아가 nonce가 남는다.
 */
export async function linkIdentity(
  db: Db,
  session: Session,
  input: unknown,
  verify: IdTokenVerifier,
  now: Date,
  summarize: Summarize,
): Promise<{ linked: true; providers: string[] }> {
  const id = await verified(session, input, verify);
  return db.transaction(async (tx) => {
    if (!(await consumeNonce(tx, id.nonceHash, now))) throw tokenInvalid();
    if (!(await lockUser(tx, session.userId))) throw unauthorized();
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
 * 합치지 않는다 (손님을 여러 번 만들어 코인을 모으는 일을 막는다). 중간에 실패하면 아무것도 남지 않는다.
 *
 * 옮겨 갈 계정이 없거나 그사이 지워졌으면 `409 no_link_conflict`이고 손님은 그대로다.
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
  const id = await verified(session, input, verify);
  return db.transaction(async (tx) => {
    if (!(await consumeNonce(tx, id.nonceHash, now))) throw tokenInvalid();
    if (!(await lockUser(tx, session.userId))) throw unauthorized();
    const target = await findIdentity(tx, id.provider, id.sub);
    if (!target || target.userId === session.userId) throw noLinkConflict();
    if ((await distinctProviders(tx, session.userId)).some(isAccountProvider)) throw linkedElsewhere();
    // 옮겨 갈 계정이 그사이 지워지지 않게 잡아 둔다. 지워지는 중이었다면 여기서 기다렸다가 "없는 사용자"로 본다.
    // 잡은 뒤에는 계정 수단이 여전히 그 사용자에게 붙어 있는지 다시 읽는다 (기다리는 동안 달라졌을 수 있다)
    if (!(await holdUser(tx, target.userId))) throw noLinkConflict();
    if ((await findIdentity(tx, id.provider, id.sub))?.userId !== target.userId) throw noLinkConflict();
    if (!(await moveGuestIdentity(tx, session.identityId, session.userId, target.userId))) throw unauthorized();
    await deleteAccountInTx(tx, session.userId, policy, now);
    const issued = await issueSession(tx, target.userId, session.identityId, now, ttlDays);
    return { userId: target.userId, ...issued };
  });
}
