import { closeView, graniteEvent } from '@apps-in-toss/web-framework';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArcadeIcon, GameIcon } from '../components/ArcadeIcon';
import { GameArt } from '../components/GameArt';
import { Coin, Lock } from '../components/gameIcons';
import { ChevronLeft, ChevronRight, Close } from '../components/icons';
import { API_BASE } from '../game/api';
import { currencyVars } from '../game/currency';
import { haptic } from '../game/haptic';
import { objectParticle } from '../game/korean';
import { bestRecord, unlockProgress } from '../game/progression';
import { ATTENDANCE_COINS, GAMES, boardLabel, getGame, type GameDef, type GameId, type UnlockRule } from '../game/registry';
import type { SaveData } from '../game/save';
import { useSave } from '../game/save-context';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import '../styles/arcade.css';
import '../styles/game-dialog.css';
import './Home.css';

export default function Home({
  game,
  onGameChange,
  onPlay,
  onOpenShop,
  onOpenSettings,
  onOpenLeaderboard,
}: {
  /** 지금 오락기 화면에 띄운 게임 — 앱 전체가 함께 쓴다(상점도 이 게임으로 열린다) */
  game: GameId;
  onGameChange: (id: GameId) => void;
  onPlay: (id: GameId) => void;
  onOpenShop: () => void;
  onOpenSettings: () => void;
  onOpenLeaderboard: () => void;
}) {
  const { save, canClaimAttendance, claimAttendance, serverStatus } = useSave();
  const insets = useSafeArea();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [claimedMessage, setClaimedMessage] = useState<string | null>(null);
  const [exitOpen, setExitOpen] = useState(false);

  // 홈에서 뒤로가기: 열린 창이 있으면 닫고, 없으면 종료할지 묻는다(바로 꺼지지 않게)
  useEffect(() => {
    try {
      return graniteEvent.addEventListener('backEvent', {
        onEvent: () => {
          if (chooserOpen) setChooserOpen(false);
          else setExitOpen((open) => !open);
        },
        onError: () => undefined,
      });
    } catch {
      return undefined;
    }
  }, [chooserOpen]);
  const exitApp = () => {
    setExitOpen(false);
    try {
      void closeView().catch(() => undefined);
    } catch {
      // 지원하지 않는 환경
    }
  };

  const unlockedGames = GAMES.filter((g) => save.unlocked.includes(g.id));
  const active = Math.max(0, GAMES.findIndex((g) => g.id === game));
  const current = GAMES[active];
  const currentUnlocked = save.unlocked.includes(current.id);

  // 오락기 화면 속 게임은 옆으로 넘긴다 — 넘기면 지금 게임(코인 표시·상점)도 따라 바뀐다
  const trackRef = useRef<HTMLUListElement>(null);
  const onGameChangeRef = useRef(onGameChange);
  useEffect(() => {
    onGameChangeRef.current = onGameChange;
  }, [onGameChange]);
  // 조이스틱 딸각: 게임을 넘기는 방향으로 잠깐 기울었다가 돌아온다(n이 바뀌면 동작을 처음부터 다시)
  const [tilt, setTilt] = useState<{ dir: 'left' | 'right'; n: number } | null>(null);
  const kick = useCallback((dir: 'left' | 'right') => {
    setTilt((t) => ({ dir, n: (t?.n ?? 0) + 1 }));
    haptic('tickWeak');
  }, []);
  /** 버튼으로 넘길 때는 누르는 순간 이미 기울였으니, 화면이 그 게임에 닿을 때 다시 기울이지 않는다 */
  const tiltedFor = useRef<number | null>(null);
  const initialIndex = useRef(active);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    // 처음엔 지금 게임 화면에서 시작한다(움직임 없이)
    el.scrollLeft = initialIndex.current * el.clientWidth;
    let last = initialIndex.current;
    const onScroll = () => {
      const index = Math.max(0, Math.min(GAMES.length - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))));
      if (index !== last) {
        if (tiltedFor.current === index) tiltedFor.current = null;
        else kick(index > last ? 'right' : 'left');
        last = index;
        onGameChangeRef.current(GAMES[index].id);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [kick]);
  const step = (dir: 'left' | 'right') => {
    const target = active + (dir === 'right' ? 1 : -1);
    tiltedFor.current = target;
    kick(dir);
    goTo(target);
  };
  const goTo = useCallback((index: number) => {
    const el = trackRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: index * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  // 마우스로 잡아끌어 넘기기 (손가락은 브라우저 기본 스크롤로 넘어간다)
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let drag: { x: number; left: number; from: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: el.scrollLeft, from: activeRef.current, moved: false };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 6) {
        drag.moved = true;
        el.classList.add('is-dragging');
      }
      if (drag.moved) el.scrollLeft = drag.left - dx;
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) return;
      el.classList.remove('is-dragging');
      const dx = e.clientX - d.x;
      const next = dx < -40 ? d.from + 1 : dx > 40 ? d.from - 1 : d.from;
      goTo(Math.max(0, Math.min(GAMES.length - 1, next)));
    };
    el.addEventListener('pointerdown', onDown);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [goTo]);

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

  const best = currentUnlocked ? bestRecord(current, save) : null;
  // 상점은 지금 게임으로 열린다. 아직 잠겼거나 준비 중이면 열린 첫 게임 상점으로 간다(Shop과 같은 규칙)
  const shopGame = currentUnlocked && current.playable ? current : (claimTargets[0] ?? current);
  const canPlay = currentUnlocked && current.playable;

  return (
    <main className="home ab-page" style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 24 }}>
      <header className="home-top">
        <ArcadeIcon name="cabinet" size={48} />
        <span className="home-brand-name ab-pixel">아케이드박스</span>
        <button type="button" className="ab-icon-btn home-settings" aria-label="설정" onClick={onOpenSettings}>
          <ArcadeIcon name="gear" size={24} />
        </button>
      </header>

      {/* 지금 화면에 띄운 게임의 코인 — 게임을 넘기면 함께 바뀐다 */}
      <section className="home-coin ab-card" aria-label={`${current.name} 코인`} style={currencyVars(current.id) as CSSProperties}>
        <GameIcon id={current.id} size={16} />
        <span className="home-coin-name">{current.name} 코인</span>
        <span className="ab-lcd home-coin-lcd">
          <Coin game={current.id} size={16} /> {(save.coins[current.id] ?? 0).toLocaleString()}
        </span>
      </section>

      <section className="machine" aria-label="게임 고르기">
        <div className="ab-bezel">
          <div className="ab-crt machine-crt">
            <ul
              className="machine-track"
              ref={trackRef}
              aria-label={`게임 목록, 옆으로 넘겨요. ${GAMES.length}개 중 ${active + 1}번째 ${current.name}`}
            >
              {GAMES.map((g) => (
                <li key={g.id} className="machine-slide" aria-hidden={g.id !== current.id}>
                  <GameScreen game={g} save={save} />
                </li>
              ))}
            </ul>
            <div className="machine-hud ab-pixel" aria-hidden="true">
              <span>{!currentUnlocked ? 'LOCKED' : best !== null ? `HI ${best.toLocaleString()}` : 'NEW'}</span>
              {GAMES.length > 1 &&
                (GAMES.length <= 8 ? (
                  <span className="machine-dots">
                    {GAMES.map((g, i) => (
                      <i key={g.id} className={i === active ? 'is-active' : undefined} />
                    ))}
                  </span>
                ) : (
                  <span>
                    {active + 1}/{GAMES.length}
                  </span>
                ))}
            </div>
          </div>
        </div>
        <div className="machine-panel">
          <span className="machine-stick" aria-hidden="true">
            <i className="machine-stick-base" />
            <span key={tilt?.n ?? 0} className={tilt ? `machine-stick-lever is-${tilt.dir}` : 'machine-stick-lever'}>
              <i className="machine-stick-shaft" />
              <i className="machine-stick-ball" />
            </span>
          </span>
          {GAMES.length > 1 && (
            <span className="machine-nav">
              <button type="button" className="ab-icon-btn" aria-label="이전 게임" disabled={active <= 0} onClick={() => step('left')}>
                <ChevronLeft size={22} />
              </button>
              <button type="button" className="ab-icon-btn" aria-label="다음 게임" disabled={active >= GAMES.length - 1} onClick={() => step('right')}>
                <ChevronRight size={22} />
              </button>
            </span>
          )}
          <button
            type="button"
            className="machine-start ab-pixel"
            disabled={!canPlay}
            aria-label={canPlay ? `${current.name} 플레이` : currentUnlocked ? `${current.name} 준비 중` : `${current.name} 잠김`}
            onClick={() => onPlay(current.id)}
          >
            {canPlay ? '플레이' : currentUnlocked ? '준비 중' : <Lock size={26} />}
          </button>
        </div>
      </section>

      <section className={canClaimAttendance ? 'coin-door ab-card' : 'coin-door ab-card is-done'} aria-label="출석 보상">
        <span className="coin-door-slot" aria-hidden="true">
          <i />
          <b />
        </span>
        <div className="coin-door-text">
          <p className="coin-door-title">출석 보상</p>
          <p className="coin-door-desc">
            {canClaimAttendance
              ? `하루 한 번 코인 ${ATTENDANCE_COINS}개를 받을 수 있어요`
              : (claimedMessage ?? '오늘 보상을 받았어요. 내일 다시 받을 수 있어요')}
          </p>
        </div>
        <button
          type="button"
          className="ab-btn ab-btn--sm ab-btn--ghost coin-door-button"
          onClick={onClaim}
          disabled={!canClaimAttendance || claimTargets.length === 0}
        >
          {canClaimAttendance ? '받기' : '받음'}
        </button>
      </section>

      <div className="home-tiles">
        <button type="button" className="home-tile ab-card" onClick={onOpenShop}>
          <ArcadeIcon name="bag" size={32} />
          <span className="home-tile-title">상점</span>
          <span className="home-tile-desc">{shopGame.name} 꾸미기 아이템을 코인으로 사요</span>
        </button>
        {API_BASE && (
          <button type="button" className="home-tile ab-card" onClick={onOpenLeaderboard}>
            <ArcadeIcon name="trophy" size={32} />
            <span className="home-tile-title">순위표</span>
            <span className="home-tile-desc">다른 사람들과 기록을 겨뤄요</span>
          </button>
        )}
      </div>

      <p className="home-note">
        새 게임이 계속 추가될 예정이에요.{' '}
        {serverStatus === 'online'
          ? '코인과 기록은 서버에 저장돼서 기기를 바꿔도 이어져요.'
          : '코인과 기록은 이 기기에 먼저 저장되고, 서버에 연결되면 함께 저장돼요.'}
      </p>

      {exitOpen && (
        <div className="exit-overlay" onClick={() => setExitOpen(false)}>
          <section
            className="game-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 id="exit-title" className="dialog-title">
              아케이드박스를 종료할까요?
            </h2>
            <p className="dialog-body">모은 코인과 기록은 저장돼 있어요.</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={() => setExitOpen(false)}>
                계속하기
              </button>
              <button type="button" className="btn btn-secondary" onClick={exitApp}>
                종료하기
              </button>
            </div>
          </section>
        </div>
      )}

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
                    <GameIcon id={g.id} size={16} /> {g.name} 코인 {ATTENDANCE_COINS}개
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

