import { graniteEvent } from '@apps-in-toss/web-framework';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArcadeIcon } from '../components/ArcadeIcon';
import { Coin, Lock, Pause } from '../components/gameIcons';
import { abilityLines } from '../game/catalog';
import { CURRENCY } from '../game/currency';
import { mapLook, minesweeperGear, tileLook } from '../game/equipped';
import { haptic } from '../game/haptic';
import { playSfx } from '../game/sfx';
import { shareWithLink } from '../game/share';
import { useSave } from '../game/save-context';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import {
  COIN_VALUE,
  DIFFICULTIES,
  chord,
  createBoard,
  flagCount,
  formatTime,
  getDifficulty,
  isWon,
  openCell,
  shieldExplosion,
  spreadSteps,
  runStats,
  scoreRun,
  stageKey,
  toggleFlag,
  type Board,
  type DifficultyId,
  type RunStats,
  type ScoreBreakdown,
} from '../minesweeper/board';
import { useBoardGestures } from '../minesweeper/useBoardGestures';
import '../styles/arcade.css';
import '../styles/game-dialog.css';
import './Minesweeper.css';

/** 확대 1배일 때 칸 크기 — 터치 영역 44px */
const CELL = 44;

function useBackEvent(handler: () => void) {
  useEffect(() => {
    try {
      return graniteEvent.addEventListener('backEvent', { onEvent: handler, onError: () => undefined });
    } catch {
      return undefined;
    }
  }, [handler]);
}

export default function Minesweeper({ onExit }: { onExit: () => void }) {
  const [playing, setPlaying] = useState<{ id: DifficultyId; run: number } | null>(null);
  const backToSelect = useCallback(() => setPlaying(null), []);

  if (playing) {
    return (
      <MinesweeperPlay
        key={`${playing.id}-${playing.run}`}
        difficultyId={playing.id}
        onSelect={backToSelect}
        onRetry={() => setPlaying({ id: playing.id, run: playing.run + 1 })}
      />
    );
  }
  return <DifficultySelect onExit={onExit} onStart={(id) => setPlaying({ id, run: 0 })} />;
}

/* ───────────── 난이도 선택 ───────────── */

function DifficultySelect({ onExit, onStart }: { onExit: () => void; onStart: (id: DifficultyId) => void }) {
  const { save } = useSave();
  const insets = useSafeArea();
  useBackEvent(onExit);
  const gear = minesweeperGear(save);
  const gearRows = [gear.tile, gear.map].map((item) => ({ item, lines: abilityLines(item) }));

  return (
    <main className="ms-select ab-page" style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 24 }}>
      <header className="ms-select-header">
        <h1 className="ms-select-title">
          지뢰찾기
        </h1>
        <p className="ms-select-subtitle">숫자를 보고 지뢰를 피해 모든 칸을 열어요</p>
        <p className="ab-chip ms-wallet">
          <Coin game="minesweeper" /> 지뢰찾기 코인 <strong>{(save.coins.minesweeper ?? 0).toLocaleString()}</strong>
        </p>
        <ul className="ms-gear" aria-label="장착한 아이템">
          {gearRows.map(({ item, lines }) => (
            <li key={item.id} className="ms-gear-row">
              <span className="ms-gear-name">{item.name}</span>
              <span className="ms-gear-ability">{lines.length > 0 ? lines.join(' · ') : '능력 없음'}</span>
            </li>
          ))}
        </ul>
      </header>

      <ul className="ms-levels">
        {DIFFICULTIES.map((d) => {
          const unlocked = d.requires === null || save.cleared.includes(stageKey(d.requires));
          const bestScore = save.bestScore[stageKey(d.id)];
          const bestTime = save.bestTime[stageKey(d.id)];
          const extra = gear.extraCoins[DIFFICULTIES.indexOf(d)] ?? 0;
          const spec = `${d.cols}×${d.rows} · 지뢰 ${d.mines}개 · 동전 ${d.coins + extra}개`;
          if (!unlocked) {
            return (
              <li key={d.id}>
                <div className={`ms-level is-${d.id} is-locked`} aria-disabled="true">
                  <LevelIcon level={d.id} />
                  <span className="ms-level-body">
                    <span className="ms-level-name">
                      {d.name} <Lock size={16} />
                    </span>
                    <span className="ms-level-spec">{spec}</span>
                    <span className="ms-level-meta">{getDifficulty(d.requires as DifficultyId).name}을 깨면 열려요</span>
                  </span>
                </div>
              </li>
            );
          }
          return (
            <li key={d.id}>
              <button type="button" className={`ms-level is-${d.id}`} onClick={() => onStart(d.id)}>
                <LevelIcon level={d.id} />
                <span className="ms-level-body">
                  <span className="ms-level-name">{d.name}</span>
                  <span className="ms-level-spec">{spec}</span>
                  <span className="ms-level-meta">
                    {bestScore !== undefined
                      ? `최고 ${bestScore.toLocaleString()}점${bestTime !== undefined ? ` · 최단 ${formatTime(bestTime)}` : ''}`
                      : '아직 기록이 없어요'}
                  </span>
                </span>
                <span className="ms-level-cta">시작</span>
              </button>
            </li>
          );
        })}
      </ul>

      <section className="ms-howto" aria-label="하는 방법">
        <h2 className="ms-howto-title">
          하는 방법
        </h2>
        <ul className="ms-howto-list">
          <li>칸을 누르면 열리고, 길게 누르면 깃발을 꽂아요.</li>
          <li>숫자는 주변 8칸에 있는 지뢰 수예요. 첫 칸은 항상 안전해요.</li>
          <li>숨은 동전을 찾으면 코인 {COIN_VALUE}개를 받아요.</li>
          <li>연 칸, 지뢰에 맞게 꽂은 깃발, 클리어, 빠른 시간으로 점수를 매겨요. 못 깬 판도 점수가 나요.</li>
          <li>판이 크면 두 손가락으로 확대·축소하고 한 손가락으로 움직여요.</li>
        </ul>
      </section>

      <button type="button" className="ab-btn ab-btn--ghost ab-btn--block ms-home-button" onClick={onExit}>
        홈으로
      </button>
    </main>
  );
}

