import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import type { HapticKind, Insets, KeyValueStore, Platform } from '../types';

/**
 * 안드로이드 앱 플랫폼(Capacitor) — @capacitor/*를 쓰는 유일한 곳.
 * 첫 버전은 기기에만 저장하고 서버·결제·광고·공유를 쓰지 않는다(null).
 * 화면 방향은 AndroidManifest의 screenOrientation="portrait"로 고정한다.
 */

const storage: KeyValueStore = {
  async getItem(key) {
    try {
      return (await Preferences.get({ key })).value;
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    try {
      await Preferences.set({ key, value });
    } catch {
      // 저장 실패는 플레이를 막지 않는다
    }
  },
  async removeItem(key) {
    try {
      await Preferences.remove({ key });
    } catch {
      // 무시
    }
  },
};

/** 토스 진동 타입을 안드로이드 진동으로 바꾼다 */
function vibrate(kind: HapticKind): Promise<void> {
  switch (kind) {
    case 'success':
    case 'confetti':
      return Haptics.notification({ type: NotificationType.Success });
    case 'error':
      return Haptics.notification({ type: NotificationType.Error });
    case 'wiggle':
      return Haptics.notification({ type: NotificationType.Warning });
    case 'tickMedium':
    case 'softMedium':
    case 'basicMedium':
      return Haptics.impact({ style: ImpactStyle.Medium });
    case 'tickWeak':
    case 'tap':
    case 'basicWeak':
      return Haptics.impact({ style: ImpactStyle.Light });
  }
}

/**
 * 화면 가장자리 안전 여백. 안드로이드 빌드는 viewport-fit=cover로 화면 끝까지 그리고,
 * WebView가 env(safe-area-inset-*)에 상태 바·내비게이션 바 높이를 넣어 준다(Capacitor SystemBars).
 */
function readInsets(): Insets {
  if (typeof document === 'undefined' || !document.body) return { top: 0, bottom: 0, left: 0, right: 0 };
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const s = getComputedStyle(probe);
  const insets = {
    top: parseFloat(s.paddingTop) || 0,
    right: parseFloat(s.paddingRight) || 0,
    bottom: parseFloat(s.paddingBottom) || 0,
    left: parseFloat(s.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

const androidPlatform: Platform = {
  id: 'android',
  // 위쪽에 플랫폼이 그리는 바가 없어서 상태 바 바로 아래에 살짝만 띄운다
  navBarOffset: 12,
  storage,
  userKey: async () => null,
  serverAuthCode: null,

  haptic(kind) {
    void vibrate(kind).catch(() => undefined);
  },

  safeArea: {
    get: readInsets,
    subscribe(listener) {
      const update = () => listener(readInsets());
      window.addEventListener('resize', update);
      // 처음 그려진 뒤 시스템 바 높이가 들어오는 경우가 있어 한 번 더 읽는다
      const timer = window.setTimeout(update, 300);
      return () => {
        window.removeEventListener('resize', update);
        window.clearTimeout(timer);
      };
    },
  },

  onBack(handler) {
    const listener = App.addListener('backButton', () => handler());
    return () => {
      void listener.then((l) => l.remove()).catch(() => undefined);
    };
  },

  exit() {
    void App.exitApp().catch(() => undefined);
  },

  lockPortrait() {
    // AndroidManifest에서 세로로 고정한다
  },

  payments: null,
  ads: null,
  share: null,
};

export default androidPlatform;