/** 오락기 화면 한 장: 게임 그림 + 이름. 잠긴 게임은 그림을 어둡게 하고 열리는 조건을 보여 준다 */
function GameScreen({ game, save }: { game: GameDef; save: SaveData }) {
  const unlocked = save.unlocked.includes(game.id);
  if (unlocked) {
    return (
      <>
        <GameArt id={game.id} />
        <div className="machine-title">
          <h2 className="machine-name">
            <span className="ab-stripe">{game.name}</span>
          </h2>
          <p className="machine-desc">{game.playable ? game.description : '열렸어요. 곧 플레이할 수 있어요'}</p>
        </div>
      </>
    );
  }
  const rule = game.unlock;
  const progress = rule ? unlockProgress(rule, save) : null;
  return (
    <>
      <span className="machine-art-dim">
        <GameArt id={game.id} />
      </span>
      <div className="machine-locked">
        <h2 className="machine-name">
          <span className="ab-stripe ab-stripe--pink">{game.name}</span>
        </h2>
        {rule && progress && (
          <>
            <p className="machine-desc">{unlockHint(rule)}</p>
            {rule.kind === 'score' && (
              <>
                <span className="machine-progress" aria-hidden="true">
                  <span style={{ width: `${(progress.current / progress.target) * 100}%` }} />
                </span>
                <p className="machine-desc ab-pixel">
                  {progress.current.toLocaleString()} / {progress.target.toLocaleString()}
                </p>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** 잠긴 게임이 열리는 조건 한 줄 */
function unlockHint(rule: UnlockRule): string {
  if (rule.kind === 'score') return `${getGame(rule.gameId).name} ${rule.score.toLocaleString()}점을 넘기면 열려요`;
  const stage = boardLabel(rule.stage);
  return `${stage}${objectParticle(stage)} 깨면 열려요`;
}
