import { useEffect, type RefObject } from 'react';
import { platform } from '../platform';

/**
 * 게임 화면 공통 조작 — 뒤로가기와 앱 전환.
 * 뒤로가기: 플레이 중이면 일시정지 창을 띄우고, 일시정지 창에서 한 번 더 누르면 그만하고 나가고,
 * 판이 끝난 뒤에는 홈으로 나간다 (뒤로가기로 항상 나갈 수 있어야 한다 — 출시 체크리스트·광고 정책).
 * 앱이 백그라운드로 가면(광고·결제·전화 등) 자동으로 멈춘다.
 */
export function useGameControls(
  phaseRef: RefObject<string>,
  { pause, quit, exit }: { pause: () => void; quit: () => void; exit: () => void },
): void {
  useEffect(() => {
    const onBack = () => {
      if (phaseRef.current === 'playing') pause();
      else if (phaseRef.current === 'paused') quit();
      else exit();
    };
    return platform.onBack(onBack);
  }, [phaseRef, pause, quit, exit]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pause]);
}
