/**
 * 지뢰찾기 판 로직 — DOM에 의존하지 않는 순수 로직.
 * 칸은 1차원 배열(index = row * cols + col)로 다룬다.
 */

export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  cols: number;
  rows: number;
  mines: number;
  /** 판에 숨겨진 동전 수 */
  coins: number;
  /** 깼을 때 받는 보너스 코인 */
  clearBonus: number;
  /** 이 난이도를 깨야 열린다 */
  requires: DifficultyId | null;
  /** 시간 보너스 기준 시간(초) — 이보다 빨리 깨면 0.1초당 1점 */
  par: number;
}

/** 코인·보너스 수치는 밸런싱 단계에서 조정한다 */
export const DIFFICULTIES: Difficulty[] = [
  { id: 'easy', name: '초급', cols: 8, rows: 10, mines: 10, coins: 3, clearBonus: 20, requires: null, par: 180 },
  { id: 'normal', name: '중급', cols: 12, rows: 18, mines: 36, coins: 6, clearBonus: 40, requires: 'easy', par: 480 },
  { id: 'hard', name: '고급', cols: 16, rows: 26, mines: 80, coins: 10, clearBonus: 80, requires: 'normal', par: 900 },
];

/** 숨은 동전 1개의 코인 값 */
export const COIN_VALUE = 5;

export function stageKey(id: DifficultyId): string {
  return `minesweeper.${id}`;
}

export function getDifficulty(id: DifficultyId): Difficulty {
  const d = DIFFICULTIES.find((x) => x.id === id);
  if (!d) throw new Error(`unknown difficulty: ${id}`);
  return d;
}

export interface Cell {
  mine: boolean;
  adj: number;
  open: boolean;
  flag: boolean;
  coin: boolean;
}

export interface Board {
  cols: number;
  rows: number;
  mines: number;
  coins: number;
  cells: Cell[];
  placed: boolean;
  openCount: number;
  /** 밟은 지뢰 칸 */
  exploded: number | null;
}

export interface OpenResult {
  boom: boolean;
  /** 이번에 연 칸에서 나온 동전 수 */
  coins: number;
  opened: number;
}

const NOTHING: OpenResult = { boom: false, coins: 0, opened: 0 };

export function createBoard(d: Difficulty): Board {
  return {
    cols: d.cols,
    rows: d.rows,
    mines: d.mines,
    coins: d.coins,
    cells: Array.from({ length: d.cols * d.rows }, () => ({ mine: false, adj: 0, open: false, flag: false, coin: false })),
    placed: false,
    openCount: 0,
    exploded: null,
  };
}

export function neighbors(b: Board, i: number): number[] {
  const r = Math.floor(i / b.cols);
  const c = i % b.cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < b.rows && nc >= 0 && nc < b.cols) out.push(nr * b.cols + nc);
    }
  }
  return out;
}

