import { useEffect, useState } from 'react';
import { platform, type Insets } from '../platform';

export type { Insets } from '../platform';

/**
 * 화면 위쪽에 플랫폼이 그리는 것(토스 게임 내비게이션 바)과 겹치지 않도록 상단 안전 여백에 더 띄울 높이.
 * 토스 미니앱은 내비게이션 바 높이, 안드로이드 앱은 상태 바 아래 숨 쉴 틈만큼이다.
 */
export const NAV_BAR_OFFSET = platform.navBarOffset;

/** 화면 가장자리 안전 여백 (노치·상태 바·홈 표시줄) */
export function useSafeArea(): Insets {
  const [insets, setInsets] = useState<Insets>(platform.safeArea.get);
  useEffect(() => platform.safeArea.subscribe(setInsets), []);
  return insets;
}
