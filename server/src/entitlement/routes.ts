import type { Db } from '../shared/db/index.ts';
import type { Route } from '../shared/http/index.ts';
import { obj } from '../shared/validate.ts';
import { equip, listEquipped } from './service.ts';

export interface EntitlementDeps {
  db: Db;
}

export function routes(deps: EntitlementDeps): Route[] {
  const { db } = deps;
  return [
    {
      // 장착 (스펙 5.10). 가진 아이템만 된다. 바뀐 뒤의 장착 목록을 준다
      method: 'PUT',
      path: '/v2/me/equipped',
      auth: 'required',
      async handle(ctx) {
        const body = obj(await ctx.json(), 'body');
        const userId = ctx.session!.userId;
        await equip(db, userId, body.productId);
        return { equipped: await listEquipped(db, userId) };
      },
    },
  ];
}
