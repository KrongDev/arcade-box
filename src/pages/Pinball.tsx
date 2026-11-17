import { graniteEvent } from '@apps-in-toss/web-framework';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArcadeIcon } from '../components/ArcadeIcon';
import { Coin, Pause } from '../components/gameIcons';
import { abilityLines } from '../game/catalog';
import { equippedItem, pinballGear, pinballLooks } from '../game/equipped';
import { haptic } from '../game/haptic';
import { playSfx } from '../game/sfx';
import { shareWithLink } from '../game/share';
import { getGame } from '../game/registry';
import { useSave } from '../game/save-context';
import { NAV_BAR_OFFSET, useSafeArea } from '../game/useSafeArea';
import { BALLS_PER_GAME, PinballEngine, TABLE_H, TABLE_W, type PinballEvent } from '../pinball/engine';
import { PinballFx } from '../pinball/fx';
import { drawTable, type TableTheme } from '../pinball/render';
import '../styles/game-dialog.css';
import './Pinball.css';

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

interface Result {
  score: number;
  coins: number;
  isBest: boolean;
  best: number;
  unlockedNames: string[];
}

const INITIAL_HUD: Hud = { score: 0, balls: BALLS_PER_GAME, coins: 0, ready: true, charging: false, multiplier: 1, multiball: false };

/** '동작 줄이기' 설정이면 화면 흔들림·번쩍임을 끈다 */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 받침 유무에 맞춘 주격 조사 (지뢰찾기가 / 블록퍼즐이) */
function subjectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return '이(가)';
  return (code - 0xac00) % 28 === 0 ? '가' : '이';
}

