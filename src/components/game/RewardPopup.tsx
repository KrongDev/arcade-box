import { useEffect, type CSSProperties } from 'react';
import { currencyVars } from '../../game/currency';
import { haptic } from '../../game/haptic';
import { getGame, type GameId } from '../../game/registry';
import { playSfx } from '../../game/sfx';
import { Coin } from '../gameIcons';
import '../../styles/game-dialog.css';
import '../../styles/reward.css';

/** 저절로 닫히기까지(밀리초). 누르면 바로 닫힌다 */
const AUTO_CLOSE_MS = 2600;
/** 퍼지는 작은 코인 방향(도) */
const SPARKS = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];

/**
 * 코인 보상 팝업 — 출석·광고 보상처럼 코인을 받았을 때 "+50"과 함께 무엇을 받았는지 보여 준다.
 * 효과음·진동을 내고, 잠시 뒤 저절로 닫힌다.
 */
export function RewardPopup({
  game,
  amount,
  title,
  note,
  onClose,
}: {
  game: GameId;
  amount: number;
  title: string;
  note?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    playSfx('powerUp');
    haptic('success', 0);
    const t = window.setTimeout(onClose, AUTO_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [onClose]);

  const name = getGame(game).name;
  return (
    <div className="reward-overlay" onClick={onClose}>
      <section
        className="reward-card"
        role="status"
        aria-live="polite"
        style={currencyVars(game) as CSSProperties}
        onClick={(ev) => ev.stopPropagation()}
      >
        <p className="reward-kicker">{title}</p>
        <div className="reward-coin" aria-hidden="true">
          {SPARKS.map((deg) => (
            <span key={deg} className="reward-spark" style={{ '--a': `${deg}deg` } as CSSProperties}>
              <Coin game={game} size={18} />
            </span>
          ))}
          <span className="reward-coin-face">
            <Coin game={game} size={72} />
          </span>
        </div>
        <p className="reward-amount">+{amount.toLocaleString()}</p>
        <p className="reward-what">
          {name} 코인 {amount.toLocaleString()}개를 받았어요
        </p>
        {note && <p className="reward-note">{note}</p>}
        <button type="button" className="btn btn-primary reward-button" onClick={onClose} autoFocus>
          좋아요
        </button>
      </section>
    </div>
  );
}
