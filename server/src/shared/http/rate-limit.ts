/**
 * 요청 수 제한: 메모리 안의 고정 창(1분). 서버가 한 대라 메모리에서 센다.
 * 창은 그 키의 첫 요청에서 시작해 1분 뒤에 끝난다.
 *
 * 메모리가 끝없이 늘지 않게 두 가지를 한다.
 * - 창이 지난 항목은 1분에 한 번 훑어 지운다.
 * - 항목 수가 상한에 닿으면 가장 먼저 만든 것부터 지운다. 키를 계속 바꿔 보내는 쪽이 있어도
 *   상한 안에서만 돈다 (밀려난 키는 처음부터 다시 센다).
 */
const WINDOW_MS = 60_000;
const DEFAULT_MAX_KEYS = 50_000;

export interface RateLimiter {
  /** 이 요청을 받아도 되면 참. 받으면 그 키의 횟수가 하나 는다 */
  allow(key: string, perMinute: number, nowMs: number): boolean;
  /** 지금 들고 있는 항목 수 */
  size(): number;
}

export function createRateLimiter(maxKeys: number = DEFAULT_MAX_KEYS): RateLimiter {
  // Map은 넣은 순서를 지킨다. 창을 새로 열 때 지웠다 다시 넣어서, 앞쪽이 늘 가장 오래된 창이다
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = -Infinity;

  function sweep(nowMs: number) {
    lastSweep = nowMs;
    for (const [key, w] of windows) {
      if (nowMs - w.start >= WINDOW_MS) windows.delete(key);
    }
  }

  return {
    allow(key, perMinute, nowMs) {
      if (nowMs - lastSweep >= WINDOW_MS) sweep(nowMs);
      const current = windows.get(key);
      if (current && nowMs - current.start < WINDOW_MS && nowMs >= current.start) {
        if (current.count >= perMinute) return false;
        current.count += 1;
        return true;
      }
      windows.delete(key);
      while (windows.size >= maxKeys) {
        const oldest = windows.keys().next();
        if (oldest.done) break;
        windows.delete(oldest.value);
      }
      windows.set(key, { start: nowMs, count: 1 });
      return perMinute >= 1;
    },
    size: () => windows.size,
  };
}
