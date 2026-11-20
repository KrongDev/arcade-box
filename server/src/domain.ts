/**
 * 게임 규칙 — 클라이언트(src/game/registry.ts, catalog.ts, minesweeper/board.ts)와 같은 값을 쓴다.
 * 코인·보상·잠금 해제는 서버가 정본이다. 클라이언트 값을 바꾸면 여기도 함께 바꾼다.
 */

export type GameId = 'pinball' | 'minesweeper' | 'breakout';
export const GAME_IDS: GameId[] = ['pinball', 'minesweeper', 'breakout'];

export const ATTENDANCE_COINS = 50;
export const AD_REWARD_COINS = 50;
export const AD_REWARDS_PER_DAY = 3;

/** 게임 잠금 해제 조건 — 클라이언트(src/game/registry.ts GAMES의 unlock)와 같다 */
export type UnlockRule =
  /** 다른 게임 최고 점수가 score 이상이면 열린다 */
  | { kind: 'score'; gameId: GameId; score: number }
  /** 이 단계(순위표 ID)를 한 번이라도 깨면 열린다 */
  | { kind: 'clear'; stage: string };

export const UNLOCK_RULES: Partial<Record<GameId, UnlockRule>> = {
  minesweeper: { kind: 'score', gameId: 'pinball', score: 30000 },
  breakout: { kind: 'clear', stage: 'minesweeper.hard' },
};

/** 리더보드(=기록 단위). higher: 점수가 클수록 / lower: 시간이 짧을수록 좋다 */
/** 지뢰찾기 판 크기 — 클라이언트 DIFFICULTIES와 같다 */
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

/**
 * 아이템 능력을 반영한 코인 상한 — 클라이언트 카탈로그(src/game/catalog.ts)의 가장 큰 능력과 맞춘다.
 * 코인은 현금이 아니라 꾸미기에만 쓰여서, 장착 여부까지 확인하지 않고 '최대 능력'을 상한으로 둔다.
 */
export const MAX_COIN_BONUS = 0.4; // 지뢰찾기 발판: 동전 코인 +40%
export const MAP_EXTRA_COINS_MAX = { easy: 4, normal: 7, hard: 10 }; // 지뢰찾기 맵: 숨은 동전 +개
const msCoinCap = (coins: number, extra: number, clearBonus: number) => Math.ceil((coins + extra) * 5 * (1 + MAX_COIN_BONUS)) + clearBonus;

export interface BoardDef {
  id: string;
  gameId: GameId;
  order: 'higher' | 'lower';
  /** 한 판에 받을 수 있는 코인 상한 (판 위 동전 + 보너스) */
  maxCoinsPerRun: number;
  /** 이 단계를 깨야 열리는 단계 */
  requires: string | null;
  minesweeper?: MinesweeperSpec;
}

export const BOARDS: BoardDef[] = [
  // 핀볼: 클라이언트 MAX_COINS_PER_RUN과 같다 (판·공 능력 포함)
  { id: 'pinball', gameId: 'pinball', order: 'higher', maxCoinsPerRun: 400, requires: null },
  // 벽돌깨기: 클라이언트 MAX_COINS_PER_RUN(src/breakout/rules.ts)과 같다 (패들·벽돌 능력 포함)
  { id: 'breakout', gameId: 'breakout', order: 'higher', maxCoinsPerRun: 400, requires: null },
  // 지뢰찾기: (동전 수 + 맵 최대 보너스) × 5 × (1 + 발판 최대 보너스) + 클리어 보너스 (클라이언트 DIFFICULTIES와 같음)
  // 지뢰찾기도 점수(높을수록 1등)로 순위를 매긴다. 판 크기: 초급 8×10·10, 중급 12×18·36, 고급 16×26·80
  { id: 'minesweeper.easy', gameId: 'minesweeper', order: 'higher', maxCoinsPerRun: msCoinCap(3, MAP_EXTRA_COINS_MAX.easy, 20), requires: null, minesweeper: { safe: 70, mines: 10, par: 180 } },
  { id: 'minesweeper.normal', gameId: 'minesweeper', order: 'higher', maxCoinsPerRun: msCoinCap(6, MAP_EXTRA_COINS_MAX.normal, 40), requires: 'minesweeper.easy', minesweeper: { safe: 180, mines: 36, par: 480 } },
  { id: 'minesweeper.hard', gameId: 'minesweeper', order: 'higher', maxCoinsPerRun: msCoinCap(10, MAP_EXTRA_COINS_MAX.hard, 80), requires: 'minesweeper.normal', minesweeper: { safe: 336, mines: 80, par: 900 } },
];