/** 난이도 아이콘 — 판 크기만큼 칸이 늘어나는 작은 격자 */
function LevelIcon({ level }: { level: DifficultyId }) {
  const n = level === 'easy' ? 3 : level === 'normal' ? 4 : 5;
  const gap = 2;
  const size = (40 - gap * (n - 1)) / n;
  const mine = n * n - 2;
  return (
    <span className="ms-level-icon" aria-hidden="true">
      <svg viewBox="0 0 40 40" width="40" height="40">
        {Array.from({ length: n * n }, (_, i) => (
          <rect
            key={i}
            x={(i % n) * (size + gap)}
            y={Math.floor(i / n) * (size + gap)}
            width={size}
            height={size}
            rx={Math.min(3, size / 3)}
            fill={i === mine ? 'currentColor' : i % 3 === 0 ? '#ffffff' : 'rgba(255,255,255,0.55)'}
          />
        ))}
      </svg>
    </span>
  );
}

/* ───────────── 플레이 ───────────── */

type Phase = 'ready' | 'playing' | 'paused' | 'won' | 'lost';

interface Result {
  won: boolean;
  seconds: number;
  score: ScoreBreakdown;
  bestScore: number;
  isBestScore: boolean;
  coins: number;
  bonus: number;
  unlockedName: string | null;
}

