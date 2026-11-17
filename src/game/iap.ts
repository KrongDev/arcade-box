import { IAP } from '@apps-in-toss/web-framework';
import { CATALOG, type ShopItem } from './catalog';

/**
 * 유료 코스튬 인앱결제 — 평생 소장형(비소모성) 상품.
 *
 * 지급 기록은 기기 저장소에 주문번호(orderId) 기준으로 남긴다. 서버 검증은 하지 않는다
 * (코스튬은 게임 진행이나 재화에 영향이 없어서). 기기를 바꾸거나 앱 데이터가 지워지면
 * 토스 구매 내역(getCompletedOrRefundedOrders)으로 다시 채우고, 환불된 주문은 회수한다.
 */

/** 개발 서버에서는 콘솔 상품 ID가 없어도 devtools mock 카탈로그의 SKU로 결제 흐름을 시험한다 */
export function devSku(item: ShopItem): string {
  return `dev.${item.id}`;
}

/** 아이템에 연결된 인앱결제 상품 ID. 콘솔에 상품을 등록하기 전이면 null */
export function skuOf(item: ShopItem): string | null {
  if (item.price.type !== 'paid') return null;
  if (item.price.iapSku) return item.price.iapSku;
  return import.meta.env.DEV ? devSku(item) : null;
}

let devProductsRegistered = false;

/**
 * 개발 서버 전용: devtools mock의 인앱결제 카탈로그에 상점의 유료 아이템을 등록한다.
 * 프로덕션 빌드와 토스 앱에서는 아무것도 하지 않는다.
 */
function ensureDevProducts(): void {
  if (!import.meta.env.DEV || devProductsRegistered) return;
  const ait = (window as unknown as { __ait?: { patch: (key: string, value: unknown) => void } }).__ait;
  if (!ait) return;
  devProductsRegistered = true;
  const products = CATALOG.filter((i) => i.price.type === 'paid' && !i.price.iapSku).map((i) => ({
    sku: devSku(i),
    type: 'NON_CONSUMABLE',
    displayName: i.name,
    displayAmount: i.price.type === 'paid' ? `${i.price.krw.toLocaleString()}원` : '',
    iconUrl: '',
    description: `${i.name} (개발용 mock 상품)`,
  }));
  try {
    ait.patch('iap', { products });
  } catch {
    devProductsRegistered = false;
  }
}

export function itemForSku(sku: string): ShopItem | undefined {
  return CATALOG.find((i) => i.price.type === 'paid' && skuOf(i) === sku);
}

function supported(fn: { isSupported: () => boolean }): boolean {
  try {
    return fn.isSupported();
  } catch {
    return false;
  }
}

export function canPurchase(): boolean {
  return supported(IAP.createOneTimePurchaseOrder);
}

export type PurchaseOutcome =
  | { kind: 'success' }
  | { kind: 'canceled' }
  | { kind: 'pending' }
  | { kind: 'error'; message: string };

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; errorCode?: unknown; name?: unknown };
    for (const v of [e.code, e.errorCode, e.name]) if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_PRODUCT_ID: '지금은 살 수 없는 상품이에요.',
  NETWORK_ERROR: '네트워크 연결을 확인하고 다시 시도해 주세요.',
  INVALID_USER_ENVIRONMENT: '이 기기나 계정에서는 살 수 없는 상품이에요.',
  APP_MARKET_VERIFICATION_FAILED: '앱스토어 확인에 실패했어요. 앱스토어에 환불을 문의해 주세요.',
  TOSS_SERVER_VERIFICATION_FAILED: '결제 정보를 저장하지 못했어요. 앱을 다시 열면 아이템을 받을 수 있어요.',
  KOREAN_ACCOUNT_ONLY: '한국 계정에서만 살 수 있어요.',
  PRODUCT_NOT_GRANTED_BY_PARTNER: '아이템을 받지 못했어요. 앱을 다시 열면 다시 받을 수 있어요.',
  UNSUPPORTED_APP_VERSION: '토스 앱을 최신 버전으로 업데이트해 주세요.',
};

/**
 * 결제창을 띄운다. grant는 아이템을 실제로 지급(기기 저장)했을 때만 true를 돌려야 한다.
 * 돌려준 함수는 화면을 떠날 때도 불러 결제 리소스를 정리한다.
 */
