import type { Db } from '../shared/db/index.ts';
import type { Route } from '../shared/http/index.ts';
import { listOrders, parseOrderPage, purchaseWithCoins } from './service.ts';

export interface OrderDeps {
  db: Db;
}

export function routes(deps: OrderDeps): Route[] {
  const { db } = deps;
  return [
    {
      // 코인으로 사기 (스펙 5.6). 누가 사는지는 세션에서만 정하고, 주문의 시각은 요청을 받은 시각이다.
      // 본문은 `{ productId, idempotencyKey? }`이고 가격은 서버가 읽는다. 답은 주문, 산 상품, 새 잔액이다.
      // 사람이 누르는 속도로는 분당 20번을 넘지 않는다 (다시 보내는 것까지 넉넉히)
      method: 'POST',
      path: '/v2/shop/purchase',
      auth: 'required',
      limit: { by: 'user', perMinute: 20 },
      async handle(ctx) {
        return purchaseWithCoins(db, ctx.session!.userId, await ctx.json(), ctx.now);
      },
    },
    {
      // 내 구매 기록, 최신부터 쪽 단위로 (스펙 5.10). 누구의 기록인지는 세션에서만 정한다.
      // 영수증 원문과 스토어 토큰은 주지 않는다
      method: 'GET',
      path: '/v2/me/orders',
      auth: 'required',
      async handle(ctx) {
        return listOrders(db, ctx.session!.userId, parseOrderPage(ctx.query));
      },
    },
  ];
}
