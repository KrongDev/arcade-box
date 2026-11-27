import { RuleError } from './errors.ts';

/**
 * 바깥에서 온 값 확인. 어기면 `RuleError(400, 'invalid_<name>', …)`를 던진다.
 * `name`은 오류 코드에 들어가니 영문 소문자와 밑줄로 쓴다 (예: 'coins', 'device_secret').
 */
function invalid(name: string): RuleError {
  return new RuleError(400, `invalid_${name}`, `${name} 값이 올바르지 않아요`);
}

/** 제어 문자(NUL, 줄바꿈, 탭, ESC, DEL …)가 들어 있는지 */
export function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * 길이와 모양이 맞는 글자열. 제어 문자가 들어 있으면 받지 않는다:
 * NUL은 PostgreSQL의 text에 넣을 수 없어서 쿼리가 실패하고(500), 줄바꿈과 ESC는 로그와 터미널 출력을 흐트러뜨린다.
 */
export function str(v: unknown, name: string, rule: { min: number; max: number; pattern?: RegExp }): string {
  if (typeof v !== 'string' || v.length < rule.min || v.length > rule.max) throw invalid(name);
  if (hasControlChars(v)) throw invalid(name);
  if (rule.pattern && !rule.pattern.test(v)) throw invalid(name);
  return v;
}

/** 범위 안의 정수. NaN, 무한대, 소수, 숫자처럼 생긴 글자열은 받지 않는다 */
export function int(v: unknown, name: string, rule: { min: number; max: number }): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < rule.min || v > rule.max) throw invalid(name);
  return v;
}

export function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') throw invalid(name);
  return v;
}

/** 배열과 null이 아닌 객체 */
export function obj(v: unknown, name: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw invalid(name);
  return v as Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * uuid 모양의 글자열인지 (사용자 ID, 주문 ID). 모양이 아닌 값을 uuid 열에 견주면 쿼리가 실패하므로(500)
 * 바깥에서 온 ID는 쿼리에 넣기 전에 이것으로 본다.
 */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** 같은 요청을 다시 보낼 때 붙이는 키. 없으면(undefined, null) null을 준다 */
export function idempotencyKey(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !IDEMPOTENCY_KEY.test(v)) throw invalid('idempotency_key');
  return v;
}
