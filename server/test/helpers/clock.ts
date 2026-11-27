import type { Clock } from '../../src/shared/time.ts';

function parse(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`시각이 아니에요: ${iso}`);
  return ms;
}

/** 테스트가 마음대로 돌리는 시계. `set`으로 옮기고 `advance`로 흘려보낸다 */
export function fakeClock(iso: string): Clock & { set(iso: string): void; advance(ms: number): void } {
  let at = parse(iso);
  return Object.assign(() => new Date(at), {
    set(next: string) {
      at = parse(next);
    },
    advance(ms: number) {
      at += ms;
    },
  });
}
