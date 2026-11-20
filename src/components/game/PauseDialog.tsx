import '../../styles/game-dialog.css';

/** 일시정지 창 — 지금까지 모은 점수·코인을 보여 주고 계속하기·그만하기를 고른다 */
export function PauseDialog({ score, coins, onResume, onQuit }: { score: number; coins: number; onResume: () => void; onQuit: () => void }) {
  return (
    <div className="game-overlay">
      <section className="game-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <h2 id="pause-title" className="dialog-title">
          잠시 멈췄어요
        </h2>
        <p className="dialog-body">
          지금까지 {score.toLocaleString()}점, 코인 {coins}개를 모았어요. 그만해도 모은 코인은 받아요.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onResume}>
            계속하기
          </button>
          <button type="button" className="btn btn-secondary" onClick={onQuit}>
            그만하기
          </button>
        </div>
      </section>
    </div>
  );
}
