import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { RuleError } from '../shared/errors.ts';
import { invalidProvider, tokenInvalid, type AccountProvider } from './rules.ts';

/**
 * ID 토큰을 확인해 사용자 고유값을 얻는다. 수단(구글, 3번 작업의 애플)마다 구현이 하나씩이고 모양은 같다 (스펙 5.15).
 * 돌려주는 것은 `sub`와 `nonce`뿐이다. 이메일과 이름은 꺼내지도 않는다.
 * 못 믿을 토큰이면 `RuleError(401, 'token_invalid')`, 모르는 수단이면 `RuleError(400, 'invalid_provider')`.
 */
export type IdTokenVerifier = (provider: string, idToken: string) => Promise<{ provider: AccountProvider; sub: string; nonce: string | null }>;

/** 서명을 확인할 공개 키를 주는 곳. 운영은 구글의 주소에서 받아 오고(`createRemoteJWKSet`), 테스트는 만든 키를 준다(`createLocalJWKSet`) */
export type JWKSource = JWTVerifyGetKey;

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** 세 조각짜리 서명된 토큰의 모양 (서명 조각이 빈 것은 jose가 거절한다) */
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const MAX_CLAIM_LENGTH = 255;

/** 토큰이 틀려서 나는 jose 오류의 코드. 여기에 없는 오류(공개 키를 받아 오지 못함 등)는 토큰 탓이 아니다 */
const TOKEN_FAULTS = new Set([
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
]);

function claim(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_CLAIM_LENGTH) throw tokenInvalid();
  return value;
}

/**
 * 구글 ID 토큰 확인 (스펙 5.12: 엄격하게).
 * - 서명: 구글 공개 키, 방식은 `RS256`만 (`none`이나 `HS256`으로 바꿔치기한 토큰은 받지 않는다)
 * - 발급자: `https://accounts.google.com` 또는 `accounts.google.com`
 * - 대상: `clientIds`(우리 앱 ID) 가운데 하나. 하나도 정하지 않았으면 아무 토큰도 받지 않는다
 * - 만료: `exp`가 꼭 있어야 하고 지나지 않았어야 한다
 * nonce는 여기서 꺼내 주기만 하고, 서버가 준 것인지는 `linkIdentity`가 확인한다.
 *
 * 기본 `jwks`는 구글의 공개 키 주소다. 받아 온 키는 jose가 잠깐(10분) 캐시한다.
 */
export function googleVerifier(clientIds: string[], jwks?: JWKSource): IdTokenVerifier {
  const keys: JWKSource = jwks ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  const audience = [...clientIds];
  return async (provider, idToken) => {
    if (provider !== 'google') throw invalidProvider();
    if (audience.length === 0 || typeof idToken !== 'string' || !COMPACT_JWS.test(idToken)) throw tokenInvalid();
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, keys, {
        algorithms: ['RS256'],
        issuer: GOOGLE_ISSUERS,
        audience,
        requiredClaims: ['iss', 'aud', 'exp', 'sub'],
      }));
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && TOKEN_FAULTS.has(code)) throw tokenInvalid();
      // 공개 키를 받아 오지 못했다 (네트워크, 구글 쪽 응답). 오류의 종류만 남기고 토큰은 남기지 않는다
      console.warn(`[auth] 구글 공개 키로 토큰을 확인하지 못했어요: ${typeof code === 'string' ? code : err instanceof Error ? err.name : 'unknown'}`);
      throw new RuleError(503, 'auth_unavailable', '지금은 로그인을 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요');
    }
    // 구글 ID 토큰의 대상은 하나다. 여러 대상이 든 토큰은 다른 앱과 함께 쓰려고 만든 것이라 받지 않는다
    if (typeof payload.aud !== 'string') throw tokenInvalid();
    return { provider: 'google', sub: claim(payload.sub), nonce: payload.nonce === undefined ? null : claim(payload.nonce) };
  };
}

const DEV_TOKEN = /^dev:([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{0,128})$/;

/**
 * 개발용 가짜 확인기: 토큰 `dev:<sub>:<nonce>`를 구글 수단으로 받아들인다. 서명을 보지 않으니
 * `config.devAuth`일 때만 조립에 넣는다 (운영에서 `AUTH_DEV=1`이면 `loadConfig`가 던져서 서버가 뜨지 않는다).
 * 조립이 잘못돼도 한 번 더 막히게, 운영 환경(`NODE_ENV=production`)에서는 만들 때 던진다.
 */
export function devVerifier(): IdTokenVerifier {
  if (process.env.NODE_ENV === 'production') throw new Error('운영 환경에서는 개발용 확인기를 쓸 수 없어요 (개발용 가짜 로그인 금지)');
  return async (provider, idToken) => {
    if (provider !== 'google') throw invalidProvider();
    const m = typeof idToken === 'string' ? DEV_TOKEN.exec(idToken) : null;
    if (!m) throw tokenInvalid();
    return { provider: 'google', sub: m[1], nonce: m[2] === '' ? null : m[2] };
  };
}
