import { subjectParticle } from './korean.ts';
import { getGame, type GameId } from './registry.ts';

/**
 * 한 판으로 새로 열린 것 — 게임 하나, 또는 게임 안의 다음 단계(지뢰찾기 난이도 등).
 * 결과 창의 한 줄 안내와 잠금 해제 연출이 같은 값을 쓴다.
 */
export type UnlockNotice = { kind: 'game'; gameId: GameId } | { kind: 'level'; gameId: GameId; level: string };

export function gameUnlocks(ids: readonly GameId[]): UnlockNotice[] {
  return ids.map((gameId) => ({ kind: 'game', gameId }));
}

/** 연출 카드의 이름 줄: "지뢰찾기" / "지뢰찾기 중급" */
export function unlockName(n: UnlockNotice): string {
  const game = getGame(n.gameId).name;
  return n.kind === 'game' ? game : `${game} ${n.level}`;
}

/** 연출 카드의 머리말 */
export function unlockHeadline(n: UnlockNotice): string {
  return n.kind === 'game' ? '새 게임이 열렸어요' : '다음 단계가 열렸어요';
}

/** 결과 창의 한 줄 안내: "새 게임 지뢰찾기가 열렸어요" / "중급이 열렸어요" */
export function unlockMessage(n: UnlockNotice): string {
  if (n.kind === 'game') {
    const name = getGame(n.gameId).name;
    return `새 게임 ${name}${subjectParticle(name)} 열렸어요`;
  }
  return `${n.level}${subjectParticle(n.level)} 열렸어요`;
}