/** 비정상 기록을 거르는 느슨한 상한 */
/** 점수 게임(핀볼·벽돌깨기) 한 판 점수 상한 — 클라이언트 MAX_SCORE와 같다 */
export const MAX_SCORE = 5_000_000;
const MIN_CLEAR_SECONDS = 1;
const MAX_SECONDS = 24 * 60 * 60;
/** 판 기록 사이 최소 간격 (자동화된 반복 제출 방지) */
export const MIN_RUN_INTERVAL_MS = 3000;

export function getBoard(id: string): BoardDef | undefined {
  return BOARDS.find((b) => b.id === id);
}

/** 상점 아이템 — 코인 아이템만 서버가 판매한다. 유료 아이템은 토스 인앱결제·구매 내역으로 관리한다 */
export interface ServerItem {
  id: string;
  gameId: GameId;
  slot: string;
  price: { type: 'free' } | { type: 'coin'; amount: number } | { type: 'paid' };
}

export const ITEMS: ServerItem[] = [
  { id: 'pinball.table.classic', gameId: 'pinball', slot: 'table', price: { type: 'free' } },
  { id: 'pinball.table.sunset', gameId: 'pinball', slot: 'table', price: { type: 'coin', amount: 1000 } },
  { id: 'pinball.table.forest', gameId: 'pinball', slot: 'table', price: { type: 'coin', amount: 1500 } },
  { id: 'pinball.table.candy', gameId: 'pinball', slot: 'table', price: { type: 'coin', amount: 3000 } },
  { id: 'pinball.table.neon', gameId: 'pinball', slot: 'table', price: { type: 'paid' } },
  { id: 'pinball.table.galaxy', gameId: 'pinball', slot: 'table', price: { type: 'paid' } },
  { id: 'pinball.ball.silver', gameId: 'pinball', slot: 'ball', price: { type: 'free' } },
  { id: 'pinball.ball.gold', gameId: 'pinball', slot: 'ball', price: { type: 'coin', amount: 1000 } },
  { id: 'pinball.ball.emerald', gameId: 'pinball', slot: 'ball', price: { type: 'coin', amount: 2500 } },
  { id: 'pinball.ball.ruby', gameId: 'pinball', slot: 'ball', price: { type: 'paid' } },
  { id: 'pinball.ball.fire', gameId: 'pinball', slot: 'ball', price: { type: 'paid' } },
  { id: 'pinball.ball.thunder', gameId: 'pinball', slot: 'ball', price: { type: 'paid' } },
  { id: 'minesweeper.tile.basic', gameId: 'minesweeper', slot: 'tile', price: { type: 'free' } },
  { id: 'minesweeper.tile.mint', gameId: 'minesweeper', slot: 'tile', price: { type: 'coin', amount: 1000 } },
  { id: 'minesweeper.tile.peach', gameId: 'minesweeper', slot: 'tile', price: { type: 'coin', amount: 1500 } },
  { id: 'minesweeper.tile.check', gameId: 'minesweeper', slot: 'tile', price: { type: 'coin', amount: 3000 } },
  { id: 'minesweeper.tile.night', gameId: 'minesweeper', slot: 'tile', price: { type: 'paid' } },
  { id: 'minesweeper.tile.gold', gameId: 'minesweeper', slot: 'tile', price: { type: 'paid' } },
  { id: 'minesweeper.map.basic', gameId: 'minesweeper', slot: 'map', price: { type: 'free' } },
  { id: 'minesweeper.map.forest', gameId: 'minesweeper', slot: 'map', price: { type: 'coin', amount: 2000 } },
  { id: 'minesweeper.map.island', gameId: 'minesweeper', slot: 'map', price: { type: 'coin', amount: 4000 } },
  { id: 'minesweeper.map.temple', gameId: 'minesweeper', slot: 'map', price: { type: 'paid' } },
  { id: 'breakout.paddle.basic', gameId: 'breakout', slot: 'paddle', price: { type: 'free' } },
  { id: 'breakout.paddle.mint', gameId: 'breakout', slot: 'paddle', price: { type: 'coin', amount: 1000 } },
  { id: 'breakout.paddle.flame', gameId: 'breakout', slot: 'paddle', price: { type: 'coin', amount: 2500 } },
  { id: 'breakout.bricks.basic', gameId: 'breakout', slot: 'bricks', price: { type: 'free' } },
  { id: 'breakout.bricks.pastel', gameId: 'breakout', slot: 'bricks', price: { type: 'coin', amount: 1500 } },
  { id: 'breakout.bricks.gem', gameId: 'breakout', slot: 'bricks', price: { type: 'coin', amount: 3000 } },
];

