import { RuleError } from './errors.ts';

/**
 * 바깥에서 온 값 확인. 어기면 `RuleError(400, 'invalid_<name>', …)`를 던진다.
 * `name`은 오류 코드에 들어가니 영문 소문자와 밑줄로 쓴다 (예: 'coins', 'device_secret').
 */
function invalid(name: string): RuleError {
  return new RuleError(400, `invalid_${name}`, `${name} 값이 올바르지 않아요`);
}

export function str(v: unknown, name: string, rule: { min: number; max: number; pattern?: RegExp }): string {
  if (typeof v !== 'string' || v.length < rule.min || v.length > rule.max) throw invalid(name);
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

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** 같은 요청을 다시 보낼 때 붙이는 키. 없으면(undefined, null) null을 준다 */
export function idempotencyKey(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !IDEMPOTENCY_KEY.test(v)) throw invalid('idempotency_key');
  return v;
}
