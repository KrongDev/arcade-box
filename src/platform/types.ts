/**
 * 플랫폼 모듈 — 앱이 돌아가는 곳(토스 미니앱, 안드로이드 앱)마다 달라지는 기능의 모양.
 * 앱 코드는 이 인터페이스만 알고, 구현은 빌드할 때 하나를 골라 넣는다(vite.config.ts의 @platform-impl).
 * 플랫폼에 없는 기능은 null이다 — 화면은 null이면 그 기능을 숨긴다.
 */

export type PlatformId = 'toss' | 'android';

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 키-값 저장소 (기기에 남는다) */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** 진동 종류 — 토스 진동 타입 이름을 그대로 쓰고, 다른 플랫폼은 가까운 진동으로 바꾼다 */
export type HapticKind =
  | 'tickWeak'
  | 'tap'
  | 'tickMedium'
  | 'softMedium'
  | 'basicWeak'
  | 'basicMedium'
  | 'success'
  | 'error'
  | 'wiggle'
  | 'confetti';

export type PurchaseOutcome = { kind: 'success' } | { kind: 'canceled' } | { kind: 'pending' } | { kind: 'error'; message: string };

export interface OrderRecord {
  orderId: string;
  sku: string;
  status: 'COMPLETED' | 'REFUNDED';
  date: string;
}

/** 인앱결제 — 상품 ID(sku)로만 다룬다. 아이템과의 연결은 앱(game/iap.ts)이 한다 */
export interface Payments {
  canPurchase(): boolean;
  /** 결제창을 띄운다. grant는 실제로 지급했을 때만 true. 돌려준 함수로 정리한다 */
  purchase(sku: string, grant: (orderId: string) => boolean, done: (outcome: PurchaseOutcome) => void): () => void;
  /** 결제는 됐지만 지급을 마치지 못한 주문 */
  pendingOrders(): Promise<{ orderId: string; sku: string | null }[]>;
  completeGrant(orderId: string): Promise<void>;
  canReadHistory(): boolean;
  /** 구매·환불 내역 한 쪽. 다음 쪽이 없으면 nextKey가 null */
  historyPage(key: string | null): Promise<{ orders: OrderRecord[]; nextKey: string | null }>;
  /** 상품 ID별 표시 가격(예: "3,300원") */
  displayPrices(): Promise<Record<string, string>>;
}

/** 보상형 광고 — 미리 불러 두고(load) 버튼을 누르면 보여 준다(show) */
export interface RewardedAds {
  isSupported(): boolean;
  load(adGroupId: string, on: { loaded: () => void; failed: () => void }): () => void;
  show(adGroupId: string, on: { rewarded: () => void; dismissed: () => void; failed: () => void }): () => void;
}

export interface Platform {
  id: PlatformId;
  /** 화면 위쪽에 플랫폼이 그리는 것(토스 게임 내비게이션 바)을 피해 더 띄울 높이 */
  navBarOffset: number;
  storage: KeyValueStore;
  /** 이 기기 저장을 사용자별로 나누는 키. 나눌 필요가 없으면 null */
  userKey(): Promise<string | null>;
  /** 서버 로그인용 일회용 인증 코드를 받는다. 서버에 연결하지 않는 플랫폼은 null */
  serverAuthCode: (() => Promise<string>) | null;
  haptic(kind: HapticKind): void;
  safeArea: {
    get(): Insets;
    subscribe(listener: (insets: Insets) => void): () => void;
  };
  /** 뒤로가기(토스 뒤로가기, 안드로이드 뒤로 버튼). 해제 함수를 돌려준다 */
  onBack(handler: () => void): () => void;
  /** 앱(미니앱) 닫기 */
  exit(): void;
  /** 화면을 세로로 고정 */
  lockPortrait(): void;
  payments: Payments | null;
  ads: RewardedAds | null;
  /** 문구와 앱 링크를 공유한다 */
  share: ((text: string) => Promise<'shared' | 'failed'>) | null;
}
