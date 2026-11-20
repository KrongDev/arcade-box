import { platform, type PurchaseOutcome } from '../platform';
import { CATALOG, type ShopItem } from './catalog';

export type { PurchaseOutcome } from '../platform';

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

/** 이 플랫폼에 인앱결제가 있는지 — 없으면 유료 아이템·구매 내역을 숨긴다 */
export const paymentsAvailable = platform.payments !== null;

export function canPurchase(): boolean {
  try {
    return platform.payments?.canPurchase() ?? false;
  } catch {
    return false;
  }
}

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
  const payments = platform.payments;
  if (!sku || !payments) {
    done({ kind: 'error', message: '아직 판매를 시작하지 않은 상품이에요.' });
    return () => undefined;
  }
  ensureDevProducts();
  return payments.purchase(sku, grant, done);
}

/**
 * 결제는 됐지만 지급하지 못한 주문을 마저 지급한다. 지급에 성공한 주문만 완료 처리하고,
 * 실패하거나 모르는 상품이면 남겨 두어 다음 실행 때 다시 시도한다.
 * 지급한 주문 수를 돌려준다.
 */
export async function recoverPendingOrders(grant: (orderId: string, itemId: string) => boolean): Promise<number> {
  const payments = platform.payments;
  if (!payments) return 0;
  ensureDevProducts();
  let recovered = 0;
  try {
    for (const order of await payments.pendingOrders()) {
      const item = order.sku ? itemForSku(order.sku) : undefined;
      if (!item) continue;
      if (!grant(order.orderId, item.id)) continue;
      try {
        await payments.completeGrant(order.orderId);
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

/** 구매 내역 전체(완료·환불). 조회할 수 없으면 null — 이때는 기존 기록을 그대로 둔다 */
export async function fetchPaidOrders(): Promise<PaidOrder[] | null> {
  const payments = platform.payments;
  if (!payments) return null;
  ensureDevProducts();
  if (!payments.canReadHistory()) return null;
  const out: PaidOrder[] = [];
  try {
    let key: string | null = null;
    for (let page = 0; page < 20; page++) {
      const res: Awaited<ReturnType<typeof payments.historyPage>> = await payments.historyPage(key);
      for (const o of res.orders) {
        const item = itemForSku(o.sku);
        if (item) out.push({ orderId: o.orderId, itemId: item.id, refunded: o.status === 'REFUNDED' });
      }
      if (!res.nextKey) break;
      key = res.nextKey;
    }
    return out;
  } catch {
    return null;
  }
}

/** 콘솔에 등록한 표시 가격(예: "3,000원"). 상점에 카탈로그 가격 대신 보여 준다 */
export async function fetchDisplayPrices(): Promise<Record<string, string>> {
  const payments = platform.payments;
  if (!payments) return {};
  ensureDevProducts();
  try {
    return await payments.displayPrices();
  } catch {
    return {};
  }
}
