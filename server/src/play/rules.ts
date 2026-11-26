import { sha256Hex } from '../shared/crypto.ts';
import { RuleError } from '../shared/errors.ts';
import { hasControlChars } from '../shared/validate.ts';

/** 순위표의 순서: higher는 값이 클수록, lower는 작을수록(시간) 좋다 */
export const ORDERINGS = ['higher', 'lower'] as const;
export type Ordering = (typeof ORDERINGS)[number];

/**
 * 순위표 (스펙 5.2 `boards`). 기록을 재는 단위다: 게임 하나에 여럿 있을 수 있다 (지뢰찾기의 초급·중급·고급).
 *
 * - `minValue`~`maxValue`: 받는 값의 범위. higher면 점수, lower면 시간(초)
 * - `maxCoinsPerRun`: 한 판에 받을 수 있는 코인 상한
 * - `requiresBoardId`: 이 순위표(단계)를 깨야 판을 낼 수 있다
 * - `validator`·`validatorParams`: 판 결과를 확인하는 검증기의 이름과 그 설정 (`validators.ts`)
 */
export interface Board {
  id: string;
  gameId: string;
  label: string;
  ordering: Ordering;
  minValue: number;
  maxValue: number;
  maxCoinsPerRun: number;
  requiresBoardId: string | null;
  validator: string;
  validatorParams: unknown;
  sortOrder: number;
}

/** 순위표 ID: 영문 소문자로 시작하는 소문자·숫자·`.`·`-` 2~64자 (예: 'pinball', 'minesweeper.easy') */
export const BOARD_ID = /^[a-z][a-z0-9.-]{1,63}$/;

export const LABEL_MAX = 60;
export const SORT_MAX = 1_000_000;
/** 판당 코인 상한의 상한 (열이 integer다) */
export const COINS_MAX = 2_147_483_647;
/** 값 범위의 상한: 이 안의 정수와 0.1 단위 값은 double로 정확하게 견줄 수 있다 */
export const VALUE_MAX = 1_000_000_000_000;
const VERSION_MAX = 2_147_483_647;

/** 판 기록 사이 최소 간격 (자동화된 반복 제출 방지, v1과 같다) */
export const MIN_RUN_INTERVAL_MS = 3000;

export const LEADERBOARD_DEFAULT = 50;
export const LEADERBOARD_MAX = 100;

// ── 거절하는 말 ───────────────────────────────────────────────
// 같은 코드는 어디서 던지든 같은 말로 답하게 여기 한 곳에 둔다. 판 결과의 말은 v1과 같다.

/** 판 결과에서는 400(v1과 같다), 순위표 조회에서는 404다 */
export const unknownBoard = (status: 400 | 404) => new RuleError(status, 'unknown_board', status === 404 ? '없는 순위표예요' : '알 수 없는 기록 종류예요');
export const gameLocked = () => new RuleError(403, 'game_locked', '아직 열리지 않은 게임이에요');
export const stageLocked = () => new RuleError(403, 'stage_locked', '아직 열리지 않은 단계예요');
export const tooFast = () => new RuleError(429, 'too_fast', '잠시 뒤 다시 시도해 주세요');
export const invalidCoins = () => new RuleError(400, 'invalid_coins', '코인 값이 올바르지 않아요');
export const invalidScore = () => new RuleError(400, 'invalid_score', '점수 값이 올바르지 않아요');
export const invalidSeconds = () => new RuleError(400, 'invalid_seconds', '기록 시간이 올바르지 않아요');
export const invalidBoardStats = () => new RuleError(400, 'invalid_board_stats', '판 기록이 올바르지 않아요');
export const idempotencyMismatch = () => new RuleError(409, 'idempotency_mismatch', '같은 요청 키로 다른 내용을 보냈어요');
/** 이 서버가 모르는 검증기이거나 검증기 설정이 깨진 순위표. 앱의 잘못이 아니라 서버 쪽 자료의 문제다 */
export const boardUnavailable = () => new RuleError(503, 'board_unavailable', '지금은 이 기록을 받을 수 없어요. 잠시 뒤 다시 시도해 주세요');
const invalid = (name: string, message: string) => new RuleError(400, `invalid_${name}`, message);

