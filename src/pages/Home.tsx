import { useCallback, useEffect, useRef, useState } from 'react';
import logoMark from '../assets/logo-mark.png';
import { GameArt } from '../components/GameArt';
import { Coin, Gear, Lock, Play } from '../components/gameIcons';
import { ChevronLeft, ChevronRight, Close } from '../components/icons';
import { API_BASE } from '../game/api';
import { haptic } from '../game/haptic';
import { ATTENDANCE_COINS, GAMES, getGame, type GameDef, type GameId } from '../game/registry';
import type { SaveData } from '../game/save';
import { useSave } from '../game/save-context';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import { DIFFICULTIES, stageKey } from '../minesweeper/board';
import '../styles/arcade.css';
import './Home.css';

export default function Home({
  onPlay,
  onOpenShop,
  onOpenSettings,
  onOpenLeaderboard,
}: {
  onPlay: (id: GameId) => void;
  onOpenShop: () => void;
  onOpenSettings: () => void;
  onOpenLeaderboard: () => void;
}) {
  const { save, canClaimAttendance, claimAttendance, serverStatus } = useSave();
  const insets = useSafeArea();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [claimedMessage, setClaimedMessage] = useState<string | null>(null);

  const unlockedGames = GAMES.filter((g) => save.unlocked.includes(g.id));

  // 게임 카드는 옆으로 넘긴다 — 게임이 늘어나도 화면이 길어지지 않게
  const trackRef = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onScroll = () => {
      const first = el.children[0] as HTMLElement | undefined;
      const second = el.children[1] as HTMLElement | undefined;
      const step = first && second ? second.offsetLeft - first.offsetLeft : el.clientWidth;
      setActive(Math.max(0, Math.min(GAMES.length - 1, Math.round(el.scrollLeft / Math.max(1, step)))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  const goTo = useCallback((index: number) => {
    const el = trackRef.current;
    const target = el?.children[index] as HTMLElement | undefined;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !target || !first) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: target.offsetLeft - first.offsetLeft, behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  const claimTargets = unlockedGames.filter((g) => g.playable);

  const claim = (id: GameId) => {
    claimAttendance(id);
    haptic('success', 0);
    setChooserOpen(false);
    setClaimedMessage(`${getGame(id).name} 코인 ${ATTENDANCE_COINS}개를 받았어요`);
  };

  const onClaim = () => {
    if (claimTargets.length === 1) claim(claimTargets[0].id);
    else if (claimTargets.length > 1) setChooserOpen(true);
  };

  return (
    <main className="home ab-page" style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 24 }}>
      <header className="home-top">
        <div className="home-brand">
          <img className="home-logo" src={logoMark} alt="" width={40} height={40} />
          <span className="home-brand-name">아케이드박스</span>
        </div>
        <button type="button" className="ab-icon-btn" aria-label="설정" onClick={onOpenSettings}>
          <Gear size={22} />
        </button>
      </header>

      <section className="home-hero">
        <h1 className="home-title">오늘은 어떤 게임을 할까요?</h1>
        <p className="home-subtitle">점수를 올리면 다음 게임이 열려요</p>
      </section>

      <section className="wallet" aria-label="게임별 코인">
        {unlockedGames.map((g) => (
          <div key={g.id} className="ab-chip">
            <span className="tf">{g.emoji}</span> {g.name}
            <strong>
              <Coin /> {(save.coins[g.id] ?? 0).toLocaleString()}
            </strong>
          </div>
        ))}
      </section>

      <section className={canClaimAttendance ? 'attendance' : 'attendance is-done'} aria-label="출석 보상">
        <span className="attendance-icon">
          <span className="tf">🎁</span>
        </span>
        <div className="attendance-text">
          <p className="attendance-title">출석 보상</p>
          <p className="attendance-desc">
            {canClaimAttendance
              ? `하루 한 번 코인 ${ATTENDANCE_COINS}개를 받을 수 있어요`
              : (claimedMessage ?? '오늘 보상을 받았어요. 내일 다시 받을 수 있어요')}
          </p>
        </div>
        <button
          type="button"
          className="ab-btn ab-btn--sm ab-btn--pink attendance-button"
          onClick={onClaim}
          disabled={!canClaimAttendance || claimTargets.length === 0}
        >
          {canClaimAttendance ? '받기' : '받음'}
        </button>
      </section>

      <div className="game-section-head">
        <h2 className="ab-section-title game-section-title">
          게임 <span className="game-count">{GAMES.length}</span>
        </h2>
        {GAMES.length > 1 && (
          <div className="game-nav">
            <button type="button" className="ab-icon-btn" aria-label="이전 게임" disabled={active <= 0} onClick={() => goTo(active - 1)}>
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="ab-icon-btn"
              aria-label="다음 게임"
              disabled={active >= GAMES.length - 1}
              onClick={() => goTo(active + 1)}
            >
              <ChevronRight size={22} />
            </button>
          </div>
        )}
      </div>
      <ul className="game-carousel" ref={trackRef} aria-label="게임 목록, 옆으로 넘겨요">
        {GAMES.map((g, i) => (
          <li key={g.id} aria-label={`${GAMES.length}개 중 ${i + 1}번째`}>
            <GameCard game={g} save={save} onPlay={onPlay} />
          </li>
        ))}
      </ul>
      {GAMES.length > 1 &&
        (GAMES.length <= 8 ? (
          <div className="game-dots" aria-hidden="true">
            {GAMES.map((g, i) => (
              <span key={g.id} className={i === active ? 'game-dot is-active' : 'game-dot'} />
            ))}
          </div>
        ) : (
          <p className="game-counter" aria-hidden="true">
            {active + 1} / {GAMES.length}
          </p>
        ))}

      <div className="home-tiles">
        <button type="button" className="home-tile" onClick={onOpenShop}>
          <span className="home-tile-icon is-pink">
            <span className="tf">🛍️</span>
          </span>
          <span className="home-tile-title">상점</span>
          <span className="home-tile-desc">모은 코인으로 판과 공을 꾸며요</span>
        </button>
        {API_BASE && (
          <button type="button" className="home-tile" onClick={onOpenLeaderboard}>
            <span className="home-tile-icon is-gold">
              <span className="tf">🏆</span>
            </span>
            <span className="home-tile-title">순위표</span>
            <span className="home-tile-desc">게임별로 다른 사람들과 기록을 겨뤄요</span>
          </button>
        )}
      </div>

      <p className="home-note">
        새 게임이 계속 추가될 예정이에요.{' '}
        {serverStatus === 'online'
          ? '코인과 기록은 서버에 저장돼서 기기를 바꿔도 이어져요.'
          : '코인과 기록은 이 기기에 먼저 저장되고, 서버에 연결되면 함께 저장돼요.'}
      </p>

      {chooserOpen && (
        <div className="sheet-overlay" onClick={() => setChooserOpen(false)}>
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chooser-title"
            style={{ paddingBottom: Math.max(insets.bottom, 34) }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="sheet-header">
              <h2 id="chooser-title" className="sheet-title">
                어느 게임 코인으로 받을까요?
              </h2>
              <button type="button" className="ab-icon-btn" aria-label="닫기" onClick={() => setChooserOpen(false)}>
                <Close size={22} />
              </button>
            </div>
            <ul className="sheet-list">
              {claimTargets.map((g) => (
                <li key={g.id}>
                  <button type="button" className="ab-btn ab-btn--ghost ab-btn--block sheet-option" onClick={() => claim(g.id)}>
                    <span className="tf">{g.emoji}</span> {g.name} 코인 {ATTENDANCE_COINS}개
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}

function GameCard({ game, save, onPlay: play }: { game: GameDef; save: SaveData; onPlay: (id: GameId) => void }) {
  const unlocked = save.unlocked.includes(game.id);

  if (unlocked && game.playable) {
    return (
      <button type="button" className="game-card" onClick={() => play(game.id)}>
        <span className="game-art">
          <GameArt id={game.id} />
        </span>
        <span className="game-info">
          <span className="game-text">
            <span className="game-name">{game.name}</span>
            <span className="game-desc">{game.description}</span>
            <span className="game-meta">{bestLabel(game, save) ?? '아직 기록이 없어요'}</span>
          </span>
          <span className="game-play" aria-hidden="true">
            <Play size={18} /> 플레이
          </span>
        </span>
      </button>
    );
  }

  if (unlocked) {
    return (
      <div className="game-card is-static">
        <span className="game-art">
          <GameArt id={game.id} />
        </span>
        <span className="game-info">
          <span className="game-text">
            <span className="game-name">{game.name}</span>
            <span className="game-desc">열렸어요. 곧 플레이할 수 있어요</span>
          </span>
          <span className="game-badge">준비 중</span>
        </span>
      </div>
    );
  }

  const rule = game.unlock;
  const sourceBest = rule ? (save.best[rule.gameId] ?? 0) : 0;
  const progress = rule ? Math.min(1, sourceBest / rule.score) : 0;
  return (
    <div className="game-card is-locked" aria-disabled="true">
      <span className="game-art">
        <GameArt id={game.id} />
        <span className="game-lock-badge">
          <Lock size={22} />
        </span>
      </span>
      <span className="game-info">
        <span className="game-text">
          <span className="game-name">{game.name}</span>
          {rule && (
            <>
              <span className="game-desc">
                {getGame(rule.gameId).name} {rule.score.toLocaleString()}점을 넘기면 열려요
              </span>
              <span className="game-progress" aria-hidden="true">
                <span className="game-progress-bar" style={{ width: `${progress * 100}%` }} />
              </span>
              <span className="game-meta">
                지금 최고 {sourceBest.toLocaleString()}점 / {rule.score.toLocaleString()}점
              </span>
            </>
          )}
        </span>
      </span>
    </div>
  );
}

/** 홈 카드에 보여 줄 최고 기록 — 점수 게임은 최고 점수, 지뢰찾기는 가장 어려운 단계의 최고 점수 */
function bestLabel(game: GameDef, save: SaveData): string | null {
  if (game.id === 'minesweeper') {
    for (const d of [...DIFFICULTIES].reverse()) {
      const score = save.bestScore[stageKey(d.id)];
      if (score !== undefined && score > 0) return `${d.name} 최고 ${score.toLocaleString()}점`;
    }
    return null;
  }
  const best = save.best[game.id] ?? 0;
  return best > 0 ? `최고 ${best.toLocaleString()}점` : null;
}
