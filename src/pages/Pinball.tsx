import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { prefersReducedMotion } from '../arcade/motion';
import { useCanvasLoop } from '../arcade/useCanvasLoop';
import { PauseDialog } from '../components/game/PauseDialog';
import { ScoreResultDialog } from '../components/game/ScoreResultDialog';
import { Coin, Pause } from '../components/gameIcons';
import { abilityLines } from '../game/catalog';
import { equippedItem, pinballGear, pinballLooks } from '../game/equipped';
import { haptic } from '../game/haptic';
import { playSfx } from '../game/sfx';
import { useGameControls } from '../game/useGameControls';
import { useScoreRun, useShareScore, type ScoreRunResult } from '../game/useScoreRun';
import { useSave } from '../game/save-context';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import { cameraTarget, focusBall, snapCamera, stepCamera } from '../pinball/camera';
import { BALLS_PER_GAME, PinballEngine, type PinballEvent } from '../pinball/engine';
import { PinballFx } from '../pinball/fx';
import { drawTable, type TableTheme } from '../pinball/render';
import { VIEW_H, VIEW_W } from '../pinball/table';
import '../styles/action-game.css';

type Phase = 'playing' | 'paused' | 'over';
type Side = 'left' | 'right';

interface Hud {
  score: number;
  balls: number;
  coins: number;
  ready: boolean;
  charging: boolean;
  multiplier: number;
  multiball: boolean;
}

const INITIAL_HUD: Hud = { score: 0, balls: BALLS_PER_GAME, coins: 0, ready: true, charging: false, multiplier: 1, multiball: false };

const sameHud = (a: Hud, b: Hud) =>
  a.score === b.score &&
  a.balls === b.balls &&
  a.coins === b.coins &&
  a.ready === b.ready &&
  a.charging === b.charging &&
  a.multiplier === b.multiplier &&
  a.multiball === b.multiball;