export function getItem(id: string): ServerItem | undefined {
  return ITEMS.find((i) => i.id === id);
}

/** 사용자 한 명의 진행 상태 — DB에는 문서 한 개로 저장한다 */
export interface UserState {
  coins: Partial<Record<GameId, number>>;
  best: Partial<Record<GameId, number>>;
  bestTime: Record<string, number>;
  /** 지뢰찾기 난이도별 최고 점수 (순위표 값) */
  bestScore: Record<string, number>;
  cleared: string[];
  unlocked: GameId[];
  owned: string[];
  equipped: Record<string, string>;
  settings: { sound: boolean; haptic: boolean };
  lastAttendance: string | null;
  adRewards: { date: string | null; count: number };
  importedAt: string | null;
  lastRunAt: number | null;
}

export function createState(): UserState {
  return {
    coins: {},
    best: {},
    bestTime: {},
    bestScore: {},
    cleared: [],
    unlocked: ['pinball'],
    owned: [],
    equipped: {},
    settings: { sound: true, haptic: true },
    lastAttendance: null,
    adRewards: { date: null, count: 0 },
    importedAt: null,
    lastRunAt: null,
  };
}

/** 저장된 문서를 현재 형식으로 맞춘다 (필드가 늘어도 옛 문서를 읽을 수 있게) */
export function normalizeState(raw: unknown): UserState {
  const base = createState();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Partial<UserState>;
  const state: UserState = {
    ...base,
    ...s,
    settings: { ...base.settings, ...s.settings },
    adRewards: { ...base.adRewards, ...s.adRewards },
    unlocked: Array.from(new Set([...base.unlocked, ...(s.unlocked ?? [])])),
  };
  // 잠금 조건이 새로 생긴 게임(예: 벽돌깨기)은 이미 조건을 채운 사용자에게 바로 연다
  applyUnlocks(state);
  return state;
}

/** 서버 기준 오늘 날짜 (한국 시간, YYYY-MM-DD) */
export function kstDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export class RuleError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isGameId(v: unknown): v is GameId {
  return typeof v === 'string' && (GAME_IDS as string[]).includes(v);
}

function requireUnlocked(state: UserState, gameId: unknown): GameId {
  if (!isGameId(gameId)) throw new RuleError(400, 'unknown_game', '알 수 없는 게임이에요');
  if (!state.unlocked.includes(gameId)) throw new RuleError(403, 'game_locked', '아직 열리지 않은 게임이에요');
  return gameId;
}

function addCoins(state: UserState, gameId: GameId, amount: number) {
  state.coins[gameId] = (state.coins[gameId] ?? 0) + amount;
}

function applyUnlocks(state: UserState): GameId[] {
  const opened: GameId[] = [];
  for (const [id, rule] of Object.entries(UNLOCK_RULES) as [GameId, UnlockRule][]) {
    const met = rule.kind === 'score' ? (state.best[rule.gameId] ?? 0) >= rule.score : state.cleared.includes(rule.stage);
    if (!state.unlocked.includes(id) && met) {
      state.unlocked.push(id);
      opened.push(id);
    }
  }
  return opened;
}

