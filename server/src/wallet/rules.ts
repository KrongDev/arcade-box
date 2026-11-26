import { RuleError } from '../shared/errors.ts';

/**
 * 코인을 주고받는 까닭 (스펙 5.2): 판 결과, 출석, 광고 보상, 구매, 환불, 운영자 지급(grant), 운영자 조정(adjust).
 * 테이블의 열 타입과 `coin_ledger_reason_check`가 이 목록으로 만들어진다. 더하면 마이그레이션도 새로 만든다.
 */
export const LEDGER_REASONS = ['run', 'attendance', 'ad_reward', 'purchase', 'refund', 'grant', 'adjust'] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

/** 잔액 상한 (`wallets_balance_check`와 같은 값). 2^53보다 작아서 숫자(number)로 정확하게 센다 */
export const MAX_BALANCE = 9_000_000_000_000_000;

// ── 거절하는 말 ───────────────────────────────────────────────
// 같은 코드는 어디서 던지든 같은 말로 답하게 여기 한 곳에 둔다.

export const insufficientCoins = () => new RuleError(409, 'insufficient_coins', '코인이 모자라요');
export const balanceLimit = () => new RuleError(409, 'balance_limit', '코인을 더 가질 수 없어요');
export const idempotencyMismatch = () => new RuleError(409, 'idempotency_mismatch', '같은 요청 키로 다른 내용을 보냈어요');
const invalidDelta = () => new RuleError(400, 'invalid_delta', '코인 증감은 0이 아닌 정수여야 해요');

/**
 * 코인 증감: 0이 아닌 안전한 정수. 0, 소수, NaN, 무한대, 2^53 이상, 숫자가 아닌 값은 `400 invalid_delta`.
 * 부르는 쪽(판 결과, 구매 …)이 바깥에서 온 값을 그대로 넘겨도 여기서 걸린다.
 */
export function checkDelta(delta: unknown): number {
  if (typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta === 0) throw invalidDelta();
  return delta;
}

/**
 * 지금 잔액에 증감을 반영한 잔액. 0 아래로 내려가면 `409 insufficient_coins`, 상한을 넘으면 `409 balance_limit`.
 * DB의 CHECK에 걸리기 전에 여기서 거절한다 (CHECK에 걸리면 500이 된다).
 *
 * 둘 다 2^53보다 작은 정수라 더한 값이 2^53을 넘어 어림이 되더라도 상한(9,000,000,000,000,000 < 2^53)보다 크다는 것은 그대로다.
 */
export function nextBalance(balance: number, delta: number): number {
  const next = balance + delta;
  if (next < 0) throw insufficientCoins();
  if (next > MAX_BALANCE) throw balanceLimit();
  return next;
}

/** 같은 키로 다시 온 요청이 처음과 같은 내용인지: 증감과 까닭이 같아야 한다 */
export function sameRequest(first: { delta: number; reason: string }, again: { delta: number; reason: string }): boolean {
  return first.delta === again.delta && first.reason === again.reason;
}

// ── 기록 조회의 쪽 ─────────────────────────────────────────────

export const LEDGER_PAGE_DEFAULT = 50;
export const LEDGER_PAGE_MAX = 100;

export interface LedgerPage {
  /** 이 번호보다 앞의(더 오래된) 기록부터. 없으면 가장 최신부터 */
  before?: number;
  limit: number;
}

const invalidLimit = () => new RuleError(400, 'invalid_limit', `limit은 1~${LEDGER_PAGE_MAX}의 정수여야 해요`);
const invalidBefore = () => new RuleError(400, 'invalid_before', 'before는 1 이상의 정수여야 해요');

/** 쪽 크기는 1~100, `before`는 1 이상의 안전한 정수. 어기면 `400 invalid_limit`·`invalid_before` */
export function checkLedgerPage(page: LedgerPage): LedgerPage {
  if (typeof page.limit !== 'number' || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > LEDGER_PAGE_MAX) throw invalidLimit();
  if (page.before === undefined) return { limit: page.limit };
  if (typeof page.before !== 'number' || !Number.isSafeInteger(page.before) || page.before < 1) throw invalidBefore();
  return { before: page.before, limit: page.limit };
}

/**
 * 주소의 물음(`?before=&limit=`)에서 한 값을 읽는다. 없으면 undefined.
 * 숫자만 적은 글이어야 한다 (`1e2`, `0x10`, `+5`, ` 5`, 빈 값은 받지 않는다). 같은 이름을 두 번 보내도 받지 않는다.
 */
function queryInt(query: URLSearchParams, name: string, invalid: () => RuleError): number | undefined {
  const values = query.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length > 1 || !/^[0-9]{1,16}$/.test(values[0])) throw invalid();
  return Number(values[0]);
}

/** `GET /v2/me/ledger?before=&limit=`의 물음을 읽는다. `limit`이 없으면 50 */
export function parseLedgerPage(query: URLSearchParams): LedgerPage {
  const limit = queryInt(query, 'limit', invalidLimit) ?? LEDGER_PAGE_DEFAULT;
  const before = queryInt(query, 'before', invalidBefore);
  return checkLedgerPage(before === undefined ? { limit } : { before, limit });
}
