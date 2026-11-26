import { RuleError } from '../shared/errors.ts';
import { str } from '../shared/validate.ts';

/** 로그인 수단의 종류. `guest`는 기기 한 대(기기 수단), 나머지는 사람(계정 수단)을 가리킨다 */
export type Provider = 'guest' | 'google' | 'apple';
export type AccountProvider = Exclude<Provider, 'guest'>;

export function isAccountProvider(provider: string): provider is AccountProvider {
  return provider === 'google' || provider === 'apple';
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * 기기 비밀값: base64url 43~128자 (256비트 난수를 base64url로 적으면 43자다).
 * 어기면 `400 invalid_device_secret`. 오류에 받은 값을 넣지 않는다.
 */
export function parseDeviceSecret(v: unknown): string {
  return str(v, 'device_secret', { min: 43, max: 128, pattern: BASE64URL });
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
