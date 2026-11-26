import { RuleError } from '../shared/errors.ts';
import { boardUnavailable, invalidBoardStats, invalidScore, invalidSeconds, type Board, type RunResult } from './rules.ts';

/**
 * 검증기: 판 결과가 말이 되는지 보고, 판에 남길 값(`RunResult`)을 읽어 낸다. DB를 모르는 순수 함수다.
 * 말이 안 되면 `RuleError(400, …)`를 던진다. 순위표의 `validator` 열이 어느 검증기를 쓸지 정한다 (스펙 5.9).
 *
 * 새 게임은 `caps`로 서버 배포 없이 추가된다. 새 검증기 종류가 필요할 때만 여기에 더한다.
 */
export type Validator = (board: Board, input: Record<string, unknown>) => RunResult;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 깬 판의 시간: 범위 안이어야 하고 0.1초로 반올림한다 (v1과 같다: 범위를 먼저 보고 반올림) */
function clearSeconds(v: unknown, min: number, max: number): number {
  const s = num(v);
  if (s === null || s < min || s > max) throw invalidSeconds();
  return Math.round(s * 10) / 10;
}

// ── caps: 범위만 본다 ────────────────────────────────────────────

/**
 * 범위만 보는 검증기 (표 K10, K11).
 * - higher(점수): `score`가 `min_value`~`max_value`의 정수. 0점은 기록이 아니다
 * - lower(시간): `won`이 참일 때만 기록이고 `seconds`가 `min_value`~`max_value` 안. 못 깬 판은 시간을 보지 않는다
 */
const caps: Validator = (board, input) => {
  if (board.ordering === 'higher') {
    const score = num(input.score);
    if (score === null || !Number.isSafeInteger(score) || score < board.minValue || score > board.maxValue) throw invalidScore();
    return { value: score === 0 ? null : score, seconds: null, won: null };
  }
  if (input.won !== true) return { value: null, seconds: null, won: false };
  const seconds = clearSeconds(input.seconds, board.minValue, board.maxValue);
  return { value: seconds, seconds, won: true };
};

// ── minesweeper: 판이 말이 되는지 보고 점수를 다시 계산한다 ────────────────────

/** 지뢰찾기 판 크기 (`validator_params`). 클라이언트 DIFFICULTIES와 같은 값을 순위표마다 적어 둔다 */
export interface MinesweeperSpec {
  /** 지뢰가 아닌 칸 수 */
  safe: number;
  mines: number;
  /** 시간 보너스 기준 시간(초) — 이보다 빨리 깨면 0.1초당 1점 */
  par: number;
}

/**
 * 지뢰찾기 점수 — 클라이언트(src/minesweeper/board.ts scoreRun)와 같은 식이다. 서버 값이 정본.
 * 연 칸 ×10, 맞은 깃발 ×20, 틀린 깃발 ×(−10), 깼으면 안전한 칸 수 ×10 + 기준 시간보다 빠른 0.1초당 1점.
 */
export const MS_SCORE = { perCell: 10, perCorrectFlag: 20, perWrongFlag: -10, clearPerSafeCell: 10, perTenthUnderPar: 1, shieldPercent: 70 };

/** 한 판에 쓸 수 있는 지뢰 보호 횟수 상한 (발판 아이템 능력 중 가장 큰 값) */
export const MAX_SHIELDS = 1;
const MIN_CLEAR_SECONDS = 1;
const MAX_SECONDS = 24 * 60 * 60;
const SPEC_MAX = 1_000_000;

/**
 * 지뢰 보호를 쓴 판은 합계의 70%만 받는다(내림) — 보호를 거짓으로 보내도 손해라 소유 확인 없이 받는다.
 */
export function minesweeperScore(
  spec: MinesweeperSpec,
  r: { opened: number; correctFlags: number; wrongFlags: number; won: boolean; seconds: number; shields?: number },
): number {
  let score = r.opened * MS_SCORE.perCell + r.correctFlags * MS_SCORE.perCorrectFlag + r.wrongFlags * MS_SCORE.perWrongFlag;
  if (r.won) {
    score += spec.safe * MS_SCORE.clearPerSafeCell;
    score += Math.max(0, Math.round((spec.par - r.seconds) * 10)) * MS_SCORE.perTenthUnderPar;
  }
  score = Math.max(0, score);
  // 정수로 계산한다 (350 × 0.7 같은 소수 오차로 1점 덜 나오지 않게)
  return (r.shields ?? 0) > 0 ? Math.floor((score * MS_SCORE.shieldPercent) / 100) : score;
}

/** `validator_params`가 판 크기인지: 정확히 `{ safe, mines, par }`이고 모두 1 이상의 정수. 아니면 null */
function specOf(params: unknown): MinesweeperSpec | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return null;
  const p = params as Record<string, unknown>;
  if (Object.keys(p).length !== 3) return null;
  const size = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= SPEC_MAX ? v : null);
  const safe = size(p.safe);
  const mines = size(p.mines);
  const par = size(p.par);
  return safe === null || mines === null || par === null ? null : { safe, mines, par };
}

