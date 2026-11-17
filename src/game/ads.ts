import { loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import { useCallback, useEffect, useRef, useState } from 'react';
import { setSfxSuspended } from './sfx';

/**
 * 보상형 광고 그룹 ID.
 * 개발과 QR 테스트에서는 반드시 테스트 ID를 쓴다(실제 ID로 테스트하면 정책 위반).
 * 출시 빌드에서만 콘솔에서 발급받은 ID를 환경 변수 VITE_REWARDED_AD_GROUP_ID로 넣는다.
 */
export const TEST_REWARDED_AD_GROUP_ID = 'ait-ad-test-rewarded-id';
export const REWARDED_AD_GROUP_ID: string =
  (import.meta.env.VITE_REWARDED_AD_GROUP_ID as string | undefined) || TEST_REWARDED_AD_GROUP_ID;

export type RewardedAdStatus = 'unsupported' | 'loading' | 'ready' | 'showing' | 'failed';

export type ShowResult = 'rewarded' | 'closed-early' | 'failed';

function isSupported(): boolean {
  try {
    return loadFullScreenAd.isSupported() && showFullScreenAd.isSupported();
  } catch {
    return false;
  }
}

/**
 * 화면에 들어올 때 광고를 미리 불러 두고(load), 버튼을 누르면 보여 준다(show).
 * 보상은 userEarnedReward 이벤트에서만 준다. 광고가 닫히면 다음 광고를 다시 불러 둔다.
 */
export function useRewardedAd(adGroupId: string = REWARDED_AD_GROUP_ID) {
  const [supported] = useState(isSupported);
  const [status, setStatus] = useState<RewardedAdStatus>(supported ? 'loading' : 'unsupported');
  const unregisterLoad = useRef<(() => void) | null>(null);
  const unregisterShow = useRef<(() => void) | null>(null);
  const alive = useRef(true);

  const load = useCallback(() => {
    if (!supported) return;
    unregisterLoad.current?.();
    setStatus('loading');
    try {
      unregisterLoad.current = loadFullScreenAd({
        options: { adGroupId },
        onEvent: (event) => {
          if (alive.current && event.type === 'loaded') setStatus('ready');
        },
        onError: () => {
          if (alive.current) setStatus('failed');
        },
      });
    } catch {
      setStatus('failed');
    }
  }, [adGroupId, supported]);

  useEffect(() => {
    alive.current = true;
    if (supported) {
      // 화면 진입 직후 미리 불러 둔다 (버튼을 누를 때 불러오지 않는다)
      const id = window.setTimeout(load, 0);
      return () => {
        window.clearTimeout(id);
        alive.current = false;
        unregisterLoad.current?.();
        unregisterShow.current?.();
        setSfxSuspended(false);
      };
    }
    return () => {
      alive.current = false;
    };
  }, [load, supported]);

  /** 광고를 보여 준다. 끝까지 보면 onReward가 한 번 불린다 */
  const show = useCallback(
    (onReward: () => void, onDone: (result: ShowResult) => void) => {
      if (status !== 'ready') return;
      setStatus('showing');
      setSfxSuspended(true);
      let rewarded = false;
      let finished = false;
      let fallback: number | undefined;
      const finish = (result: ShowResult) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(fallback);
        setSfxSuspended(false);
        unregisterShow.current?.();
        unregisterShow.current = null;
        onDone(result);
        // 이미 보여 준 광고는 다시 쓸 수 없으니 다음 광고를 불러 둔다
        if (alive.current) load();
      };
      try {
        unregisterShow.current = showFullScreenAd({
          options: { adGroupId },
          onEvent: (event) => {
            if (event.type === 'userEarnedReward' && !rewarded) {
              rewarded = true;
              onReward();
              // 일부 앱 버전은 dismissed를 보내지 않아서, 보상 뒤에는 오래 기다리지 않는다
              fallback = window.setTimeout(() => finish('rewarded'), 20000);
            } else if (event.type === 'dismissed') {
              finish(rewarded ? 'rewarded' : 'closed-early');
            } else if (event.type === 'failedToShow') {
              finish('failed');
            }
          },
          onError: () => finish(rewarded ? 'rewarded' : 'failed'),
        });
      } catch {
        finish('failed');
      }
    },
    [adGroupId, load, status],
  );

  return { status, show, reload: load };
}