export function purchase(
  item: ShopItem,
  grant: (orderId: string) => boolean,
  done: (outcome: PurchaseOutcome) => void,
): () => void {
  const sku = skuOf(item);
  if (!sku) {
    done({ kind: 'error', message: '아직 판매를 시작하지 않은 상품이에요.' });
    return () => undefined;
  }

  ensureDevProducts();
  let cleanup: (() => void) | null = null;
  let finished = false;
  const finish = (outcome: PurchaseOutcome) => {
    if (finished) return;
    finished = true;
    cleanup?.();
    cleanup = null;
    done(outcome);
  };

  try {
    cleanup = IAP.createOneTimePurchaseOrder({
      options: {
        sku,
        processProductGrant: ({ orderId }) => {
          try {
            return grant(orderId);
          } catch {
            return false;
          }
        },
      },
      onEvent: (event) => {
        if (event.type === 'success') finish({ kind: 'success' });
      },
      onError: (error) => {
        const code = errorCode(error);
        if (code === 'USER_CANCELED') finish({ kind: 'canceled' });
        else if (code === 'PAYMENT_PENDING') finish({ kind: 'pending' });
        else finish({ kind: 'error', message: (code && ERROR_MESSAGES[code]) || '결제하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
      },
    });
  } catch (error) {
    finish({ kind: 'error', message: ERROR_MESSAGES[errorCode(error) ?? ''] ?? '결제하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
  }

  return () => {
    finished = true;
    cleanup?.();
    cleanup = null;
  };
}

/**
 * 결제는 됐지만 지급하지 못한 주문을 마저 지급한다. 지급에 성공한 주문만 완료 처리하고,
 * 실패하거나 모르는 상품이면 남겨 두어 다음 실행 때 다시 시도한다.
 * 지급한 주문 수를 돌려준다.
 */
export async function recoverPendingOrders(grant: (orderId: string, itemId: string) => boolean): Promise<number> {
  ensureDevProducts();
  if (!supported(IAP.getPendingOrders)) return 0;
  let recovered = 0;
  try {
    const res = await IAP.getPendingOrders();
    for (const order of res?.orders ?? []) {
      const item = order.sku ? itemForSku(order.sku) : undefined;
      if (!item) continue;
      if (!grant(order.orderId, item.id)) continue;
      try {
        await IAP.completeProductGrant({ params: { orderId: order.orderId } });
        recovered++;
      } catch {
        // 완료 처리에 실패해도 지급 기록은 orderId로 남아 있어 중복 지급되지 않는다
      }
    }
  } catch {
    // 다음 실행 때 다시 시도한다
  }
  return recovered;
}

export interface PaidOrder {
  orderId: string;
  itemId: string;
  refunded: boolean;
}

/** 토스 구매 내역 전체(완료·환불). 조회할 수 없으면 null — 이때는 기존 기록을 그대로 둔다 */
export async function fetchPaidOrders(): Promise<PaidOrder[] | null> {
  ensureDevProducts();
  if (!supported(IAP.getCompletedOrRefundedOrders)) return null;
  const out: PaidOrder[] = [];
  try {
    let key: string | null = null;
    for (let page = 0; page < 20; page++) {
      const res: Awaited<ReturnType<typeof IAP.getCompletedOrRefundedOrders>> | undefined =
        await IAP.getCompletedOrRefundedOrders(key ? { key } : undefined);
      if (!res) return null;
      for (const o of res.orders) {
        const item = itemForSku(o.sku);
        if (item) out.push({ orderId: o.orderId, itemId: item.id, refunded: o.status === 'REFUNDED' });
      }
      if (!res.hasNext || !res.nextKey) break;
      key = res.nextKey;
    }
    return out;
  } catch {
    return null;
  }
}

/** 콘솔에 등록한 표시 가격(예: "3,000원"). 상점에 카탈로그 가격 대신 보여 준다 */
export async function fetchDisplayPrices(): Promise<Record<string, string>> {
  ensureDevProducts();
  if (!supported(IAP.getProductItemList)) return {};
  try {
    const res = await IAP.getProductItemList();
    const prices: Record<string, string> = {};
    for (const p of res?.products ?? []) prices[p.sku] = p.displayAmount;
    return prices;
  } catch {
    return {};
  }
}