function MinesweeperPlay({
  difficultyId,
  onSelect,
  onRetry,
}: {
  difficultyId: DifficultyId;
  onSelect: () => void;
  onRetry: () => void;
}) {
  const diff = getDifficulty(difficultyId);
  const { addCoins, recordClear, recordStageScore, submitRun, save } = useSave();
  const tiles = tileLook(save);
  const map = mapLook(save);
  // 장착 능력·이펙트는 판을 시작할 때 정한다
  const [gear] = useState(() => minesweeperGear(save));
  const insets = useSafeArea();

  // 판은 한 판 동안 같은 객체를 고쳐 쓰고, setVersion으로 다시 그린다
  const [board] = useState<Board>(() => createBoard(diff, gear.extraCoins[DIFFICULTIES.indexOf(diff)] ?? 0));
  /** 남은 지뢰 보호, 쓴 횟수 */
  const [shieldsLeft, setShieldsLeft] = useState(gear.shield);
  const shieldsUsed = useRef(0);
  /** 발판 능력으로 생긴 코인 소수점 */
  const coinCarry = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>('ready');
  const clock = useRef({ accumulated: 0, since: null as number | null });
  const coinsRef = useRef(0);
  const settledRef = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const [, setVersion] = useState(0);
  const [phase, setPhaseState] = useState<Phase>('ready');
  const [seconds, setSeconds] = useState(0);
  const [coins, setCoins] = useState(0);
  const [flagMode, setFlagMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  /** 판이 끝난 뒤 결과 창을 보이는지 — 지뢰를 밟으면 폭발·지뢰 공개 연출을 먼저 보여 준다 */
  const [showResult, setShowResult] = useState(false);
  const [shaking, setShaking] = useState(false);
  const fxTimers = useRef<number[]>([]);
  useEffect(() => () => fxTimers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (fn: () => void, ms: number) => {
    fxTimers.current.push(window.setTimeout(fn, ms));
  };

  const rerender = () => setVersion((v) => v + 1);
  /** 마지막으로 열린 칸들의 등장 지연(ms) — 누른 곳에서 번지듯 열린다 */
  const [openDelays, setOpenDelays] = useState<Map<number, number>>(() => new Map());
  const rippleMs = useRef(0);
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const elapsed = () => {
    const c = clock.current;
    return (c.accumulated + (c.since !== null ? performance.now() - c.since : 0)) / 1000;
  };
  const stopClock = () => {
    const c = clock.current;
    if (c.since !== null) {
      c.accumulated += performance.now() - c.since;
      c.since = null;
    }
  };

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /** 찾은 동전(+클리어 보너스)을 한 번만 지급한다 */
  /**
   * 판을 마무리한다: 찾은 동전(+클리어 보너스)을 한 번만 지급하고, 점수를 기록하고, 판 결과를 서버에 보낸다.
   * 못 깬 판(지뢰를 밟음·그만하기)도 연 칸과 깃발로 점수가 난다.
   */
  const settle = useCallback(
    (bonus: number, stats: RunStats) => {
      const score = scoreRun(diff, stats);
      if (settledRef.current) return { score, best: { isBest: false, best: score.total } };
      settledRef.current = true;
      const coins = coinsRef.current + bonus;
      addCoins('minesweeper', coins);
      const best = recordStageScore(stageKey(diff.id), score.total);
      submitRun({ board: stageKey(diff.id), coins, ...stats });
      return { score, best };
    },
    [addCoins, recordStageScore, submitRun, diff],
  );

  const finish = (won: boolean) => {
    stopClock();
    const secs = elapsed();
    setSeconds(secs);
    const stats = runStats(board, won, secs, shieldsUsed.current);
    if (won) {
      const r = recordClear(stageKey(diff.id), stats.seconds);
      const next = DIFFICULTIES.find((d) => d.requires === diff.id);
      const { score, best } = settle(diff.clearBonus, stats);
      haptic('confetti', 0);
      playSfx('win');
      setResult({
        won: true,
        seconds: secs,
        score,
        bestScore: best.best,
        isBestScore: best.isBest,
        coins: coinsRef.current,
        bonus: diff.clearBonus,
        unlockedName: r.firstClear && next ? next.name : null,
      });
      setPhase('won');
      // 마지막 칸들이 번지며 열리는 걸 다 본 뒤 결과를 띄운다
      later(() => setShowResult(true), Math.max(600, rippleMs.current + 350));
    } else {
      const { score, best } = settle(0, stats);
      haptic('error', 0);
      playSfx('boom');
      setResult({
        won: false,
        seconds: secs,
        score,
        bestScore: best.best,
        isBestScore: best.isBest,
        coins: coinsRef.current,
        bonus: 0,
        unlockedName: null,
      });
      setPhase('lost');
      setShaking(true);
      later(() => setShaking(false), 450);
      later(() => setShowResult(true), revealDuration(board) + 1000);
    }
  };

  const act = (index: number, mode: 'open' | 'flag') => {
    const p = phaseRef.current;
    if (p !== 'ready' && p !== 'playing') return;
    const b = board;
    const cell = b.cells[index];

    if (mode === 'flag' && !cell.open) {
      if (toggleFlag(b, index)) {
        haptic('tap', 0);
        playSfx('flag');
        rerender();
      }
      return;
    }

    const wasOpen = b.cells.map((c) => c.open);
    const res = cell.open ? chord(b, index) : openCell(b, index);
    if (res.opened === 0 && !res.boom) return;

    // 누른 칸부터 번지듯 열리도록 칸마다 지연을 준다 (넓게 열릴수록 한 걸음 간격을 줄여 0.75초 안에 끝낸다)
    const fresh = new Set<number>();
    b.cells.forEach((c, i) => {
      if (c.open && !c.mine && !wasOpen[i]) fresh.add(i);
    });
    const steps = spreadSteps(b, [index], fresh);
    let maxStep = 0;
    for (const [i, d] of steps) if (fresh.has(i)) maxStep = Math.max(maxStep, d);
    const stepMs = maxStep > 0 ? Math.min(42, 750 / maxStep) : 0;
    const delays = new Map<number, number>();
    for (const [i, d] of steps) if (fresh.has(i)) delays.set(i, Math.round(d * stepMs));
    setOpenDelays(delays);
    rippleMs.current = maxStep * stepMs;

    if (p === 'ready') {
      clock.current.since = performance.now();
      setPhase('playing');
    }
    // 지뢰를 밟았는데 보호가 남아 있으면 막고 계속한다 (그 판 점수는 깎인다)
    let shielded = false;
    if (res.boom && shieldsLeft > 0) {
      shieldExplosion(b);
      shieldsUsed.current += 1;
      setShieldsLeft((n) => n - 1);
      shielded = true;
      haptic('error', 0);
      playSfx('blast');
      setShaking(true);
      later(() => setShaking(false), 450);
      showToast('지뢰 보호가 막았어요 · 이번 판 점수는 30% 깎여요');
    }

    if (res.coins > 0) {
      coinCarry.current += res.coins * COIN_VALUE * (1 + gear.coinValue);
      const gained = Math.floor(coinCarry.current);
      coinCarry.current -= gained;
      coinsRef.current += gained;
      setCoins(coinsRef.current);
      haptic('success', 0);
      playSfx('coin');
      showToast(`동전을 찾았어요 · 코인 +${gained}`);
    } else if (!res.boom) {
      haptic('tickWeak');
      playSfx('open');
    }
    // 번지는 동안 '톡톡' 소리를 몇 번 이어 준다
    if (!res.boom && maxStep >= 3) {
      const ticks = Math.min(6, Math.floor(maxStep / 2));
      for (let k = 1; k <= ticks; k++) later(() => playSfx('open'), Math.round((rippleMs.current * k) / ticks));
    }

    if (res.boom && !shielded) finish(false);
    else if (isWon(b)) finish(true);
    rerender();
  };

  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const shareRecord = async (score: number) => {
    if (sharing) return;
    setSharing(true);
    setShareError(false);
    const r = await shareWithLink(`지뢰찾기 ${diff.name}에서 ${score.toLocaleString()}점을 냈어요. 이 점수, 넘을 수 있나요? 💣`);
    setSharing(false);
    setShareError(r === 'failed');
  };

  const cellAt = (clientX: number, clientY: number): number => {
    const el = contentRef.current;
    if (!el) return -1;
    const rect = el.getBoundingClientRect();
    const col = Math.floor(((clientX - rect.left) / rect.width) * diff.cols);
    const row = Math.floor(((clientY - rect.top) / rect.height) * diff.rows);
    if (col < 0 || row < 0 || col >= diff.cols || row >= diff.rows) return -1;
    return row * diff.cols + col;
  };

  useBoardGestures(viewportRef, contentRef, {
    contentWidth: diff.cols * CELL,
    contentHeight: diff.rows * CELL,
    initialScale: 'fitWidth',
    minScale: 0.6,
    maxScale: 1.6,
    onTap: (x, y) => {
      const i = cellAt(x, y);
      if (i >= 0) act(i, flagMode ? 'flag' : 'open');
    },
    onLongPress: (x, y) => {
      const i = cellAt(x, y);
      if (i >= 0) act(i, 'flag');
    },
  });

  // 시계 표시
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = window.setInterval(() => setSeconds(elapsed()), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const pause = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    stopClock();
    setSeconds(elapsed());
    setPhase('paused');
  }, [setPhase]);

  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    clock.current.since = performance.now();
    setPhase('playing');
  }, [setPhase]);

  const quit = useCallback(() => {
    settle(0, runStats(board, false, elapsed(), shieldsUsed.current));
    onSelect();
  }, [onSelect, settle, board]);

  // 뒤로가기: 시작 전이면 난이도 선택으로, 플레이 중이면 일시정지 창, 일시정지 창에서 한 번 더 누르면 그만하기
  // (뒤로가기로 항상 나갈 수 있어야 한다 — 출시 체크리스트·광고 정책)
  const onBack = useCallback(() => {
    const p = phaseRef.current;
    if (p === 'ready') onSelect();
    else if (p === 'playing') pause();
    else if (p === 'paused') quit();
    else if (!showResult) setShowResult(true);
    else onSelect();
  }, [onSelect, pause, quit, showResult]);
  useBackEvent(onBack);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause]);

  const minesLeft = diff.mines - flagCount(board);
  const ended = phase === 'won' || phase === 'lost';
  const revealDelays = useMemo(() => mineRevealDelays(board, phase === 'lost'), [board, phase]);

  return (
    <div
      className="ms-play"
      style={
        {
          paddingTop: insets.top + NAV_BAR_OFFSET,
          '--ms-bg': map.bg,
          '--ms-closed': tiles.closed,
          '--ms-closed-edge': tiles.closedEdge,
          '--ms-open': tiles.open,
          '--ms-open-edge': tiles.openEdge,
          '--ms-ink': map.ink,
          '--ms-ink-sub': map.inkSub,
          '--ms-coin-ink': CURRENCY.minesweeper.ink,
        } as CSSProperties
      }
    >
      <header className="ms-hud">
        <button
          type="button"
          className="ms-hud-button"
          aria-label={phase === 'ready' ? '난이도 선택으로' : '일시정지'}
          onClick={phase === 'ready' ? onSelect : pause}
          disabled={ended}
        >
          <Pause size={22} />
        </button>
        <div className="ms-hud-center">
          <span className="ms-hud-label">{diff.name}</span>
          <strong className="ms-hud-time">{formatTime(seconds)}</strong>
        </div>
        <div className="ms-hud-side">
          <span aria-label={`남은 지뢰 ${minesLeft}개`}>
            <ArcadeIcon name="flag" size={20} /> {minesLeft}
          </span>
          {gear.shield > 0 && (
            <span className={shieldsLeft > 0 ? 'ms-hud-shield' : 'ms-hud-shield is-used'} aria-label={`남은 지뢰 보호 ${shieldsLeft}번`}>
              <ArcadeIcon name="shield" size={20} /> {shieldsLeft}
            </span>
          )}
          <span className="ms-hud-coins">
            <Coin game="minesweeper" /> +{coins}
          </span>
        </div>
      </header>

      {map.motif && (
        <ArcadeIcon name={map.motif} size={132} className="ms-motif" />
      )}
      <div className={shaking ? 'ms-viewport is-shaking' : 'ms-viewport'} ref={viewportRef}>
        <div
          className={[
            'ms-board',
            `pat-${tiles.pattern}`,
            gear.effect.open ? `fx-open-${gear.effect.open}` : '',
            gear.effect.coinGlow ? 'fx-coin-glow' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          ref={contentRef}
          role="grid"
          aria-label={`${diff.name} 판 ${diff.cols}×${diff.rows}`}
          style={{ gridTemplateColumns: `repeat(${diff.cols}, ${CELL}px)`, width: diff.cols * CELL }}
        >
          {board.cells.map((cell, i) => (
            <CellView
              key={i}
              open={cell.open}
              flag={cell.flag}
              mine={cell.mine}
              adj={cell.adj}
              coin={cell.coin}
              exploded={board.exploded === i}
              shielded={cell.shielded}
              phase={phase}
              revealDelay={revealDelays[i]}
              openDelay={openDelays.get(i)}
            />
          ))}
          {phase === 'lost' && board.exploded !== null && (
            <div
              className="ms-blast"
              aria-hidden="true"
              style={{
                left: (board.exploded % diff.cols) * CELL,
                top: Math.floor(board.exploded / diff.cols) * CELL,
                width: CELL,
                height: CELL,
              }}
            />
          )}
        </div>

        {phase === 'ready' && (
          <div className="ms-hint">
            <p className="ms-hint-title">아무 칸이나 눌러 시작해요</p>
            <p className="ms-hint-desc">첫 칸은 항상 안전해요. 길게 누르면 깃발을 꽂아요.</p>
          </div>
        )}
        {toast && (
          <div className="ms-toast" role="status">
            {toast}
          </div>
        )}
      </div>

      <footer className="ms-toolbar" style={{ paddingBottom: Math.max(34, insets.bottom + 12) }}>
        {ended ? (
          <div className="ms-end-actions">
            <button type="button" className="btn btn-primary" onClick={() => setShowResult(true)} disabled={!result}>
              결과 보기
            </button>
            <button type="button" className="btn btn-secondary" onClick={onRetry}>
              다시 하기
            </button>
          </div>
        ) : (
        <div className="ms-mode" role="group" aria-label="누르면 할 동작">
          <button
            type="button"
            className={flagMode ? 'ms-mode-button' : 'ms-mode-button is-active'}
            aria-pressed={!flagMode}
            onClick={() => setFlagMode(false)}
          >
            <ArcadeIcon name="shovel" size={22} /> 열기
          </button>
          <button
            type="button"
            className={flagMode ? 'ms-mode-button is-active' : 'ms-mode-button'}
            aria-pressed={flagMode}
            onClick={() => setFlagMode(true)}
          >
            <ArcadeIcon name="flag" size={22} /> 깃발
          </button>
        </div>
        )}
      </footer>

      {phase === 'paused' && (
        <div className="game-overlay">
          <section className="game-dialog" role="dialog" aria-modal="true" aria-labelledby="ms-pause-title">
            <h2 id="ms-pause-title" className="dialog-title">
              잠시 멈췄어요
            </h2>
            <p className="dialog-body">
              {formatTime(seconds)} 동안 코인 {coins}개를 찾았어요. 그만해도 찾은 코인은 받아요.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={resume}>
                계속하기
              </button>
              <button type="button" className="btn btn-secondary" onClick={quit}>
                그만하기
              </button>
            </div>
          </section>
        </div>
      )}

      {ended && result && showResult && (
        <div className="game-overlay is-soft">
          <section className="game-dialog" role="dialog" aria-modal="true" aria-labelledby="ms-result-title">
            {result.isBestScore && (
              <p className="result-badge">
                <ArcadeIcon name="party" size={20} /> 새 최고 점수
              </p>
            )}
            <h2 id="ms-result-title" className="dialog-title">
              {result.won ? `${diff.name}을 ${formatTime(result.seconds)}에 깼어요` : '지뢰를 밟았어요'}
            </h2>
            <p className="result-score">{result.score.total.toLocaleString()}점</p>
            <dl className="result-rows">
              <div className="result-row">
                <dt>연 칸</dt>
                <dd>+{result.score.cells.toLocaleString()}</dd>
              </div>
              <div className="result-row">
                <dt>깃발</dt>
                <dd>
                  {result.score.flags >= 0 ? '+' : '−'}
                  {Math.abs(result.score.flags).toLocaleString()}
                </dd>
              </div>
              {result.won && (
                <>
                  <div className="result-row">
                    <dt>클리어</dt>
                    <dd>+{result.score.clear.toLocaleString()}</dd>
                  </div>
                  <div className="result-row">
                    <dt>시간 보너스</dt>
                    <dd>+{result.score.time.toLocaleString()}</dd>
                  </div>
                </>
              )}
              {result.score.shield < 0 && (
                <div className="result-row">
                  <dt>지뢰 보호 (30% 감점)</dt>
                  <dd>−{Math.abs(result.score.shield).toLocaleString()}</dd>
                </div>
              )}
              <div className="result-row">
                <dt>최고 점수</dt>
                <dd>{result.bestScore.toLocaleString()}점</dd>
              </div>
              <div className="result-row">
                <dt>받은 코인</dt>
                <dd>
                  <Coin game="minesweeper" /> {result.coins + result.bonus}
                </dd>
              </div>
            </dl>
            {result.unlockedName && (
              <p className="result-unlock">
                <ArcadeIcon name="unlock" size={20} /> {result.unlockedName}이 열렸어요
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                다시 하기
              </button>
              {shareError && <p className="dialog-error">공유하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>}
              {result.score.total > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void shareRecord(result.score.total)}
                  disabled={sharing}
                >
                  점수 공유하기
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setShowResult(false)}>
                판 보기
              </button>
              <button type="button" className="btn btn-secondary" onClick={onSelect}>
                난이도 선택
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

const NUMBER_CLASS = ['', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'];

/** 지뢰를 하나씩 드러내는 데 쓰는 전체 시간(ms) — 지뢰가 많아도 1.4초를 넘지 않는다 */
function revealDuration(b: Board): number {
  return Math.min(1400, 250 + b.mines * 45);
}

/**
 * 진 판에서 각 지뢰 칸이 드러날 시간(ms). 터진 칸에서 가까운 지뢰부터 차례로 나온다.
 * 깃발로 이미 맞힌 지뢰와 지뢰가 아닌 칸은 undefined.
 */
function mineRevealDelays(b: Board, lost: boolean): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(b.cells.length).fill(undefined);
  if (!lost || b.exploded === null) return out;
  const ex = b.exploded;
  const er = Math.floor(ex / b.cols);
  const ec = ex % b.cols;
  const hidden = b.cells
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => c.mine && !c.flag && i !== ex)
    .map(({ i }) => ({ i, d: Math.hypot(Math.floor(i / b.cols) - er, (i % b.cols) - ec) }))
    .sort((a, b2) => a.d - b2.d);
  const span = revealDuration(b) - 250;
  const step = hidden.length > 1 ? Math.min(90, span / (hidden.length - 1)) : 0;
  hidden.forEach(({ i }, k) => {
    out[i] = 250 + Math.round(k * step);
  });
  return out;
}

const CellView = memo(function CellView({
  open,
  flag,
  mine,
  adj,
  coin,
  exploded,
  shielded,
  phase,
  revealDelay,
  openDelay,
}: {
  open: boolean;
  flag: boolean;
  mine: boolean;
  adj: number;
  coin: boolean;
  exploded: boolean;
  shielded: boolean;
  phase: Phase;
  revealDelay?: number;
  /** 이번에 열린 칸이면 등장 지연(ms) */
  openDelay?: number;
}) {
  const lost = phase === 'lost';
  const won = phase === 'won';

  if (open && !mine) {
    return (
      <div
        role="gridcell"
        className={`ms-cell is-open ${NUMBER_CLASS[adj]}${openDelay !== undefined ? ' is-opening' : ''}`}
        style={openDelay !== undefined ? ({ '--open-delay': `${openDelay}ms` } as CSSProperties) : undefined}
      >
        {adj > 0 ? adj : ''}
        {coin && <span className="ms-cell-coin"><Coin game="minesweeper" /></span>}
      </div>
    );
  }
  if (shielded) {
    return (
      <div role="gridcell" aria-label="보호로 막은 지뢰" className="ms-cell is-shielded">
        <ArcadeIcon name="shield" size={26} />
      </div>
    );
  }
  if (exploded) {
    return (
      <div role="gridcell" aria-label="밟은 지뢰" className="ms-cell is-exploded">
        <ArcadeIcon name="bomb" size={28} />
        <ArcadeIcon name="boom" size={44} className="ms-burst" />
      </div>
    );
  }
  if ((lost || won) && mine) {
    if (flag || won) {
      return (
        <div role="gridcell" aria-label="찾은 지뢰" className="ms-cell is-flag">
          <ArcadeIcon name="flag" size={26} />
        </div>
      );
    }
    return (
      <div
        role="gridcell"
        aria-label="지뢰"
        className={revealDelay !== undefined ? 'ms-cell is-mine is-revealing' : 'ms-cell is-mine'}
        style={revealDelay !== undefined ? ({ '--reveal-delay': `${revealDelay}ms` } as CSSProperties) : undefined}
      >
        <ArcadeIcon name="bomb" size={28} />
      </div>
    );
  }
  if (flag) {
    if (lost) {
      // 지뢰가 아닌 곳에 꽂은 깃발 — X로 표시
      return (
        <div role="gridcell" aria-label="잘못 꽂은 깃발" className="ms-cell is-flag is-wrong">
          <ArcadeIcon name="flag" size={26} />
          <svg className="ms-wrong-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5 L19 19 M19 5 L5 19" />
          </svg>
        </div>
      );
    }
    return (
      <div role="gridcell" className="ms-cell is-flag">
        <ArcadeIcon name="flag" size={26} />
      </div>
    );
  }
  return <div role="gridcell" className="ms-cell" />;
});
