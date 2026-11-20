import { closeView, Device, graniteEvent, SafeAreaInsets, Screen, Share, Storage, User } from '@apps-in-toss/web-framework';
import type { Insets, KeyValueStore, Platform } from '../types';
import { tossAds } from './ads';
import { tossPayments } from './payments';

/**
 * 토스 미니앱 플랫폼 — 앱인토스 SDK(@apps-in-toss/web-framework)를 쓰는 유일한 곳.
 */

const ZERO: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

/** apps-in-toss.config.ts의 appName과 같아야 한다 */
const APP_NAME = 'arcade-box';

/** 토스 저장소. 쓸 수 없는 환경(브라우저 개발 등)이면 브라우저 저장소로 대신한다 */
const storage: KeyValueStore = {
  async getItem(key) {
    try {
      return await Storage.getItem(key);
    } catch {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }
  },
  async setItem(key, value) {
    try {
      await Storage.setItem(key, value);
    } catch {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // 저장 실패는 플레이를 막지 않는다
      }
    }
  },
  async removeItem(key) {
    try {
      await Storage.removeItem(key);
    } catch {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // 무시
      }
    }
  },
};

const tossPlatform: Platform = {
  id: 'toss',
  // 게임 앱은 내비게이션 바를 투명 배경으로 쓰므로 콘텐츠가 바 아래까지 올라온다.
  // 바의 더보기·닫기 버튼과 겹치지 않도록 상단 안전 여백에 이만큼 더 띄운다.
  navBarOffset: 52,
  storage,

  /** 게임용 사용자 식별키(hash). 게임 시작을 오래 막지 않도록 3초까지만 기다린다 */
  async userKey() {
    try {
      if (!User.getAnonymousKey.isSupported()) return null;
      const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 3000));
      const result = await Promise.race([User.getAnonymousKey(), timeout]);
      return result && result.type === 'HASH' && result.hash ? result.hash : null;
    } catch {
      return null;
    }
  },

  serverAuthCode: async () => (await User.createAnonymousKeyAuthCode()).code,

  haptic(kind) {
    try {
      void Device.triggerHaptic({ type: kind }).catch(() => undefined);
    } catch {
      // 지원하지 않는 환경
    }
  },

  safeArea: {
    get() {
      try {
        return SafeAreaInsets.get() ?? ZERO;
      } catch {
        return ZERO;
      }
    },
    subscribe(listener) {
      try {
        return SafeAreaInsets.subscribe({ onEvent: listener });
      } catch {
        return () => undefined;
      }
    },
  },

  onBack(handler) {
    try {
      return graniteEvent.addEventListener('backEvent', { onEvent: handler, onError: () => undefined });
    } catch {
      return () => undefined;
    }
  },

  exit() {
    try {
      void closeView().catch(() => undefined);
    } catch {
      // 토스 앱 밖
    }
  },

  // 지원하지 않는 토스 앱 버전에서는 아무것도 하지 않는다
  lockPortrait() {
    try {
      if (Screen.setOrientation.isSupported()) void Screen.setOrientation({ type: 'portrait' }).catch(() => undefined);
    } catch {
      // 토스 앱 밖(브라우저 개발 환경 등)
    }
  },

  payments: tossPayments,
  ads: tossAds,

  /**
   * 토스 앱에서 이 미니앱을 여는 링크를 붙여 공유 시트를 연다. 링크를 만들지 못하면 문구만 공유한다.
   * (intoss:// 링크는 정식 출시 뒤에 열린다. 출시 전에는 콘솔 QR의 테스트 스킴으로 확인한다.)
   */
  async share(text) {
    let link = '';
    try {
      link = await Share.createLink({ path: `intoss://${APP_NAME}` });
    } catch {
      link = '';
    }
    try {
      await Share.sendMessage({ message: link ? `${text}\n${link}` : text });
      return 'shared';
    } catch {
      return 'failed';
    }
  },
};

export default tossPlatform;
