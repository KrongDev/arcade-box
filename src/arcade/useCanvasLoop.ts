import { useEffect, useRef, type RefObject } from 'react';

/**
 * 캔버스 게임 루프 — 캔버스를 무대 크기에 맞춰(게임 좌표 비율 유지, 고해상도 화면 대응) 키우고,
 * 화면이 그려질 때마다 frame(지난 프레임부터 흐른 초, 게임 좌표로 맞춘 그리기 도구)을 부른다.
 * frame은 늘 최신 것을 부르므로 렌더마다 새로 만들어도 루프가 다시 시작되지 않는다.
 */
export function useCanvasLoop(
  stageRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  width: number,
  height: number,
  frame: (dt: number, ctx: CanvasRenderingContext2D) => void,
): void {
  const frameRef = useRef(frame);
  useEffect(() => {
    frameRef.current = frame;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !stage || !ctx) return;

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const scale = Math.max(0.1, Math.min(rect.width / width, rect.height / height));
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.style.width = `${width * scale}px`;
      canvas.style.height = `${height * scale}px`;
      canvas.width = Math.round(width * scale * dpr);
      canvas.height = Math.round(height * scale * dpr);
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      frameRef.current(dt, ctx);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [stageRef, canvasRef, width, height]);
}