export function adRewardsLeft(state: UserState, today: string): number {
  return AD_REWARDS_PER_DAY - (state.adRewards.date === today ? state.adRewards.count : 0);
}

export function claimAttendance(state: UserState, gameId: unknown, today: string): void {
  const id = requireUnlocked(state, gameId);
  if (state.lastAttendance === today) throw new RuleError(409, 'already_claimed', '오늘 출석 보상을 이미 받았어요');
  state.lastAttendance = today;
  addCoins(state, id, ATTENDANCE_COINS);
}

/**
 * 광고 보상. 서버는 광고 시청 자체를 검증할 수 없어서(클라이언트 userEarnedReward 이벤트 기준)
 * 하루 횟수만 서버 시간으로 막는다.
 */
export function claimAdReward(state: UserState, gameId: unknown, today: string): void {
  const id = requireUnlocked(state, gameId);
  if (adRewardsLeft(state, today) <= 0) throw new RuleError(429, 'daily_limit', '오늘 받을 수 있는 광고 보상을 다 받았어요');
  const used = state.adRewards.date === today ? state.adRewards.count : 0;
  state.adRewards = { date: today, count: used + 1 };
  addCoins(state, id, AD_REWARD_COINS);
}

export interface RunInput {
  board: unknown;
  score?: unknown;
  seconds?: unknown;
  won?: unknown;
  /** 지뢰찾기: 연 칸 수, 맞은 깃발 수, 틀린 깃발 수, 지뢰 보호를 쓴 횟수 */
  opened?: unknown;
  correctFlags?: unknown;
  wrongFlags?: unknown;
  shields?: unknown;
  coins: unknown;
}

export interface RunOutcome {
  board: BoardDef;
  /** 리더보드에 올릴 값 (없으면 기록 안 함 — 진 판) */
  recordValue: number | null;
  isBest: boolean;
  coins: number;
  newlyUnlocked: GameId[];
  firstClear: boolean;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 한 판 결과를 반영한다: 코인 지급, 최고 기록, 단계·게임 잠금 해제 */
export function applyRun(state: UserState, input: RunInput, nowMs: number): RunOutcome {
  const board = typeof input.board === 'string' ? getBoard(input.board) : undefined;
  if (!board) throw new RuleError(400, 'unknown_board', '알 수 없는 기록 종류예요');
  requireUnlocked(state, board.gameId);
  if (board.requires && !state.cleared.includes(board.requires)) {
    throw new RuleError(403, 'stage_locked', '아직 열리지 않은 단계예요');
  }
  if (state.lastRunAt !== null && nowMs - state.lastRunAt < MIN_RUN_INTERVAL_MS) {
    throw new RuleError(429, 'too_fast', '잠시 뒤 다시 시도해 주세요');
  }

  const coins = num(input.coins);
  if (coins === null || coins < 0 || !Number.isInteger(coins) || coins > board.maxCoinsPerRun) {
    throw new RuleError(400, 'invalid_coins', '코인 값이 올바르지 않아요');
  }

  let recordValue: number | null = null;
  let isBest = false;
  let firstClear = false;

  if (board.minesweeper) {
    const spec = board.minesweeper;
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
      throw new RuleError(400, 'invalid_board_stats', '판 기록이 올바르지 않아요');
    }
    let seconds = 0;
    if (won) {
      const s = num(input.seconds);
      if (s === null || s < MIN_CLEAR_SECONDS || s > MAX_SECONDS) {
        throw new RuleError(400, 'invalid_seconds', '기록 시간이 올바르지 않아요');
      }
      seconds = Math.round(s * 10) / 10;
      const prevTime = state.bestTime[board.id];
      if (prevTime === undefined || seconds < prevTime) state.bestTime[board.id] = seconds;
      if (!state.cleared.includes(board.id)) {
        state.cleared.push(board.id);
        firstClear = true;
      }
    }
    const score = minesweeperScore(spec, { opened, correctFlags, wrongFlags, won, seconds, shields });
    const prev = state.bestScore[board.id] ?? 0;
    if (score > prev) {
      state.bestScore[board.id] = score;
      isBest = true;
    }
    recordValue = score > 0 ? score : null;
  } else if (board.order === 'higher') {
    const score = num(input.score);
    if (score === null || score < 0 || !Number.isInteger(score) || score > MAX_SCORE) {
      throw new RuleError(400, 'invalid_score', '점수 값이 올바르지 않아요');
    }
    const prev = state.best[board.gameId] ?? 0;
    if (score > prev) {
      state.best[board.gameId] = score;
      isBest = score > 0;
    }
    recordValue = score > 0 ? score : null;
  } else {
    const won = input.won === true;
    if (won) {
      const seconds = num(input.seconds);
      if (seconds === null || seconds < MIN_CLEAR_SECONDS || seconds > MAX_SECONDS) {
        throw new RuleError(400, 'invalid_seconds', '기록 시간이 올바르지 않아요');
      }
      const rounded = Math.round(seconds * 10) / 10;
      const prev = state.bestTime[board.id];
      if (prev === undefined || rounded < prev) {
        state.bestTime[board.id] = rounded;
        isBest = true;
      }
      if (!state.cleared.includes(board.id)) {
        state.cleared.push(board.id);
        firstClear = true;
      }
      recordValue = rounded;
    }
  }