function shuffle<T>(arr: T[], random: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 첫 칸과 그 주변에는 지뢰를 두지 않는다 — 첫 탭은 항상 안전하고 넓게 열린다 */
function placeMines(b: Board, first: number, random: () => number): void {
  const safe = new Set([first, ...neighbors(b, first)]);
  let candidates = b.cells.map((_, i) => i).filter((i) => !safe.has(i));
  if (candidates.length < b.mines) candidates = b.cells.map((_, i) => i).filter((i) => i !== first);
  for (const i of shuffle(candidates, random).slice(0, b.mines)) b.cells[i].mine = true;

  const empty = b.cells.map((_, i) => i).filter((i) => !b.cells[i].mine);
  for (const i of shuffle(empty, random).slice(0, b.coins)) b.cells[i].coin = true;

  for (let i = 0; i < b.cells.length; i++) {
    b.cells[i].adj = neighbors(b, i).filter((n) => b.cells[n].mine).length;
  }
  b.placed = true;
}

/** 칸을 연다. 빈 칸(주변 지뢰 0)이면 이어진 칸까지 연다 */
export function openCell(b: Board, i: number, random: () => number = Math.random): OpenResult {
  const cell = b.cells[i];
  if (b.exploded !== null || cell.open || cell.flag) return NOTHING;
  if (!b.placed) placeMines(b, i, random);

  if (cell.mine) {
    cell.open = true;
    b.exploded = i;
    return { boom: true, coins: 0, opened: 1 };
  }

  let coins = 0;
  let opened = 0;
  const queue = [i];
  while (queue.length > 0) {
    const k = queue.pop() as number;
    const c = b.cells[k];
    if (c.open || c.flag || c.mine) continue;
    c.open = true;
    opened++;
    if (c.coin) coins++;
    if (c.adj === 0) for (const n of neighbors(b, k)) if (!b.cells[n].open) queue.push(n);
  }
  b.openCount += opened;
  return { boom: false, coins, opened };
}

/** 열린 숫자 칸 주변의 깃발 수가 숫자와 같으면 나머지 주변 칸을 한 번에 연다 */
export function chord(b: Board, i: number, random: () => number = Math.random): OpenResult {
  const cell = b.cells[i];
  if (!cell.open || cell.adj === 0 || b.exploded !== null) return NOTHING;
  const around = neighbors(b, i);
  const flags = around.filter((n) => b.cells[n].flag).length;
  if (flags !== cell.adj) return NOTHING;

  const total: OpenResult = { boom: false, coins: 0, opened: 0 };
  for (const n of around) {
    const r = openCell(b, n, random);
    total.coins += r.coins;
    total.opened += r.opened;
    if (r.boom) total.boom = true;
  }
  return total;
}

/** 닫힌 칸의 깃발을 꽂거나 뽑는다. 바뀌었으면 true */
export function toggleFlag(b: Board, i: number): boolean {
  const cell = b.cells[i];
  if (cell.open || b.exploded !== null) return false;
  cell.flag = !cell.flag;
  return true;
}

export function flagCount(b: Board): number {
  return b.cells.reduce((n, c) => n + (c.flag ? 1 : 0), 0);
}

export function isWon(b: Board): boolean {
  return b.exploded === null && b.placed && b.openCount === b.cols * b.rows - b.mines;
}

/** 초를 "m:ss"로 */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 한 판의 점수 계산 재료 — 서버로 보내는 값이기도 하다 */
export interface RunStats {
  opened: number;
  correctFlags: number;
  wrongFlags: number;
  won: boolean;
  seconds: number;
}

export function runStats(b: Board, won: boolean, seconds: number): RunStats {
  let correctFlags = 0;
  let wrongFlags = 0;
  for (const c of b.cells) {
    if (!c.flag) continue;
    if (c.mine) correctFlags++;
    else wrongFlags++;
  }
  return { opened: b.openCount, correctFlags, wrongFlags, won, seconds: Math.round(seconds * 10) / 10 };
}

export interface ScoreBreakdown {
  cells: number;
  flags: number;
  clear: number;
  time: number;
  total: number;
}

/**
 * 점수 — 서버(server/src/domain.ts minesweeperScore)와 같은 식이다. 순위표 값은 서버가 정한다.
 * 연 칸 ×10, 맞은 깃발 ×20, 틀린 깃발 ×(−10), 깼으면 안전한 칸 수 ×10 + 기준 시간보다 빠른 0.1초당 1점.
 */
export function scoreRun(d: Difficulty, r: RunStats): ScoreBreakdown {
  const safe = d.cols * d.rows - d.mines;
  const cells = r.opened * 10;
  const flags = r.correctFlags * 20 - r.wrongFlags * 10;
  const clear = r.won ? safe * 10 : 0;
  const time = r.won ? Math.max(0, Math.round((d.par - r.seconds) * 10)) : 0;
  return { cells, flags, clear, time, total: Math.max(0, cells + flags + clear + time) };
}

