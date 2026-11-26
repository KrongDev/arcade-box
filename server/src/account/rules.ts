import { RuleError } from '../shared/errors.ts';
import { obj, str } from '../shared/validate.ts';

/** 로그인 수단의 종류. `guest`는 기기 한 대(기기 수단), 나머지는 사람(계정 수단)을 가리킨다 */
export type Provider = 'guest' | 'google' | 'apple';
export type AccountProvider = Exclude<Provider, 'guest'>;

export function isAccountProvider(provider: string): provider is AccountProvider {
  return provider === 'google' || provider === 'apple';
}

// ── 거절하는 말 ───────────────────────────────────────────────
// 같은 코드는 어디서 던지든 같은 말로 답하게 여기 한 곳에 둔다. 메시지에 받은 값(토큰, 비밀값)을 넣지 않는다.

/** 못 믿을 ID 토큰, 틀리거나 이미 쓴 nonce */
export const tokenInvalid = () => new RuleError(401, 'token_invalid', '로그인 정보를 확인하지 못했어요. 다시 시도해 주세요');
/** 세션은 통했는데 그사이 사용자가 지워졌다 (HTTP 틀이 세션이 없을 때 주는 것과 같은 답) */
export const unauthorized = () => new RuleError(401, 'unauthorized', '로그인이 필요해요');
export const invalidProvider = () => new RuleError(400, 'invalid_provider', '지원하지 않는 로그인 수단이에요');

/**
 * `shared/validate`의 확인을 쓰되 메시지는 사람이 읽는 말로 바꾼다. 코드(`invalid_<name>`)는 그대로다.
 * 그대로 두면 메시지에 서버 안에서 쓰는 이름(`device_secret 값이 …`)이 나간다.
 */
function saying<T>(message: string, check: () => T): T {
  try {
    return check();
  } catch (err) {
    if (err instanceof RuleError) throw new RuleError(err.status, err.code, message);
    throw err;
  }
}

/** 요청 본문은 객체여야 한다. 어기면 `400 invalid_body` */
export function parseBody(v: unknown): Record<string, unknown> {
  return saying('요청 본문이 올바르지 않아요', () => obj(v, 'body'));
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * 기기 비밀값: base64url 43~128자 (256비트 난수를 base64url로 적으면 43자다).
 * 어기면 `400 invalid_device_secret`. 오류에 받은 값을 넣지 않는다.
 */
export function parseDeviceSecret(v: unknown): string {
  return saying('기기 비밀값이 올바르지 않아요', () => str(v, 'device_secret', { min: 43, max: 128, pattern: BASE64URL }));
}

/** 구글 ID 토큰은 1~2KB다 */
const MAX_ID_TOKEN = 8192;

/** 연결·충돌 정리 요청 `{ provider, idToken }`. 어기면 `400 invalid_body`·`invalid_id_token`·`invalid_provider` */
export function parseLinkInput(input: unknown): { provider: string; idToken: string } {
  const body = parseBody(input);
  const idToken = saying('로그인 토큰이 올바르지 않아요', () => str(body.idToken, 'id_token', { min: 1, max: MAX_ID_TOKEN }));
  // 모양이 틀린 수단도 모르는 수단과 같은 말로 답한다
  const provider = saying(invalidProvider().message, () => str(body.provider, 'provider', { min: 1, max: 20, pattern: /^[a-z]+$/ }));
  return { provider, idToken };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 세션이 끝나는 시각. 이 시각부터는 통하지 않는다 (`expires_at > now`일 때만 통한다) */
export function sessionExpiry(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * DAY_MS);
}

export interface Settings {
  sound: boolean;
  haptic: boolean;
}

/** 행이 없는 사용자의 설정 */
export const DEFAULT_SETTINGS: Settings = { sound: true, haptic: true };

const SETTING_KEYS = ['sound', 'haptic'] as const;

/**
 * 설정을 바꾸는 요청. `sound`·`haptic`의 참/거짓만 받는다.
 * 모르는 키나 다른 타입이 하나라도 있으면 `400 invalid_settings`이고 하나도 반영하지 않는다 (v1은 모르는 키를 못 본 척했다).
 */
export function parseSettingsPatch(patch: unknown): Partial<Settings> {
  const invalid = () => new RuleError(400, 'invalid_settings', '설정 값이 올바르지 않아요');
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw invalid();
  const out: Partial<Settings> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key) || typeof value !== 'boolean') throw invalid();
    out[key as keyof Settings] = value;
  }
  return out;
}
