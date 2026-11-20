import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { prefersReducedMotion } from '../arcade/motion';
import { useCanvasLoop } from '../arcade/useCanvasLoop';
import { BreakoutEngine, type BreakoutEvent } from '../breakout/engine';
import { BreakoutFx } from '../breakout/fx';
import { drawBreakout, P, type BreakoutTheme } from '../breakout/render';
import { BALLS_PER_GAME, FIELD_H, FIELD_W } from '../breakout/rules';
import { PauseDialog } from '../components/game/PauseDialog';
import { ScoreResultDialog } from '../components/game/ScoreResultDialog';
import { Coin, Pause } from '../components/gameIcons';
import { abilityLines } from '../game/catalog';
import { CURRENCY } from '../game/currency';
import { breakoutGear, breakoutLooks, equippedItem } from '../game/equipped';
import { haptic } from '../game/haptic';
import { useSave } from '../game/save-context';
import { playSfx } from '../game/sfx';
import { useGameControls } from '../game/useGameControls';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import { useScoreRun, useShareScore, type ScoreRunResult } from '../game/useScoreRun';
import '../styles/action-game.css';
import './Breakout.css';

type Phase = 'playing' | 'paused' | 'over';

interface Hud {
  score: number;
  lives: number;
  coins: number;
  stage: number;
  multiplier: number;
  ready: boolean;
}

const INITIAL_HUD: Hud = { score: 0, lives: BALLS_PER_GAME, coins: 0, stage: 1, multiplier: 1, ready: true };

const sameHud = (a: Hud, b: Hud) =>
  a.score === b.score && a.lives === b.lives && a.coins === b.coins && a.stage === b.stage && a.multiplier === b.multiplier && a.ready === b.ready;

/** 키보드로 패들을 옮기는 속력 (개발용) */
const KEY_SPEED = 420;