// ── 판 결과 ──────────────────────────────────────────────────

export function isBoardId(v: unknown): v is string {
  return typeof v === 'string' && BOARD_ID.test(v);
}

/**
 * 판에서 번 코인: 0~판당 상한의 정수 (표 K8). 음수, 소수, NaN, 무한대, 숫자처럼 생긴 글자는 `400 invalid_coins`.
 * 코인은 현금이 아니라서 어떤 아이템을 장착했는지까지 보지 않고 순위표의 상한만 본다 (v1과 같다).
 */
export function checkCoins(board: Board, v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > board.maxCoinsPerRun) throw invalidCoins();
  return v;
}

/** 판을 낸 게임 묶음의 버전. 적지 않아도 된다(null). 적으면 1 이상의 정수 */
export function checkGameVersion(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1 || v > VERSION_MAX) throw invalid('game_version', '게임 버전은 1 이상의 정수여야 해요');
  return v;
}

/**
 * 직전 판에서 3초가 안 지났나. 직전 판이 지금보다 뒤의 시각이어도(먼저 받은 요청이 늦게 처리됨) 안 지난 것이다.
 */
export function tooSoon(lastRunAt: Date | null, now: Date): boolean {
  return lastRunAt !== null && now.getTime() - lastRunAt.getTime() < MIN_RUN_INTERVAL_MS;
}

/**
 * 검증기가 판 하나에서 읽어 낸 것. 판(`runs`)에 그대로 남는다.
 * - `value`: 순위표에 올릴 값. 없으면(null) 기록이 아닌 판이다 (0점, 못 깬 시간 판)
 * - `seconds`: 깬 판의 시간 (0.1초로 반올림). 깨지 않았거나 시간을 재지 않는 순위표면 null
 * - `won`: 깼는지. 깨는 것이 없는 순위표(점수 게임)면 null
 */
export interface RunResult {
  value: number | null;
  seconds: number | null;
  won: boolean | null;
}

/** 한 사용자가 한 순위표에서 지금까지 쌓은 것 (`board_records`의 한 행, `runs`의 집계) */
export interface Standing {
  best: number | null;
  bestSeconds: number | null;
  cleared: boolean;
}

export const NO_STANDING: Standing = { best: null, bestSeconds: null, cleared: false };

function better(ordering: Ordering, value: number, than: number): boolean {
  return ordering === 'higher' ? value > than : value < than;
}

/**
 * 지금까지의 기록에 판 하나를 반영한다 (v1 `applyRun`의 기록 부분, 표 K9~K11).
 * - 최고 기록은 더 좋을 때만 바뀐다. 같은 값은 바꾸지 않는다 (먼저 낸 사람이 앞이어야 해서 낸 시각도 그대로다)
 * - 최고 시간은 깬 판의 시간이 더 짧을 때 바뀐다. 점수와 따로다 (보호를 써서 점수는 낮아도 시간은 최고일 수 있다)
 * - 처음 깬 판이면 `firstClear`
 */
export function applyResult(ordering: Ordering, prior: Standing, result: RunResult): { isBest: boolean; firstClear: boolean; next: Standing } {
  const isBest = result.value !== null && (prior.best === null || better(ordering, result.value, prior.best));
  const won = result.won === true;
  const fasterClear = won && result.seconds !== null && (prior.bestSeconds === null || result.seconds < prior.bestSeconds);
  return {
    isBest,
    firstClear: won && !prior.cleared,
    next: { best: isBest ? result.value : prior.best, bestSeconds: fasterClear ? result.seconds : prior.bestSeconds, cleared: prior.cleared || won },
  };
}

// ── 순위표 조회 ────────────────────────────────────────────────

/** 순위표에 보여 줄 이름: 사용자 ID로 만든 가명. v1과 같다 (`플레이어 `+SHA-256의 앞 4자 대문자). 사용자 ID는 내보내지 않는다 */
export function nickname(userId: string): string {
  return `플레이어 ${sha256Hex(userId).slice(0, 4).toUpperCase()}`;
}