export default function Pinball({ onExit }: { onExit: () => void }) {
  const { addCoins, recordScore, submitRun, save } = useSave();
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
  const phaseRef = useRef<Phase>('playing');
  const pointers = useRef(new Map<number, Side>());
  const keys = useRef(new Set<Side>());
  const settledRef = useRef(false);

  const [phase, setPhaseState] = useState<Phase>('playing');
  const [hud, setHud] = useState<Hud>(INITIAL_HUD);
  const [result, setResult] = useState<Result | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState(false);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  /** 이번 판의 점수·코인을 한 번만 저장한다 */
  const settle = useCallback((): Result => {
    const e = engineRef.current;
    if (settledRef.current) {
      return { score: e.score, coins: e.coinsEarned, isBest: false, best: e.score, unlockedNames: [] };
    }
    settledRef.current = true;
    addCoins('pinball', e.coinsEarned);
    const r = recordScore('pinball', e.score);
    submitRun({ board: 'pinball', score: e.score, coins: e.coinsEarned });
    return {
      score: e.score,
      coins: e.coinsEarned,
      isBest: r.isBest,
      best: r.best,
      unlockedNames: r.newlyUnlocked.map((id) => getGame(id).name),
    };
  }, [addCoins, recordScore, submitRun]);

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

  const restart = useCallback(() => {
    engineRef.current = new PinballEngine(Math.random, gearRef.current);
    fxRef.current = new PinballFx(prefersReducedMotion());
    fxRef.current.setSkin(gearRef.current.effect);
    settledRef.current = false;
    releaseAll();
    setResult(null);
    setShareError(false);
    setHud(INITIAL_HUD);
    setPhase('playing');
  }, [releaseAll, setPhase]);

  const shareScore = async (score: number) => {
    if (sharing) return;
    setSharing(true);
    setShareError(false);
    const r = await shareWithLink(`핀볼에서 ${score.toLocaleString()}점을 냈어요. 이 점수, 이길 수 있나요? 🕹️`);
    setSharing(false);
    setShareError(r === 'failed');
  };

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

  // 엔진 이벤트 처리 — 게임 루프는 ref로 최신 콜백을 부른다
  const onEngineEvent = useRef<(ev: PinballEvent) => void>(() => undefined);
  const handleEngineEvent = useCallback(
    (ev: PinballEvent) => {
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
      }
    },
    [releaseAll, setPhase, settle],
  );
  useEffect(() => {
    onEngineEvent.current = handleEngineEvent;
  }, [handleEngineEvent]);

  // 게임 루프 + 캔버스 크기 맞춤
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !stage || !ctx) return;

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const scale = Math.max(0.1, Math.min(rect.width / TABLE_W, rect.height / TABLE_H));
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.style.width = `${TABLE_W * scale}px`;
      canvas.style.height = `${TABLE_H * scale}px`;
      canvas.width = Math.round(TABLE_W * scale * dpr);
      canvas.height = Math.round(TABLE_H * scale * dpr);
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    let raf = 0;
    let last = performance.now();
    let hudClock = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
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
          onEngineEvent.current(ev);
        }
        fx.trackBalls(e.balls);
        fx.update(dt);
      }
      drawTable(ctx, e, themeRef.current, fx);

      hudClock += dt;
      if (hudClock >= 0.1) {
        hudClock = 0;
        const next: Hud = {
          score: e.score,
          balls: e.ballsLeft,
          coins: e.coinsEarned,
          ready: e.ballState === 'ready',
          charging: e.charging,
          multiplier: e.multiplier,
          multiball: e.isMultiball,
        };
        setHud((prev) =>
          prev.score === next.score &&
          prev.balls === next.balls &&
          prev.coins === next.coins &&
          prev.ready === next.ready &&
          prev.charging === next.charging &&
          prev.multiplier === next.multiplier &&
          prev.multiball === next.multiball
            ? prev
            : next,
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  // 뒤로가기: 플레이 중이면 일시정지 창을 띄우고, 일시정지 창이나 결과 화면에서 한 번 더 누르면 홈으로 나간다
  // (뒤로가기로 항상 나갈 수 있어야 한다 — 출시 체크리스트·광고 정책)
  useEffect(() => {
    const onBack = () => {
      if (phaseRef.current === 'playing') pause();
      else if (phaseRef.current === 'paused') quit();
      else onExit();
    };
    try {
      return graniteEvent.addEventListener('backEvent', { onEvent: onBack, onError: () => undefined });
    } catch {
      return undefined;
    }
  }, [onExit, pause, quit]);

  // 앱이 백그라운드로 가면(광고·결제·전화 등) 자동으로 멈춘다
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause]);

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
      className="pinball"
      style={{ paddingTop: insets.top + NAV_BAR_OFFSET, paddingBottom: insets.bottom + 12, background: looks.table.page }}
    >
      <header className="pinball-hud">
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
            <Coin /> +{hud.coins}
          </span>
        </div>
      </header>

      <div
        className="pinball-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <canvas ref={canvasRef} className="pinball-canvas" aria-label="핀볼 테이블" />

        {phase === 'playing' && hud.ready && !hud.charging && (
          <div className="pinball-hint" aria-live="polite">
            <p className="pinball-hint-title">화면을 누르고 있다가 떼면 공이 발사돼요</p>
            <p className="pinball-hint-desc">오래 누를수록 세게 나가요. 공이 들어가면 왼쪽·오른쪽을 눌러 플리퍼를 움직여요</p>
            {gearLines.length > 0 && <p className="pinball-hint-gear">장착 능력 · {gearLines.join(' · ')}</p>}
          </div>
        )}
      </div>

      {phase === 'paused' && (
        <div className="game-overlay">
          <section className="game-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <h2 id="pause-title" className="dialog-title">
              잠시 멈췄어요
            </h2>
            <p className="dialog-body">
              지금까지 {hud.score.toLocaleString()}점, 코인 {hud.coins}개를 모았어요. 그만해도 모은 코인은 받아요.
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

      {phase === 'over' && result && (
        <div className="game-overlay">
          <section className="game-dialog" role="dialog" aria-modal="true" aria-labelledby="result-title">
            {result.isBest && (
              <p className="result-badge">
                <ArcadeIcon name="party" size={20} /> 새 최고 기록
              </p>
            )}
            <h2 id="result-title" className="dialog-title">
              게임이 끝났어요
            </h2>
            <p className="result-score">{result.score.toLocaleString()}점</p>
            <dl className="result-rows">
              <div className="result-row">
                <dt>최고 기록</dt>
                <dd>{result.best.toLocaleString()}점</dd>
              </div>
              <div className="result-row">
                <dt>받은 코인</dt>
                <dd>
                  <Coin /> {result.coins}
                </dd>
              </div>
            </dl>
            {result.unlockedNames.map((name) => (
              <p key={name} className="result-unlock">
                <ArcadeIcon name="unlock" size={20} /> 새 게임 {name}
                {subjectParticle(name)} 열렸어요
              </p>
            ))}
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={restart}>
                다시 하기
              </button>
              {shareError && <p className="dialog-error">공유하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>}
              {result.score > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void shareScore(result.score)}
                  disabled={sharing}
                >
                  점수 공유하기
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={onExit}>
                홈으로
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
