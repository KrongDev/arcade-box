import { IAP } from '@apps-in-toss/web-framework';
import type { OrderRecord, Payments, PurchaseOutcome } from '../types';

/** 토스 인앱결제 — 평생 소장형(비소모성) 상품 */

function supported(fn: { isSupported: () => boolean }): boolean {
  try {
    return fn.isSupported();
  } catch {
    return false;
  }
}

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

const FALLBACK_ERROR = '결제하지 못했어요. 잠시 뒤 다시 시도해 주세요.';

export const tossPayments: Payments = {
  canPurchase() {
    return supported(IAP.createOneTimePurchaseOrder);
  },

  purchase(sku, grant, done) {
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
          else finish({ kind: 'error', message: (code && ERROR_MESSAGES[code]) || FALLBACK_ERROR });
        },
      });
    } catch (error) {
      finish({ kind: 'error', message: ERROR_MESSAGES[errorCode(error) ?? ''] ?? FALLBACK_ERROR });
    }

    return () => {
      finished = true;
      cleanup?.();
      cleanup = null;
    };
  },

  async pendingOrders() {
    if (!supported(IAP.getPendingOrders)) return [];
    const res = await IAP.getPendingOrders();
    return (res?.orders ?? []).map((o) => ({ orderId: o.orderId, sku: o.sku ?? null }));
  },

  async completeGrant(orderId) {
    await IAP.completeProductGrant({ params: { orderId } });
  },

  canReadHistory() {
    return supported(IAP.getCompletedOrRefundedOrders);
  },

  async historyPage(key) {
    const res = await IAP.getCompletedOrRefundedOrders(key ? { key } : undefined);
    if (!res) throw new Error('history_unavailable');
    const orders: OrderRecord[] = res.orders.map((o) => ({ orderId: o.orderId, sku: o.sku, status: o.status, date: o.date }));
    return { orders, nextKey: res.hasNext ? (res.nextKey ?? null) : null };
  },

  async displayPrices() {
    if (!supported(IAP.getProductItemList)) return {};
    const res = await IAP.getProductItemList();
    const prices: Record<string, string> = {};
    for (const p of res?.products ?? []) prices[p.sku] = p.displayAmount;
    return prices;
  },
};
