import type { ReactNode } from 'react';
import type { GameId } from '../../game/registry';
import type { ScoreRunResult } from '../../game/useScoreRun';
import { ArcadeIcon } from '../ArcadeIcon';
import { Coin } from '../gameIcons';
import '../../styles/game-dialog.css';

/**
 * 점수 게임 결과 창 — 점수, 최고 기록, 받은 코인, 새로 열린 게임, 다시 하기·공유·홈으로.
 * 게임마다 다른 줄(예: 도달한 스테이지)은 extraRows로 넣는다.
 */
export function ScoreResultDialog({
  game,
  result,
  extraRows,
  sharing,
  shareFailed,
  onRetry,
  onShare,
  onHome,
}: {
  game: GameId;
  result: ScoreRunResult;
  extraRows?: ReactNode;
  sharing: boolean;
  shareFailed: boolean;
  onRetry: () => void;
  onShare: () => void;
  onHome: () => void;
}) {
  return (
    <div className="game-overlay">
      <section className="game-dialog" role="dialog" aria-modal="true" aria-labelledby="result-title">
        {result.isBest && (
          <p className="result-badge">
            <ArcadeIcon name="party" size={16} /> 새 최고 기록
          </p>
        )}
        <h2 id="result-title" className="dialog-title">
          게임이 끝났어요
        </h2>
        <p className="result-score">{result.score.toLocaleString()}점</p>
        <dl className="result-rows">
          {extraRows}
          <div className="result-row">
            <dt>최고 기록</dt>
            <dd>{result.best.toLocaleString()}점</dd>
          </div>
          <div className="result-row">
            <dt>받은 코인</dt>
            <dd>
              <Coin game={game} /> {result.coins}
            </dd>
          </div>
        </dl>
        {result.unlocks.map((text) => (
          <p key={text} className="result-unlock">
            <ArcadeIcon name="unlock" size={16} /> {text}
          </p>
        ))}
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            다시 하기
          </button>
          {shareFailed && <p className="dialog-error">공유하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>}
          {result.score > 0 && (
            <button type="button" className="btn btn-secondary" onClick={onShare} disabled={sharing}>
              점수 공유하기
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onHome}>
            홈으로
          </button>
        </div>
      </section>
    </div>
  );
}
