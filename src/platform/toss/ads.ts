import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import type { RewardedAds } from '../types';

/** 토스 보상형 광고 — 보상은 userEarnedReward 이벤트에서만 준다 */
export const tossAds: RewardedAds = {
  isSupported() {
    try {
      return loadFullScreenAd.isSupported() && showFullScreenAd.isSupported();
    } catch {
      return false;
    }
  },

  load(adGroupId, on) {
    return loadFullScreenAd({
      options: { adGroupId },
      onEvent: (event) => {
        if (event.type === 'loaded') on.loaded();
      },
      onError: () => on.failed(),
    });
  },

  show(adGroupId, on) {
    return showFullScreenAd({
      options: { adGroupId },
      onEvent: (event) => {
        if (event.type === 'userEarnedReward') on.rewarded();
        else if (event.type === 'dismissed') on.dismissed();
        else if (event.type === 'failedToShow') on.failed();
      },
      onError: () => on.failed(),
    });
  },
};
