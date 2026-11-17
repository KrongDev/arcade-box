import { useState } from 'react';
import { ChevronRight, Close } from '../components/icons';
import { haptic } from '../game/haptic';
import { ATTENDANCE_COINS, GAMES, getGame, type GameDef, type GameId } from '../game/registry';
import type { SaveData } from '../game/save';
import { DIFFICULTIES, stageKey } from '../minesweeper/board';
import { API_BASE } from '../game/api';
import { Coin } from '../components/gameIcons';
import { useSave } from '../game/save-context';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
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
    <main className="home" style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 24 }}>
      <header className="home-header">
        <h1 className="home-title">오늘은 어떤 게임을 할까요?</h1>
        <p className="home-subtitle">점수를 올리면 다음 게임이 열려요</p>
      </header>

      <section className="wallet" aria-label="게임별 코인">
        {unlockedGames.map((g) => (
          <div key={g.id} className="wallet-chip">
            <span className="wallet-name">
              <span className="tf">{g.emoji}</span> {g.name}
            </span>
            <span className="wallet-amount">
              <Coin /> {(save.coins[g.id] ?? 0).toLocaleString()}
            </span>
          </div>
        ))}
      </section>

      <section className="attendance" aria-label="출석 보상">
        <div className="attendance-text">
          <p className="attendance-title">
            <span className="tf">🎁</span> 출석 보상
          </p>
          <p className="attendance-desc">
            {canClaimAttendance
              ? `하루 한 번 코인 ${ATTENDANCE_COINS}개를 받을 수 있어요`
              : (claimedMessage ?? '오늘 보상을 받았어요. 내일 다시 받을 수 있어요')}
          </p>
        </div>
        <button
          type="button"
          className="attendance-button"
          onClick={onClaim}
          disabled={!canClaimAttendance || claimTargets.length === 0}
        >
          {canClaimAttendance ? '받기' : '받음'}
        </button>
      </section>

      <button type="button" className="shop-entry" onClick={onOpenShop}>
        <span className="shop-entry-icon">
          <span className="tf">🛍️</span>
        </span>
        <span className="shop-entry-body">
          <span className="shop-entry-title">상점</span>
          <span className="shop-entry-desc">모은 코인으로 판과 공을 꾸며요</span>
        </span>
        <span className="game-chevron">
          <ChevronRight size={20} />
        </span>
      </button>

      {API_BASE && (
        <button type="button" className="shop-entry" onClick={onOpenLeaderboard}>
          <span className="shop-entry-icon">
            <span className="tf">🏆</span>
          </span>
          <span className="shop-entry-body">
            <span className="shop-entry-title">순위표</span>
            <span className="shop-entry-desc">게임별로 다른 사람들과 기록을 겨뤄요</span>
          </span>
          <span className="game-chevron">
            <ChevronRight size={20} />
          </span>
        </button>
      )}

      <h2 className="section-title">게임</h2>
      <ul className="game-list">
        {GAMES.map((g) => (
          <li key={g.id}>
            <GameCard game={g} save={save} onPlay={onPlay} />
          </li>
        ))}
      </ul>

      <button type="button" className="settings-entry" onClick={onOpenSettings}>
        <span className="tf">⚙️</span>
        <span className="settings-entry-label">설정</span>
        <span className="settings-entry-desc">효과음 · 진동 · 구매 내역</span>
        <span className="game-chevron">
          <ChevronRight size={20} />
        </span>
      </button>

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
              <button type="button" className="sheet-close" aria-label="닫기" onClick={() => setChooserOpen(false)}>
                <Close size={22} />
              </button>
            </div>
            <ul className="sheet-list">
              {claimTargets.map((g) => (
                <li key={g.id}>
                  <button type="button" className="sheet-option" onClick={() => claim(g.id)}>
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
        <span className="game-tile">
          <span className="tf">{game.emoji}</span>
        </span>
        <span className="game-body">
          <span className="game-name">{game.name}</span>
          <span className="game-desc">{game.description}</span>
          <span className="game-meta">{bestLabel(game, save) ?? '아직 기록이 없어요'}</span>
        </span>
        <span className="game-chevron">
          <ChevronRight size={20} />
        </span>
      </button>
    );
  }

  if (unlocked) {
    return (
      <div className="game-card is-static">
        <span className="game-tile">
          <span className="tf">{game.emoji}</span>
        </span>
        <span className="game-body">
          <span className="game-name">{game.name}</span>
          <span className="game-desc">열렸어요. 곧 플레이할 수 있어요</span>
        </span>
        <span className="game-badge">준비 중</span>
      </div>
    );
  }

  const rule = game.unlock;
  const sourceBest = rule ? (save.best[rule.gameId] ?? 0) : 0;
  const progress = rule ? Math.min(1, sourceBest / rule.score) : 0;
  return (
    <div className="game-card is-locked" aria-disabled="true">
      <span className="game-tile">
        <span className="tf game-tile-emoji">{game.emoji}</span>
        <span className="tf game-lock">🔒</span>
      </span>
      <span className="game-body">
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
    </div>
  );
}

/** 홈 카드에 보여 줄 최고 기록 — 점수 게임은 최고 점수, 지뢰찾기는 가장 어려운 단계의 최단 시간 */
function bestLabel(game: GameDef, save: SaveData): string | null {
  if (game.id === 'minesweeper') {
    // 가장 어려운 난이도부터, 점수가 있는 곳의 최고 점수
    for (const d of [...DIFFICULTIES].reverse()) {
      const score = save.bestScore[stageKey(d.id)];
      if (score !== undefined && score > 0) return `${d.name} 최고 ${score.toLocaleString()}점`;
    }
    return null;
  }
  const best = save.best[game.id] ?? 0;
  return best > 0 ? `최고 ${best.toLocaleString()}점` : null;
}
