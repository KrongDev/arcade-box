import { Device, type HapticFeedbackType } from '@apps-in-toss/web-framework';

let lastAt = 0;
let enabled = true;

export function setHapticEnabled(on: boolean): void {
  enabled = on;
}

/**
 * 진동 피드백. 앱 브릿지를 짧은 간격으로 과하게 부르지 않도록 최소 간격을 둔다.
 * 실패해도 게임은 그대로 진행한다.
 */
export function haptic(type: HapticFeedbackType, minGapMs = 90): void {
  if (!enabled) return;
  const now = performance.now();
  if (now - lastAt < minGapMs) return;
  lastAt = now;
  try {
    void Device.triggerHaptic({ type }).catch(() => undefined);
  } catch {
    // 지원하지 않는 환경
  }
}
