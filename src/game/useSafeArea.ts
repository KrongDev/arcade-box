import { SafeAreaInsets } from '@apps-in-toss/web-framework';
import { useEffect, useState } from 'react';

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * 게임 앱은 내비게이션 바를 투명 배경으로 쓰므로 콘텐츠가 바 아래까지 올라온다.
 * 바의 더보기·닫기 버튼과 겹치지 않도록 상단 안전 여백에 이만큼 더 띄운다.
 */
export const NAV_BAR_OFFSET = 52;

function readInsets(): Insets {
  try {
    return SafeAreaInsets.get() ?? ZERO;
  } catch {
    return ZERO;
  }
}

export function useSafeArea(): Insets {
  const [insets, setInsets] = useState<Insets>(readInsets);

  useEffect(() => {
    try {
      return SafeAreaInsets.subscribe({ onEvent: setInsets });
    } catch {
      return undefined;
    }
  }, []);

  return insets;
}
