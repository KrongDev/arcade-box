import { GAMES, type GameDef, type GameId, type UnlockRule } from './registry.ts';

/**
 * 진행 규칙 — 게임 잠금 해제와 대표 기록. 기기 저장(SaveData)과 서버 스냅샷 모두 이 모양을 가진다.
 * 서버(server/src/domain.ts applyUnlocks)와 같은 규칙이다.
 */

export interface Progress {
  /** 게임별 최고 점수 (순위표가 하나인 게임) */
  best: Partial<Record<GameId, number>>;
  /** 단계(순위표 ID)별 최고 점수 (단계가 여러 개인 게임) */
  bestScore: Partial<Record<string, number>>;
  /** 깬 단계 */
  cleared: readonly string[];
  unlocked: readonly GameId[];
}

export function isUnlockMet(rule: UnlockRule, p: Progress): boolean {
  if (rule.kind === 'score') return (p.best[rule.gameId] ?? 0) >= rule.score;
  return p.cleared.includes(rule.stage);
}

/** 조건을 채웠지만 아직 열리지 않은 게임 */
export function newlyUnlocked(p: Progress): GameId[] {
  return GAMES.filter((g) => g.unlock !== null && !p.unlocked.includes(g.id) && isUnlockMet(g.unlock, p)).map((g) => g.id);
}

/** 잠금 진행도 — 점수 조건은 지금 점수/기준 점수, 단계 조건은 깼으면 1/1 */
export function unlockProgress(rule: UnlockRule, p: Progress): { current: number; target: number } {
  if (rule.kind === 'score') return { current: Math.min(p.best[rule.gameId] ?? 0, rule.score), target: rule.score };
  return { current: p.cleared.includes(rule.stage) ? 1 : 0, target: 1 };
}

/** 홈에 보여 줄 대표 기록 — 단계가 여러 개면 가장 어려운 단계부터 기록이 있는 것. 없으면 null */
export function bestRecord(game: GameDef, p: Pick<Progress, 'best' | 'bestScore'>): number | null {
  if (game.boards.length > 1) {
    for (const board of [...game.boards].reverse()) {
      const score = p.bestScore[board.id];
      if (score !== undefined && score > 0) return score;
    }
    return null;
  }
  const best = p.best[game.id] ?? 0;
  return best > 0 ? best : null;
}
