/** '동작 줄이기' 설정이면 화면 흔들림·번쩍임을 끈다 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
