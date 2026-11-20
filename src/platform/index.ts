import impl from '@platform-impl';
import type { Platform } from './types';

/**
 * 지금 빌드의 플랫폼. 구현은 vite.config.ts가 빌드 모드로 고른다(토스 미니앱: toss, 안드로이드: android).
 * 앱 코드는 SDK를 직접 부르지 않고 이 객체만 쓴다.
 */
export const platform: Platform = impl;

export type { HapticKind, Insets, Payments, Platform, PurchaseOutcome, RewardedAds } from './types';
