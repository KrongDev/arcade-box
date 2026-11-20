import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { haptic } from '../../game/haptic';
import { playSfx } from '../../game/sfx';
import { unlockHeadline, unlockName, type UnlockNotice } from '../../game/unlocks';
import { GameIcon } from '../ArcadeIcon';
import '../../styles/game-dialog.css';
import '../../styles/unlock.css';

/**
 * 잠금 해제 연출 — 자물쇠가 떨리다(shake) 부서지고(break) 열린 것을 보여 준다(reveal).
 * 결과 창 위에 뜨고, 새로 열린 것이 여러 개면 차례로 보여 준 뒤 onDone을 부른다.
 * 연출 중에 누르면 바로 카드로 넘어가고, '동작 줄이기' 설정이면 처음부터 카드만 보여 준다.
 */

const SHAKE_MS = 650;
const BREAK_MS = 700;
const CELL = 7;

/* 16×17칸 픽셀 자물쇠. K 윤곽, s·w·d 고리(밝은 면·빛·그늘), Y·y·A 몸통(면·빛·그늘) */
const LOCK = [
  '.....KKKKKK.....',
  '....KwwsssdK....',
  '...KwsKKKKsdK...',
  '...KsK....KdK...',
  '...KsK....KdK...',
  '...KsK....KdK...',
  '...KsK....KdK...',
  '..KKKKKKKKKKKK..',
  '..KyyyyyyyyyyK..',
  '..KyYYYYYYYYAK..',
  '..KyYYYKKYYYAK..',
  '..KyYYKKKKYYAK..',
  '..KyYYKKKKYYAK..',
  '..KyYYYKKYYYAK..',
  '..KyYYYKKYYYAK..',
  '..KAAAAAAAAAAK..',
  '..KKKKKKKKKKKK..',
];
const COLORS: Record<string, string> = {
  K: '#1c1d22',
  s: '#d6dbe6',
  w: '#ffffff',
  d: '#8f97ab',
  Y: '#ffd93d',
  y: '#fff3a8',
  A: '#c98a00',
};
const COLS = LOCK[0].length;
const ROWS = LOCK.length;

/** 자물쇠 칸을 색별 path 하나로 묶는다 (조각마다 viewBox만 바꿔 같은 그림을 잘라 쓴다) */
const LOCK_PATHS = (() => {
  const byColor = new Map<string, string>();
  LOCK.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      byColor.set(ch, `${byColor.get(ch) ?? ''}M${x} ${y}h1v1h-1z`);
    }),
  );
  return [...byColor].map(([ch, d]) => ({ fill: COLORS[ch], d }));
})();

interface Piece {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 날아가는 거리(px)와 회전 */
  dx: number;
  dy: number;
  r: number;
}

/** 고리 한 조각 + 몸통 6조각(가로 3 × 세로 2) */
const PIECES: Piece[] = [
  { x: 3, y: 0, w: 10, h: 7, dx: 18, dy: -150, r: 70 },
  { x: 2, y: 7, w: 4, h: 5, dx: -130, dy: -70, r: -80 },
  { x: 6, y: 7, w: 4, h: 5, dx: 10, dy: -110, r: 40 },
  { x: 10, y: 7, w: 4, h: 5, dx: 135, dy: -60, r: 95 },
  { x: 2, y: 12, w: 4, h: 5, dx: -120, dy: 90, r: -120 },
  { x: 6, y: 12, w: 4, h: 5, dx: -15, dy: 130, r: 60 },
  { x: 10, y: 12, w: 4, h: 5, dx: 125, dy: 100, r: 140 },
];

const SPARKS = Array.from({ length: 14 }, (_, i) => i * (360 / 14));

function LockSvg({ x = 0, y = 0, w = COLS, h = ROWS, className, style }: { x?: number; y?: number; w?: number; h?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} width={w * CELL} height={h * CELL} viewBox={`${x} ${y} ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true">
      {LOCK_PATHS.map((p) => (
        <path key={p.fill} fill={p.fill} d={p.d} />
      ))}
    </svg>
  );
}

type Phase = 'shake' | 'break' | 'reveal';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function UnlockCelebration({ notices, onDone }: { notices: UnlockNotice[]; onDone: () => void }) {
  const [reduced] = useState(prefersReducedMotion);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>(reduced ? 'reveal' : 'shake');
  const notice = notices[index];

  // 떨림 → 부서짐 → 카드. 새 항목마다 다시 재생한다
  useEffect(() => {
    if (reduced) {
      haptic('success', 0);
      return;
    }
    playSfx('lockShake');
    haptic('wiggle', 0);
    const toBreak = window.setTimeout(() => {
      setPhase('break');
      playSfx('unlock');
      haptic('confetti', 0);
    }, SHAKE_MS);
    const toReveal = window.setTimeout(() => setPhase('reveal'), SHAKE_MS + BREAK_MS);
    return () => {
      window.clearTimeout(toBreak);
      window.clearTimeout(toReveal);
    };
  }, [index, reduced]);

  const advance = useCallback(() => {
    if (phase !== 'reveal') {
      setPhase('reveal');
      return;
    }
    if (index < notices.length - 1) {
      setIndex(index + 1);
      setPhase(reduced ? 'reveal' : 'shake');
    } else {
      onDone();
    }
  }, [phase, index, notices.length, onDone, reduced]);

  if (!notice) return null;
  const last = index === notices.length - 1;

  return (
    <div className="unlock-overlay" onClick={advance}>
      <section
        key={index}
        className={`unlock-stage is-${phase}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-title"
        aria-describedby="unlock-desc"
      >
        {phase !== 'reveal' && (
          <div className="unlock-lock" style={{ width: COLS * CELL, height: ROWS * CELL }}>
            {phase === 'shake' ? (
              <LockSvg className="unlock-lock-whole" />
            ) : (
              <>
                <span className="unlock-burst" aria-hidden="true" />
                {SPARKS.map((deg) => (
                  <span key={deg} className="unlock-spark" style={{ '--a': `${deg}deg` } as CSSProperties} aria-hidden="true" />
                ))}
                {PIECES.map((p) => (
                  <LockSvg
                    key={`${p.x}-${p.y}`}
                    x={p.x}
                    y={p.y}
                    w={p.w}
                    h={p.h}
                    className="unlock-piece"
                    style={{ left: p.x * CELL, top: p.y * CELL, '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--r': `${p.r}deg` } as CSSProperties}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {phase === 'reveal' && (
          <div className="unlock-card" onClick={(ev) => ev.stopPropagation()}>
            <h2 id="unlock-title" className="ab-plate unlock-title">
              <span className="ab-stripe">잠금 해제!</span>
            </h2>
            <p className="unlock-name">
              <span className="unlock-icon">
                <GameIcon id={notice.gameId} size={32} />
              </span>
              {unlockName(notice)}
            </p>
            <p id="unlock-desc" className="unlock-desc">
              {unlockHeadline(notice)}
            </p>
            <button type="button" className="btn btn-primary unlock-button" onClick={advance} autoFocus>
              {last ? '좋아요' : '다음'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