/**
 * 지뢰찾기 검증기 (표 K9). 판 크기는 순위표의 `validator_params`에서 읽는다.
 * - 연 칸 ≤ 안전한 칸, 맞은 깃발 ≤ 지뢰 수, 틀린 깃발 ≤ 닫힌 안전한 칸, 깼으면 다 열었어야 하고 다 열었으면 깬 것,
 *   보호 ≤ 1. 어기면 `400 invalid_board_stats`
 * - 깬 판의 시간은 1~86,400초(아니면 `400 invalid_seconds`)이고 0.1초로 반올림한다. 못 깬 판은 시간을 보지 않는다
 * - 점수는 앱이 보낸 값을 쓰지 않고 `minesweeperScore`로 다시 계산한다. 0점은 기록이 아니다
 * - 다시 계산한 점수가 순위표의 `min_value`~`max_value` 밖이면 `400 invalid_score` (스펙 5.9. 처음 자료의 범위에서는 일어나지 않는다)
 */
const minesweeper: Validator = (board, input) => {
  const spec = specOf(board.validatorParams);
  if (!spec) throw boardUnavailable();
  const int = (v: unknown) => {
    const n = num(v);
    return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
  };
  const opened = int(input.opened);
  const correctFlags = int(input.correctFlags);
  const wrongFlags = int(input.wrongFlags);
  const shields = input.shields === undefined ? 0 : int(input.shields);
  const won = input.won === true;
  // 가능한 범위인지 본다: 연 칸 ≤ 안전한 칸, 맞은 깃발 ≤ 지뢰 수, 틀린 깃발은 아직 닫힌 안전한 칸에만
  if (
    opened === null ||
    correctFlags === null ||
    wrongFlags === null ||
    shields === null ||
    shields > MAX_SHIELDS ||
    opened > spec.safe ||
    correctFlags > spec.mines ||
    wrongFlags > spec.safe - opened ||
    (won && opened !== spec.safe) ||
    (!won && opened === spec.safe)
  ) {
    throw invalidBoardStats();
  }
  const seconds = won ? clearSeconds(input.seconds, MIN_CLEAR_SECONDS, MAX_SECONDS) : null;
  const score = minesweeperScore(spec, { opened, correctFlags, wrongFlags, won, seconds: seconds ?? 0, shields });
  if (score < board.minValue || score > board.maxValue) throw invalidScore();
  return { value: score > 0 ? score : null, seconds, won };
};

// ── 검증기 고르기 ───────────────────────────────────────────────

export const VALIDATORS: Record<string, Validator> = { caps, minesweeper };

/** 이름으로 검증기를 찾는다. 모르는 이름이면 null (`constructor` 같은 객체에 딸린 이름에 속지 않는다) */
export function findValidator(name: string): Validator | null {
  return Object.hasOwn(VALIDATORS, name) ? VALIDATORS[name] : null;
}

/**
 * 이 순위표에 "깬다"가 있는가: 판의 `won`이 참이 될 수 있는가. 다음 단계(`requires_board_id`)는 앞 단계를 깨야 열리므로
 * 깰 수 없는 순위표를 앞 단계로 두면 그 단계가 영영 열리지 않는다.
 * 지뢰찾기는 깰 수 있고, `caps`는 시간 순위표(lower)만 깰 수 있다 (점수만 재는 higher에는 깬다는 것이 없다). 모르는 검증기는 알 수 없으니 아니다.
 */
export function canBeCleared(board: Pick<Board, 'validator' | 'ordering'>): boolean {
  if (board.validator === 'minesweeper') return true;
  return board.validator === 'caps' && board.ordering === 'lower';
}

const invalidParams = (message: string) => new RuleError(400, 'invalid_validator_params', message);

/**
 * 순위표를 만들거나 고칠 때: 검증기 이름과 그 설정이 맞는지 보고, 저장할 설정을 돌려준다.
 * 모르는 검증기면 `400 unknown_validator`, 설정이 틀리면 `400 invalid_validator_params`.
 */
export function checkValidatorParams(validator: unknown, params: unknown): MinesweeperSpec | null {
  if (typeof validator !== 'string' || findValidator(validator) === null) {
    throw new RuleError(400, 'unknown_validator', `모르는 검증기예요. 쓸 수 있는 것은 ${Object.keys(VALIDATORS).join(', ')}이에요`);
  }
  if (validator === 'minesweeper') {
    const spec = specOf(params);
    if (!spec) throw invalidParams('minesweeper 검증기에는 판 크기가 있어야 해요: {"safe":70,"mines":10,"par":180}처럼 세 값 모두 1 이상의 정수로 적어요');
    return spec;
  }
  if (params !== null && params !== undefined) throw invalidParams(`${validator} 검증기는 설정을 받지 않아요`);
  return null;
}
