import { useCallback, useRef, useState } from 'react';
import type { ScoreGameId } from './api';
import { useSave } from './save-context';
import { shareWithLink } from './share';
import { gameUnlocks, type UnlockNotice } from './unlocks';

/** 점수 게임 한 판의 결과 */
export interface ScoreRunResult {
  score: number;
  coins: number;
  isBest: boolean;
  best: number;
  /** 이번 판으로 새로 열린 게임 */
  unlocks: UnlockNotice[];
}

/**
 * 점수 게임(핀볼·벽돌깨기) 한 판 마무리 — 코인 지급, 최고 점수 기록, 서버 전송을 한 판에 한 번만 한다.
 * 같은 판을 두 번 마무리하면(결과 창 + 그만하기) 두 번째는 기록하지 않고 결과만 돌려준다.
 */
export function useScoreRun(game: ScoreGameId) {
  const { addCoins, recordScore, submitRun } = useSave();
  const settledRef = useRef(false);

  const settle = useCallback(
    (score: number, coins: number): ScoreRunResult => {
      if (settledRef.current) return { score, coins, isBest: false, best: score, unlocks: [] };
      settledRef.current = true;
      addCoins(game, coins);
      const r = recordScore(game, score);
      submitRun({ board: game, score, coins });
      return {
        score,
        coins,
        isBest: r.isBest,
        best: r.best,
        unlocks: gameUnlocks(r.newlyUnlocked),
      };
    },
    [game, addCoins, recordScore, submitRun],
  );

  /** 새 판을 시작할 때 부른다 */
  const reset = useCallback(() => {
    settledRef.current = false;
  }, []);

  return { settle, reset };
}

/** 점수 공유 — 공유 중 여부와 실패 여부를 함께 관리한다 */
export function useShareScore(message: (score: number) => string) {
  const [sharing, setSharing] = useState(false);
  const [failed, setFailed] = useState(false);

  const share = async (score: number) => {
    if (sharing) return;
    setSharing(true);
    setFailed(false);
    const r = await shareWithLink(message(score));
    setSharing(false);
    setFailed(r === 'failed');
  };

  const clearError = useCallback(() => setFailed(false), []);

  return { sharing, failed, share, clearError };
}
