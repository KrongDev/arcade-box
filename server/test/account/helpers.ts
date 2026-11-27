import { randomBytes } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import { devVerifier, findSession, googleVerifier, registerOrLoginGuest, routes, type AccountDeps, type DeletionPolicy, type IdTokenVerifier } from '../../src/account/index.ts';
import { loadConfig, type Config } from '../../src/shared/config.ts';
import { sha256Hex } from '../../src/shared/crypto.ts';
import type { Db } from '../../src/shared/db/index.ts';
import { createHandler, type Session } from '../../src/shared/http/index.ts';
import type { Clock } from '../../src/shared/time.ts';
import type { Handler } from '../helpers/http.ts';

export const TTL_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 앱이 만드는 것과 같은 모양의 기기 비밀값: 256비트 난수를 base64url로 적은 43자 */
export function deviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

export const testConfig: Config = loadConfig({ DATABASE_URL: 'postgres://unused' });

/** 지울 것이 없는 삭제 방침 (account만 있는 테스트용) */
export const noPolicy: DeletionPolicy = { mustKeepUserRow: async () => false, purge: [] };

/** account의 경로만 붙인 HTTP 처리기. 세션은 진짜 `findSession`으로 찾는다 */
export function accountHandler(db: Db, clock: Clock, deps: Partial<AccountDeps> = {}): Handler {
  const all: AccountDeps = { db, config: testConfig, verify: devVerifier(), summarize: async () => ({ coins: 0, games: 0 }), policy: noPolicy, ...deps };
  return createHandler(routes(all), {
    allowedOrigins: testConfig.allowedOrigins,
    now: clock,
    findSession: (tokenHash, now) => findSession(db, tokenHash, now),
  });
}

export interface Guest {
  secret: string;
  userId: string;
  token: string;
  tokenHash: string;
  session: Session;
}

/** 기기 한 대가 손님으로 들어온 것. 같은 `secret`을 주면 그 기기가 다시 들어온 것이다 */
export async function loginGuest(db: Db, now: Date, secret: string = deviceSecret()): Promise<Guest> {
  const login = await registerOrLoginGuest(db, secret, now, TTL_DAYS);
  const tokenHash = sha256Hex(login.token);
  const session = await findSession(db, tokenHash, now);
  if (!session) throw new Error('방금 받은 세션을 찾지 못했어요');
  return { secret, userId: login.userId, token: login.token, tokenHash, session };
}

export const GOOGLE_CLIENT_ID = 'arcade-test.apps.googleusercontent.com';

export interface SignOptions {
  issuer?: string;
  audience?: string | string[];
  /** 지금부터 몇 초 뒤에 끝나는지. 음수면 이미 끝난 토큰. null이면 exp를 넣지 않는다 */
  expiresInSeconds?: number | null;
  key?: CryptoKey | Uint8Array;
  alg?: string;
  kid?: string;
}

/**
 * 테스트 안에서 만든 RSA 키로 구글 ID 토큰을 흉내 낸다. 확인기는 진짜 `googleVerifier`이고
 * 공개 키만 가짜 `jwks`로 준다 (바깥 네트워크를 부르지 않는다).
 */
export async function googleKit(): Promise<{
  verify: IdTokenVerifier;
  jwks: ReturnType<typeof createLocalJWKSet>;
  publicJwk: JWK;
  sign(claims: Record<string, unknown>, opts?: SignOptions): Promise<string>;
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key-1', alg: 'RS256', use: 'sig' };
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  return {
    verify: googleVerifier([GOOGLE_CLIENT_ID], jwks),
    jwks,
    publicJwk,
    async sign(claims, opts = {}) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT(claims)
        .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'test-key-1', typ: 'JWT' })
        .setIssuer(opts.issuer ?? 'https://accounts.google.com')
        .setAudience(opts.audience ?? GOOGLE_CLIENT_ID)
        .setIssuedAt(nowSeconds - 10);
      if (opts.expiresInSeconds !== null) jwt.setExpirationTime(nowSeconds + (opts.expiresInSeconds ?? 3600));
      return jwt.sign(opts.key ?? privateKey);
    },
  };
}