  addCoins(state, board.gameId, coins);
  state.lastRunAt = nowMs;
  const newlyUnlocked = applyUnlocks(state);
  return { board, recordValue, isBest, coins, newlyUnlocked, firstClear };
}

export function buyItem(state: UserState, itemId: unknown): void {
  const item = typeof itemId === 'string' ? getItem(itemId) : undefined;
  if (!item) throw new RuleError(404, 'unknown_item', '없는 아이템이에요');
  if (item.price.type !== 'coin') throw new RuleError(400, 'not_coin_item', '코인으로 살 수 없는 아이템이에요');
  if (state.owned.includes(item.id)) throw new RuleError(409, 'already_owned', '이미 가진 아이템이에요');
  const balance = state.coins[item.gameId] ?? 0;
  if (balance < item.price.amount) throw new RuleError(409, 'insufficient_coins', '코인이 부족해요');
  state.coins[item.gameId] = balance - item.price.amount;
  state.owned.push(item.id);
  state.equipped[`${item.gameId}.${item.slot}`] = item.id;
}

/**
 * 장착. 유료 아이템은 소유 확인을 클라이언트(토스 구매 내역)가 하므로 여기서는 받는다 —
 * 꾸미기라 다른 사용자나 재화에 영향이 없다.
 */
export function equipItem(state: UserState, itemId: unknown): void {
  const item = typeof itemId === 'string' ? getItem(itemId) : undefined;
  if (!item) throw new RuleError(404, 'unknown_item', '없는 아이템이에요');
  if (item.price.type === 'coin' && !state.owned.includes(item.id)) {
    throw new RuleError(403, 'not_owned', '가지고 있지 않은 아이템이에요');
  }
  state.equipped[`${item.gameId}.${item.slot}`] = item.id;
}

export function updateSettings(state: UserState, patch: unknown): void {
  if (!patch || typeof patch !== 'object') throw new RuleError(400, 'invalid_settings', '설정 값이 올바르지 않아요');
  const p = patch as Record<string, unknown>;
  const keys = (['sound', 'haptic'] as const).filter((k) => k in p);
  // 전부 검사한 뒤에 적용한다 — 일부만 반영되지 않게
  if (keys.some((k) => typeof p[k] !== 'boolean')) throw new RuleError(400, 'invalid_settings', '설정 값이 올바르지 않아요');
  for (const k of keys) state.settings[k] = p[k] as boolean;
}

/**
 * 기기에 쌓인 v1 데이터를 처음 한 번만 서버로 가져온다. 이미 서버에 진행이 있으면 받지 않는다.
 * 기기 데이터는 검증할 수 없으므로 값마다 상한을 둔다.
 */