const invalidLimit = () => invalid('limit', `limit은 1~${LEADERBOARD_MAX}의 정수여야 해요`);

export function checkLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > LEADERBOARD_MAX) throw invalidLimit();
  return limit;
}

/** `?limit=`을 읽는다. 없으면 50. 숫자만 적은 글이어야 하고(`1e2`, `0x10`, 빈 값은 받지 않는다) 두 번 보내도 받지 않는다 */
export function parseLimit(query: URLSearchParams): number {
  const values = query.getAll('limit');
  if (values.length === 0) return LEADERBOARD_DEFAULT;
  if (values.length > 1 || !/^[0-9]{1,4}$/.test(values[0])) throw invalidLimit();
  return checkLimit(Number(values[0]));
}

/**
 * 좋은 순서로 늘어선 기록에 등수를 붙인다. 같은 값은 같은 등수다 (v1의 RANK와 같다: 900, 900, 500이면 1, 1, 3).
 * 맨 위부터 온 줄이어야 한다 (그래야 "나보다 좋은 기록의 수 + 1"과 같다).
 */
export function ranked<T extends { value: number }>(rows: T[]): Array<T & { rank: number }> {
  let rank = 0;
  return rows.map((row, i) => {
    if (i === 0 || row.value !== rows[i - 1].value) rank = i + 1;
    return { ...row, rank };
  });
}

// ── 순위표 만들기·고치기 ──────────────────────────────────────────

export function checkBoardId(v: unknown): string {
  if (!isBoardId(v)) throw invalid('board_id', '순위표 ID는 영문 소문자로 시작하는 소문자·숫자·.·- 2~64자예요 (예: minesweeper.easy)');
  return v;
}

function checkLabel(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '' || v.length > LABEL_MAX || hasControlChars(v)) throw invalid('label', `순위표 이름은 한 줄 1~${LABEL_MAX}자예요`);
  return v;
}

function checkOrdering(v: unknown): Ordering {
  if (!(ORDERINGS as readonly unknown[]).includes(v)) throw invalid('ordering', `순서는 ${ORDERINGS.join(', ')} 가운데 하나예요`);
  return v as Ordering;
}

function checkValue(v: unknown, name: 'min_value' | 'max_value'): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > VALUE_MAX) throw invalid(name, `${name}는 −${VALUE_MAX}~${VALUE_MAX}의 숫자예요`);
  return v;
}

function checkMaxCoins(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > COINS_MAX) throw invalid('max_coins_per_run', `판당 코인 상한은 0~${COINS_MAX}의 정수예요`);
  return v;
}

function checkSortOrder(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > SORT_MAX) throw invalid('sort_order', `순서는 0~${SORT_MAX}의 정수예요`);
  return v;
}

/**
 * 순위표 한 줄이 말이 되는지 (DB를 보지 않고 알 수 있는 것만). 어기면 `400 invalid_<칸>`.
 * 검증기 이름과 설정은 `validators.ts`의 `checkValidatorParams`가, 게임과 앞 단계가 있는지는 서비스가 본다.
 */
export function checkBoardShape(b: Omit<Board, 'validator' | 'validatorParams'>): Omit<Board, 'validator' | 'validatorParams'> {
  const id = checkBoardId(b.id);
  const minValue = checkValue(b.minValue, 'min_value');
  const maxValue = checkValue(b.maxValue, 'max_value');
  if (minValue > maxValue) throw invalid('range', 'min_value는 max_value보다 클 수 없어요');
  const requiresBoardId = b.requiresBoardId === null ? null : checkBoardId(b.requiresBoardId);
  if (requiresBoardId === id) throw invalidRequires('순위표가 자기 자신을 앞 단계로 둘 수 없어요');
  return {
    id,
    gameId: b.gameId,
    label: checkLabel(b.label),
    ordering: checkOrdering(b.ordering),
    minValue,
    maxValue,
    maxCoinsPerRun: checkMaxCoins(b.maxCoinsPerRun),
    requiresBoardId,
    sortOrder: checkSortOrder(b.sortOrder),
  };
}

export const invalidRequires = (message: string) => invalid('requires', message);