export default function Pinball({ onExit }: { onExit: () => void }) {
  const { save } = useSave();
  const run = useScoreRun('pinball');
  const sharer = useShareScore((score) => `핀볼에서 ${score.toLocaleString()}점을 냈어요. 이 점수, 이길 수 있나요? 🕹️`);
  const looks = pinballLooks(save);
  const themeRef = useRef<TableTheme>({ ...looks.table, ...looks.ball });
  // 장착한 판·공의 능력과 이펙트는 판을 시작할 때 정한다
  const [initial] = useState(() => {
    const gear = pinballGear(save);
    const fx = new PinballFx(prefersReducedMotion());
    fx.setSkin(gear.effect);
    return { gear, engine: new PinballEngine(Math.random, gear), fx };
  });
  const gearRef = useRef(initial.gear);
  const gearLines = [...abilityLines(equippedItem(save, 'pinball', 'table')), ...abilityLines(equippedItem(save, 'pinball', 'ball'))];
  const insets = useSafeArea();

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(initial.engine);
  const fxRef = useRef(initial.fx);
  /** 화면에 보이는 범위의 위쪽 끝 — 판이 화면보다 길어서 공을 따라 움직인다. 공이 없으면 맨 아래(발사대) */
  const cameraRef = useRef(cameraTarget(null));
  const phaseRef = useRef<Phase>('playing');
  const pointers = useRef(new Map<number, Side>());
  const keys = useRef(new Set<Side>());
  const hudClock = useRef(0);

  const [phase, setPhaseState] = useState<Phase>('playing');
  const [hud, setHud] = useState<Hud>(INITIAL_HUD);
  const [result, setResult] = useState<ScoreRunResult | null>(null);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  /** 이번 판의 점수·코인을 한 번만 저장한다 */
  const { settle: settleRun } = run;
  const settle = useCallback(() => settleRun(engineRef.current.score, engineRef.current.coinsEarned), [settleRun]);

  const syncFlippers = useCallback(() => {
    const e = engineRef.current;
    const sides = new Set<Side>([...pointers.current.values(), ...keys.current]);
    e.setFlipper('left', sides.has('left'));
    e.setFlipper('right', sides.has('right'));
  }, []);

  /** 스프링을 당기고 있는 손가락(또는 키보드) — 떼면 발사한다 */
  const chargeInput = useRef<number | 'key' | null>(null);

  const releaseAll = useCallback(() => {
    pointers.current.clear();
    keys.current.clear();
    chargeInput.current = null;
    engineRef.current.cancelCharge();
    syncFlippers();
  }, [syncFlippers]);

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

  const { reset: resetRun } = run;
  const { clearError } = sharer;
  const restart = useCallback(() => {
    engineRef.current = new PinballEngine(Math.random, gearRef.current);
    fxRef.current = new PinballFx(prefersReducedMotion());
    fxRef.current.setSkin(gearRef.current.effect);
    cameraRef.current = cameraTarget(null);
    resetRun();
    releaseAll();
    setResult(null);
    clearError();
    setHud(INITIAL_HUD);
    setPhase('playing');
  }, [releaseAll, setPhase, resetRun, clearError]);

  useGameControls(phaseRef, { pause, quit, exit: onExit });

  /** 발사대에 공이 있으면 스프링을 당기기 시작한다. 당기기 시작했으면 true */
  const startCharge = useCallback((input: number | 'key') => {
    if (phaseRef.current !== 'playing' || chargeInput.current !== null) return false;
    if (!engineRef.current.startCharge()) return false;
    chargeInput.current = input;
    haptic('tickWeak', 0);
    return true;
  }, []);

  /** 당기던 입력을 떼면 당긴 만큼의 힘으로 발사한다 */
  const releaseCharge = useCallback((input: number | 'key') => {
    if (chargeInput.current !== input) return;
    chargeInput.current = null;
    const e = engineRef.current;
    const power = e.charge;
    if (phaseRef.current === 'playing' && e.release()) {
      haptic(power > 0.66 ? 'basicMedium' : 'tickMedium', 0);
      playSfx('launch');
    }
  }, []);

  // 엔진 이벤트 처리 — 소리·진동, 판이 끝나면 결과
  const handleEngineEvent = (ev: PinballEvent) => {
    switch (ev.type) {
      case 'flip':
        playSfx('flip');
        break;
      case 'bumper':
        haptic('tickMedium');
        playSfx('bumper');
        break;
      case 'sling':
        haptic('tickMedium');
        playSfx('sling');
        break;
      case 'target':
        haptic('tap');
        playSfx('target');
        break;
      case 'bank':
        haptic('success', 0);
        playSfx('bank');
        break;
      case 'rollover':
        haptic('tickWeak');
        playSfx('rollover');
        break;
      case 'lanes':
        haptic('success', 0);
        playSfx('lanes');
        break;
      case 'saucer':
        haptic(ev.jackpot ? 'confetti' : 'basicMedium', 0);
        playSfx(ev.jackpot ? 'jackpot' : 'saucer');
        break;
      case 'multiball':
        haptic('confetti', 0);
        playSfx('multiball');
        break;
      case 'ballSaved':
        haptic('success', 0);
        playSfx('ballSave');
        break;
      case 'combo':
        playSfx('combo');
        break;
      case 'coin':
        haptic('tap');
        playSfx('coin');
        break;
      case 'milestone':
        haptic('success', 0);
        playSfx('milestone');
        break;
      case 'drain':
        haptic('error', 0);
        playSfx('drain');
        break;
      case 'gameOver':
        releaseAll();
        setResult(settle());
        setPhase('over');
        break;
      case 'launch':
        if (ev.auto) playSfx('launch');
        break;
      case 'multiballEnd':
        break;
      case 'kickback':
        haptic('success', 0);
        playSfx('kickback');
        break;
      case 'standup':
        haptic('tap');
        playSfx('target');
        break;
      case 'standupBank':
        haptic('success', 0);
        playSfx('bank');
        break;
      case 'spinner':
        playSfx('spinner');
        break;
      case 'bonus':
        haptic('basicMedium', 0);
        playSfx('bonus');
        break;
      case 'ramp':
        haptic('success', 0);
        playSfx('ramp');
        break;
      case 'atticTarget':
        haptic('tap');
        playSfx('target');
        break;
      case 'jackpotLit':
        haptic('success', 0);
        playSfx('bank');
        break;
      case 'atticHole':
        haptic(ev.jackpot ? 'confetti' : 'basicMedium', 0);
        playSfx(ev.jackpot ? 'jackpot' : 'saucer');
        break;
      case 'rail':
        haptic('tickWeak');
        playSfx('rail');
        break;
      case 'railEnd':
      case 'nudge':
        break;
      default: {
        // 새 사건을 더하고 여기서 빠뜨리면 타입 검사에서 걸린다
        const unhandled: never = ev;
        return unhandled;
      }
    }
  };

  // 게임 루프
  useCanvasLoop(stageRef, canvasRef, VIEW_W, VIEW_H, (dt, ctx) => {
    const e = engineRef.current;
    const fx = fxRef.current;
    if (phaseRef.current === 'playing') {
      e.step(dt);
      for (const ev of e.drainEvents()) {
        fx.handle(ev, themeRef.current);
        if (fx.handleSkin(ev)) {
          playSfx('blast');
          haptic('basicMedium');
        }
        handleEngineEvent(ev);
      }
      fx.trackBalls(e.balls);
      fx.update(dt);
      const focus = focusBall(e.balls);
      cameraRef.current = stepCamera(cameraRef.current, cameraTarget(focus), focus ? focus.y : null, dt);
    }
    drawTable(ctx, e, themeRef.current, fx, snapCamera(cameraRef.current));

    hudClock.current += dt;
    if (hudClock.current >= 0.1) {
      hudClock.current = 0;
      const next: Hud = {
        score: e.score,
        balls: e.ballsLeft,
        coins: e.coinsEarned,
        ready: e.ballState === 'ready',
        charging: e.charging,
        multiplier: e.multiplier,
        multiball: e.isMultiball,
      };
      setHud((prev) => (sameHud(prev, next) ? prev : next));
    }
  });

  // 데스크톱 개발용 키보드 조작: ←/Z 왼쪽, →/M 오른쪽, Space 발사
  useEffect(() => {
    const sideOfKey = (code: string): Side | null => {
      if (code === 'ArrowLeft' || code === 'KeyZ') return 'left';
      if (code === 'ArrowRight' || code === 'KeyM' || code === 'Slash') return 'right';
      return null;
    };
    const down = (ev: KeyboardEvent) => {
      if (ev.code === 'Space' || ev.code === 'Enter') {
        if (!ev.repeat) startCharge('key');
        return;
      }
      const side = sideOfKey(ev.code);
      if (!side || phaseRef.current !== 'playing') return;
      keys.current.add(side);
      syncFlippers();
    };
    const up = (ev: KeyboardEvent) => {
      if (ev.code === 'Space' || ev.code === 'Enter') {
        releaseCharge('key');
        return;
      }
      const side = sideOfKey(ev.code);
      if (!side) return;
      keys.current.delete(side);
      syncFlippers();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [syncFlippers, startCharge, releaseCharge]);

  const onPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (phaseRef.current !== 'playing') return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const side: Side = ev.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    ev.currentTarget.setPointerCapture(ev.pointerId);
    // 공이 발사대에 있으면 이 손가락은 스프링을 당긴다 (플리퍼는 움직이지 않는다)
    if (startCharge(ev.pointerId)) return;
    pointers.current.set(ev.pointerId, side);
    syncFlippers();
  };

  const onPointerEnd = (ev: ReactPointerEvent<HTMLDivElement>) => {
    releaseCharge(ev.pointerId);
    pointers.current.delete(ev.pointerId);
    syncFlippers();
  };

  return (
    <div
      className="action-game"
      style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 12, background: looks.table.page }}
    >
      <header className="action-hud">
        <button type="button" className="hud-pause" aria-label="일시정지" onClick={pause}>
          <Pause size={22} />
        </button>
        <div className="hud-score">
          <span className="hud-label">
            점수
            {hud.multiplier > 1 && <span className="hud-tag hud-tag-mult">×{hud.multiplier}</span>}
            {hud.multiball && <span className="hud-tag hud-tag-multi">멀티볼 2배</span>}
          </span>
          <strong className="hud-score-value">{hud.score.toLocaleString()}</strong>
        </div>
        <div className="hud-side">
          <span className="hud-balls" role="img" aria-label={`남은 공 ${hud.balls}개`}>
            {Array.from({ length: BALLS_PER_GAME }, (_, i) => (
              <span key={i} className={i < hud.balls ? 'hud-ball is-on' : 'hud-ball'} />
            ))}
          </span>
          <span className="hud-coins">
            <Coin game="pinball" /> +{hud.coins}
          </span>
        </div>
      </header>

      <div
        className="action-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <canvas ref={canvasRef} className="action-canvas" aria-label="핀볼 테이블" />

        {phase === 'playing' && hud.ready && !hud.charging && (
          <div className="action-hint" aria-live="polite">
            <p className="action-hint-title">화면을 누르고 있다가 떼면 공이 발사돼요</p>
            <p className="action-hint-desc">오래 누를수록 세게 나가요. 공이 들어가면 왼쪽·오른쪽을 눌러 플리퍼를 움직여요</p>
            {gearLines.length > 0 && <p className="action-hint-gear">장착 능력 · {gearLines.join(' · ')}</p>}
          </div>
        )}
      </div>

      {phase === 'paused' && <PauseDialog score={hud.score} coins={hud.coins} onResume={resume} onQuit={quit} />}

      {phase === 'over' && result && (
        <ScoreResultDialog
          game="pinball"
          result={result}
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