export const IMPORT_COIN_CAP = 20000;

export function importLocalSave(state: UserState, raw: unknown, nowIso: string): void {
  if (state.importedAt) throw new RuleError(409, 'already_imported', '이미 기기 데이터를 가져왔어요');
  if (!raw || typeof raw !== 'object') throw new RuleError(400, 'invalid_save', '저장 데이터가 올바르지 않아요');
  const s = raw as Record<string, unknown>;
  const clampInt = (v: unknown, max: number) => {
    const n = num(v);
    return n === null || n < 0 ? 0 : Math.min(Math.floor(n), max);
  };

  const coins = (s.coins ?? {}) as Record<string, unknown>;
  for (const g of GAME_IDS) addCoins(state, g, clampInt(coins[g], IMPORT_COIN_CAP));

  // 점수 게임(순위표가 하나)의 최고 점수
  const best = (s.best ?? {}) as Record<string, unknown>;
  for (const b of BOARDS) {
    if (b.minesweeper || b.order !== 'higher') continue;
    const v = clampInt(best[b.gameId], MAX_SCORE);
    if (v > (state.best[b.gameId] ?? 0)) state.best[b.gameId] = v;
  }

  const bestTime = (s.bestTime ?? {}) as Record<string, unknown>;
  const cleared = Array.isArray(s.cleared) ? s.cleared : [];
  // 깰 수 있는 단계(지뢰찾기·시간 기록): 최단 시간과 깬 단계. 앞 단계를 깬 경우만 받는다 (BOARDS는 쉬운 단계부터)
  for (const b of BOARDS.filter((x) => x.order === 'lower' || x.minesweeper)) {
    const t = num(bestTime[b.id]);
    if (t !== null && t >= MIN_CLEAR_SECONDS && t <= MAX_SECONDS) {
      const prev = state.bestTime[b.id];
      if (prev === undefined || t < prev) state.bestTime[b.id] = Math.round(t * 10) / 10;
    }
    const reachable = !b.requires || state.cleared.includes(b.requires);
    if (cleared.includes(b.id) && reachable && !state.cleared.includes(b.id)) state.cleared.push(b.id);
  }

  const bestScore = (s.bestScore ?? {}) as Record<string, unknown>;
  for (const b of BOARDS) {
    if (!b.minesweeper) continue;
    const spec = b.minesweeper;
    const max = spec.safe * 10 + spec.mines * 20 + spec.safe * 10 + spec.par * 10;
    const v = clampInt(bestScore[b.id], max);
    if (v > (state.bestScore[b.id] ?? 0)) state.bestScore[b.id] = v;
  }

  const owned = Array.isArray(s.owned) ? s.owned : [];
  for (const id of owned) {
    const item = typeof id === 'string' ? getItem(id) : undefined;
    if (item && item.price.type === 'coin' && !state.owned.includes(item.id)) state.owned.push(item.id);
  }

  const equipped = (s.equipped ?? {}) as Record<string, unknown>;
  for (const id of Object.values(equipped)) {
    const item = typeof id === 'string' ? getItem(id) : undefined;
    if (item && (item.price.type !== 'coin' || state.owned.includes(item.id))) {
      state.equipped[`${item.gameId}.${item.slot}`] = item.id;
    }
  }

  if (s.settings && typeof s.settings === 'object') {
    try {
      updateSettings(state, s.settings);
    } catch {
      // 잘못된 설정은 무시
    }
  }

  applyUnlocks(state);
  state.importedAt = nowIso;
}

/** 클라이언트에 돌려줄 형태 */
export function snapshot(state: UserState, today: string) {
  return {
    coins: state.coins,
    best: state.best,
    bestTime: state.bestTime,
    bestScore: state.bestScore,
    cleared: state.cleared,
    unlocked: state.unlocked,
    owned: state.owned,
    equipped: state.equipped,
    settings: state.settings,
    attendanceClaimedToday: state.lastAttendance === today,
    adRewardsLeft: adRewardsLeft(state, today),
    imported: state.importedAt !== null,
    serverDate: today,
  };
}