export default function Breakout({ onExit }: { onExit: () => void }) {
  const { save } = useSave();
  const run = useScoreRun('breakout');
  const sharer = useShareScore((score) => `벽돌깨기에서 ${score.toLocaleString()}점을 냈어요. 이 점수, 이길 수 있나요? 🧱`);
  const looks = breakoutLooks(save);
  const themeRef = useRef<BreakoutTheme>(looks);
  // 장착한 패들·벽돌의 능력은 판을 시작할 때 정한다
  const [initial] = useState(() => {
    const gear = breakoutGear(save);
    return { gear, engine: new BreakoutEngine({ gear }), fx: new BreakoutFx(prefersReducedMotion(), P) };
  });
  const gearRef = useRef(initial.gear);
  const gearLines = [...abilityLines(equippedItem(save, 'breakout', 'paddle')), ...abilityLines(equippedItem(save, 'breakout', 'bricks'))];
  const insets = useSafeArea();

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(initial.engine);
  const fxRef = useRef(initial.fx);
  const phaseRef = useRef<Phase>('playing');
  /** 패들을 움직이는 손가락 */
  const pointerRef = useRef<number | null>(null);
  const keys = useRef(new Set<'left' | 'right'>());
  const hudClock = useRef(0);

  const [phase, setPhaseState] = useState<Phase>('playing');
  const [hud, setHud] = useState<Hud>(INITIAL_HUD);
  const [result, setResult] = useState<(ScoreRunResult & { stage: number }) | null>(null);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  /** 이번 판의 점수·코인을 한 번만 저장한다 */
  const { settle: settleRun, reset: resetRun } = run;
  const settle = useCallback(() => settleRun(engineRef.current.score, engineRef.current.coinsEarned), [settleRun]);

  const releaseAll = useCallback(() => {
    pointerRef.current = null;
    keys.current.clear();
  }, []);

  const pause = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    releaseAll();
    setPhase('paused');
  }, [releaseAll, setPhase]);

  const resume = useCallback(() => {
    if (phaseRef.current === 'paused') setPhase('playing');
  }, [setPhase]);

  const quit = useCallback(() => {
    const e = engineRef.current;
    if (e.score > 0 || e.coinsEarned > 0) settle();
    onExit();
  }, [onExit, settle]);

  const { clearError } = sharer;
  const restart = useCallback(() => {
    engineRef.current = new BreakoutEngine({ gear: gearRef.current });
    fxRef.current = new BreakoutFx(prefersReducedMotion(), P);
    resetRun();
    releaseAll();
    setResult(null);
    clearError();
    setHud(INITIAL_HUD);
    setPhase('playing');
  }, [releaseAll, setPhase, resetRun, clearError]);

  useGameControls(phaseRef, { pause, quit, exit: onExit });

  const launch = useCallback(() => {
    if (phaseRef.current === 'playing' && engineRef.current.launch()) {
      haptic('tickMedium', 0);
      playSfx('launch');
    }
  }, []);

  // 엔진 이벤트 처리 — 소리·진동, 판이 끝나면 결과
  const handleEngineEvent = (ev: BreakoutEvent) => {
    switch (ev.type) {
      case 'paddle':
        haptic('tickWeak');
        playSfx('paddle');
        break;
      case 'brickHit':
        haptic('tickMedium');
        playSfx('brickTough');
        break;
      case 'brickBreak':
        haptic('tickWeak');
        playSfx('brick');
        break;
      case 'chain':
        playSfx('combo');
        break;
      case 'coin':
        haptic('tap');
        playSfx('coin');
        break;
      case 'power':
        haptic('success', 0);
        playSfx('powerUp');
        break;
      case 'ballLost':
        playSfx('drain');
        break;
      case 'lifeLost':
        haptic('error', 0);
        playSfx('drain');
        break;
      case 'stageClear':
        haptic('confetti', 0);
        playSfx('stageClear');
        break;
      case 'gameOver': {
        haptic('error', 0);
        releaseAll();
        const stage = engineRef.current.stage;
        setResult({ ...settle(), stage });
        setPhase('over');
        break;
      }
      case 'launch':
      case 'wall':
        break;
    }
  };

  // 게임 루프
  useCanvasLoop(stageRef, canvasRef, FIELD_W, FIELD_H, (dt, ctx) => {
    const e = engineRef.current;
    const fx = fxRef.current;
    if (phaseRef.current === 'playing') {
      const dir = (keys.current.has('right') ? 1 : 0) - (keys.current.has('left') ? 1 : 0);
      if (dir !== 0) e.movePaddle(e.paddle.x + dir * KEY_SPEED * Math.min(dt, 0.05));
      e.step(dt);
      for (const ev of e.drainEvents()) {
        fx.handle(ev, themeRef.current);
        handleEngineEvent(ev);
      }
      fx.trackBalls(e.balls);
      fx.update(dt);
    }
    drawBreakout(ctx, e, themeRef.current, fx);

    hudClock.current += dt;
    if (hudClock.current >= 0.1) {
      hudClock.current = 0;
      const next: Hud = { score: e.score, lives: e.lives, coins: e.coinsEarned, stage: e.stage, multiplier: e.multiplier, ready: e.state === 'ready' };
      setHud((prev) => (sameHud(prev, next) ? prev : next));
    }
  });

  // 데스크톱 개발용 키보드 조작: ←/→ 패들, Space 발사
  useEffect(() => {
    const sideOfKey = (code: string) => (code === 'ArrowLeft' ? 'left' : code === 'ArrowRight' ? 'right' : null);
    const down = (ev: KeyboardEvent) => {
      if (ev.code === 'Space' || ev.code === 'Enter') {
        if (!ev.repeat) launch();
        return;
      }
      const side = sideOfKey(ev.code);
      if (side && phaseRef.current === 'playing') keys.current.add(side);
    };
    const up = (ev: KeyboardEvent) => {
      const side = sideOfKey(ev.code);
      if (side) keys.current.delete(side);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [launch]);

  /** 손가락 x(화면) → 판 x(게임 좌표) */
  const fieldX = (clientX: number): number | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return ((clientX - rect.left) / rect.width) * FIELD_W;
  };

  const followFinger = (clientX: number) => {
    const x = fieldX(clientX);
    if (x !== null) engineRef.current.movePaddle(x);
  };

  // 손가락을 좌우로 움직이면 패들이 그 자리로 따라오고, 공이 패들 위에 있을 때 손을 떼면 발사한다
  const onPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'playing' || pointerRef.current !== null) return;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    pointerRef.current = ev.pointerId;
    followFinger(ev.clientX);
  };

  const onPointerMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== ev.pointerId || phaseRef.current !== 'playing') return;
    followFinger(ev.clientX);
  };

  const onPointerUp = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== ev.pointerId) return;
    pointerRef.current = null;
    launch();
  };

  const onPointerCancel = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current === ev.pointerId) pointerRef.current = null;
  };

  const coinColor = { '--ag-coin': CURRENCY.breakout.lcd } as CSSProperties;

  return (
    <div
      className="action-game"
      style={{ ...coinColor, paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 12, background: looks.bricks.page }}
    >
      <header className="action-hud">
        <button type="button" className="hud-pause" aria-label="일시정지" onClick={pause}>
          <Pause size={22} />
        </button>
        <div className="hud-score">
          <span className="hud-label">
            <span className="hud-tag hud-tag-stage">스테이지 {hud.stage}</span>
            {hud.multiplier > 1 && <span className="hud-tag hud-tag-mult">×{hud.multiplier}</span>}
          </span>
          <strong className="hud-score-value">{hud.score.toLocaleString()}</strong>
        </div>
        <div className="hud-side">
          <span className="hud-balls" role="img" aria-label={`남은 공 ${hud.lives}개`}>
            {Array.from({ length: BALLS_PER_GAME }, (_, i) => (
              <span key={i} className={i < hud.lives ? 'hud-ball is-on' : 'hud-ball'} />
            ))}
          </span>
          <span className="hud-coins">
            <Coin game="breakout" /> +{hud.coins}
          </span>
        </div>
      </header>

      <div
        className="action-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <canvas ref={canvasRef} className="action-canvas" aria-label="벽돌깨기 판" />

        {phase === 'playing' && hud.ready && (
          <div className="action-hint" aria-live="polite">
            <p className="action-hint-title">손을 떼면 공이 출발해요</p>
            <p className="action-hint-desc">화면을 누른 채 좌우로 움직이면 패들이 따라와요. 떨어지는 동전과 아이템은 패들로 받아요</p>
            {gearLines.length > 0 && <p className="action-hint-gear">장착 능력 · {gearLines.join(' · ')}</p>}
          </div>
        )}
      </div>

      {phase === 'paused' && <PauseDialog score={hud.score} coins={hud.coins} onResume={resume} onQuit={quit} />}

      {phase === 'over' && result && (
        <ScoreResultDialog
          game="breakout"
          result={result}
          extraRows={
            <div className="result-row">
              <dt>도달한 스테이지</dt>
              <dd>{result.stage}</dd>
            </div>
          }
          sharing={sharer.sharing}
          shareFailed={sharer.failed}
          onRetry={restart}
          onShare={() => void sharer.share(result.score)}
          onHome={onExit}
        />
      )}
    </div>
  );
}
